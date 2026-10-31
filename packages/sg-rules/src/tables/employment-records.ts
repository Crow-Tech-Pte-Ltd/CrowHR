/**
 * Key Employment Terms (KETs) and employment-record retention, as published by MOM (checked
 * 31 Oct 2026; research/sg-regulatory.md §7 and §11.2). Intervals are [effectiveFrom, effectiveTo).
 */

import type { Effective } from "./effective.ts";

/** MOM "Key employment terms": the mandatory KET items, issued in writing within 14 days of the start. */
export const MOM_KETS = "https://www.mom.gov.sg/employment-practices/contract-of-service/key-employment-terms";
/** MOM "Employment records": what to keep and for how long. */
export const MOM_EMPLOYMENT_RECORDS = "https://www.mom.gov.sg/employment-practices/employment-records";

export interface KetItem {
  /** Stable id, used as the `<!-- ket:<id> -->` anchor in letter templates. */
  readonly id: string;
  /** MOM's wording, shortened. */
  readonly label: string;
  /** Only required in some cases (fixed-term contracts; employees entitled to overtime; optional). */
  readonly condition?: "fixed_term" | "overtime_entitled" | "optional";
}

export interface KetRule extends Effective {
  /** Days after the start of employment by which KETs must be issued. */
  readonly issueWithinDays: number;
  /** Employees employed for at least this many days (by contract length) must get KETs. */
  readonly minimumEmploymentDays: number;
  readonly items: readonly KetItem[];
}

/**
 * The 18 KET items in MOM's order. Items 11 and 12 (overtime payment period and rate) may be left
 * out for employees not entitled to overtime; item 5 (duration) applies to fixed-term contracts; item
 * 18 (place of work) is optional. In force for employees who started on or after 1 Apr 2016.
 */
export const KET_RULES: readonly KetRule[] = [
  {
    effectiveFrom: "2016-04-01",
    effectiveTo: null,
    source: MOM_KETS,
    effectiveFromBasis: "PUBLISHED",
    verifiedOn: "2026-10-31",
    issueWithinDays: 14,
    minimumEmploymentDays: 14,
    items: [
      { id: "employer_name", label: "Full name of employer" },
      { id: "employee_name", label: "Full name of employee" },
      { id: "job_title", label: "Job title, main duties and responsibilities" },
      { id: "start_date", label: "Start date of employment" },
      { id: "duration", label: "Duration of employment (fixed-term contracts)", condition: "fixed_term" },
      {
        id: "working_arrangements",
        label: "Working arrangements: daily working hours, number of working days per week, rest day",
      },
      { id: "salary_period", label: "Salary period" },
      { id: "basic_salary", label: "Basic salary (or rate of pay for hourly, daily or piece-rated employees)" },
      { id: "fixed_allowances", label: "Fixed allowances" },
      { id: "fixed_deductions", label: "Fixed deductions" },
      { id: "overtime_period", label: "Overtime payment period", condition: "overtime_entitled" },
      { id: "overtime_rate", label: "Overtime rate of pay", condition: "overtime_entitled" },
      { id: "other_salary", label: "Other salary-related components (bonuses, incentives)" },
      {
        id: "leave",
        label: "Types of leave (annual, outpatient sick and hospitalisation, maternity, childcare and others)",
      },
      { id: "medical_benefits", label: "Medical benefits (insurance, medical examination fees, dental benefits)" },
      { id: "probation", label: "Probation period" },
      { id: "notice", label: "Notice period" },
      { id: "place_of_work", label: "Place of work", condition: "optional" },
    ],
  },
];

export interface RecordRetentionRule extends Effective {
  /** Records of current employees: keep the latest this many months. */
  readonly currentEmployeeMonths: number;
  /** Ex-employees: keep the records for this many months after the employee leaves. */
  readonly afterLeavingMonths: number;
}

/**
 * Employment Act record keeping: current employees, the latest 2 years; ex-employees, the last
 * 2 years kept for 1 year after they leave. These are minimums; IRAS and CPF may need longer
 * (research §11.2, UNVERIFIED there, commonly 5 years for tax records), so callers only flag
 * records for review after the period and never delete on their own.
 */
export const RECORD_RETENTION_RULES: readonly RecordRetentionRule[] = [
  {
    effectiveFrom: "2016-04-01",
    effectiveTo: null,
    source: MOM_EMPLOYMENT_RECORDS,
    effectiveFromBasis: "ENGINE_COVERAGE_START",
    verifiedOn: "2026-10-31",
    currentEmployeeMonths: 24,
    afterLeavingMonths: 12,
  },
];
