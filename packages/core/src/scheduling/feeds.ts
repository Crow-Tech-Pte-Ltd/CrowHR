import { and, asc, eq, gte, inArray, lte } from "drizzle-orm";
import { orgScope } from "../access/org-scope.ts";
import { leaveRequestDays, leaveRequests } from "../db/schema/leave.ts";
import { publishedShifts, rosters } from "../db/schema/scheduling.ts";
import type { Db } from "../db/types.ts";
import type { AppDeps } from "../deps.ts";
import { addDays } from "../employees/dates.ts";
import {
  datesBetween,
  dayInfo,
  type EmployeeTime,
  employmentOn,
  loadEmployeesTime,
  type RosterEntry,
  scheduleOn,
  tenureOn,
} from "../leave/calendar.ts";
import type { RosterScheduledDays, ScheduledDaysSource } from "../payroll/ports.ts";
import { mondayOf, paidMinutes } from "./time.ts";

/**
 * What scheduling gives other modules (design decision 7). Everything here reads the published
 * copy only: drafts and unpublished edits never reach attendance, leave or payroll.
 */

export interface PlannedShift {
  id: string;
  rosterId: string;
  employeeId: string;
  date: string;
  kind: "shift" | "rest";
  startsAt: Date | null;
  endsAt: Date | null;
  breakMinutes: number;
  paidMinutes: number;
  templateId: string | null;
  note: string | null;
}

/** `PlannedShifts.forEmployee` (published only, by roster date). */
export async function plannedShifts(
  db: Db,
  orgId: string,
  employeeIds: readonly string[],
  from: string,
  to: string,
): Promise<PlannedShift[]> {
  if (!employeeIds.length) return [];
  const rows = await db
    .select()
    .from(publishedShifts)
    .where(
      orgScope(db, orgId).where(
        publishedShifts,
        inArray(publishedShifts.employeeId, [...employeeIds]),
        gte(publishedShifts.date, from),
        lte(publishedShifts.date, to),
      ),
    )
    .orderBy(asc(publishedShifts.date), asc(publishedShifts.startsAt));
  return rows.map((r) => ({
    id: r.id,
    rosterId: r.rosterId,
    employeeId: r.employeeId as string,
    date: r.date,
    kind: r.kind,
    startsAt: r.startsAt,
    endsAt: r.endsAt,
    breakMinutes: r.breakMinutes,
    paidMinutes: r.startsAt && r.endsAt ? paidMinutes(r.startsAt, r.endsAt, r.breakMinutes) : 0,
    templateId: r.templateId,
    note: r.note,
  }));
}

export interface PlannedShifts {
  forEmployee(orgId: string, employeeId: string, from: string, to: string): Promise<PlannedShift[]>;
}

export function createPlannedShifts(deps: Pick<AppDeps, "db">): PlannedShifts {
  return { forEmployee: (orgId, employeeId, from, to) => plannedShifts(deps.db, orgId, [employeeId], from, to) };
}

/** Does the employee's employment on `date` fall inside a roster scope? */
export function inScope(
  t: EmployeeTime,
  date: string,
  scope: { locationId: string | null; departmentId: string | null },
): boolean {
  if (!tenureOn(t, date)) return false;
  const emp = employmentOn(t, date);
  if (!emp) return false;
  if (scope.locationId && emp.locationId !== scope.locationId) return false;
  if (scope.departmentId && emp.departmentId !== scope.departmentId) return false;
  return !!(scope.locationId || scope.departmentId);
}

/**
 * Attaches each employee's published roster over [from, to] to their `EmployeeTime` (the leave
 * calculator then prefers it for shift-schedule staff). A week is covered when the employee has
 * a published row in it, or is in the scope of a roster published for that week.
 */
export async function attachRosters(
  db: Db,
  orgId: string,
  times: ReadonlyMap<string, EmployeeTime>,
  from: string,
  to: string,
): Promise<void> {
  const ids = [...times.keys()];
  if (!ids.length) return;
  const weekFrom = mondayOf(from);
  const weekTo = addDays(mondayOf(to), 6);
  const org = orgScope(db, orgId);
  const rows = await db
    .select()
    .from(publishedShifts)
    .where(
      org.where(
        publishedShifts,
        inArray(publishedShifts.employeeId, ids),
        gte(publishedShifts.date, weekFrom),
        lte(publishedShifts.date, weekTo),
      ),
    );
  const published = await db
    .select({ weekStart: rosters.weekStart, locationId: rosters.locationId, departmentId: rosters.departmentId })
    .from(rosters)
    .where(
      org.where(
        rosters,
        eq(rosters.status, "published"),
        gte(rosters.weekStart, weekFrom),
        lte(rosters.weekStart, weekTo),
      ),
    );
  for (const [employeeId, t] of times) {
    const weeks = new Set<string>();
    const days = new Map<string, RosterEntry[]>();
    for (const r of rows) {
      if (r.employeeId !== employeeId) continue;
      weeks.add(mondayOf(r.date));
      const list = days.get(r.date) ?? [];
      list.push({
        kind: r.kind,
        startsAt: r.startsAt,
        endsAt: r.endsAt,
        breakMinutes: r.breakMinutes,
        minutes: r.startsAt && r.endsAt ? paidMinutes(r.startsAt, r.endsAt, r.breakMinutes) : 0,
      });
      days.set(r.date, list);
    }
    for (const p of published) {
      if (weeks.has(p.weekStart)) continue;
      for (let i = 0; i < 7; i++) {
        if (inScope(t, addDays(p.weekStart, i), p)) {
          weeks.add(p.weekStart);
          break;
        }
      }
    }
    t.roster = { weeks, days };
  }
}

/** Is `date` on a published roster of a shift-schedule employee? */
export function rosterCovers(t: EmployeeTime, date: string): boolean {
  return !!t.roster?.weeks.has(mondayOf(date));
}

/**
 * Scheduled days for payroll (`ScheduledDaysSource`, design decision 7): for shift-schedule staff
 * employed for the whole period, every date of which is on a published roster. Scheduled days =
 * dates with a published shift ∪ public holidays not on a rostered rest day ∪ dates of approved
 * leave counted for the employee, so paid leave and holidays never exceed the scheduled days.
 */
export async function listScheduledDays(
  db: Db,
  orgId: string,
  periodStart: string,
  periodEnd: string,
): Promise<RosterScheduledDays[]> {
  const org = orgScope(db, orgId);
  const withShifts = await db
    .selectDistinct({ employeeId: publishedShifts.employeeId })
    .from(publishedShifts)
    .where(org.where(publishedShifts, gte(publishedShifts.date, periodStart), lte(publishedShifts.date, periodEnd)));
  const ids = withShifts.map((r) => r.employeeId).filter((id): id is string => !!id);
  if (!ids.length) return [];
  const times = await loadEmployeesTime(db, orgId, ids);
  await attachRosters(db, orgId, times, periodStart, periodEnd);
  const dates = datesBetween(periodStart, periodEnd);
  const eligible = [...times.values()].filter((t) =>
    dates.every((d) => tenureOn(t, d) && scheduleOn(t, d)?.version.days === null && rosterCovers(t, d)),
  );
  if (!eligible.length) return [];
  const leave = await db
    .select({ employeeId: leaveRequestDays.employeeId, date: leaveRequestDays.date })
    .from(leaveRequestDays)
    .innerJoin(
      leaveRequests,
      and(eq(leaveRequests.orgId, leaveRequestDays.orgId), eq(leaveRequests.id, leaveRequestDays.requestId)),
    )
    .where(
      org.where(
        leaveRequestDays,
        inArray(
          leaveRequestDays.employeeId,
          eligible.map((t) => t.employeeId),
        ),
        gte(leaveRequestDays.date, periodStart),
        lte(leaveRequestDays.date, periodEnd),
        gte(leaveRequestDays.hundredths, 1),
        inArray(leaveRequests.status, ["approved", "cancellation_pending"]),
      ),
    );
  return eligible
    .map((t): RosterScheduledDays => {
      const required = new Set<string>();
      for (const d of dates) {
        const info = dayInfo(t, d);
        if (info.dayType === "shift" || (info.holiday && info.dayType !== "rest")) required.add(d);
      }
      for (const l of leave) if (l.employeeId === t.employeeId) required.add(l.date);
      return {
        sourceId: `scheduled-days:${t.employeeId}:${periodStart}:${periodEnd}`,
        employeeId: t.employeeId,
        scheduledDays: required.size,
        periodStart,
        periodEnd,
      };
    })
    .sort((a, b) => (a.employeeId < b.employeeId ? -1 : 1));
}

export function schedulingScheduledDaysSource(deps: Pick<AppDeps, "db">): ScheduledDaysSource {
  return { listScheduledDays: (orgId, from, to) => listScheduledDays(deps.db, orgId, from, to) };
}
