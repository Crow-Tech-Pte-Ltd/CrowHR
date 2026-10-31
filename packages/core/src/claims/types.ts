import { and, asc, count, eq, isNull, sql } from "drizzle-orm";
import { orgScope } from "../access/org-scope.ts";
import { diffFields, recordAudit } from "../audit/audit.ts";
import {
  type CapPeriod,
  type ClaimCategory,
  claimLines,
  claimSettings,
  claimTypes,
  type PayoutMethod,
  type ReceiptRule,
} from "../db/schema/claims.ts";
import type { EmploymentType } from "../db/schema/employees.ts";
import type { Db } from "../db/types.ts";
import type { AppDeps } from "../deps.ts";
import { AppError } from "../errors.ts";
import type { ClaimsActor } from "./access.ts";
import { sgd } from "./money.ts";

/**
 * Claim types (spec "Claim types"): configured by owners and hr_admins, archivable but never
 * deleted once used. Eligibility is by employment type and probation status, evaluated on the
 * employee's employment record in force today (Asia/Singapore).
 */

export type ClaimTypeRow = typeof claimTypes.$inferSelect;

export interface ClaimTypeInput {
  code: string;
  name: string;
  category: ClaimCategory;
  receiptRule: ReceiptRule;
  receiptAboveCents?: number | null;
  capCents?: number | null;
  capPeriod: CapPeriod;
  eligibleEmploymentTypes?: EmploymentType[];
  availableDuringProbation?: boolean;
  defaultPayout?: PayoutMethod;
  gstApplicable?: boolean;
  taxable?: boolean;
  glCode?: string | null;
}

export const EMPLOYMENT_TYPE_LABEL: Record<EmploymentType, string> = {
  full_time: "full-time",
  part_time: "part-time",
  contract: "contract",
  intern: "intern",
};

/**
 * Suggested starter set, offered on the empty state for HR to confirm (design "Migration Plan").
 * These are product suggestions, not statutory values: every amount is editable.
 */
export const STARTER_CLAIM_TYPES: readonly ClaimTypeInput[] = [
  {
    code: "TRANSPORT",
    name: "Transport",
    category: "transport",
    receiptRule: "above",
    receiptAboveCents: 2000,
    capPeriod: "none",
  },
  { code: "MEALS", name: "Meals", category: "meals", receiptRule: "above", receiptAboveCents: 1000, capPeriod: "none" },
  {
    code: "ENTERTAINMENT",
    name: "Client entertainment",
    category: "entertainment",
    receiptRule: "always",
    capPeriod: "none",
  },
  {
    code: "MEDICAL",
    name: "Medical (outpatient)",
    category: "medical",
    receiptRule: "always",
    capCents: 50_000,
    capPeriod: "yearly",
  },
  { code: "DENTAL", name: "Dental", category: "dental", receiptRule: "always", capCents: 30_000, capPeriod: "yearly" },
  {
    code: "PHONE",
    name: "Mobile phone",
    category: "phone",
    receiptRule: "always",
    capCents: 5_000,
    capPeriod: "monthly",
    eligibleEmploymentTypes: ["full_time"],
  },
];

function normalise(input: ClaimTypeInput) {
  const code = input.code.trim().toUpperCase();
  const issues: { path: string; message: string }[] = [];
  if (!/^[A-Z][A-Z0-9_]{1,31}$/.test(code))
    issues.push({
      path: "code",
      message: "Use 2–32 letters, digits or underscores, starting with a letter (e.g. TRANSPORT).",
    });
  if (input.capPeriod === "none" && input.capCents != null)
    issues.push({
      path: "capCents",
      message: "Pick a cap period (per claim, monthly or yearly), or clear the cap amount.",
    });
  if (input.capPeriod !== "none" && !(input.capCents && input.capCents > 0))
    issues.push({ path: "capCents", message: "Enter the cap amount, or set the cap period to none." });
  if (input.receiptRule === "above" && !(input.receiptAboveCents != null && input.receiptAboveCents >= 0))
    issues.push({ path: "receiptAboveCents", message: "Enter the amount above which a receipt is required." });
  if (issues.length) throw new AppError("validation_failed", "Some claim type settings need fixing.", { issues });
  return {
    code,
    name: input.name.trim(),
    category: input.category,
    receiptRule: input.receiptRule,
    receiptAboveCents: input.receiptRule === "above" ? (input.receiptAboveCents ?? 0) : null,
    capCents: input.capPeriod === "none" ? null : (input.capCents ?? null),
    capPeriod: input.capPeriod,
    eligibleEmploymentTypes: [...new Set(input.eligibleEmploymentTypes ?? [])],
    availableDuringProbation: input.availableDuringProbation ?? true,
    defaultPayout: input.defaultPayout ?? "payroll",
    gstApplicable: input.gstApplicable ?? true,
    taxable: input.taxable ?? false,
    glCode: input.glCode?.trim() || null,
  };
}

async function usage(db: Db, orgId: string): Promise<Map<string, number>> {
  const rows = await db
    .select({ id: claimLines.claimTypeId, n: count() })
    .from(claimLines)
    .where(eq(claimLines.orgId, orgId))
    .groupBy(claimLines.claimTypeId);
  return new Map(rows.map((r) => [r.id, Number(r.n)]));
}

export async function listClaimTypes(deps: AppDeps, actor: ClaimsActor, opts: { includeArchived?: boolean } = {}) {
  const rows = await deps.db
    .select()
    .from(claimTypes)
    .where(actor.org.where(claimTypes, opts.includeArchived ? undefined : isNull(claimTypes.archivedAt)))
    .orderBy(asc(claimTypes.name));
  const used = await usage(deps.db, actor.orgId);
  return rows.map((r) => ({ ...r, inUse: (used.get(r.id) ?? 0) > 0 }));
}

async function assertCodeFree(db: Db, orgId: string, code: string, exceptId?: string) {
  const [clash] = await db
    .select({ id: claimTypes.id })
    .from(claimTypes)
    .where(and(eq(claimTypes.orgId, orgId), eq(claimTypes.code, code)));
  if (clash && clash.id !== exceptId) {
    throw new AppError("conflict", `Another claim type already uses the code ${code}. Pick a different code.`, {
      issues: [{ path: "code", message: "This code is taken." }],
    });
  }
}

export async function createClaimType(deps: AppDeps, actor: ClaimsActor, input: ClaimTypeInput) {
  const values = normalise(input);
  return deps.db.transaction(async (tx) => {
    await assertCodeFree(tx, actor.orgId, values.code);
    const id = deps.ids.newId();
    const [row] = await tx
      .insert(claimTypes)
      .values(actor.org.values({ id, ...values }))
      .returning();
    await recordAudit(tx, deps, actor.auditCtx, {
      action: "claim_type.created",
      targetType: "claim_type",
      targetId: id,
      meta: { code: values.code, name: values.name },
    });
    return { ...(row as ClaimTypeRow), inUse: false };
  });
}

export async function updateClaimType(deps: AppDeps, actor: ClaimsActor, id: string, patch: Partial<ClaimTypeInput>) {
  return deps.db.transaction(async (tx) => {
    const before = await orgScope(tx, actor.orgId).getById(claimTypes, id, "claim type");
    const values = normalise({
      code: patch.code ?? before.code,
      name: patch.name ?? before.name,
      category: patch.category ?? before.category,
      receiptRule: patch.receiptRule ?? before.receiptRule,
      receiptAboveCents: patch.receiptAboveCents !== undefined ? patch.receiptAboveCents : before.receiptAboveCents,
      capCents: patch.capCents !== undefined ? patch.capCents : before.capCents,
      capPeriod: patch.capPeriod ?? before.capPeriod,
      eligibleEmploymentTypes: patch.eligibleEmploymentTypes ?? before.eligibleEmploymentTypes,
      availableDuringProbation: patch.availableDuringProbation ?? before.availableDuringProbation,
      defaultPayout: patch.defaultPayout ?? before.defaultPayout,
      gstApplicable: patch.gstApplicable ?? before.gstApplicable,
      taxable: patch.taxable ?? before.taxable,
      glCode: patch.glCode !== undefined ? patch.glCode : before.glCode,
    });
    await assertCodeFree(tx, actor.orgId, values.code, id);
    const [row] = await tx
      .update(claimTypes)
      .set({ ...values, updatedAt: deps.clock.now() })
      .where(actor.org.whereId(claimTypes, id))
      .returning();
    await recordAudit(tx, deps, actor.auditCtx, {
      action: "claim_type.updated",
      targetType: "claim_type",
      targetId: id,
      diff: diffFields(before as unknown as Record<string, unknown>, values as unknown as Record<string, unknown>),
    });
    const used = await usage(tx, actor.orgId);
    return { ...(row as ClaimTypeRow), inUse: (used.get(id) ?? 0) > 0 };
  });
}

export async function setClaimTypeArchived(deps: AppDeps, actor: ClaimsActor, id: string, archived: boolean) {
  return deps.db.transaction(async (tx) => {
    await orgScope(tx, actor.orgId).getById(claimTypes, id, "claim type");
    const [row] = await tx
      .update(claimTypes)
      .set({ archivedAt: archived ? deps.clock.now() : null, updatedAt: deps.clock.now() })
      .where(actor.org.whereId(claimTypes, id))
      .returning();
    await recordAudit(tx, deps, actor.auditCtx, {
      action: archived ? "claim_type.archived" : "claim_type.restored",
      targetType: "claim_type",
      targetId: id,
    });
    const used = await usage(tx, actor.orgId);
    return { ...(row as ClaimTypeRow), inUse: (used.get(id) ?? 0) > 0 };
  });
}

/** Deletes an unused type. A type that any claim line uses can only be archived. */
export async function deleteClaimType(deps: AppDeps, actor: ClaimsActor, id: string) {
  await deps.db.transaction(async (tx) => {
    const row = await orgScope(tx, actor.orgId).getById(claimTypes, id, "claim type");
    const [used] = await tx
      .select({ n: count() })
      .from(claimLines)
      .where(and(eq(claimLines.orgId, actor.orgId), eq(claimLines.claimTypeId, id)));
    if (Number(used?.n ?? 0) > 0) {
      throw new AppError(
        "in_use",
        `${row.name} is used by existing claims, so it can't be deleted. Archive it instead.`,
      );
    }
    await tx.delete(claimTypes).where(actor.org.whereId(claimTypes, id));
    await recordAudit(tx, deps, actor.auditCtx, {
      action: "claim_type.deleted",
      targetType: "claim_type",
      targetId: id,
      meta: { code: row.code },
    });
  });
}

/** Creates the starter types (or the chosen subset) that don't exist yet. */
export async function createStarterTypes(deps: AppDeps, actor: ClaimsActor, codes?: string[]) {
  const existing = new Set(
    (await deps.db.select({ code: claimTypes.code }).from(claimTypes).where(actor.org.where(claimTypes))).map(
      (r) => r.code,
    ),
  );
  const wanted = STARTER_CLAIM_TYPES.filter((t) => (!codes || codes.includes(t.code)) && !existing.has(t.code));
  for (const t of wanted) await createClaimType(deps, actor, t);
  return listClaimTypes(deps, actor);
}

// ---------------------------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------------------------

export const DEFAULT_SUBMISSION_WINDOW_DAYS = 90;

export async function getClaimSettings(db: Db, orgId: string) {
  const [row] = await db.select().from(claimSettings).where(eq(claimSettings.orgId, orgId));
  return { submissionWindowDays: row?.submissionWindowDays ?? DEFAULT_SUBMISSION_WINDOW_DAYS };
}

export async function updateClaimSettings(deps: AppDeps, actor: ClaimsActor, input: { submissionWindowDays: number }) {
  return deps.db.transaction(async (tx) => {
    const before = await getClaimSettings(tx, actor.orgId);
    await tx
      .insert(claimSettings)
      .values({ orgId: actor.orgId, submissionWindowDays: input.submissionWindowDays, updatedAt: deps.clock.now() })
      .onConflictDoUpdate({
        target: claimSettings.orgId,
        set: { submissionWindowDays: input.submissionWindowDays, updatedAt: deps.clock.now() },
      });
    await recordAudit(tx, deps, actor.auditCtx, {
      action: "claim_settings.updated",
      targetType: "organisation",
      targetId: actor.orgId,
      diff: diffFields(before, input),
    });
    return getClaimSettings(tx, actor.orgId);
  });
}

// ---------------------------------------------------------------------------------------------
// Eligibility
// ---------------------------------------------------------------------------------------------

export interface EmploymentFacts {
  employmentType: EmploymentType | null;
  inProbation: boolean;
  departmentId: string | null;
}

function rowsOf<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  return ((result as { rows?: T[] }).rows ?? []) as T[];
}

/** The employment record in force on `onDate`, and whether probation is still running (not confirmed). */
export async function employmentFacts(
  db: Db,
  orgId: string,
  employeeId: string,
  onDate: string,
): Promise<EmploymentFacts> {
  const result = await db.execute<{
    employment_type: EmploymentType;
    probation_end: string | null;
    department_id: string;
    confirmed: boolean;
  }>(sql`
    select er.employment_type, er.probation_end::text as probation_end, er.department_id,
           exists (select 1 from lifecycle_events le
                    where le.org_id = er.org_id and le.employee_id = er.employee_id and le.tenure_id = er.tenure_id
                      and le.type = 'probation_confirmed' and le.cancelled_at is null) as confirmed
      from employment_records er
     where er.org_id = ${orgId} and er.employee_id = ${employeeId}
       and er.effective_from <= ${onDate}
       and (er.effective_to is null or er.effective_to > ${onDate})
     order by er.effective_from desc
     limit 1
  `);
  const r = rowsOf<{
    employment_type: EmploymentType;
    probation_end: string | null;
    department_id: string;
    confirmed: boolean;
  }>(result)[0];
  if (!r) return { employmentType: null, inProbation: false, departmentId: null };
  return {
    employmentType: r.employment_type,
    inProbation: !!r.probation_end && r.probation_end >= onDate && !r.confirmed,
    departmentId: r.department_id,
  };
}

/** Why `type` is not available to an employee with these facts, or null when it is. */
export function ineligibleReason(type: ClaimTypeRow, facts: EmploymentFacts): string | null {
  if (type.archivedAt) return `${type.name} is no longer offered.`;
  if (
    type.eligibleEmploymentTypes.length &&
    !(facts.employmentType && type.eligibleEmploymentTypes.includes(facts.employmentType))
  ) {
    const who = type.eligibleEmploymentTypes.map((t) => EMPLOYMENT_TYPE_LABEL[t]).join(" or ");
    return `${type.name} is only for ${who} staff.`;
  }
  if (!type.availableDuringProbation && facts.inProbation) return `${type.name} is available after probation.`;
  return null;
}

export function receiptRequired(type: Pick<ClaimTypeRow, "receiptRule" | "receiptAboveCents">, sgdCents: number) {
  if (type.receiptRule === "always") return true;
  if (type.receiptRule === "above") return sgdCents > (type.receiptAboveCents ?? 0);
  return false;
}

export function receiptRuleLabel(type: Pick<ClaimTypeRow, "receiptRule" | "receiptAboveCents">): string {
  if (type.receiptRule === "always") return "Receipt required";
  if (type.receiptRule === "never") return "No receipt needed";
  return `Receipt required above ${sgd(type.receiptAboveCents ?? 0)}`;
}
