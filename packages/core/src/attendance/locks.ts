import { asc, eq, gte, inArray, lte } from "drizzle-orm";
import { orgScope } from "../access/org-scope.ts";
import { type AttendanceTimesheet, attendanceTimesheets } from "../db/schema/attendance.ts";
import type { Db } from "../db/types.ts";
import { AppError } from "../errors.ts";
import { periodLabel } from "./periods.ts";

/**
 * The approved-timesheet lock (add-timesheet-approval spec "Approved timesheets lock the period",
 * design decision 6). Callers check that the organisation has timesheet approval on: with it off,
 * nothing is locked even where approved rows exist.
 */

/** Approved timesheets of these employees that overlap [from, to]. */
export async function approvedOverlapping(
  db: Db,
  orgId: string,
  employeeIds: readonly string[],
  from: string,
  to: string,
): Promise<AttendanceTimesheet[]> {
  if (!employeeIds.length) return [];
  return db
    .select()
    .from(attendanceTimesheets)
    .where(
      orgScope(db, orgId).where(
        attendanceTimesheets,
        inArray(attendanceTimesheets.employeeId, [...employeeIds]),
        eq(attendanceTimesheets.status, "approved"),
        lte(attendanceTimesheets.periodStart, to),
        gte(attendanceTimesheets.periodEnd, from),
      ),
    )
    .orderBy(asc(attendanceTimesheets.periodStart));
}

/** The employee's approved timesheet covering `date`, if any. */
export async function approvedCovering(
  db: Db,
  orgId: string,
  employeeId: string,
  date: string,
): Promise<AttendanceTimesheet | null> {
  const [row] = await approvedOverlapping(db, orgId, [employeeId], date, date);
  return row ?? null;
}

function lockDetails(ts: AttendanceTimesheet) {
  return { reason: "timesheet_locked", timesheetId: ts.id, periodStart: ts.periodStart, periodEnd: ts.periodEnd };
}

const range = (ts: AttendanceTimesheet) => periodLabel({ start: ts.periodStart, end: ts.periodEnd });

/**
 * An employee's punch into an approved period. `punch_rejected`, not a new code: native clients
 * that lag the server already drop such a punch from their queue and show the message.
 */
export function punchLockedError(ts: AttendanceTimesheet): AppError {
  return new AppError(
    "punch_rejected",
    `Your timesheet for ${range(ts)} is approved, so this punch can't be added. Ask HR to add it if it was right.`,
    lockDetails(ts),
  );
}

/** A correction to a locked day. Owners and HR admins may confirm with `reopen: true`. */
export function correctionLockedError(ts: AttendanceTimesheet, canReopen: boolean): AppError {
  return new AppError(
    "timesheet_locked",
    canReopen
      ? `The timesheet for ${range(ts)} is approved. Correcting this day reopens it, and it must be submitted and approved again. Confirm to reopen it.`
      : `The timesheet for ${range(ts)} is approved, so this day can't be corrected. Ask an HR admin: their correction reopens the timesheet.`,
    { ...lockDetails(ts), canReopen },
  );
}

/** A new overtime claim for a locked day. */
export function overtimeLockedError(ts: AttendanceTimesheet): AppError {
  return new AppError(
    "timesheet_locked",
    `The timesheet for ${range(ts)} is approved, so overtime can't be claimed for that day any more. Ask HR to reopen it first.`,
    { ...lockDetails(ts), canReopen: false },
  );
}
