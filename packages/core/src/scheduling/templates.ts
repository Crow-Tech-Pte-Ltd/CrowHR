import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { orgScope } from "../access/org-scope.ts";
import { type AuditContext, diffFields, recordAudit } from "../audit/audit.ts";
import { locations } from "../db/schema/organisation.ts";
import { rosterShifts, SHIFT_COLOURS, type ShiftTemplate, shiftTemplates } from "../db/schema/scheduling.ts";
import type { Db } from "../db/types.ts";
import type { AppDeps } from "../deps.ts";
import { AppError } from "../errors.ts";
import { HHMM, spanMinutes } from "./time.ts";

/** Shift templates (spec "Shift templates"): Settings → Shift templates, owners and hr_admins. */

export const MAX_ACTIVE_TEMPLATES_PER_LOCATION = 30;

const time = z.string().regex(HHMM, "Use the 24-hour format HH:MM, like 09:00.");

export const templateInput = z.object({
  name: z.string().trim().min(1, "Name the shift, like Morning.").max(60, "Use at most 60 characters."),
  code: z
    .string()
    .trim()
    .min(1, "Give the shift a short code of 1 to 6 characters, like AM.")
    .max(6, "Use a code of at most 6 characters, like AM.")
    .regex(/^[A-Za-z0-9]+$/, "Use letters and digits only, like AM or N1."),
  startTime: time,
  endTime: time,
  breakMinutes: z.int().min(0, "A break can't be negative.").max(240, "Use a break of at most 240 minutes."),
  locationId: z.uuid().nullable(),
  colour: z.enum(SHIFT_COLOURS),
});
export type TemplateInput = z.output<typeof templateInput>;

export const templateView = z.object({
  id: z.uuid(),
  name: z.string(),
  code: z.string(),
  startTime: z.string(),
  endTime: z.string(),
  breakMinutes: z.number(),
  /** Paid duration: end − start − break. */
  paidMinutes: z.number(),
  overnight: z.boolean(),
  locationId: z.uuid().nullable(),
  locationName: z.string().nullable(),
  colour: z.enum(SHIFT_COLOURS),
  archived: z.boolean(),
  inUse: z.boolean(),
});
export type TemplateView = z.input<typeof templateView>;

export interface SchedulingActor {
  orgId: string;
  membershipId: string;
  employeeId: string | null;
  audit: AuditContext;
}

export function paidOf(t: Pick<ShiftTemplate, "startTime" | "endTime" | "breakMinutes">): number {
  return spanMinutes(t.startTime, t.endTime) - t.breakMinutes;
}

function check(input: TemplateInput) {
  const span = spanMinutes(input.startTime, input.endTime);
  if (input.breakMinutes >= span) {
    throw new AppError("validation_failed", "The break is as long as the shift.", {
      issues: [{ path: "breakMinutes", message: `Use a break shorter than the shift (${span} minutes).` }],
    });
  }
}

export async function listTemplates(db: Db, orgId: string, opts: { includeArchived?: boolean } = {}) {
  const org = orgScope(db, orgId);
  const rows = await db
    .select({ t: shiftTemplates, locationName: locations.name })
    .from(shiftTemplates)
    .leftJoin(locations, and(eq(locations.orgId, shiftTemplates.orgId), eq(locations.id, shiftTemplates.locationId)))
    .where(org.where(shiftTemplates, opts.includeArchived ? undefined : isNull(shiftTemplates.archivedAt)))
    .orderBy(asc(shiftTemplates.startTime), asc(shiftTemplates.code));
  const used = await db
    .selectDistinct({ id: rosterShifts.templateId })
    .from(rosterShifts)
    .where(org.where(rosterShifts, sql`${rosterShifts.templateId} is not null`));
  const inUse = new Set(used.map((u) => u.id));
  return rows.map(
    ({ t, locationName }): TemplateView => ({
      id: t.id,
      name: t.name,
      code: t.code,
      startTime: t.startTime,
      endTime: t.endTime,
      breakMinutes: t.breakMinutes,
      paidMinutes: paidOf(t),
      overnight: t.endTime <= t.startTime,
      locationId: t.locationId,
      locationName: locationName ?? null,
      colour: t.colour,
      archived: t.archivedAt !== null,
      inUse: inUse.has(t.id),
    }),
  );
}

async function assertCapacity(db: Db, orgId: string, locationId: string | null, exceptId?: string) {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(shiftTemplates)
    .where(
      orgScope(db, orgId).where(
        shiftTemplates,
        isNull(shiftTemplates.archivedAt),
        locationId ? eq(shiftTemplates.locationId, locationId) : isNull(shiftTemplates.locationId),
        exceptId ? sql`${shiftTemplates.id} <> ${exceptId}` : undefined,
      ),
    );
  if (Number(row?.n ?? 0) >= MAX_ACTIVE_TEMPLATES_PER_LOCATION) {
    throw new AppError(
      "conflict",
      `A location can have at most ${MAX_ACTIVE_TEMPLATES_PER_LOCATION} active shift templates. Archive one you no longer use first.`,
    );
  }
}

async function assertCodeFree(db: Db, orgId: string, code: string, exceptId?: string) {
  const [row] = await db
    .select({ id: shiftTemplates.id })
    .from(shiftTemplates)
    .where(
      orgScope(db, orgId).where(
        shiftTemplates,
        isNull(shiftTemplates.archivedAt),
        sql`lower(${shiftTemplates.code}) = lower(${code})`,
        exceptId ? sql`${shiftTemplates.id} <> ${exceptId}` : undefined,
      ),
    );
  if (row) {
    throw new AppError(
      "conflict",
      `The code ${code.toUpperCase()} is already used by another shift. Pick another code.`,
      {
        issues: [{ path: "code", message: "Pick a code no other active shift uses." }],
      },
    );
  }
}

async function assertLocation(db: Db, orgId: string, locationId: string | null) {
  if (locationId) await orgScope(db, orgId).getById(locations, locationId, "location");
}

const auditShape = (t: TemplateInput) => ({
  name: t.name,
  shortCode: t.code,
  startTime: t.startTime,
  endTime: t.endTime,
  breakMinutes: t.breakMinutes,
  locationId: t.locationId,
  colour: t.colour,
});

export async function createTemplate(deps: AppDeps, actor: SchedulingActor, input: TemplateInput) {
  check(input);
  const code = input.code.toUpperCase();
  return deps.db.transaction(async (tx) => {
    await assertLocation(tx, actor.orgId, input.locationId);
    await assertCodeFree(tx, actor.orgId, code);
    await assertCapacity(tx, actor.orgId, input.locationId);
    const id = deps.ids.newId();
    await tx.insert(shiftTemplates).values({ id, orgId: actor.orgId, ...input, code });
    await recordAudit(tx, deps, actor.audit, {
      action: "scheduling.template_created",
      targetType: "shift_template",
      targetId: id,
      diff: diffFields(null, auditShape({ ...input, code })),
    });
    return id;
  });
}

export async function updateTemplate(deps: AppDeps, actor: SchedulingActor, id: string, input: TemplateInput) {
  check(input);
  const code = input.code.toUpperCase();
  return deps.db.transaction(async (tx) => {
    const before = await orgScope(tx, actor.orgId).getById(shiftTemplates, id, "shift template");
    if (before.archivedAt) {
      throw new AppError("conflict", "This shift template is archived. Restore it before editing.");
    }
    await assertLocation(tx, actor.orgId, input.locationId);
    await assertCodeFree(tx, actor.orgId, code, id);
    if (before.locationId !== input.locationId) await assertCapacity(tx, actor.orgId, input.locationId, id);
    const now = deps.clock.now();
    await tx
      .update(shiftTemplates)
      .set({ ...input, code, updatedAt: now })
      .where(orgScope(tx, actor.orgId).whereId(shiftTemplates, id));
    await recordAudit(tx, deps, actor.audit, {
      action: "scheduling.template_updated",
      targetType: "shift_template",
      targetId: id,
      diff: diffFields(auditShape(before), auditShape({ ...input, code })),
    });
  });
}

/** Archive (never delete: shifts keep pointing at their template) or restore. */
export async function setTemplateArchived(deps: AppDeps, actor: SchedulingActor, id: string, archived: boolean) {
  return deps.db.transaction(async (tx) => {
    const t = await orgScope(tx, actor.orgId).getById(shiftTemplates, id, "shift template");
    if ((t.archivedAt !== null) === archived) return;
    if (!archived) {
      await assertCodeFree(tx, actor.orgId, t.code, id);
      await assertCapacity(tx, actor.orgId, t.locationId, id);
    }
    await tx
      .update(shiftTemplates)
      .set({ archivedAt: archived ? deps.clock.now() : null, updatedAt: deps.clock.now() })
      .where(orgScope(tx, actor.orgId).whereId(shiftTemplates, id));
    await recordAudit(tx, deps, actor.audit, {
      action: archived ? "scheduling.template_archived" : "scheduling.template_restored",
      targetType: "shift_template",
      targetId: id,
    });
  });
}

/** Delete a template no shift has ever used; one in use must be archived instead. */
export async function deleteTemplate(deps: AppDeps, actor: SchedulingActor, id: string) {
  return deps.db.transaction(async (tx) => {
    await orgScope(tx, actor.orgId).getById(shiftTemplates, id, "shift template");
    const [used] = await tx
      .select({ id: rosterShifts.id })
      .from(rosterShifts)
      .where(orgScope(tx, actor.orgId).where(rosterShifts, eq(rosterShifts.templateId, id)))
      .limit(1);
    if (used) {
      throw new AppError("in_use", "Rosters use this shift template, so it can't be deleted. Archive it instead.");
    }
    await tx.delete(shiftTemplates).where(orgScope(tx, actor.orgId).whereId(shiftTemplates, id));
    await recordAudit(tx, deps, actor.audit, {
      action: "scheduling.template_deleted",
      targetType: "shift_template",
      targetId: id,
    });
  });
}
