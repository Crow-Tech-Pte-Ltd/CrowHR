import { SgRulesInputError } from "../errors.ts";
import { dayOfWeek, daysInMonth, formatDate, parseMonth } from "../internal/dates.ts";
import { add, exactDollarsText, roundHalfUpToCent, scale } from "../internal/exact.ts";
import { assertCents, money } from "../internal/money.ts";
import { pickInForce } from "../tables/effective.ts";
import { OVERTIME_RULES, PUBLIC_HOLIDAY_PAY_SOURCE, REST_DAY_PAY_HALF_DAYS } from "../tables/employment-act.ts";
import type { Cents, IsoDate, RuleIssue, WorkingStep, YearMonth } from "../types.ts";
import { type OvertimeRateMethod, overtimeHourlyBase } from "./overtime.ts";
import { dailyRate, halfDays, isPart4Covered } from "./rates.ts";

/** Working days per weekday, Sunday (0) … Saturday (6): 1 = full day, 0.5 = half day, 0 = rest/non-working. */
export type WorkPattern = readonly [number, number, number, number, number, number, number];

export const WORK_PATTERNS = {
  FIVE_DAY: [0, 1, 1, 1, 1, 1, 0],
  FIVE_AND_HALF_DAY: [0, 1, 1, 1, 1, 1, 0.5],
  SIX_DAY: [0, 1, 1, 1, 1, 1, 1],
} as const satisfies Record<string, WorkPattern>;

/**
 * Working days in a month for a work pattern. MOM: excludes rest days and non-working days but
 * INCLUDES public holidays, so holidays need no special handling here.
 */
export function workingDaysInMonth(month: YearMonth, pattern: WorkPattern): number {
  const { y, m } = parseMonth(month);
  let half = 0;
  for (let d = 1; d <= daysInMonth(y, m); d++) {
    half += halfDays(pattern[dayOfWeek(formatDate(y, m, d))] as number, "work pattern day");
  }
  return half / 2;
}

export interface IncompleteMonthInput {
  readonly monthlyGrossCents: Cents;
  /** Working days in the month (e.g. from `workingDaysInMonth`), multiples of 0.5. */
  readonly workingDaysInMonth: number;
  /**
   * Days actually worked, including public holidays, paid hospitalisation leave and annual leave
   * (MOM). Treating other paid leave (outpatient sick, childcare) as worked is the caller's policy.
   */
  readonly daysWorked: number;
}

/**
 * MOM incomplete-month salary: monthly gross rate / working days in the month × days actually worked.
 * MOM publishes no rounding rule; the result is rounded half up to the cent (documented policy).
 */
export function incompleteMonthSalary(input: IncompleteMonthInput): { payCents: Cents; working: WorkingStep[] } {
  assertCents(input.monthlyGrossCents, "monthlyGrossCents");
  const total = halfDays(input.workingDaysInMonth, "workingDaysInMonth");
  const worked = halfDays(input.daysWorked, "daysWorked");
  if (total === 0) throw new SgRulesInputError("workingDaysInMonth must be more than 0.");
  if (worked > total) throw new SgRulesInputError("daysWorked cannot exceed workingDaysInMonth.");
  const exact = scale(input.monthlyGrossCents, worked, total);
  const payCents = roundHalfUpToCent(exact);
  return {
    payCents,
    working: [
      {
        code: "EA_INCOMPLETE_MONTH",
        text: `Salary = ${money(input.monthlyGrossCents)} / ${input.workingDaysInMonth} working days × ${input.daysWorked} days worked = $${exactDollarsText(exact)} → ${money(payCents)}.`,
      },
    ],
  };
}

export interface RestDayWorkInput {
  readonly date: IsoDate;
  readonly monthlyBasicCents: Cents;
  readonly isWorkman: boolean;
  readonly isManagerOrExecutive: boolean;
  readonly workingDaysPerWeek: number;
  /** Normal daily working hours, in minutes. */
  readonly normalDailyMinutes: number;
  readonly minutesWorked: number;
  readonly requestedBy: "EMPLOYER" | "EMPLOYEE";
  readonly overtimeMethod?: OvertimeRateMethod;
}

export interface RestDayWorkResult {
  readonly eligible: boolean;
  /** Basic daily rate multiples paid (0.5, 1 or 2). */
  readonly dayMultiple: number;
  readonly dayPayCents: Cents;
  /** Minutes beyond normal daily hours, paid as overtime (count toward the 72 h limit). */
  readonly overtimeMinutes: number;
  readonly overtimePayCents: Cents;
  readonly payCents: Cents;
  readonly working: readonly WorkingStep[];
  readonly issues: readonly RuleIssue[];
}

/** Pay for work on a rest day (Part 4 employees), in multiples of the basic daily rate, plus OT beyond normal hours. */
export function restDayWorkPay(input: RestDayWorkInput): RestDayWorkResult {
  for (const [k, v] of [
    ["normalDailyMinutes", input.normalDailyMinutes],
    ["minutesWorked", input.minutesWorked],
  ] as const) {
    if (!Number.isInteger(v) || v < 0)
      throw new SgRulesInputError(`${k} must be a non-negative whole number of minutes.`);
  }
  if (input.normalDailyMinutes === 0) throw new SgRulesInputError("normalDailyMinutes must be more than 0.");
  const part4 = isPart4Covered(input);
  if (!part4.covered) {
    return {
      eligible: false,
      dayMultiple: 0,
      dayPayCents: 0,
      overtimeMinutes: 0,
      overtimePayCents: 0,
      payCents: 0,
      working: [
        ...part4.working,
        {
          code: "EA_REST_DAY_NOT_STATUTORY",
          text: "Rest-day pay rules apply to Part 4 employees only; pay is contractual.",
        },
      ],
      issues: part4.issues,
    };
  }
  const table = REST_DAY_PAY_HALF_DAYS[input.requestedBy];
  const half =
    input.minutesWorked === 0
      ? 0
      : input.minutesWorked * 2 <= input.normalDailyMinutes
        ? table.upToHalfNormalHours
        : table.moreThanHalfNormalHours;
  const daily = dailyRate({
    monthlyCents: input.monthlyBasicCents,
    workingDaysPerWeek: input.workingDaysPerWeek,
    kind: "basic",
  });
  const dayExact = scale(daily.exact, half, 2);
  const otMinutes = Math.max(0, input.minutesWorked - input.normalDailyMinutes);
  const rule = pickInForce(OVERTIME_RULES, input.date, "Employment Act overtime");
  const { hourly } = overtimeHourlyBase({ ...input, method: input.overtimeMethod ?? "MOM_PUBLISHED_CAP" });
  const otExact = scale(hourly, BigInt(rule.multiplierBps) * BigInt(otMinutes), 10_000n * 60n);
  const dayPayCents = roundHalfUpToCent(dayExact);
  const overtimePayCents = roundHalfUpToCent(otExact);
  const multiple = half / 2;
  return {
    eligible: true,
    dayMultiple: multiple,
    dayPayCents,
    overtimeMinutes: otMinutes,
    overtimePayCents,
    payCents: roundHalfUpToCent(add(dayExact, otExact)),
    working: [
      { code: "EA_DAILY_BASIC", text: daily.text },
      {
        code: "EA_REST_DAY_PAY",
        text: `Rest day at the ${input.requestedBy.toLowerCase()}'s request, ${input.minutesWorked / 60} h worked (normal ${input.normalDailyMinutes / 60} h) → ${multiple} × daily basic rate = ${money(dayPayCents)}${otMinutes > 0 ? `, plus ${otMinutes / 60} h overtime = ${money(overtimePayCents)}` : ""}.`,
      },
    ],
    issues: part4.issues,
  };
}

export interface PublicHolidayWorkInput {
  /** WORKING_DAY: the holiday fell on a normal working day. NON_WORKING_DAY: e.g. Saturday for a 5-day week. */
  readonly dayType: "WORKING_DAY" | "NON_WORKING_DAY";
  readonly monthlyBasicCents: Cents;
  readonly monthlyGrossCents: Cents;
  readonly workingDaysPerWeek: number;
}

/**
 * Extra pay for working on a public holiday, on top of the holiday pay already in the monthly salary:
 * on a working day, one extra day at the BASIC rate; on a non-working day, one extra day at the GROSS rate.
 * Hours beyond normal daily hours are overtime (use `computeOvertimePay`).
 */
export function publicHolidayWorkPay(input: PublicHolidayWorkInput): { extraPayCents: Cents; working: WorkingStep[] } {
  const kind = input.dayType === "WORKING_DAY" ? "basic" : "gross";
  const r = dailyRate({
    monthlyCents: kind === "basic" ? input.monthlyBasicCents : input.monthlyGrossCents,
    workingDaysPerWeek: input.workingDaysPerWeek,
    kind,
  });
  const extraPayCents = roundHalfUpToCent(r.exact);
  return {
    extraPayCents,
    working: [
      { code: "EA_DAILY_RATE", text: r.text },
      {
        code: "EA_PH_WORK_PAY",
        text: `Worked on a public holiday (${input.dayType === "WORKING_DAY" ? "working day" : "non-working day"}) → 1 extra day at the ${kind} rate = ${money(extraPayCents)}.`,
      },
    ],
  };
}

/**
 * Time off in lieu instead of extra pay for public-holiday work is allowed only for employees outside
 * Part 4 (workmen > $4,500, non-workmen > $2,600 basic, and all managers/executives).
 */
export function publicHolidayTimeOffInLieuAllowed(input: {
  readonly date: IsoDate;
  readonly monthlyBasicCents: Cents;
  readonly isWorkman: boolean;
  readonly isManagerOrExecutive: boolean;
}): { allowed: boolean; reason: string; source: string } {
  const part4 = isPart4Covered(input);
  return {
    allowed: !part4.covered,
    reason: part4.covered
      ? "Part 4 employee: must be paid the extra day for public-holiday work; time off in lieu is not allowed."
      : "Not covered by Part 4: time off in lieu may be agreed instead of the extra day's pay.",
    source: PUBLIC_HOLIDAY_PAY_SOURCE,
  };
}
