/**
 * Employment Act leave entitlements (annual and sick leave). Intervals are [effectiveFrom, effectiveTo).
 * Parental, childcare and other Government-paid leave are NOT encoded here (see VERIFICATION.md handoffs).
 */

import { type Effective, ENGINE_COVERAGE_START } from "./effective.ts";

export interface AnnualLeaveRule extends Effective {
  readonly minServiceMonths: number;
  /** Days for service year 1, 2, …; the last entry applies to every later year. */
  readonly daysByServiceYear: readonly number[];
}

export const ANNUAL_LEAVE_RULES: readonly AnnualLeaveRule[] = [
  {
    // Long-standing scale; start date not published on the page. Verified current.
    effectiveFrom: ENGINE_COVERAGE_START,
    effectiveTo: null,
    effectiveFromBasis: "ENGINE_COVERAGE_START",
    verifiedOn: "2026-10-31",
    minServiceMonths: 3,
    daysByServiceYear: [7, 8, 9, 10, 11, 12, 13, 14],
    source: "https://www.mom.gov.sg/employment-practices/leave/annual-leave/eligibility-and-entitlement",
  },
];

export interface SickLeaveStep {
  readonly completedMonths: number;
  readonly outpatientDays: number;
  /** Hospitalisation days INCLUDING the outpatient days. */
  readonly hospitalisationDays: number;
}

export interface SickLeaveRule extends Effective {
  readonly minServiceMonths: number;
  /** Ascending; the entry with the highest completedMonths ≤ service applies. */
  readonly steps: readonly SickLeaveStep[];
}

export const SICK_LEAVE_RULES: readonly SickLeaveRule[] = [
  {
    effectiveFrom: ENGINE_COVERAGE_START,
    effectiveTo: null,
    effectiveFromBasis: "ENGINE_COVERAGE_START",
    verifiedOn: "2026-10-31",
    minServiceMonths: 3,
    steps: [
      { completedMonths: 3, outpatientDays: 5, hospitalisationDays: 15 },
      { completedMonths: 4, outpatientDays: 8, hospitalisationDays: 30 },
      { completedMonths: 5, outpatientDays: 11, hospitalisationDays: 45 },
      { completedMonths: 6, outpatientDays: 14, hospitalisationDays: 60 },
    ],
    source: "https://www.mom.gov.sg/employment-practices/leave/sick-leave/eligibility-and-entitlement",
  },
];
