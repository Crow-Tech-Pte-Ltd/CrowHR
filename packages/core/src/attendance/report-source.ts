import { z } from "zod";
import { addDays, displayDate, isIsoDate } from "../employees/dates.ts";
import { inBatches, type ReportDefinition, type ReportSource } from "../reporting/types.ts";
import { attendanceSummary, employeesInScope, MAX_REPORT_DAYS } from "./reports.ts";
import { timesheets } from "./timesheet.ts";

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

const timesheetReport: ReportDefinition<z.output<ReturnType<typeof params>>> = {
  id: "attendance.timesheets",
  module: "attendance",
  title: "Daily timesheets",
  description: "Daily clock-in and clock-out, scheduled and worked hours, exceptions and overtime decisions.",
  read: "reports_attendance:read",
  export: "reports_attendance:export",
  params,
  fields: attendanceExceptionsReport.fields,
  columns: () => [
    { key: "date", title: "Date", type: "date" },
    { key: "name", title: "Employee", type: "text" },
    { key: "dayType", title: "Day type", type: "text" },
    { key: "firstIn", title: "First clock-in", type: "datetime" },
    { key: "lastOut", title: "Last clock-out", type: "datetime" },
    { key: "scheduledMinutes", title: "Scheduled hours", type: "hours", total: "sum" },
    { key: "workedMinutes", title: "Worked hours", type: "hours", total: "sum" },
    { key: "breakMinutes", title: "Break minutes", type: "integer", total: "sum" },
    { key: "lateMinutes", title: "Late minutes", type: "integer", total: "sum" },
    { key: "earlyOutMinutes", title: "Early-out minutes", type: "integer", total: "sum" },
    { key: "missingPunches", title: "Missing punches", type: "integer", total: "sum" },
    { key: "otMinutes", title: "Computed overtime hours", type: "hours", total: "sum" },
    { key: "otClaimStatus", title: "Overtime claim status", type: "text" },
    { key: "claimedMinutes", title: "Claimed overtime hours", type: "hours", total: "sum" },
    { key: "approvedMinutes", title: "Approved overtime hours", type: "hours", total: "sum" },
    { key: "locked", title: "Approved timesheet", type: "boolean" },
  ],
  defaultSort: { key: "date", dir: "desc" },
  async *run(ctx, p) {
    const ids = (await employeesInScope(ctx.db, ctx.orgId, ctx.grant, p.from, p.to)).filter(
      (id) => !ctx.employeeIds || ctx.employeeIds.has(id),
    );
    // A daily record includes punches and roster data. Load small groups so large teams stay bounded.
    for (let start = 0; start < ids.length; start += 50) {
      const sheet = await timesheets(ctx.db, ctx.orgId, ids.slice(start, start + 50), p.from, p.to, ctx.today);
      for (const [id, days] of sheet.days) {
        yield days
          .filter((day) => day.dayType !== "not_employed")
          .map((day) => ({
            date: day.date,
            name: sheet.times.get(id)?.name ?? "",
            dayType: day.dayType,
            firstIn: day.firstIn,
            lastOut: day.lastOut,
            scheduledMinutes: day.scheduledMinutes,
            workedMinutes: day.workedMinutes,
            breakMinutes: day.breakMinutes,
            lateMinutes: day.lateMinutes,
            earlyOutMinutes: day.earlyOutMinutes,
            missingPunches: day.missingPunches,
            otMinutes: day.otMinutes,
            otClaimStatus: day.otClaim?.status ?? null,
            claimedMinutes: day.otClaim?.claimedMinutes ?? null,
            approvedMinutes: day.otClaim?.approvedMinutes ?? null,
            locked: day.locked,
          }));
      }
    }
  },
  emptyMessage: (p) => `No timesheet days between ${displayDate(p.from)} and ${displayDate(p.to)}.`,
};

export const attendanceReportSource: ReportSource = {
  module: "attendance",
  reports: [attendanceExceptionsReport, timesheetReport],
};
