import { addDays, daysInMonth, parseDate } from "../internal/dates.ts";
import { assertCents, money } from "../internal/money.ts";
import { pickInForce } from "../tables/effective.ts";
import {
  AW_TOPUP_RECOVERY_MONTHS_AFTER_YEAR_END,
  DEDUCTION_CATEGORIES,
  DEDUCTION_LIMIT_RULES,
  type DeductionCategory,
  type DeductionLimitGroup,
  PAYMENT_DEADLINE_RULES,
  type PaymentDeadlineRule,
} from "../tables/salary-payment.ts";
import type { IsoDate, RuleIssue, WorkingStep } from "../types.ts";

export function paymentDeadlines(date: IsoDate): PaymentDeadlineRule {
  return pickInForce(PAYMENT_DEADLINE_RULES, date, "EA salary payment deadline");
}

/** Last day of the monthly salary period containing `date`. */
function monthEnd(date: IsoDate): IsoDate {
  const { y, m } = parseDate(date, "date");
  return `${y}-${String(m).padStart(2, "0")}-${String(daysInMonth(y, m)).padStart(2, "0")}`;
}

/**
 * EA s 21(1): salary is due within 7 calendar days after the end of the salary period (the day the
 * period ends is not counted). Interpretation Act s 50 may extend a deadline that falls on a Sunday or
 * public holiday; that interaction with s 21 is not settled (payroll-choices.md §6), so it is not applied.
 */
export function salaryDueBy(periodEnd: IsoDate): IsoDate {
  return addDays(periodEnd, paymentDeadlines(periodEnd).salaryDaysAfterPeriod);
}

/**
 * EA s 21(2): overtime is due within 14 days after the end of the salary period **during which the
 * overtime was performed** (monthly periods: the month containing the OT period's last day).
 */
export function overtimeDueBy(otPeriodEnd: IsoDate): IsoDate {
  const end = monthEnd(otPeriodEnd);
  return addDays(end, paymentDeadlines(end).overtimeDaysAfterPeriod);
}

/** CPF Act s 7(9): last date an AW top-up payable in `payableYear` may be recovered from wages. */
export function awTopUpRecoveryDeadline(payableYear: number): IsoDate {
  const m = AW_TOPUP_RECOVERY_MONTHS_AFTER_YEAR_END;
  return `${payableYear + 1}-${String(m).padStart(2, "0")}-${String(daysInMonth(payableYear + 1, m)).padStart(2, "0")}`;
}

export interface DeductionCheckInput {
  readonly date: IsoDate;
  /** Salary payable for the period: wages earned after no-pay leave, excluding reimbursements. */
  readonly salaryCents: number;
  readonly deductions: readonly { category: DeductionCategory; label: string; amountCents: number }[];
  /** Employee CPF (incl. recovered AW top-ups) and SHG deducted this period: count toward the 50% limit. */
  readonly statutoryEmployeeCents: number;
  readonly finalPay: boolean;
}

const GROUP_LABEL: Record<DeductionLimitGroup, string> = {
  damage_loss: "Damage or loss",
  accommodation_amenities: "Accommodation, amenities and services together",
  advance: "Advance recovery",
  loan: "Loan instalments",
};

/** Employment Act deduction limits: per-group 25% limits (s 29, s 30(2); MOM) and the 50% limit (s 32). */
export function checkDeductions(input: DeductionCheckInput): { issues: RuleIssue[]; working: WorkingStep[] } {
  assertCents(input.salaryCents, "salaryCents");
  const rule = pickInForce(DEDUCTION_LIMIT_RULES, input.date, "EA deduction limits");
  const issues: RuleIssue[] = [];
  const working: WorkingStep[] = [];
  const byGroup = new Map<DeductionLimitGroup, number>();
  for (const d of input.deductions) {
    assertCents(d.amountCents, `deduction ${d.label}`);
    const g = DEDUCTION_CATEGORIES[d.category].limitGroup as DeductionLimitGroup | null;
    if (g) byGroup.set(g, (byGroup.get(g) ?? 0) + d.amountCents);
  }
  for (const [group, total] of [...byGroup.entries()].sort()) {
    const bps = rule.groupCapBps[group];
    const cap = Math.floor((input.salaryCents * bps) / 10_000);
    working.push({
      code: "EA_DEDUCTION_GROUP_CAP",
      text: `${GROUP_LABEL[group]}: ${money(total)} of a ${bps / 100}% limit ${money(cap)} (${bps / 100}% × ${money(input.salaryCents)}).`,
    });
    if (total > cap) {
      issues.push({
        code: "EA_DEDUCTION_CATEGORY_CAP",
        severity: "blocking",
        message: `${GROUP_LABEL[group]} deductions of ${money(total)} exceed the Employment Act limit of ${bps / 100}% of salary (${money(cap)}) by ${money(total - cap)}. Reduce the amount or spread it over later months.`,
        source: rule.groupSources[group],
      });
    }
  }
  const counted =
    input.deductions
      .filter((d) => !DEDUCTION_CATEGORIES[d.category].exemptFromOverallCap)
      .reduce((s, d) => s + d.amountCents, 0) + input.statutoryEmployeeCents;
  const overallCap = Math.floor((input.salaryCents * rule.overallCapBps) / 10_000);
  working.push({
    code: "EA_OVERALL_CAP",
    text: `Deductions counted toward the 50% limit (EA s 32: all but absence, advances, loans, unearned benefits, overpaid salary and co-operative payments; employee CPF and SHG included): ${money(counted)} of ${money(overallCap)}.`,
  });
  if (counted > overallCap) {
    const waived = input.finalPay && rule.overallCapWaivedOnFinalPay;
    issues.push({
      code: waived ? "EA_DEDUCTION_OVERALL_CAP_FINAL_PAY" : "EA_DEDUCTION_OVERALL_CAP",
      severity: waived ? "warning" : "blocking",
      message: waived
        ? `Deductions of ${money(counted)} are more than 50% of salary (${money(overallCap)}). This is the final salary payment, where EA s 32(2) lifts the limit; each deduction must still be one s 27 allows.`
        : `Deductions of ${money(counted)} exceed the Employment Act limit of 50% of salary payable (${money(overallCap)}) by ${money(counted - overallCap)}. Reduce or defer deductions (loans and advances are outside this limit but each instalment is capped at 25%).`,
      source: rule.source,
    });
  }
  return { issues, working };
}
