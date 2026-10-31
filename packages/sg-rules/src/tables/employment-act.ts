/**
 * Employment Act 1968 constants, as published in MOM guidance (the statute text on SSO could not be
 * read by scripted fetch; see research/sg-regulatory.md §5). Intervals are [effectiveFrom, effectiveTo).
 */

import type { Effective } from "./effective.ts";

const MOM_WHO = "https://www.mom.gov.sg/employment-practices/employment-act/who-is-covered";
const MOM_HOURS = "https://www.mom.gov.sg/employment-practices/hours-of-work-overtime-and-rest-days";

export interface Part4Coverage extends Effective {
  /** Workman (manual labour) is covered by Part 4 with monthly basic salary ≤ this. */
  readonly workmanMaxBasicMonthlyCents: number;
  /** Non-workman is covered by Part 4 with monthly basic salary ≤ this. */
  readonly nonWorkmanMaxBasicMonthlyCents: number;
  /** Managers and executives are never covered by Part 4. */
  readonly managersExecutivesCovered: false;
}

/** Thresholds in force since the 1 Apr 2019 amendments (non-workman raised from $2,500 to $2,600). */
export const PART4_COVERAGE: readonly Part4Coverage[] = [
  {
    effectiveFrom: "2019-04-01",
    effectiveTo: null,
    workmanMaxBasicMonthlyCents: 450_000,
    nonWorkmanMaxBasicMonthlyCents: 260_000,
    managersExecutivesCovered: false,
    source: MOM_WHO,
    effectiveFromBasis: "PUBLISHED",
    verifiedOn: "2026-10-31",
  },
];

export interface OvertimeRule extends Effective {
  /** At least 1.5× the hourly basic rate. */
  readonly multiplierBps: number;
  /** Hourly basic rate (monthly-rated) = (12 × monthly basic) / (52 × normalHoursPerWeek). */
  readonly normalHoursPerWeek: number;
  readonly maxOvertimeHoursPerMonth: number;
  readonly maxHoursPerDay: number;
  /** "The overtime rate payable for non-workmen is capped at the salary level of $2,600 …" */
  readonly nonWorkmanOtBaseCapMonthlyCents: number;
  /** "… or an hourly rate of $13.60" (MOM's published figure; exact formula gives $13.6364). */
  readonly nonWorkmanPublishedHourlyCapCents: number;
}

export const OVERTIME_RULES: readonly OvertimeRule[] = [
  {
    effectiveFrom: "2019-04-01",
    effectiveTo: null,
    multiplierBps: 15_000,
    normalHoursPerWeek: 44,
    maxOvertimeHoursPerMonth: 72,
    maxHoursPerDay: 12,
    nonWorkmanOtBaseCapMonthlyCents: 260_000,
    nonWorkmanPublishedHourlyCapCents: 1_360,
    source: MOM_HOURS,
    effectiveFromBasis: "PUBLISHED",
    verifiedOn: "2026-10-31",
  },
];

/**
 * Rest-day work pay in multiples of the basic daily rate (MOM hours-of-work page).
 * Values are in half-days: 2 = 1 day.
 */
export const REST_DAY_PAY_HALF_DAYS = {
  EMPLOYER: { upToHalfNormalHours: 2, moreThanHalfNormalHours: 4 },
  EMPLOYEE: { upToHalfNormalHours: 1, moreThanHalfNormalHours: 2 },
  source: MOM_HOURS,
} as const;

/** Incomplete-month formula and daily-rate definitions. */
export const SALARY_RATES_SOURCE = "https://www.mom.gov.sg/employment-practices/salary/monthly-and-daily-salary";

/** Public holiday entitlement, pay and substitution. */
export const PUBLIC_HOLIDAY_PAY_SOURCE =
  "https://www.mom.gov.sg/employment-practices/public-holidays-entitlement-and-pay";
export const PUBLIC_HOLIDAY_SUBSTITUTION_SOURCE =
  "https://www.mom.gov.sg/faq/public-holidays/is-an-employee-entitled-to-another-day-off-if-a-public-holiday-falls-on-a-rest-day-or-non-working-day";
