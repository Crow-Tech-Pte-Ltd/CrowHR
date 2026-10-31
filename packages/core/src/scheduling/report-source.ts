import { inArray } from "drizzle-orm";
import { z } from "zod";
import { orgScope } from "../access/org-scope.ts";
import { employeesInScope } from "../attendance/reports.ts";
import { employees } from "../db/schema/employees.ts";
import { addDays, displayDate, isIsoDate } from "../employees/dates.ts";
import { displayName } from "../employees/records.ts";
import { inBatches, type ReportDefinition, type ReportRow, type ReportSource } from "../reporting/types.ts";
import { plannedShifts } from "./feeds.ts";

/**
 * Scheduled hours per employee from published rosters (drafts never count), for a period of up to
 * 62 days. Readers: owner and hr_admin (organisation) and managers (their team), `rosters:read`;
 * employees hold `rosters:read` for their own roster only, and reports never run at own scope.
 */

const MAX_DAYS = 62;
const isoDate = z.string().refine(isIsoDate, { message: "Use the date format YYYY-MM-DD, like 2026-11-02." });

const params = ({ today }: { today: string }) =>
  z
    .object({ from: isoDate.default(`${today.slice(0, 7)}-01`), to: isoDate.default(today) })
    .refine((p) => p.from <= p.to, { message: "Pick a start date on or before the end date.", path: ["from"] })
    .refine((p) => p.to <= addDays(p.from, MAX_DAYS - 1), {
      message: `Choose at most ${MAX_DAYS} days at a time.`,
      path: ["to"],
    });

export const scheduledHoursReport: ReportDefinition<z.output<ReturnType<typeof params>>> = {
  id: "scheduling.hours",
  module: "scheduling",
  title: "Scheduled hours",
  description: "Shifts, rest days and paid hours per employee from published rosters.",
  read: "rosters:read",
  export: "rosters:read",
  params,
  fields: [
    { key: "from", label: "From", kind: "date" },
    { key: "to", label: "To", kind: "date", hint: `Up to ${MAX_DAYS} days.` },
  ],
  columns: () => [
    { key: "name", title: "Employee", type: "text" },
    { key: "shifts", title: "Shifts", type: "integer", total: "sum" },
    { key: "restDays", title: "Rest days", type: "integer", total: "sum" },
    { key: "paidMinutes", title: "Paid hours", type: "hours", total: "sum" },
  ],
  defaultSort: { key: "name", dir: "asc" },
  async *run(ctx, p) {
    const ids = await employeesInScope(ctx.db, ctx.orgId, ctx.grant, p.from, p.to);
    const scoped = ctx.employeeIds ? ids.filter((id) => ctx.employeeIds?.has(id)) : ids;
    if (!scoped.length) return;
    const shifts = await plannedShifts(ctx.db, ctx.orgId, scoped, p.from, p.to);
    const people = await ctx.db
      .select()
      .from(employees)
      .where(orgScope(ctx.db, ctx.orgId).where(employees, inArray(employees.id, scoped)));
    const rows: ReportRow[] = [];
    for (const e of people) {
      const mine = shifts.filter((s) => s.employeeId === e.id);
      if (!mine.length) continue;
      rows.push({
        name: displayName(e),
        shifts: mine.filter((s) => s.kind === "shift").length,
        restDays: mine.filter((s) => s.kind === "rest").length,
        paidMinutes: mine.reduce((a, s) => a + s.paidMinutes, 0),
      });
    }
    yield* inBatches(rows);
  },
  emptyMessage: (p) =>
    `No published shifts between ${displayDate(p.from)} and ${displayDate(p.to)}. Publish the roster, or widen the dates.`,
  notes: ["Only published rosters count. Paid hours are shift length less the unpaid break."],
  chart: { label: "name", value: "paidMinutes" },
};

export const schedulingReportSource: ReportSource = { module: "scheduling", reports: [scheduledHoursReport] };
