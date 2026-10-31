import { z } from "zod";
import { addDays, displayDate, isIsoDate } from "../employees/dates.ts";
import { inBatches, type ReportDefinition, type ReportSource } from "../reporting/types.ts";
import { attendanceSummary, MAX_REPORT_DAYS } from "./reports.ts";

/**
 * Attendance exceptions and hours by employee for a period (add-reporting spec "Module reports
 * through definitions"), from the attendance module's own timesheet summary. Readers: owner and
 * hr_admin (organisation), managers (their team), `reports_attendance:*`.
 */

const isoDate = z.string().refine(isIsoDate, { message: "Use the date format YYYY-MM-DD, like 2026-11-01." });

const params = ({ today }: { today: string }) =>
  z
    .object({ from: isoDate.default(`${today.slice(0, 7)}-01`), to: isoDate.default(today) })
    .refine((p) => p.from <= p.to, { message: "Pick a start date on or before the end date.", path: ["from"] })
    .refine((p) => p.to <= addDays(p.from, MAX_REPORT_DAYS - 1), {
      message: `Choose at most ${MAX_REPORT_DAYS} days at a time.`,
      path: ["to"],
    });

export const attendanceExceptionsReport: ReportDefinition<z.output<ReturnType<typeof params>>> = {
  id: "attendance.exceptions",
  module: "attendance",
  title: "Lateness, missing punches and overtime",
  description: "Days worked, late arrivals, early outs, missing punches and overtime hours per employee.",
  read: "reports_attendance:read",
  export: "reports_attendance:export",
  params,
  fields: [
    { key: "from", label: "From", kind: "date" },
    { key: "to", label: "To", kind: "date", hint: `Up to ${MAX_REPORT_DAYS} days.` },
  ],
  columns: () => [
    { key: "name", title: "Employee", type: "text" },
    { key: "daysWorked", title: "Days worked", type: "integer", total: "sum" },
    { key: "workedMinutes", title: "Hours worked", type: "hours", total: "sum" },
    { key: "lateCount", title: "Late days", type: "integer", total: "sum" },
    { key: "lateMinutes", title: "Late minutes", type: "integer", total: "sum" },
    { key: "earlyOutCount", title: "Early outs", type: "integer", total: "sum" },
    { key: "missingPunches", title: "Missing punches", type: "integer", total: "sum" },
    { key: "computedOtMinutes", title: "OT hours (timesheet)", type: "hours", total: "sum" },
    { key: "approvedOtMinutes", title: "OT hours (approved)", type: "hours", total: "sum" },
    { key: "leaveDays", title: "Leave days", type: "decimal", total: "sum" },
  ],
  defaultSort: { key: "name", dir: "asc" },
  async *run(ctx, p) {
    const rows = await attendanceSummary(ctx.db, ctx.orgId, ctx.grant, p.from, p.to, ctx.today);
    yield* inBatches(rows.map(({ employeeId: _id, ...r }) => r));
  },
  emptyMessage: (p) => `Nobody in this report was employed between ${displayDate(p.from)} and ${displayDate(p.to)}.`,
  notes: ["Late and early-out are against each employee's work schedule. Approved OT counts approved overtime claims."],
  chart: { label: "name", value: "lateCount" },
};

export const attendanceReportSource: ReportSource = { module: "attendance", reports: [attendanceExceptionsReport] };
