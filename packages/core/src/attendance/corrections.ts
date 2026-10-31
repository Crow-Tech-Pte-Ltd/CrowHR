import { z } from "zod";
import type { Grant } from "../access/authorize.ts";
import { orgScope } from "../access/org-scope.ts";
import { type AuditContext, recordAudit } from "../audit/audit.ts";
import { attendancePunches } from "../db/schema/attendance.ts";
import type { AppDeps } from "../deps.ts";
import { AppError } from "../errors.ts";
import { loadPunch, workDateFor } from "./punch.ts";

/**
 * Manager and HR corrections (spec "Daily timesheets"; design decision 4): a correction adds a
 * punch with a reason or voids one; original rows are never edited, and each change is audited in
 * its own transaction. Nobody corrects their own timesheet.
 */

export interface CorrectionActor {
  orgId: string;
  membershipId: string;
  employeeId: string | null;
  audit: AuditContext;
}

const reason = z.string().trim().min(3, 'Say why, e.g. "Forgot to clock out".').max(300);

export const correctionInput = z.object({
  employeeId: z.uuid(),
  kind: z.enum(["in", "out"]),
  time: z.iso.datetime({
    offset: true,
    message: "Give the time as an ISO 8601 timestamp, like 2026-11-12T18:00:00+08:00.",
  }),
  reason,
});

export const voidInput = z.object({ reason });

function assertNotSelf(actor: CorrectionActor, employeeId: string) {
  if (actor.employeeId && actor.employeeId === employeeId) {
    throw new AppError(
      "self_change_requires_approval",
      "You can't correct your own timesheet. Ask your manager or HR to make the change.",
    );
  }
}

export async function addCorrection(
  deps: AppDeps,
  actor: CorrectionActor,
  grant: Grant,
  input: z.output<typeof correctionInput>,
) {
  await grant.assertEmployee(input.employeeId, "employee");
  assertNotSelf(actor, input.employeeId);
  const at = new Date(input.time);
  const now = deps.clock.now();
  if (at.getTime() > now.getTime() + 60_000) {
    throw new AppError("validation_failed", "A correction can't be in the future.", {
      issues: [{ path: "time", message: "Pick a time that has already passed." }],
    });
  }
  return deps.db.transaction(async (tx) => {
    const id = deps.ids.newId();
    const workDate = await workDateFor(tx, actor.orgId, input.employeeId, input.kind, at);
    const [row] = await tx
      .insert(attendancePunches)
      .values({
        id,
        orgId: actor.orgId,
        employeeId: input.employeeId,
        kind: input.kind,
        idempotencyKey: `correction:${id}`,
        source: "correction",
        deviceTime: at,
        sentAt: at,
        serverTime: now,
        recordedAt: at,
        workDate,
        skewSeconds: 0,
        queued: false,
        flags: [],
        reason: input.reason,
        createdByMembershipId: actor.membershipId,
      })
      .returning();
    await recordAudit(tx, deps, actor.audit, {
      action: "attendance.correction_added",
      targetType: "attendance_punch",
      targetId: id,
      meta: { employeeId: input.employeeId, kind: input.kind, time: at.toISOString(), workDate, reason: input.reason },
    });
    if (!row) throw new Error("correction insert returned nothing");
    return row;
  });
}

export async function voidPunch(deps: AppDeps, actor: CorrectionActor, grant: Grant, punchId: string, why: string) {
  // Scope checks read outside the transaction (PGlite has one connection).
  const found = await loadPunch(deps.db, actor.orgId, punchId);
  await grant.assertEmployee(found.employeeId, "punch");
  assertNotSelf(actor, found.employeeId);
  return deps.db.transaction(async (tx) => {
    const punch = await loadPunch(tx, actor.orgId, punchId);
    if (punch.voidedAt) throw new AppError("conflict", "This punch is already voided. Nothing was changed.");
    const now = deps.clock.now();
    const [row] = await tx
      .update(attendancePunches)
      .set({ voidedAt: now, voidedByMembershipId: actor.membershipId, voidReason: why })
      .where(orgScope(tx, actor.orgId).whereId(attendancePunches, punchId))
      .returning();
    await recordAudit(tx, deps, actor.audit, {
      action: "attendance.punch_voided",
      targetType: "attendance_punch",
      targetId: punchId,
      meta: { employeeId: punch.employeeId, kind: punch.kind, recordedAt: punch.recordedAt.toISOString(), reason: why },
    });
    if (!row) throw new Error("void update returned nothing");
    return row;
  });
}
