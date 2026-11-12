import { and, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { z } from "zod";
import type { Grant } from "../access/authorize.ts";
import { orgScope } from "../access/org-scope.ts";
import { singaporeDate } from "../access/scope.ts";
import { type AuditContext, recordAudit } from "../audit/audit.ts";
import { memberships } from "../db/schema/access.ts";
import {
  type AttendanceTimesheet,
  attendanceTimesheets,
  type TimesheetStatus,
  type TimesheetTotalsSnapshot,
} from "../db/schema/attendance.ts";
import { employees, tenures } from "../db/schema/employees.ts";
import { users } from "../db/schema/users.ts";
import { approvalTasks } from "../db/schema/workflows.ts";
import type { Db } from "../db/types.ts";
import type { AppDeps } from "../deps.ts";
import { displayDate, isIsoDate } from "../employees/dates.ts";
import { displayName } from "../employees/records.ts";
import { isUniqueViolation } from "../employees/validation.ts";
import { AppError } from "../errors.ts";
import { notify } from "../notifications/notify.ts";
import { submitApproval, withdrawSubject } from "../workflows/engine.ts";
import { memberOf } from "./overtime.ts";
import { isPeriodOver, type Period, periodLabel, periodOf, submittableFrom } from "./periods.ts";
import type { AttendanceSettings } from "./settings.ts";
import { type DayRecord, timesheets, totalsOf } from "./timesheet.ts";

/**
 * Timesheet approval (openspec/changes/add-timesheet-approval): submit a period, decide it through
 * the workflows engine as subject `timesheet`, lock it once approved, reopen it (HR). The adapter
 * and the Home source are in `approval.ts`; the lock checks in `locks.ts`.
 */

export interface TimesheetActor {
  orgId: string;
  membershipId: string;
  employeeId: string | null;
  audit: AuditContext;
}

const isoDate = z.string().refine(isIsoDate, { message: "Use the date format YYYY-MM-DD, like 2026-10-01." });

export const totalsView = z.object({
  daysWorked: z.number(),
  workedMinutes: z.number(),
  lateCount: z.number(),
  lateMinutes: z.number(),
  earlyOutCount: z.number(),
  missingPunches: z.number(),
  otMinutes: z.number(),
  leaveDays: z.number(),
});

export const timesheetStatus = z.enum(["submitted", "approved", "returned", "withdrawn", "reopened"]);

export const timesheetView = z.object({
  id: z.uuid(),
  employee: z.object({ id: z.uuid(), name: z.string() }),
  periodStart: z.string(),
  periodEnd: z.string(),
  /** e.g. `1–31 Oct 2026`. */
  periodLabel: z.string(),
  status: timesheetStatus,
  submittedAt: z.string(),
  submittedBy: z.string(),
  /** The totals when it was submitted. */
  submittedTotals: totalsView,
  /** The totals when it was approved (what the approver saw). */
  approvedTotals: totalsView.nullable(),
  decidedAt: z.string().nullable(),
  decidedBy: z.string().nullable(),
  /** The approver's comment; required when the timesheet was returned. */
  comment: z.string().nullable(),
  reopenedAt: z.string().nullable(),
  reopenedBy: z.string().nullable(),
  reopenReason: z.string().nullable(),
  approvalRequestId: z.uuid().nullable(),
});
export type TimesheetView = z.input<typeof timesheetView>;

export const submitInput = z.object({
  employeeId: z.uuid().optional().meta({ description: "Default: your own timesheet." }),
  date: isoDate.meta({ description: "Any date in the period, e.g. its first day." }),
});

export const reopenInput = z.object({
  reason: z.string().trim().min(3, 'Say why, e.g. "Missing clock-out on 14 Oct".').max(300),
});

const OPEN: readonly TimesheetStatus[] = ["submitted", "approved"];

/** Employee names (full legal names, as approval views use). */
async function employeeNames(db: Db, orgId: string, ids: readonly string[]): Promise<Map<string, string>> {
  if (!ids.length) return new Map();
  const rows = await db
    .select({ id: employees.id, legalName: employees.legalName, preferredName: employees.preferredName })
    .from(employees)
    .where(orgScope(db, orgId).where(employees, inArray(employees.id, [...new Set(ids)])));
  return new Map(rows.map((r) => [r.id, displayName(r)]));
}

async function memberNames(db: Db, orgId: string, ids: readonly string[]): Promise<Map<string, string>> {
  const wanted = [...new Set(ids)];
  if (!wanted.length) return new Map();
  const rows = await db
    .select({ id: memberships.id, name: users.displayName })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(and(eq(memberships.orgId, orgId), inArray(memberships.id, wanted)));
  return new Map(rows.map((r) => [r.id, r.name]));
}

export async function toTimesheetViews(db: Db, orgId: string, rows: readonly AttendanceTimesheet[]) {
  if (!rows.length) return [];
  const people = await employeeNames(
    db,
    orgId,
    rows.map((r) => r.employeeId),
  );
  const members = await memberNames(
    db,
    orgId,
    rows.flatMap((r) =>
      [r.submittedByMembershipId, r.decidedByMembershipId, r.reopenedByMembershipId].filter((x): x is string => !!x),
    ),
  );
  const who = (id: string | null) => (id ? (members.get(id) ?? "A former member") : null);
  return rows.map(
    (r): TimesheetView => ({
      id: r.id,
      employee: { id: r.employeeId, name: people.get(r.employeeId) ?? "Former employee" },
      periodStart: r.periodStart,
      periodEnd: r.periodEnd,
      periodLabel: periodLabel({ start: r.periodStart, end: r.periodEnd }),
      status: r.status,
      submittedAt: r.submittedAt.toISOString(),
      submittedBy: who(r.submittedByMembershipId) ?? "",
      submittedTotals: r.submittedTotals,
      approvedTotals: r.approvedTotals ?? null,
      decidedAt: r.decidedAt?.toISOString() ?? null,
      decidedBy: who(r.decidedByMembershipId),
      comment: r.comment,
      reopenedAt: r.reopenedAt?.toISOString() ?? null,
      reopenedBy: who(r.reopenedByMembershipId),
      reopenReason: r.reopenReason,
      approvalRequestId: r.approvalRequestId,
    }),
  );
}

export async function loadTimesheet(db: Db, orgId: string, id: string): Promise<AttendanceTimesheet> {
  const row = await orgScope(db, orgId).findById(attendanceTimesheets, id);
  if (!row) throw new AppError("not_found", "That timesheet doesn't exist or you can't see it.");
  return row;
}

/** Open (submitted) or approved timesheets of the employee overlapping the period. */
async function openOverlapping(db: Db, orgId: string, employeeId: string, p: Period) {
  const [row] = await db
    .select()
    .from(attendanceTimesheets)
    .where(
      orgScope(db, orgId).where(
        attendanceTimesheets,
        eq(attendanceTimesheets.employeeId, employeeId),
        inArray(attendanceTimesheets.status, [...OPEN]),
        lte(attendanceTimesheets.periodStart, p.end),
        gte(attendanceTimesheets.periodEnd, p.start),
      ),
    )
    .limit(1);
  return row ?? null;
}

/** Each employee's latest timesheet overlapping the period (any status). */
export async function latestTimesheets(
  db: Db,
  orgId: string,
  employeeIds: readonly string[],
  p: Period,
): Promise<Map<string, AttendanceTimesheet>> {
  if (!employeeIds.length) return new Map();
  const rows = await db
    .select()
    .from(attendanceTimesheets)
    .where(
      orgScope(db, orgId).where(
        attendanceTimesheets,
        inArray(attendanceTimesheets.employeeId, [...employeeIds]),
        lte(attendanceTimesheets.periodStart, p.end),
        gte(attendanceTimesheets.periodEnd, p.start),
      ),
    )
    .orderBy(desc(attendanceTimesheets.submittedAt), desc(attendanceTimesheets.createdAt));
  const out = new Map<string, AttendanceTimesheet>();
  for (const r of rows) if (!out.has(r.employeeId)) out.set(r.employeeId, r);
  return out;
}

const dayMonth = (date: string) => displayDate(date).replace(/ \d{4}$/, "");
const listDays = (days: readonly DayRecord[]) =>
  days.length > 4
    ? `${days
        .slice(0, 3)
        .map((d) => dayMonth(d.date))
        .join(", ")} and ${days.length - 3} more`
    : days.map((d) => dayMonth(d.date)).join(", ");

/** Non-blocking warnings at submission (spec "Timesheet submission"). */
export function submissionWarnings(days: readonly DayRecord[]): string[] {
  const warnings: string[] = [];
  const missing = days.filter((d) => d.missingPunches > 0 && !d.open);
  if (missing.length) {
    warnings.push(
      `${missing.length === 1 ? "1 day has" : `${missing.length} days have`} a missing punch (${listDays(missing)}). Correct ${missing.length === 1 ? "it" : "them"} before the timesheet is approved, or the approver may return it.`,
    );
  }
  const unclaimed = days.filter((d) => d.otMinutes > 0 && (!d.otClaim || d.otClaim.status === "withdrawn"));
  if (unclaimed.length) {
    warnings.push(
      `Overtime on ${unclaimed.length === 1 ? "1 day isn't" : `${unclaimed.length} days isn't`} claimed (${listDays(unclaimed)}). Claim it before the timesheet is approved: approved days are locked.`,
    );
  }
  const pending = days.filter((d) => d.otClaim?.status === "pending").length;
  if (pending) {
    warnings.push(
      `${pending === 1 ? "1 overtime claim" : `${pending} overtime claims`} in this period ${pending === 1 ? "is" : "are"} still waiting for approval.`,
    );
  }
  return warnings;
}

function noApproval(): AppError {
  return new AppError(
    "conflict",
    "Timesheet approval is off for your organisation. An owner or HR admin can turn it on under Settings → Attendance.",
  );
}

function notOverError(p: Period, now: Date): AppError {
  const from = submittableFrom(p);
  const fromDay = singaporeDate(from);
  const when =
    fromDay === singaporeDate(now)
      ? "from 04:00 today, once overnight shifts have closed"
      : `once the period is over, from ${displayDate(fromDay)}`;
  return new AppError("validation_failed", `The timesheet for ${periodLabel(p)} can be submitted ${when}.`, {
    issues: [{ path: "date", message: "Pick a period that has ended." }],
    submittableFrom: from.toISOString(),
  });
}

/**
 * Submits the period containing `input.date` (spec "Timesheet submission"). `authorizeFor` grants
 * the organisation's mode: `attendance:create` (employees; owner and hr_admin on behalf) or
 * `attendance:update` (managers' teams; owner and hr_admin). It throws 403 without one.
 */
export async function submitTimesheet(
  deps: AppDeps,
  actor: TimesheetActor,
  settings: AttendanceSettings,
  input: z.output<typeof submitInput>,
  authorizeFor: (permission: "attendance:create" | "attendance:update") => Promise<Grant>,
): Promise<{ timesheet: AttendanceTimesheet; warnings: string[] }> {
  if (!settings.timesheetApproval) throw noApproval();
  const employeeId = input.employeeId ?? actor.employeeId;
  if (!employeeId) {
    throw new AppError(
      "validation_failed",
      "Your sign-in isn't linked to an employee record, so choose the employee.",
      {
        issues: [{ path: "employeeId", message: "Choose the employee." }],
      },
    );
  }
  const managerMode = settings.timesheetSubmitter === "manager";
  if (managerMode && employeeId === actor.employeeId) {
    throw new AppError(
      "forbidden",
      "In your organisation, managers submit timesheets. Ask your manager or HR to submit yours.",
    );
  }
  const grant = await authorizeFor(managerMode ? "attendance:update" : "attendance:create");
  await grant.assertEmployee(employeeId, "employee");
  const period = periodOf(input.date, settings.timesheetPeriod);
  const now = deps.clock.now();
  if (!isPeriodOver(period, now)) throw notOverError(period, now);
  const sheet = await timesheets(deps.db, actor.orgId, [employeeId], period.start, period.end, singaporeDate(now));
  const days = sheet.days.get(employeeId) ?? [];
  if (!days.some((d) => d.dayType !== "not_employed")) {
    throw new AppError(
      "validation_failed",
      `${sheet.times.get(employeeId)?.name ?? "This employee"} wasn't employed between ${displayDate(period.start)} and ${displayDate(period.end)}, so there is no timesheet to submit.`,
      { issues: [{ path: "date", message: "Pick a period in which they were employed." }] },
    );
  }
  const totals: TimesheetTotalsSnapshot = totalsOf(days);
  const warnings = submissionWarnings(days);
  const already = (row: AttendanceTimesheet) =>
    new AppError(
      "conflict",
      row.status === "approved"
        ? `The timesheet for ${periodLabel({ start: row.periodStart, end: row.periodEnd })} is already approved.`
        : `The timesheet for ${periodLabel({ start: row.periodStart, end: row.periodEnd })} was already submitted and is waiting for approval.`,
      { timesheetId: row.id },
    );
  try {
    return await deps.db.transaction(async (tx) => {
      const open = await openOverlapping(tx, actor.orgId, employeeId, period);
      if (open) throw already(open);
      const id = deps.ids.newId();
      await tx.insert(attendanceTimesheets).values({
        id,
        orgId: actor.orgId,
        employeeId,
        periodStart: period.start,
        periodEnd: period.end,
        status: "submitted",
        submittedByMembershipId: actor.membershipId,
        submittedAt: now,
        submittedTotals: totals,
      });
      await recordAudit(tx, deps, actor.audit, {
        action: "attendance.timesheet_submitted",
        targetType: "attendance_timesheet",
        targetId: id,
        meta: {
          employeeId,
          periodStart: period.start,
          periodEnd: period.end,
          onBehalf: employeeId !== actor.employeeId,
        },
      });
      const requester =
        employeeId === actor.employeeId
          ? actor.membershipId
          : ((await memberOf(tx, actor.orgId, employeeId)) ?? actor.membershipId);
      const approval = await submitApproval(tx, deps, actor.audit, {
        orgId: actor.orgId,
        subjectType: "timesheet",
        subjectId: id,
        requesterMembershipId: requester,
        requesterEmployeeId: employeeId,
      });
      const [row] = await tx
        .update(attendanceTimesheets)
        .set({ approvalRequestId: approval.requestId })
        .where(orgScope(tx, actor.orgId).whereId(attendanceTimesheets, id))
        .returning();
      if (!row) throw new Error("timesheet insert returned nothing");
      return { timesheet: row, warnings };
    });
  } catch (err) {
    if (isUniqueViolation(err, "attendance_timesheets_one_open")) {
      throw new AppError(
        "conflict",
        `The timesheet for ${periodLabel(period)} was already submitted. Reload to see it.`,
      );
    }
    throw err;
  }
}

/** The employee or whoever submitted it withdraws a pending timesheet. `grant`: `attendance:read`. */
export async function withdrawTimesheet(deps: AppDeps, actor: TimesheetActor, grant: Grant, id: string) {
  const found = await loadTimesheet(deps.db, actor.orgId, id);
  await grant.assertEmployee(found.employeeId, "timesheet");
  if (found.employeeId !== actor.employeeId && found.submittedByMembershipId !== actor.membershipId) {
    throw new AppError(
      "forbidden",
      "Only the employee or whoever submitted it can withdraw a timesheet. Approvers return it with a comment instead.",
    );
  }
  return deps.db.transaction(async (tx) => {
    const ts = await loadTimesheet(tx, actor.orgId, id);
    if (ts.status !== "submitted") {
      throw new AppError("conflict", `This timesheet is ${ts.status}, so it can't be withdrawn.`);
    }
    const done = await withdrawSubject(tx, deps, actor.audit, {
      orgId: actor.orgId,
      subjectType: "timesheet",
      subjectId: id,
    });
    if (!done) await setDecided(tx, actor.orgId, id, { status: "withdrawn", at: deps.clock.now() });
    await recordAudit(tx, deps, actor.audit, {
      action: "attendance.timesheet_withdrawn",
      targetType: "attendance_timesheet",
      targetId: id,
      meta: { employeeId: ts.employeeId, periodStart: ts.periodStart, periodEnd: ts.periodEnd },
    });
    return loadTimesheet(tx, actor.orgId, id);
  });
}

/** Moves a submitted timesheet to its final state (adapter callbacks, withdrawal). */
export async function setDecided(
  db: Db,
  orgId: string,
  id: string,
  patch: {
    status: "approved" | "returned" | "withdrawn";
    at: Date;
    by?: string | null;
    comment?: string | null;
    approvedTotals?: TimesheetTotalsSnapshot;
  },
) {
  await db
    .update(attendanceTimesheets)
    .set({
      status: patch.status,
      decidedAt: patch.at,
      updatedAt: patch.at,
      ...(patch.by !== undefined ? { decidedByMembershipId: patch.by } : {}),
      ...(patch.comment !== undefined ? { comment: patch.comment } : {}),
      ...(patch.approvedTotals ? { approvedTotals: patch.approvedTotals } : {}),
    })
    .where(
      orgScope(db, orgId).where(
        attendanceTimesheets,
        eq(attendanceTimesheets.id, id),
        eq(attendanceTimesheets.status, "submitted"),
      ),
    );
}

/**
 * Reopens an approved timesheet in the caller's transaction (spec "Reopening a timesheet"):
 * audited with the reason, the employee and the submitter are notified. The approval request
 * stays decided; the period must be submitted again.
 */
export async function reopenLocked(
  tx: Db,
  deps: AppDeps,
  actor: TimesheetActor,
  ts: AttendanceTimesheet,
  reason: string,
): Promise<AttendanceTimesheet> {
  const now = deps.clock.now();
  const [row] = await tx
    .update(attendanceTimesheets)
    .set({
      status: "reopened",
      reopenedAt: now,
      reopenedByMembershipId: actor.membershipId,
      reopenReason: reason,
      updatedAt: now,
    })
    .where(
      orgScope(tx, actor.orgId).where(
        attendanceTimesheets,
        eq(attendanceTimesheets.id, ts.id),
        eq(attendanceTimesheets.status, "approved"),
      ),
    )
    .returning();
  if (!row) throw new AppError("conflict", "This timesheet is no longer approved. Reload to see its status.");
  await recordAudit(tx, deps, actor.audit, {
    action: "attendance.timesheet_reopened",
    targetType: "attendance_timesheet",
    targetId: ts.id,
    meta: { employeeId: ts.employeeId, periodStart: ts.periodStart, periodEnd: ts.periodEnd, reason },
  });
  const label = periodLabel({ start: ts.periodStart, end: ts.periodEnd });
  const employeeMember = await memberOf(tx, actor.orgId, ts.employeeId);
  const send = async (recipient: string | null, link: string, headline: string) => {
    if (!recipient || recipient === actor.membershipId) return;
    await notify(tx, deps, {
      orgId: actor.orgId,
      recipients: [recipient],
      kind: "timesheet_reopened",
      title: headline,
      body: `${reason}. Submit it again once it's right.`,
      link,
      subjectType: "timesheet",
      subjectId: ts.id,
      email: {
        headline: `${headline}.`,
        detail: "Submit it again once it's right.",
        linkPath: link,
        actionLabel: "Open timesheet",
      },
    });
  };
  await send(
    employeeMember,
    `/attendance/timesheet?period=${ts.periodStart}`,
    `Your timesheet for ${label} was reopened`,
  );
  if (ts.submittedByMembershipId !== employeeMember) {
    const name = (await employeeNames(tx, actor.orgId, [ts.employeeId])).get(ts.employeeId) ?? "An employee";
    await send(
      ts.submittedByMembershipId,
      `/attendance/timesheets?date=${ts.periodStart}&employee=${ts.employeeId}`,
      `${name}'s timesheet for ${label} was reopened`,
    );
  }
  return row;
}

/** HR reopens an approved timesheet without a correction. `grant`: `attendance:reopen`. */
export async function reopenTimesheet(deps: AppDeps, actor: TimesheetActor, grant: Grant, id: string, reason: string) {
  const found = await loadTimesheet(deps.db, actor.orgId, id);
  await grant.assertEmployee(found.employeeId, "timesheet");
  if (found.employeeId === actor.employeeId) {
    throw new AppError(
      "self_change_requires_approval",
      "You can't reopen your own timesheet. Ask another HR admin or an owner.",
    );
  }
  return deps.db.transaction(async (tx) => {
    const ts = await loadTimesheet(tx, actor.orgId, id);
    if (ts.status !== "approved") {
      throw new AppError("conflict", `This timesheet is ${ts.status}, so there is nothing to reopen.`);
    }
    return reopenLocked(tx, deps, actor, ts, reason);
  });
}

/** Employees among `ids` employed at some point in the period. */
export async function employedIn(db: Db, orgId: string, ids: readonly string[], p: Period): Promise<string[]> {
  if (!ids.length) return [];
  const rows = await db
    .selectDistinct({ id: tenures.employeeId })
    .from(tenures)
    .where(
      orgScope(db, orgId).where(
        tenures,
        inArray(tenures.employeeId, [...ids]),
        lte(tenures.hireDate, p.end),
        sql`(${tenures.lastWorkingDay} is null or ${tenures.lastWorkingDay} >= ${p.start})`,
      ),
    );
  return rows.map((r) => r.id);
}

/** Employees among `ids` employed in the period without an open or approved timesheet for it. */
export async function unsubmitted(db: Db, orgId: string, ids: readonly string[], p: Period): Promise<string[]> {
  const employed = await employedIn(db, orgId, ids, p);
  if (!employed.length) return [];
  const done = await db
    .selectDistinct({ id: attendanceTimesheets.employeeId })
    .from(attendanceTimesheets)
    .where(
      orgScope(db, orgId).where(
        attendanceTimesheets,
        inArray(attendanceTimesheets.employeeId, employed),
        inArray(attendanceTimesheets.status, [...OPEN]),
        lte(attendanceTimesheets.periodStart, p.end),
        gte(attendanceTimesheets.periodEnd, p.start),
      ),
    );
  const covered = new Set(done.map((d) => d.id));
  return employed.filter((id) => !covered.has(id));
}

/** The viewer's pending approval tasks for these requests, by request ID. */
export async function myTasks(
  db: Db,
  orgId: string,
  membershipId: string,
  requestIds: readonly string[],
): Promise<Map<string, string>> {
  if (!requestIds.length) return new Map();
  const rows = await db
    .select({ id: approvalTasks.id, requestId: approvalTasks.requestId })
    .from(approvalTasks)
    .where(
      and(
        eq(approvalTasks.orgId, orgId),
        eq(approvalTasks.assigneeMembershipId, membershipId),
        eq(approvalTasks.status, "pending"),
        inArray(approvalTasks.requestId, [...requestIds]),
      ),
    );
  return new Map(rows.map((r) => [r.requestId, r.id]));
}
