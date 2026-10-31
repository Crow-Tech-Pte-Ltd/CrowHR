/**
 * Employment Act salary payment deadlines and deductions (Part 3). Moved from core's payroll module.
 * Intervals are [effectiveFrom, effectiveTo). The statute states no commencement date that matters
 * for current payrolls, so rows apply from the engine coverage start (1 Jan 2025).
 *
 * Sources (read 31 Oct 2026; research/sg-regulatory.md §5.2; research/verification/payroll-choices.md):
 * - Employment Act 1968 s 21 (time of payment), s 25 (payment on a working day; bank accounts),
 *   s 27 (authorised deductions), s 30 (accommodation, amenities and services), s 32 (limit).
 * - MOM "Paying salary", "Salary deductions" and the Workright checklist (7 and 14 *calendar* days).
 */

import type { Effective } from "./effective.ts";

export const EA_S21 = "https://sso.agc.gov.sg/Act/EmA1968?ProvIds=pr21-";
export const EA_S25 = "https://sso.agc.gov.sg/Act/EmA1968?WholeDoc=1";
export const EA_S27 = "https://sso.agc.gov.sg/Act/EmA1968?ProvIds=pr27-";
export const EA_S30 = "https://sso.agc.gov.sg/Act/EmA1968?ProvIds=pr30-";
export const EA_S32 = "https://sso.agc.gov.sg/Act/EmA1968?ProvIds=pr32-";
export const MOM_PAYING_SALARY = "https://www.mom.gov.sg/employment-practices/salary/paying-salary";
export const MOM_SALARY_DEDUCTIONS = "https://www.mom.gov.sg/employment-practices/salary/salary-deductions";
export const MOM_WORKRIGHT_CHECKLIST =
  "https://www.mom.gov.sg/-/media/mom/documents/employment-practices/workright/workright-checklist.pdf";

export interface PaymentDeadlineRule extends Effective {
  /** EA s 21(1): within 7 days after the end of the salary period (calendar days, MOM Workright). */
  readonly salaryDaysAfterPeriod: number;
  /** EA s 21(2): overtime within 14 days after the end of the salary period in which it was performed. */
  readonly overtimeDaysAfterPeriod: number;
  /** Employer ends the employment (MOM "Paying salary"): last day, or within 3 working days if not possible. */
  readonly finalPayWorkingDaysWhenEmployerTerminates: number;
}

export const PAYMENT_DEADLINE_RULES: readonly PaymentDeadlineRule[] = [
  {
    effectiveFrom: "2025-01-01",
    effectiveTo: null,
    source: EA_S21,
    effectiveFromBasis: "ENGINE_COVERAGE_START",
    verifiedOn: "2026-10-31",
    salaryDaysAfterPeriod: 7,
    overtimeDaysAfterPeriod: 14,
    finalPayWorkingDaysWhenEmployerTerminates: 3,
  },
];

/**
 * Deduction categories (EA s 27(1)). `limitGroup` is a per-period limit in basis points of the
 * salary payable, shared by every category in the group: s 30(2) caps accommodation, amenities and
 * services **together** at 25%; s 29 caps damage or loss at 25%; advances and loans are limited per
 * instalment (MOM). `exemptFromOverallCap` follows s 32(1), which excludes only s 27(1)(a) absence,
 * (f) advances, loans, unearned employment benefits and salary overpayments, and (j) consented
 * co-operative society payments. Employee CPF (s 27(1)(h)) therefore counts toward the 50% limit.
 */
export const DEDUCTION_CATEGORIES = {
  absence: { label: "Unauthorised absence", limitGroup: null, exemptFromOverallCap: true, provision: "s 27(1)(a)" },
  damage_loss: {
    label: "Damage or loss (after inquiry)",
    limitGroup: "damage_loss",
    exemptFromOverallCap: false,
    provision: "s 27(1)(b), s 29",
  },
  accommodation: {
    label: "Accommodation",
    limitGroup: "accommodation_amenities",
    exemptFromOverallCap: false,
    provision: "s 27(1)(c), s 30",
  },
  amenities: {
    label: "Amenities and services",
    limitGroup: "accommodation_amenities",
    exemptFromOverallCap: false,
    provision: "s 27(1)(d), s 30",
  },
  advance: { label: "Advance recovery", limitGroup: "advance", exemptFromOverallCap: true, provision: "s 27(1)(f)" },
  loan: { label: "Loan instalment", limitGroup: "loan", exemptFromOverallCap: true, provision: "s 27(1)(f)" },
  unearned_benefit: {
    label: "Unearned employment benefit recovery",
    limitGroup: null,
    exemptFromOverallCap: true,
    provision: "s 27(1)(f)",
  },
  overpayment: {
    label: "Overpaid salary recovery",
    limitGroup: null,
    exemptFromOverallCap: true,
    provision: "s 27(1)(f)",
  },
  cooperative: {
    label: "Co-operative society (consented)",
    limitGroup: null,
    exemptFromOverallCap: true,
    provision: "s 27(1)(j)",
  },
  consented: {
    label: "Other (written consent)",
    limitGroup: null,
    exemptFromOverallCap: false,
    provision: "s 27(1)(l)",
  },
  court_order: {
    label: "Court order or tax",
    limitGroup: null,
    exemptFromOverallCap: false,
    provision: "s 27(1)(i), (k)",
  },
} as const;

export type DeductionCategory = keyof typeof DEDUCTION_CATEGORIES;
export const DEDUCTION_CATEGORY_KEYS = Object.keys(DEDUCTION_CATEGORIES) as [DeductionCategory, ...DeductionCategory[]];

export type DeductionLimitGroup = "damage_loss" | "accommodation_amenities" | "advance" | "loan";

export interface DeductionLimitRule extends Effective {
  /** s 32(1): at most 50% of the salary payable in the period. */
  readonly overallCapBps: number;
  /** s 32(2): the limit does not apply to the final salary payment on termination or completion. */
  readonly overallCapWaivedOnFinalPay: boolean;
  /** Per-group limits in basis points of the period's salary. */
  readonly groupCapBps: Readonly<Record<DeductionLimitGroup, number>>;
  readonly groupSources: Readonly<Record<DeductionLimitGroup, string>>;
}

export const DEDUCTION_LIMIT_RULES: readonly DeductionLimitRule[] = [
  {
    effectiveFrom: "2025-01-01",
    effectiveTo: null,
    source: EA_S32,
    effectiveFromBasis: "ENGINE_COVERAGE_START",
    verifiedOn: "2026-10-31",
    overallCapBps: 5_000,
    overallCapWaivedOnFinalPay: true,
    groupCapBps: { damage_loss: 2_500, accommodation_amenities: 2_500, advance: 2_500, loan: 2_500 },
    groupSources: {
      damage_loss: MOM_SALARY_DEDUCTIONS,
      accommodation_amenities: EA_S30,
      advance: MOM_SALARY_DEDUCTIONS,
      loan: MOM_SALARY_DEDUCTIONS,
    },
  },
];

/**
 * CPF Act s 7(9) with First Schedule para 4(2): additional contributions payable on AW after the AW
 * ceiling is reconciled may be recovered from the employee's wages paid no later than six months
 * after the end of the year in which they are payable. Ordinary employer-error arrears may NOT be
 * recovered from later wages except under s 7(6A)'s conditions (CPF "recover the employee's share").
 */
export const CPF_ACT_S7 = "https://sso.agc.gov.sg/Act/CPFA1953?ProvIds=pr7-";
export const CPF_RECOVERY_FAQ =
  "https://www.cpf.gov.sg/service/article/how-do-i-recover-the-employee-s-share-of-cpf-contributions";
export const AW_TOPUP_RECOVERY_MONTHS_AFTER_YEAR_END = 6;
