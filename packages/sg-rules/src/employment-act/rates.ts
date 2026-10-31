import { SgRulesInputError } from "../errors.ts";
import { type ExactCents, exactCents, exactDollarsText, roundHalfUpToCent } from "../internal/exact.ts";
import { assertCents, money } from "../internal/money.ts";
import { pickInForce } from "../tables/effective.ts";
import { OVERTIME_RULES, PART4_COVERAGE } from "../tables/employment-act.ts";
import type { Cents, IsoDate, RuleIssue, WorkingStep } from "../types.ts";

export interface Part4Input {
  readonly date: IsoDate;
  readonly monthlyBasicCents: Cents;
  /** Mainly manual work (EA First Schedule occupations, or supervisors doing manual work > half the time). */
  readonly isWorkman: boolean;
  readonly isManagerOrExecutive: boolean;
}

export interface Part4Result {
  /** Covered by Part 4 (rest days, hours of work, overtime). */
  readonly covered: boolean;
  readonly working: readonly WorkingStep[];
  readonly issues: readonly RuleIssue[];
}

/**
 * Part 4 of the Employment Act applies to a workman earning a monthly basic salary of $4,500 or
 * less and a non-workman earning $2,600 or less; never to managers or executives. Basic salary
 * excludes overtime, bonus, AWS, productivity incentives, reimbursements and all allowances.
 */
export function isPart4Covered(input: Part4Input): Part4Result {
  assertCents(input.monthlyBasicCents, "monthlyBasicCents");
  const rule = pickInForce(PART4_COVERAGE, input.date, "Employment Act Part 4 coverage");
  const issues: RuleIssue[] = [];
  if (input.isManagerOrExecutive) {
    if (input.monthlyBasicCents <= rule.nonWorkmanMaxBasicMonthlyCents) {
      issues.push({
        code: "EA_ME_LOW_SALARY",
        severity: "warning",
        message: `Marked as a manager/executive with basic salary ${money(input.monthlyBasicCents)} (≤ ${money(rule.nonWorkmanMaxBasicMonthlyCents)}). Check the classification: a misclassified employee loses Part 4 protection.`,
        source: rule.source,
      });
    }
    return {
      covered: false,
      working: [{ code: "EA_PART4", text: "Managers and executives are not covered by Part 4." }],
      issues,
    };
  }
  const limit = input.isWorkman ? rule.workmanMaxBasicMonthlyCents : rule.nonWorkmanMaxBasicMonthlyCents;
  const covered = input.monthlyBasicCents <= limit;
  return {
    covered,
    working: [
      {
        code: "EA_PART4",
        text: `${input.isWorkman ? "Workman" : "Non-workman"} with basic ${money(input.monthlyBasicCents)} ${covered ? "≤" : ">"} ${money(limit)} → ${covered ? "covered" : "not covered"} by Part 4.`,
      },
    ],
    issues,
  };
}

/** Days per week may be fractional in half days (e.g. 5.5). Returned as half-days. */
export function halfDays(days: number, field: string): number {
  const h = days * 2;
  if (!Number.isInteger(h) || h < 0)
    throw new SgRulesInputError(`${field} must be a multiple of 0.5 days, got ${days}.`);
  return h;
}

export interface RateResult {
  /** Exact rate in cents as "n/d" is not needed by most callers; the rounded and textual forms are. */
  readonly exact: ExactCents;
  /** Rounded half-up to the cent, for display only. */
  readonly displayCents: Cents;
  readonly text: string;
}

const rate = (exact: ExactCents, label: string, formula: string): RateResult => ({
  exact,
  displayCents: roundHalfUpToCent(exact),
  text: `${label} = ${formula} = $${exactDollarsText(exact)}`,
});

/**
 * Hourly basic rate for a monthly-rated employee: (12 × monthly basic) / (52 × 44).
 * Part-time employees: pass their contractual weekly hours (12 × monthly basic / (52 × weekly hours)).
 */
export function hourlyBasicRate(input: {
  readonly date: IsoDate;
  readonly monthlyBasicCents: Cents;
  readonly weeklyHours?: number;
}): RateResult {
  assertCents(input.monthlyBasicCents, "monthlyBasicCents");
  const normal = pickInForce(OVERTIME_RULES, input.date, "Employment Act overtime").normalHoursPerWeek;
  const hours = input.weeklyHours ?? normal;
  if (!(hours > 0) || !Number.isInteger(hours * 4))
    throw new SgRulesInputError(`weeklyHours must be positive (quarter hours), got ${hours}.`);
  const exact = exactCents(BigInt(input.monthlyBasicCents) * 12n * 4n, 52n * BigInt(hours * 4));
  return rate(exact, "Hourly basic rate", `(12 × ${money(input.monthlyBasicCents)}) / (52 × ${hours})`);
}

/** Daily rate (basic or gross) = (12 × monthly rate) / (52 × average working days per week). */
export function dailyRate(input: {
  readonly monthlyCents: Cents;
  readonly workingDaysPerWeek: number;
  readonly kind: "basic" | "gross";
}): RateResult {
  assertCents(input.monthlyCents, "monthlyCents");
  const h = halfDays(input.workingDaysPerWeek, "workingDaysPerWeek");
  if (h === 0) throw new SgRulesInputError("workingDaysPerWeek must be more than 0.");
  const exact = exactCents(BigInt(input.monthlyCents) * 12n * 2n, 52n * BigInt(h));
  return rate(
    exact,
    `Daily ${input.kind} rate`,
    `(12 × ${money(input.monthlyCents)}) / (52 × ${input.workingDaysPerWeek})`,
  );
}
