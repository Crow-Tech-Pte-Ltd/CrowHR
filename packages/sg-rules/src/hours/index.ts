import { SgRulesInputError } from "../errors.ts";
import type { Effective } from "../tables/effective.ts";
import { pickInForce } from "../tables/effective.ts";
import { OVERTIME_RULES, PUBLIC_HOLIDAY_PAY_SOURCE, REST_DAY_PAY_HALF_DAYS } from "../tables/employment-act.ts";
import { REST_DAYS_PER_WEEK } from "../tables/registrations.ts";
import type { IsoDate, RuleIssue } from "../types.ts";

/**
 * Hours of work and rest days for rosters (Employment Act Part 4), as MOM publishes them:
 * "Normal hours of work: up to 44 hours a week. If you work 5 days or fewer a week: up to 9 hours a
 * day. If you work more than 5 days a week: up to 8 hours a day." The week runs Monday to Sunday.
 * One rest day a week. Maximum 12 hours a day; overtime at most 72 hours a month (OVERTIME_RULES).
 * research/sg-regulatory.md §5.3.
 */

const MOM_HOURS = "https://www.mom.gov.sg/employment-practices/hours-of-work-overtime-and-rest-days";

export interface HoursOfWorkRule extends Effective {
  /** Normal daily hours when working 5 days a week or fewer. */
  readonly normalDailyHoursUpTo5Days: number;
  /** Normal daily hours when working more than 5 days a week. */
  readonly normalDailyHoursOver5Days: number;
  readonly normalWeeklyHours: number;
}

export const HOURS_OF_WORK_RULES: readonly HoursOfWorkRule[] = [
  {
    effectiveFrom: "2019-04-01",
    effectiveTo: null,
    normalDailyHoursUpTo5Days: 9,
    normalDailyHoursOver5Days: 8,
    normalWeeklyHours: 44,
    source: MOM_HOURS,
    effectiveFromBasis: "PUBLISHED",
    verifiedOn: "2026-10-31",
  },
];

export interface RosterDay {
  readonly date: IsoDate;
  /** Paid minutes rostered that day (0 for a day off). */
  readonly minutes: number;
  /** The employee's rest day. */
  readonly restDay?: boolean;
  /** A public holiday that applies to the employee. */
  readonly publicHoliday?: boolean;
}

export interface RosterDayResult {
  readonly date: IsoDate;
  /** Minutes beyond normal hours: overtime if worked as rostered. */
  readonly overtimeMinutes: number;
  /** The part of `overtimeMinutes` that counts toward the 72-hour monthly limit. */
  readonly capMinutes: number;
  readonly issues: readonly RuleIssue[];
}

export interface RosterWeekResult {
  /** Normal daily hours for this week, in minutes (8 h if rostered more than 5 days, else 9 h). */
  readonly normalDailyMinutes: number;
  readonly totalMinutes: number;
  readonly days: readonly RosterDayResult[];
  readonly issues: readonly RuleIssue[];
}

const h = (minutes: number) => {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} h ${rest} min` : `${hours} h`;
};

/**
 * Checks one Monday-to-Sunday week of a roster for one employee. Never throws for a breach: the
 * results are warnings for the scheduler. Rest-day and public-holiday work is paid separately, so
 * it does not count toward the 44-hour week; only its hours beyond normal daily hours count toward
 * the 72-hour limit (MOM).
 */
export function checkRosterWeek(input: { readonly days: readonly RosterDay[] }): RosterWeekResult {
  const days = [...input.days].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  if (days.length > 7) throw new SgRulesInputError("A roster week has at most 7 days.");
  for (const d of days) {
    if (!Number.isInteger(d.minutes) || d.minutes < 0) {
      throw new SgRulesInputError(`minutes must be a non-negative whole number, got ${d.minutes} on ${d.date}.`);
    }
  }
  const first = days[0]?.date ?? "2026-01-05";
  const rule = pickInForce(HOURS_OF_WORK_RULES, first, "Employment Act hours of work");
  const ot = pickInForce(OVERTIME_RULES, first, "Employment Act overtime");
  const worked = days.filter((d) => d.minutes > 0);
  const normalDaily = (worked.length > 5 ? rule.normalDailyHoursOver5Days : rule.normalDailyHoursUpTo5Days) * 60;
  const weekly = rule.normalWeeklyHours * 60;
  let normalSoFar = 0;
  let normalDayMinutes = 0;
  const results: RosterDayResult[] = [];
  for (const d of days) {
    const issues: RuleIssue[] = [];
    if (d.minutes > ot.maxHoursPerDay * 60) {
      issues.push({
        code: "EA_DAILY_HOURS_LIMIT",
        severity: "warning",
        message: `${h(d.minutes)} rostered: more than the ${ot.maxHoursPerDay}-hour daily maximum.`,
        source: ot.source,
      });
    }
    const beyondDaily = Math.max(0, d.minutes - normalDaily);
    let overtime: number;
    let cap: number;
    if (d.restDay || d.publicHoliday) {
      overtime = beyondDaily;
      cap = beyondDaily;
    } else {
      normalDayMinutes += d.minutes;
      const normal = Math.min(d.minutes, normalDaily, Math.max(0, weekly - normalSoFar));
      normalSoFar += normal;
      overtime = d.minutes - normal;
      cap = overtime;
    }
    if (beyondDaily > 0) {
      issues.push({
        code: "EA_BEYOND_NORMAL_DAILY",
        severity: "info",
        message: `${h(beyondDaily)} beyond normal daily hours (${h(normalDaily)}): paid as overtime.`,
        source: rule.source,
      });
    }
    results.push({ date: d.date, overtimeMinutes: overtime, capMinutes: cap, issues });
  }
  const issues: RuleIssue[] = [];
  if (normalDayMinutes > weekly) {
    issues.push({
      code: "EA_WEEKLY_NORMAL_HOURS",
      severity: "warning",
      message: `${h(normalDayMinutes)} rostered: ${h(normalDayMinutes - weekly)} beyond the ${rule.normalWeeklyHours}-hour week, paid as overtime.`,
      source: rule.source,
    });
  }
  if (days.length === 7 && worked.length === 7) {
    issues.push({
      code: "EA_NO_REST_DAY",
      severity: "warning",
      message: `Rostered all 7 days: the Employment Act requires ${REST_DAYS_PER_WEEK} rest day a week.`,
      source: rule.source,
    });
  }
  return {
    normalDailyMinutes: normalDaily,
    totalMinutes: days.reduce((s, d) => s + d.minutes, 0),
    days: results,
    issues,
  };
}

/** Projected overtime in a calendar month against the 72-hour limit (warning only). */
export function checkProjectedMonthlyOvertime(input: {
  readonly date: IsoDate;
  readonly minutes: number;
}): RuleIssue[] {
  const ot = pickInForce(OVERTIME_RULES, input.date, "Employment Act overtime");
  if (input.minutes <= ot.maxOvertimeHoursPerMonth * 60) return [];
  return [
    {
      code: "EA_OT_MONTHLY_LIMIT",
      severity: "warning",
      message: `${h(input.minutes)} of overtime rostered this month: more than the ${ot.maxOvertimeHoursPerMonth}-hour monthly limit (lawful only with an MOM exemption).`,
      source: ot.source,
    },
  ];
}

const days = (halfDays: number) => (halfDays === 2 ? "1 day's" : `${halfDays / 2} days'`);

/** What rostering someone on their rest day means for pay (Part 4 staff, at the employer's request). */
export function restDayWorkNote(): { message: string; source: string } {
  const t = REST_DAY_PAY_HALF_DAYS.EMPLOYER;
  return {
    message: `Rest-day work: Part 4 staff rostered at your request get ${days(t.upToHalfNormalHours)} basic pay for up to half their normal daily hours, ${days(t.moreThanHalfNormalHours)} for more, plus overtime beyond normal hours.`,
    source: REST_DAY_PAY_HALF_DAYS.source,
  };
}

/** What rostering someone on a public holiday means for pay (on top of the holiday pay in their salary). */
export function publicHolidayWorkNote(holiday: string): { message: string; source: string } {
  return {
    message: `Public holiday (${holiday}): Part 4 staff who work get an extra day's basic pay on top of their holiday pay, plus overtime beyond normal hours.`,
    source: PUBLIC_HOLIDAY_PAY_SOURCE,
  };
}
