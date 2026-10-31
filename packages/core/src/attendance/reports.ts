import { and, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { z } from "zod";
import type { Grant } from "../access/authorize.ts";
import { orgScope } from "../access/org-scope.ts";
import { overtimeClaims } from "../db/schema/attendance.ts";
import { tenures } from "../db/schema/employees.ts";
import type { Db } from "../db/types.ts";
import { isIsoDate } from "../employees/dates.ts";
import { AppError } from "../errors.ts";
import { toCsv } from "../leave/outputs.ts";
import { timesheets, totalsOf } from "./timesheet.ts";

/** Attendance summary for a period (spec "Attendance summary export"). */

const isoDate = z.string().refine(isIsoDate, { message: "Use the date format YYYY-MM-DD, like 2026-11-01." });
export const MAX_REPORT_DAYS = 62;

export const summaryQuery = z.object({ from: isoDate, to: isoDate });

export const summaryRow = z.object({
  employeeId: z.uuid(),
  name: z.string(),
  daysWorked: z.number(),
  workedMinutes: z.number(),
  lateCount: z.number(),
  lateMinutes: z.number(),
  earlyOutCount: z.number(),
  missingPunches: z.number(),
  computedOtMinutes: z.number(),
  approvedOtMinutes: z.number(),
  leaveDays: z.number(),
});
export type SummaryRow = z.input<typeof summaryRow>;

export function assertRange(from: string, to: string, maxDays: number) {
  if (to < from) {
    throw new AppError("validation_failed", "The end date is before the start date.", {
      issues: [{ path: "to", message: "Pick an end date on or after the start date." }],
    });
  }
  if ((Date.parse(to) - Date.parse(from)) / 86_400_000 + 1 > maxDays) {
    throw new AppError("validation_failed", `Choose at most ${maxDays} days at a time.`, {
      issues: [{ path: "to", message: `Pick a range of up to ${maxDays} days.` }],
    });
  }
}

/** Employees in the grant's scope employed at some point in [from, to]. */
export async function employeesInScope(
  db: Db,
  orgId: string,
  grant: Grant,
  from: string,
  to: string,
): Promise<string[]> {
  const rows = await db
    .selectDistinct({ id: tenures.employeeId })
    .from(tenures)
    .where(
      orgScope(db, orgId).where(
        tenures,
        lte(tenures.hireDate, to),
        sql`(${tenures.lastWorkingDay} is null or ${tenures.lastWorkingDay} >= ${from})`,
        await grant.employeeFilter(tenures.employeeId),
      ),
    );
  return rows.map((r) => r.id);
}

export async function attendanceSummary(db: Db, orgId: string, grant: Grant, from: string, to: string, today: string) {
  assertRange(from, to, MAX_REPORT_DAYS);
  const ids = await employeesInScope(db, orgId, grant, from, to);
  if (!ids.length) return [];
  const sheet = await timesheets(db, orgId, ids, from, to, today);
  const approved = await db
    .select({
      employeeId: overtimeClaims.employeeId,
      total: sql<number>`coalesce(sum(coalesce(${overtimeClaims.approvedMinutes}, ${overtimeClaims.claimedMinutes})), 0)::int`,
    })
    .from(overtimeClaims)
    .where(
      and(
        eq(overtimeClaims.orgId, orgId),
        inArray(overtimeClaims.employeeId, ids),
        eq(overtimeClaims.status, "approved"),
        gte(overtimeClaims.workDate, from),
        lte(overtimeClaims.workDate, to),
      ),
    )
    .groupBy(overtimeClaims.employeeId);
  const rows: SummaryRow[] = [];
  for (const [employeeId, days] of sheet.days) {
    const t = totalsOf(days);
    rows.push({
      employeeId,
      name: sheet.times.get(employeeId)?.name ?? "",
      daysWorked: t.daysWorked,
      workedMinutes: t.workedMinutes,
      lateCount: t.lateCount,
      lateMinutes: t.lateMinutes,
      earlyOutCount: t.earlyOutCount,
      missingPunches: t.missingPunches,
      computedOtMinutes: t.otMinutes,
      approvedOtMinutes: Number(approved.find((a) => a.employeeId === employeeId)?.total ?? 0),
      leaveDays: t.leaveDays,
    });
  }
  return rows.sort((a, b) => a.name.localeCompare(b.name));
}

const hours = (minutes: number) => (minutes / 60).toFixed(2);

export function summaryCsv(rows: readonly SummaryRow[]): string {
  return toCsv(
    [
      "Employee",
      "Days worked",
      "Hours worked",
      "Late days",
      "Late minutes",
      "Early-out days",
      "Missing punches",
      "OT hours (timesheet)",
      "OT hours (approved)",
      "Leave days",
    ],
    rows.map((r) => [
      r.name,
      r.daysWorked,
      hours(r.workedMinutes),
      r.lateCount,
      r.lateMinutes,
      r.earlyOutCount,
      r.missingPunches,
      hours(r.computedOtMinutes),
      hours(r.approvedOtMinutes),
      r.leaveDays,
    ]),
  );
}
