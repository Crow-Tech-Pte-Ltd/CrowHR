import { z } from "zod";
import type { AppContext } from "../context.ts";
import { authorize } from "./authorize.ts";
import type { Permission } from "./matrix.ts";
import { effectiveRoles } from "./scope.ts";
import { type SensitivityClass, sensitivityOf } from "./sensitivity.ts";

/**
 * Field-level sensitivity at the serialiser (design decision 7). Every response that carries
 * an employee's sensitive fields goes through `redact()`, and reports/exports call the same
 * function, so a field can't leak through a forgotten check.
 *
 *   const employeeOut = withRedactions(z.object({ name: z.string(), basicPayCents: sensitive(z.number().optional(), "salary") }));
 *   return redact(c, employeeOut, row, { employeeId: row.id });
 */

/** Which permission unlocks each class (the matrix decides who holds it, for which employees). */
export const SENSITIVITY_PERMISSION: Record<Exclude<SensitivityClass, "medical">, Permission> = {
  salary: "compensation:read",
  nric: "personal_details:read",
  bank: "bank_details:read",
};

/** Adds the optional `redactedFields` list to a response object schema. */
export function withRedactions<T extends z.ZodObject>(schema: T) {
  return schema.extend({
    redactedFields: z
      .array(z.string())
      .optional()
      .meta({ description: "Sensitive fields left out because the reader may not see them." }),
  });
}

export interface RedactContext {
  /** The employee the record belongs to. */
  employeeId: string;
  /** The reader is the assigned approver of the item this medical field is attached to. */
  assignedApproverOfItem?: boolean;
}

async function allowedClasses(c: AppContext, ctx: RedactContext): Promise<Set<SensitivityClass>> {
  const key = `redact:${ctx.employeeId}:${ctx.assignedApproverOfItem ? 1 : 0}`;
  const memo = c.get("memo");
  const hit = memo.get(key) as Set<SensitivityClass> | undefined;
  if (hit) return hit;
  const allowed = new Set<SensitivityClass>();
  for (const [cls, permission] of Object.entries(SENSITIVITY_PERMISSION) as [
    Exclude<SensitivityClass, "medical">,
    Permission,
  ][]) {
    try {
      const grant = await authorize(c, permission);
      if (await grant.canAccessEmployee(ctx.employeeId)) allowed.add(cls);
    } catch {
      // no grant → redacted
    }
  }
  const auth = c.get("auth");
  const roles = await effectiveRoles(c);
  if (
    roles.has("owner") ||
    roles.has("hr_admin") ||
    (auth?.employeeId && auth.employeeId === ctx.employeeId) ||
    ctx.assignedApproverOfItem
  ) {
    allowed.add("medical");
  }
  memo.set(key, allowed);
  return allowed;
}

/**
 * Drops the sensitive fields of `value` the caller may not read and lists them in
 * `redactedFields`. Looks at the top-level fields of `schema` (an object schema).
 */
export async function redact<T extends Record<string, unknown>>(
  c: AppContext,
  schema: z.ZodObject,
  value: T,
  ctx: RedactContext,
): Promise<Partial<T> & { redactedFields?: string[] }> {
  const allowed = await allowedClasses(c, ctx);
  const out: Record<string, unknown> = { ...value };
  const redacted: string[] = [];
  for (const [key, field] of Object.entries(schema.shape as Record<string, z.ZodType>)) {
    const cls = sensitivityOf(field);
    if (cls && !allowed.has(cls) && key in out) {
      delete out[key];
      redacted.push(key);
    }
  }
  if (redacted.length) out.redactedFields = redacted.sort();
  return out as Partial<T> & { redactedFields?: string[] };
}

/** `redact` over a list (each row may belong to a different employee). */
export function redactMany<T extends Record<string, unknown>>(
  c: AppContext,
  schema: z.ZodObject,
  rows: T[],
  employeeIdOf: (row: T) => string,
) {
  return Promise.all(rows.map((row) => redact(c, schema, row, { employeeId: employeeIdOf(row) })));
}
