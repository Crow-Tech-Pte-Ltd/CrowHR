/**
 * Employment Act payment and deduction rules used by payroll (AGENTS.md rule 3: every value is
 * cited and effective-dated).
 *
 * These belong in `packages/sg-rules/src/employment-act/` (salary payment and deductions). This
 * change may not edit sg-rules beyond its fixtures, so they live here with the signatures sg-rules
 * should export, for a mechanical move by the sg-rules owner.
 */

/** MOM: paying salary (updated 30 Jan 2026), read 31 Oct 2026; research/sg-regulatory.md §5.2. */
export const MOM_PAYING_SALARY_SOURCE = "https://www.mom.gov.sg/employment-practices/salary/paying-salary";
/** MOM: salary deductions, read 31 Oct 2026; research/sg-regulatory.md §5.2. */
export const MOM_DEDUCTIONS_SOURCE = "https://www.mom.gov.sg/employment-practices/salary/salary-deductions";
/** MOM: monthly and daily salary (incomplete month formula), updated 8 Dec 2025; research §5.5. */
export const MOM_INCOMPLETE_MONTH_SOURCE =
  "https://www.mom.gov.sg/employment-practices/salary/monthly-and-daily-salary";
/** MOM: itemised payslips, read 31 Oct 2026; research/sg-regulatory.md §7. */
export const MOM_PAYSLIP_SOURCE = "https://www.mom.gov.sg/employment-practices/salary/itemised-payslips";
/** CPF Board: what constitutes wages (OW/AW, OT apportionment), read 31 Oct 2026; research §1.7. */
export const CPF_WAGES_SOURCE =
  "https://www.cpf.gov.sg/employer/employer-obligations/what-constitutes-wages-for-cpf-contributions";
/** CPF Board: common mistakes by employers (OT apportionment, item 10), research §1.7. */
export const CPF_MISTAKES_SOURCE =
  "https://www.cpf.gov.sg/service/sfc/servlet.shepherd/version/download/068IW000003YkZlYAK";

export interface PaymentDeadlines {
  readonly effectiveFrom: string;
  readonly effectiveTo: string | null;
  readonly source: string;
  /** "Salary must be paid within 7 days after the end of the salary period." */
  readonly salaryDaysAfterPeriod: number;
  /** "Overtime … within 14 days after the end of the salary period." */
  readonly overtimeDaysAfterPeriod: number;
  /** Employer terminates / dismissal: "last day, or within 3 working days if not possible". */
  readonly finalPayWorkingDaysAfterLastDayWhenEmployerTerminates: number;
}

/**
 * In force on 31 Oct 2026. MOM does not state the start date of these rules on the page; the row is
 * applied from Crow HR's engine coverage start (1 Jan 2025) only, and earlier history is not claimed.
 */
export const PAYMENT_DEADLINES: PaymentDeadlines = {
  effectiveFrom: "2025-01-01",
  effectiveTo: null,
  source: MOM_PAYING_SALARY_SOURCE,
  salaryDaysAfterPeriod: 7,
  overtimeDaysAfterPeriod: 14,
  finalPayWorkingDaysAfterLastDayWhenEmployerTerminates: 3,
};

/**
 * Deduction categories MOM allows, with their limits. Limits are in basis points of the salary
 * payable for the period. `countsTowardOverallCap: false` = MOM excludes the category from the 50%
 * overall limit ("does not include deductions for absence, advances, loans, overpaid salary, unearned
 * benefits, or co-operative society payments"). Levy, security bond, medical insurance and
 * repatriation costs for migrant workers are prohibited and have no category (FWL: sg-rules
 * `FWL_DEDUCTIBLE_FROM_SALARY = false`).
 */
export const DEDUCTION_CATEGORIES = {
  absence: { label: "Unauthorised absence", capBps: null, countsTowardOverallCap: false },
  damage_loss: { label: "Damage or loss (after inquiry)", capBps: 2500, countsTowardOverallCap: true },
  accommodation: { label: "Accommodation", capBps: 2500, countsTowardOverallCap: true },
  amenities: { label: "Amenities and services", capBps: 2500, countsTowardOverallCap: true },
  advance: { label: "Advance recovery", capBps: 2500, countsTowardOverallCap: false },
  loan: { label: "Loan instalment", capBps: 2500, countsTowardOverallCap: false },
  overpayment: { label: "Overpaid salary recovery", capBps: null, countsTowardOverallCap: false },
  cooperative: { label: "Co-operative society", capBps: null, countsTowardOverallCap: false },
  consented: { label: "Other (written consent)", capBps: null, countsTowardOverallCap: true },
  court_order: { label: "Court order or tax", capBps: null, countsTowardOverallCap: true },
} as const;

export type DeductionCategory = keyof typeof DEDUCTION_CATEGORIES;
export const DEDUCTION_CATEGORY_KEYS = Object.keys(DEDUCTION_CATEGORIES) as [DeductionCategory, ...DeductionCategory[]];

export const DEDUCTION_LIMITS = {
  effectiveFrom: "2025-01-01",
  effectiveTo: null,
  source: MOM_DEDUCTIONS_SOURCE,
  /** "Your employer cannot deduct more than 50% of your total salary payable in any one salary period." */
  overallCapBps: 5000,
  /** "The cap may be exceeded on the final salary payment." */
  overallCapWaivedOnFinalPay: true,
  /**
   * MOM does not list employee CPF among the exclusions, so it counts toward the 50% limit.
   * research/sg-regulatory.md flags this as ambiguous; counting it is the conservative reading.
   */
  employeeCpfCountsTowardOverallCap: true,
} as const;

/** Days after the AW payable month by which OW must be payable to stay OW (CPF: "by the 14th of the following month"). */
export const OW_PAYABLE_BY_DAY_OF_NEXT_MONTH = 14;
