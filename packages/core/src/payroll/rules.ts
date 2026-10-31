/**
 * Sources payroll cites, and re-exports of the Employment Act payment and deduction rules, which
 * live in `@crowhr/sg-rules` (`tables/salary-payment.ts`, `employment-act/salary-payment.ts`).
 */
export {
  awTopUpRecoveryDeadline,
  CPF_ACT_S7,
  CPF_RECOVERY_FAQ,
  checkDeductions,
  DEDUCTION_CATEGORIES,
  DEDUCTION_CATEGORY_KEYS,
  type DeductionCategory,
  EA_S21,
  EA_S25,
  MOM_PAYING_SALARY as MOM_PAYING_SALARY_SOURCE,
  MOM_SALARY_DEDUCTIONS as MOM_DEDUCTIONS_SOURCE,
  overtimeDueBy,
  paymentDeadlines,
  salaryDueBy,
} from "@crowhr/sg-rules";

/** MOM: monthly and daily salary (incomplete month formula), updated 8 Dec 2025; research §5.5. */
export const MOM_INCOMPLETE_MONTH_SOURCE =
  "https://www.mom.gov.sg/employment-practices/salary/monthly-and-daily-salary";
/** EA s 20A: the incomplete-month denominator is the days the employee is required to work in the month. */
export const EA_S20A_SOURCE = "https://sso.agc.gov.sg/Act/EmA1968?ProvIds=pr20A-";
/** MOM: itemised payslips, read 31 Oct 2026; research/sg-regulatory.md §7. */
export const MOM_PAYSLIP_SOURCE = "https://www.mom.gov.sg/employment-practices/salary/itemised-payslips";
/** CPF Board: what constitutes wages (OW/AW, OT apportionment), read 31 Oct 2026; research §1.7. */
export const CPF_WAGES_SOURCE =
  "https://www.cpf.gov.sg/employer/employer-obligations/what-constitutes-wages-for-cpf-contributions";
/** CPF Board: common mistakes by employers (OT apportionment, item 10), research §1.7. */
export const CPF_MISTAKES_SOURCE =
  "https://www.cpf.gov.sg/service/sfc/servlet.shepherd/version/download/068IW000003YkZlYAK";
