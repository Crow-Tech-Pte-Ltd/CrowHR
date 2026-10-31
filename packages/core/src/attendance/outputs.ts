import { and, asc, eq, gte, inArray, isNull, lte } from "drizzle-orm";
import { orgScope } from "../access/org-scope.ts";
import { attendancePunches, overtimeClaims } from "../db/schema/attendance.ts";
import { leaveRequestDays, leaveRequests, leaveTypes } from "../db/schema/leave.ts";
import type { Db } from "../db/types.ts";
import type { AppDeps } from "../deps.ts";
import { datesBetween, dayInfo, loadEmployeesTime, scheduleOn } from "../leave/calendar.ts";
import { timesheets } from "./timesheet.ts";

/**
 * The payroll overtime feed (spec "Payroll overtime feed").
 *
 * `ApprovedOvertime` and `OvertimeSource` mirror `packages/core/src/payroll/ports.ts` on the WS4
 * payroll branch exactly; the integrator wires `attendanceOvertimeSource(deps)` into
 * `payrollPorts` at merge (then these local copies can be replaced by imports).
 */
export interface ApprovedOvertime {
  /** Stable id from attendance (idempotent import): the overtime claim id. */
  sourceId: string;
  employeeId: string;
  minutes: number;
  periodStart: string;
  periodEnd: string;
}

export interface OvertimeSource {
  listApproved(orgId: string, periodStart: string, periodEnd: string): Promise<ApprovedOvertime[]>;
}

/** Approved claims dated within [periodStart, periodEnd], one entry per claim (period = that date). */
export async function listApprovedOvertime(db: Db, orgId: string, periodStart: string, periodEnd: string) {
  const rows = await db
    .select()
    .from(overtimeClaims)
    .where(
      orgScope(db, orgId).where(
        overtimeClaims,
        eq(overtimeClaims.status, "approved"),
        gte(overtimeClaims.workDate, periodStart),
        lte(overtimeClaims.workDate, periodEnd),
      ),
    )
    .orderBy(asc(overtimeClaims.employeeId), asc(overtimeClaims.workDate));
  return rows.map(
    (r): ApprovedOvertime => ({
      sourceId: r.id,
      employeeId: r.employeeId,
      minutes: r.approvedMinutes ?? r.claimedMinutes,
      periodStart: r.workDate,
      periodEnd: r.workDate,
    }),
  );
}

export function attendanceOvertimeSource(deps: Pick<AppDeps, "db">): OvertimeSource {
  return { listApproved: (orgId, from, to) => listApprovedOvertime(deps.db, orgId, from, to) };
}

/**
 * Days worked for rostered staff (no fixed week), for payroll's incomplete-month formula (EA s 20A:
 * "days worked" includes public holidays and paid leave, excludes no-pay leave). Only employees who
 * clock in through attendance in the period are listed: without punches attendance knows nothing,
 * and payroll keeps asking for the figures by hand.
 *
 * NOT IMPLEMENTED: scheduled days (the roster's required days) need the scheduling module (M3), so
 * payroll still asks HR for "Scheduled days".
 */
export interface RosterDaysWorked {
  /** Stable per employee and period. */
  sourceId: string;
  employeeId: string;
  /** Multiples of 0.5. */
  daysWorked: number;
  periodStart: string;
  periodEnd: string;
}

export interface DaysWorkedSource {
  listDaysWorked(orgId: string, periodStart: string, periodEnd: string): Promise<RosterDaysWorked[]>;
}

export async function listRosterDaysWorked(db: Db, orgId: string, periodStart: string, periodEnd: string) {
  const org = orgScope(db, orgId);
  const punched = await db
    .selectDistinct({ employeeId: attendancePunches.employeeId })
    .from(attendancePunches)
    .where(
      org.where(
        attendancePunches,
        isNull(attendancePunches.voidedAt),
        gte(attendancePunches.workDate, periodStart),
        lte(attendancePunches.workDate, periodEnd),
      ),
    );
  if (!punched.length) return [];
  const ids = punched.map((p) => p.employeeId);
  const times = await loadEmployeesTime(db, orgId, ids);
  const rostered = [...times.values()].filter((t) =>
    datesBetween(periodStart, periodEnd).some((d) => scheduleOn(t, d)?.version.days === null),
  );
  if (!rostered.length) return [];
  const sheets = await timesheets(
    db,
    orgId,
    rostered.map((t) => t.employeeId),
    periodStart,
    periodEnd,
    periodEnd,
  );
  const paidLeave = await db
    .select({
      employeeId: leaveRequestDays.employeeId,
      date: leaveRequestDays.date,
      hundredths: leaveRequestDays.hundredths,
    })
    .from(leaveRequestDays)
    .innerJoin(
      leaveRequests,
      and(eq(leaveRequests.orgId, leaveRequestDays.orgId), eq(leaveRequests.id, leaveRequestDays.requestId)),
    )
    .innerJoin(
      leaveTypes,
      and(eq(leaveTypes.orgId, leaveRequestDays.orgId), eq(leaveTypes.id, leaveRequestDays.leaveTypeId)),
    )
    .where(
      org.where(
        leaveRequestDays,
        inArray(
          leaveRequestDays.employeeId,
          rostered.map((t) => t.employeeId),
        ),
        gte(leaveRequestDays.date, periodStart),
        lte(leaveRequestDays.date, periodEnd),
        eq(leaveTypes.paid, true),
        eq(leaveRequests.unit, "days"),
        inArray(leaveRequests.status, ["approved", "cancellation_pending"]),
      ),
    );
  return rostered.map((t): RosterDaysWorked => {
    let halves = 0;
    for (const day of sheets.days.get(t.employeeId) ?? []) {
      if (day.dayType === "not_employed") continue;
      if (day.workedMinutes > 0 || dayInfo(t, day.date).holiday) {
        halves += 2;
        continue;
      }
      const leave = paidLeave
        .filter((l) => l.employeeId === t.employeeId && l.date === day.date)
        .reduce((s, l) => s + l.hundredths, 0);
      halves += Math.min(2, Math.round(leave / 50));
    }
    return {
      sourceId: `days-worked:${t.employeeId}:${periodStart}:${periodEnd}`,
      employeeId: t.employeeId,
      daysWorked: halves / 2,
      periodStart,
      periodEnd,
    };
  });
}

export function attendanceDaysWorkedSource(deps: Pick<AppDeps, "db">): DaysWorkedSource {
  return { listDaysWorked: (orgId, from, to) => listRosterDaysWorked(deps.db, orgId, from, to) };
}
