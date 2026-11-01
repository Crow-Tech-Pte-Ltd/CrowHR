import { eq } from "drizzle-orm";
import { z } from "zod";
import { orgScope } from "../access/org-scope.ts";
import { diffFields, recordAudit } from "../audit/audit.ts";
import { type LeavePolicy, type LeaveType, leaveHolidays, leaveSettings, leaveTypes } from "../db/schema/leave.ts";
import { workSchedules } from "../db/schema/organisation.ts";
import type { AppDeps } from "../deps.ts";
import { isUniqueViolation } from "../employees/validation.ts";
import { AppError } from "../errors.ts";
import { ensureLeaveSetup, loadLeaveSettings } from "./defaults.ts";
import { assertPolicyAtLeastStatutory } from "./entitlement.ts";
import { isoDate, type LeaveActor } from "./service.ts";
import { toTypeView, typeView } from "./views.ts";

/** Settings → Leave policies, holidays and leave settings (owners and hr_admins). */

const days = z
  .number()
  .min(0)
  .max(365)
  .refine((n) => Number.isInteger(n * 2), "Use whole or half days.");

export const policySchema = z.object({
  entitlement: z.discriminatedUnion("basis", [
    z.object({ basis: z.literal("statutory") }),
    z.object({ basis: z.literal("fixed"), days }),
    z.object({
      basis: z.literal("by_service"),
      steps: z
        .array(z.object({ fromServiceYear: z.int().min(1).max(60), days }))
        .min(1, "Add at least one step.")
        .max(20),
    }),
    z.object({ basis: z.literal("unlimited") }),
  ]),
  minServiceMonths: z.int().min(0).max(24),
  prorate: z.boolean(),
  accrual: z.enum(["upfront", "monthly"]),
  carryForward: z
    .object({
      maxDays: days.nullable(),
      expiresAfterMonths: z.int().min(1).max(36).nullable(),
    })
    .nullable(),
  encashable: z.boolean(),
  employeeEncashmentRequests: z.boolean().optional(),
});

export const policyView = typeView.extend({
  kind: z.enum(["statutory", "company"]),
  dayCounting: z.enum(["working_days", "working_days_including_holidays"]),
  policy: policySchema,
  sortOrder: z.number(),
});

export const toPolicyView = (t: LeaveType): z.input<typeof policyView> => ({
  ...toTypeView(t),
  kind: t.statutoryCode ? "statutory" : "company",
  dayCounting: t.dayCounting,
  policy: t.policy,
  sortOrder: t.sortOrder,
});

export const policyUpdate = z.object({
  name: z.string().trim().min(1, "Enter a name.").max(60).optional(),
  halfDays: z.boolean().optional(),
  attachment: z.enum(["none", "optional", "required"]).optional(),
  attachmentLabel: z.string().trim().max(80).nullish(),
  sensitive: z.boolean().optional(),
  paid: z.boolean().optional(),
  policy: policySchema.optional(),
});

export const customTypeInput = z.object({
  code: z
    .string()
    .trim()
    .regex(/^[a-z][a-z0-9_]{1,30}$/, "Use 2–31 lower-case letters, digits or underscores, like birthday."),
  name: z.string().trim().min(1, "Enter a name, like Birthday leave.").max(60),
  paid: z.boolean().default(true),
  halfDays: z.boolean().default(true),
  attachment: z.enum(["none", "optional", "required"]).default("none"),
  attachmentLabel: z.string().trim().max(80).nullish(),
  sensitive: z.boolean().default(false),
  policy: policySchema,
});

export async function updatePolicy(
  deps: AppDeps,
  actor: LeaveActor,
  typeId: string,
  input: z.output<typeof policyUpdate>,
) {
  await ensureLeaveSetup(deps, actor.orgId);
  return deps.db.transaction(async (tx) => {
    const org = orgScope(tx, actor.orgId);
    const before = await org.getById(leaveTypes, typeId, "leave type");
    if (input.policy) assertPolicyAtLeastStatutory(before, input.policy as LeavePolicy);
    if (before.statutoryCode && input.paid !== undefined && input.paid !== before.paid) {
      throw new AppError("below_statutory", "Whether statutory leave is paid is set by law and can't be changed.");
    }
    const next = {
      name: input.name ?? before.name,
      halfDays: input.halfDays ?? before.halfDays,
      attachment: input.attachment ?? before.attachment,
      attachmentLabel: input.attachmentLabel === undefined ? before.attachmentLabel : input.attachmentLabel,
      sensitive: input.sensitive ?? before.sensitive,
      paid: input.paid ?? before.paid,
      policy: (input.policy as LeavePolicy | undefined) ?? before.policy,
    };
    const [row] = await tx
      .update(leaveTypes)
      .set({ ...next, updatedAt: deps.clock.now() })
      .where(org.whereId(leaveTypes, typeId))
      .returning();
    await recordAudit(tx, deps, actor.audit, {
      action: "leave.policy_updated",
      targetType: "leave_type",
      targetId: typeId,
      diff: diffFields(
        { ...before, policy: JSON.stringify(before.policy) } as Record<string, unknown>,
        { ...before, ...next, policy: JSON.stringify(next.policy) } as Record<string, unknown>,
        { ignore: ["updatedAt", "createdAt"] },
      ),
    });
    return row as LeaveType;
  });
}

export async function createCustomType(deps: AppDeps, actor: LeaveActor, input: z.output<typeof customTypeInput>) {
  await ensureLeaveSetup(deps, actor.orgId);
  if (input.policy.minServiceMonths < 0) throw new AppError("validation_failed", "Service months can't be negative.");
  try {
    return await deps.db.transaction(async (tx) => {
      const id = deps.ids.newId();
      const [row] = await tx
        .insert(leaveTypes)
        .values({
          id,
          orgId: actor.orgId,
          code: input.code,
          name: input.name,
          statutoryCode: null,
          paid: input.paid,
          dayCounting: "working_days",
          halfDays: input.halfDays,
          attachment: input.attachment,
          attachmentLabel: input.attachmentLabel ?? null,
          sensitive: input.sensitive,
          policy: input.policy as LeavePolicy,
          sortOrder: 80,
        })
        .returning();
      await recordAudit(tx, deps, actor.audit, {
        action: "leave.type_created",
        targetType: "leave_type",
        targetId: id,
        meta: { code: input.code, name: input.name },
      });
      return row as LeaveType;
    });
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new AppError("conflict", `A leave type with code "${input.code}" already exists. Choose another code.`);
    }
    throw err;
  }
}

export async function setTypeArchived(deps: AppDeps, actor: LeaveActor, typeId: string, archived: boolean) {
  return deps.db.transaction(async (tx) => {
    const org = orgScope(tx, actor.orgId);
    const before = await org.getById(leaveTypes, typeId, "leave type");
    if (before.statutoryCode && archived) {
      throw new AppError(
        "below_statutory",
        "Statutory leave types can't be archived; employees are entitled to them by law.",
      );
    }
    const [row] = await tx
      .update(leaveTypes)
      .set({ archivedAt: archived ? deps.clock.now() : null, updatedAt: deps.clock.now() })
      .where(org.whereId(leaveTypes, typeId))
      .returning();
    await recordAudit(tx, deps, actor.audit, {
      action: archived ? "leave.type_archived" : "leave.type_restored",
      targetType: "leave_type",
      targetId: typeId,
    });
    return row as LeaveType;
  });
}

// ---------------------------------------------------------------------------------------------
// Holidays and settings
// ---------------------------------------------------------------------------------------------

export const holidayInput = z.object({
  date: isoDate,
  name: z.string().trim().min(1, "Enter the holiday's name, like Polling Day.").max(80),
});

export async function addHoliday(deps: AppDeps, actor: LeaveActor, input: z.output<typeof holidayInput>) {
  try {
    return await deps.db.transaction(async (tx) => {
      const id = deps.ids.newId();
      const [row] = await tx
        .insert(leaveHolidays)
        .values({ id, orgId: actor.orgId, ...input })
        .returning();
      await recordAudit(tx, deps, actor.audit, {
        action: "leave.holiday_added",
        targetType: "leave_holiday",
        targetId: id,
        meta: input,
      });
      return row;
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw new AppError("conflict", "There is already an extra holiday on that date.");
    throw err;
  }
}

export async function removeHoliday(deps: AppDeps, actor: LeaveActor, id: string) {
  await deps.db.transaction(async (tx) => {
    const org = orgScope(tx, actor.orgId);
    const row = await org.getById(leaveHolidays, id, "holiday");
    await tx.delete(leaveHolidays).where(org.whereId(leaveHolidays, id));
    await recordAudit(tx, deps, actor.audit, {
      action: "leave.holiday_removed",
      targetType: "leave_holiday",
      targetId: id,
      meta: { date: row.date, name: row.name },
    });
  });
}

export const settingsSchema = z.object({
  offDayHoliday: z.enum(["extra_pay", "next_working_day"]),
  unpaidServiceRule: z.enum(["none", "whole_month", "any_day"]),
  fullTimeScheduleId: z.uuid().nullable(),
});

export async function getSettings(deps: AppDeps, orgId: string) {
  await ensureLeaveSetup(deps, orgId);
  const s = await loadLeaveSettings(deps.db, orgId);
  return {
    offDayHoliday: s.offDayHoliday,
    unpaidServiceRule: s.unpaidServiceRule,
    fullTimeScheduleId: s.fullTimeScheduleId,
  };
}

export async function saveSettings(deps: AppDeps, actor: LeaveActor, input: z.output<typeof settingsSchema>) {
  await ensureLeaveSetup(deps, actor.orgId);
  return deps.db.transaction(async (tx) => {
    if (input.fullTimeScheduleId) {
      const s = await orgScope(tx, actor.orgId).findById(workSchedules, input.fullTimeScheduleId);
      if (s?.kind !== "fixed") {
        throw new AppError("validation_failed", "Choose a fixed work schedule as the full-time reference.", {
          issues: [{ path: "fullTimeScheduleId", message: "Pick a fixed (not shift) schedule." }],
        });
      }
    }
    const before = await loadLeaveSettings(tx, actor.orgId);
    await tx
      .update(leaveSettings)
      .set({ ...input, updatedAt: deps.clock.now() })
      .where(eq(leaveSettings.orgId, actor.orgId));
    await recordAudit(tx, deps, actor.audit, {
      action: "leave.settings_updated",
      targetType: "organisation",
      targetId: actor.orgId,
      diff: diffFields(
        {
          offDayHoliday: before.offDayHoliday,
          unpaidServiceRule: before.unpaidServiceRule,
          fullTimeScheduleId: before.fullTimeScheduleId,
        },
        input,
      ),
    });
    return input;
  });
}
