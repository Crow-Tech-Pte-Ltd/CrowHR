import type { TimesheetPayrollDay } from "../db/schema/attendance.ts";
import { dateLabel, eachDay } from "./engine/dates.ts";
import type { PayIssue, RunItemInput } from "./engine/types.ts";
import type { ApprovedHoursSheet } from "./ports.ts";

const REVIEW: Record<NonNullable<TimesheetPayrollDay["review"]>, string> = {
  not_employed: "The approved timesheet recorded this date as outside employment.",
  missing_punches: "The approved timesheet has an incomplete punch pair.",
  overtime: "Overtime needs to be separated from regular hours.",
  special_day: "Rest-day, off-day or public-holiday pay needs review.",
  leave: "Leave and regular hours need to be reviewed together.",
};

function manualHours(issue: string, date?: string) {
  return {
    items: [],
    issue: {
      code: "HOURS_MISSING",
      severity: "blocking",
      message: `${date ? `${dateLabel(date)}: ` : ""}${issue} Use approved timesheets with complete regular hours, or enter all regular hours for this employee in the run.`,
      source: null,
    } satisfies PayIssue,
  };
}

/** Build a complete set of regular hours or fall back to manual entry for the whole employee. */
export function approvedHoursItems(
  sheets: ApprovedHoursSheet[],
  {
    from,
    to,
    hasSeparateOvertime,
    hasMultipleTenures,
  }: { from: string; to: string; hasSeparateOvertime: boolean; hasMultipleTenures: boolean },
): { items: RunItemInput[]; issue?: PayIssue } {
  if (hasMultipleTenures) return manualHours("The employee left and rejoined within this pay period.");
  if (hasSeparateOvertime) return manualHours("Overtime in this pay period needs to be separated from regular hours.");
  const items: RunItemInput[] = [];
  for (const date of eachDay(from, to)) {
    const covering = sheets.filter((s) => s.periodStart <= date && date <= s.periodEnd);
    const [sheet] = covering;
    if (!sheet) return manualHours("No approved timesheet covers this date.", date);
    if (covering.length > 1) return manualHours("Several approved timesheets cover this date.", date);
    const day = sheet.days?.find((d) => d.date === date);
    if (!day)
      return manualHours("The approved timesheet has no daily payroll records. Reopen and approve it again.", date);
    if (day.review) return manualHours(REVIEW[day.review], date);
    // Keep one row for an approved zero-hour period so it differs from a missing timesheet.
    if (day.workedMinutes === 0 && items.length > 0) continue;
    items.push({
      id: `attendance:hours:${sheet.id}:${date}`,
      kind: "hours",
      label: "Regular hours from approved timesheet",
      amountCents: null,
      wageClass: null,
      cpfLiable: true,
      awPayableDate: null,
      minutes: day.workedMinutes,
      days: null,
      date,
      periodStart: date,
      periodEnd: date,
      deductionCategory: null,
      source: "attendance",
    });
  }
  const positive = items.filter((item) => (item.minutes ?? 0) > 0);
  return { items: positive.length ? positive : items };
}
