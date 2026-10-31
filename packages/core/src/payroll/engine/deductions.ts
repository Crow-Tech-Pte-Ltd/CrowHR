import { DEDUCTION_CATEGORIES, DEDUCTION_LIMITS, type DeductionCategory } from "../rules.ts";
import { sgd } from "./dates.ts";
import type { PayIssue, WorkingLine } from "./types.ts";

export interface DeductionCheckInput {
  /** Salary payable for the period: wages earned after no-pay leave, excluding reimbursements. */
  salaryCents: number;
  deductions: { category: DeductionCategory; label: string; amountCents: number }[];
  /** Employee CPF and SHG deducted this run (count toward the 50% limit). */
  statutoryEmployeeCents: number;
  finalPay: boolean;
}

/** Employment Act deduction limits (MOM salary deductions; `payroll/rules.ts`). */
export function checkDeductions(input: DeductionCheckInput): { issues: PayIssue[]; working: WorkingLine[] } {
  const issues: PayIssue[] = [];
  const working: WorkingLine[] = [];
  const src = DEDUCTION_LIMITS.source;
  const byCategory = new Map<DeductionCategory, number>();
  for (const d of input.deductions) byCategory.set(d.category, (byCategory.get(d.category) ?? 0) + d.amountCents);
  for (const [category, total] of [...byCategory.entries()].sort()) {
    const rule = DEDUCTION_CATEGORIES[category];
    if (rule.capBps === null) continue;
    const cap = Math.floor((input.salaryCents * rule.capBps) / 10_000);
    working.push({
      section: "deductions",
      code: "EA_CATEGORY_CAP",
      text: `${rule.label}: ${sgd(total)} of a ${rule.capBps / 100}% limit ${sgd(cap)} (${rule.capBps / 100}% × ${sgd(input.salaryCents)}).`,
    });
    if (total > cap) {
      issues.push({
        code: "EA_DEDUCTION_CATEGORY_CAP",
        severity: "blocking",
        message: `${rule.label} deductions of ${sgd(total)} exceed the Employment Act limit of ${rule.capBps / 100}% of salary (${sgd(cap)}) by ${sgd(total - cap)}. Reduce the amount or spread it over later months.`,
        source: src,
      });
    }
  }
  const counted =
    input.deductions
      .filter((d) => DEDUCTION_CATEGORIES[d.category].countsTowardOverallCap)
      .reduce((s, d) => s + d.amountCents, 0) +
    (DEDUCTION_LIMITS.employeeCpfCountsTowardOverallCap ? input.statutoryEmployeeCents : 0);
  const overallCap = Math.floor((input.salaryCents * DEDUCTION_LIMITS.overallCapBps) / 10_000);
  working.push({
    section: "deductions",
    code: "EA_OVERALL_CAP",
    text: `Deductions counted toward the 50% limit (excludes absence, advances, loans, overpaid salary, co-operative; includes employee CPF and SHG): ${sgd(counted)} of ${sgd(overallCap)}.`,
  });
  if (counted > overallCap && input.salaryCents >= 0) {
    const waived = input.finalPay && DEDUCTION_LIMITS.overallCapWaivedOnFinalPay;
    issues.push({
      code: waived ? "EA_DEDUCTION_OVERALL_CAP_FINAL_PAY" : "EA_DEDUCTION_OVERALL_CAP",
      severity: waived ? "warning" : "blocking",
      message: waived
        ? `Deductions of ${sgd(counted)} are more than 50% of salary (${sgd(overallCap)}). This is the final salary payment, where MOM allows the limit to be exceeded; check each deduction is allowed.`
        : `Deductions of ${sgd(counted)} exceed the Employment Act limit of 50% of salary payable (${sgd(overallCap)}) by ${sgd(counted - overallCap)}. Reduce or defer deductions (loans and advances are outside this limit but each instalment is capped at 25%).`,
      source: src,
    });
  }
  return { issues, working };
}
