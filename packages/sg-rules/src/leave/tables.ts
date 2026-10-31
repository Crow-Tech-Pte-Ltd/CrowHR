/**
 * Parental, childcare and infant-care leave (Government-Paid Leave schemes and the Employment Act
 * fallbacks). Every row is half-open [effectiveFrom, effectiveTo), cited, and verified on the date
 * shown. Reference dates pick the row: the child's birth date, expected delivery date (EDD) or the
 * formal intent to adopt, never the leave dates.
 *
 * Rows that start on `LEAVE_HISTORY_START` encode the scheme as it stood in 2023: the scheme's real
 * start date is earlier and not claimed here (children born before 2023 are out of scope). Rows that
 * start on `ENGINE_COVERAGE_START` carry amounts verified current on 31 Oct 2026 whose historical
 * start is not encoded (`effectiveFromBasis: "ENGINE_COVERAGE_START"`).
 */

import { type Effective, ENGINE_COVERAGE_START } from "../tables/effective.ts";
import type { IsoDate } from "../types.ts";

/** Earliest reference date the parental-leave history is encoded from (children born from 2023). */
export const LEAVE_HISTORY_START: IsoDate = "2023-01-01";

const VERIFIED = "2026-10-31";

export const SOURCES = {
  maternity: "https://www.mom.gov.sg/employment-practices/leave/maternity-leave/eligibility-and-entitlement",
  maternityMsf: "https://www.profamilyleave.msf.gov.sg/schemes/maternity-leave",
  paternity: "https://www.mom.gov.sg/employment-practices/leave/paternity-leave",
  paternityStillbirth: "https://ask.gov.sg/msf/questions/cmknees5w001gpwb8u66r0wzy",
  paternityChronology: "https://ask.gov.sg/msf/questions/cmtqu4elt00xr5l011wnf0543?from=topics",
  sharedParental: "https://www.mom.gov.sg/employment-practices/leave/shared-parental-leave",
  sharedParentalStillbirth: "https://ask.gov.sg/msf/questions/cls1lenm102ajjzsg30u2kssb?from=relatedquestions",
  childcare: "https://www.mom.gov.sg/employment-practices/leave/childcare-leave/eligibility-and-entitlement",
  childcareProrated: "https://www.mom.gov.sg/employment-practices/leave/childcare-leave/pro-rated-childcare-leave",
  extendedChildcare: "https://www.mom.gov.sg/employment-practices/leave/childcare-leave/extended-childcare-leave",
  childcareLifetime: "https://file.go.gov.sg/gpcl2notes.pdf",
  infantCare: "https://www.mom.gov.sg/employment-practices/leave/unpaid-infant-care-leave",
  adoption: "https://www.mom.gov.sg/employment-practices/leave/adoption-leave",
  partTime: "https://www.mom.gov.sg/employment-practices/part-time-employment/leave",
  ndr2026: "https://www.gov.sg/ndr2026/families/",
  ndr2026Citizen:
    "https://www.cpf.gov.sg/member/infohub/educational-resources/baby-bonus-benefits-and-support-for-new-parents",
} as const;

/** Funding split by child order: weeks the employer pays first; the rest is Government-paid. */
export interface FundingRule {
  /** Applies to children of this birth order and above (1 = first child). */
  readonly fromBirthOrder: number;
  readonly employerWeeks: number;
  /** Weeks after the employer-paid ones that are unpaid (EA maternity weeks 9–12). */
  readonly unpaidWeeks: number;
  readonly governmentCapCents: number | null;
}

export interface MaternityRule extends Effective {
  readonly scheme: "GPML" | "EA_MATERNITY";
  readonly weeks: number;
  readonly minServiceMonths: number;
  readonly perWeekCapCents: number | null;
  /** Ordered by `fromBirthOrder` ascending; the last rule whose order ≤ the child's applies. */
  readonly funding: readonly FundingRule[];
}

export const GPML_RULES: readonly MaternityRule[] = [
  {
    effectiveFrom: ENGINE_COVERAGE_START,
    effectiveTo: null,
    effectiveFromBasis: "ENGINE_COVERAGE_START",
    verifiedOn: VERIFIED,
    scheme: "GPML",
    weeks: 16,
    minServiceMonths: 3,
    // "$10,000 per 4 weeks" = $2,500 a week.
    perWeekCapCents: 250_000,
    funding: [
      { fromBirthOrder: 1, employerWeeks: 8, unpaidWeeks: 0, governmentCapCents: 2_000_000 },
      { fromBirthOrder: 3, employerWeeks: 0, unpaidWeeks: 0, governmentCapCents: 4_000_000 },
    ],
    source: SOURCES.maternityMsf,
  },
];

/** Child not a Singapore Citizen: 12 weeks under the Employment Act. */
export const EA_MATERNITY_RULES: readonly MaternityRule[] = [
  {
    effectiveFrom: ENGINE_COVERAGE_START,
    effectiveTo: null,
    effectiveFromBasis: "ENGINE_COVERAGE_START",
    verifiedOn: VERIFIED,
    scheme: "EA_MATERNITY",
    weeks: 12,
    minServiceMonths: 3,
    perWeekCapCents: null,
    // Employer pays the first 8 weeks when the mother has fewer than 2 living children (approximated
    // by birth order ≤ 2); the last 4 weeks, and all 12 otherwise, are unpaid.
    funding: [
      { fromBirthOrder: 1, employerWeeks: 8, unpaidWeeks: 4, governmentCapCents: null },
      { fromBirthOrder: 3, employerWeeks: 0, unpaidWeeks: 12, governmentCapCents: null },
    ],
    source: SOURCES.maternity,
  },
];

export interface PaternityRule extends Effective {
  /** Weeks of Government-Paid Paternity Leave. */
  readonly weeks: number;
  /** Of `weeks`, how many are given only with the employer's agreement (voluntary, still reimbursed). */
  readonly voluntaryWeeks: number;
  readonly minServiceMonths: number;
  readonly perWeekCapCents: number;
  /** Paid working days per week are capped at this number. */
  readonly maxDaysPerWeek: number;
}

export const PATERNITY_RULES: readonly PaternityRule[] = [
  {
    // Two weeks mandatory before 1 Jan 2024 (encoded from 2023 only; the scheme is older).
    effectiveFrom: LEAVE_HISTORY_START,
    effectiveTo: "2024-01-01",
    verifiedOn: VERIFIED,
    weeks: 2,
    voluntaryWeeks: 0,
    minServiceMonths: 3,
    perWeekCapCents: 250_000,
    maxDaysPerWeek: 6,
    source: SOURCES.paternityChronology,
  },
  {
    // The optional, reimbursable extra two weeks (employer agreement) began on 1 Jan 2024.
    effectiveFrom: "2024-01-01",
    effectiveTo: "2025-04-01",
    effectiveFromBasis: "PUBLISHED",
    verifiedOn: VERIFIED,
    weeks: 4,
    voluntaryWeeks: 2,
    minServiceMonths: 3,
    perWeekCapCents: 250_000,
    maxDaysPerWeek: 6,
    source: SOURCES.paternityChronology,
  },
  {
    // Four mandatory weeks where the birth, EDD or formal intent to adopt is on or after 1 Apr 2025.
    effectiveFrom: "2025-04-01",
    effectiveTo: null,
    effectiveFromBasis: "PUBLISHED",
    verifiedOn: VERIFIED,
    weeks: 4,
    voluntaryWeeks: 0,
    minServiceMonths: 3,
    perWeekCapCents: 250_000,
    maxDaysPerWeek: 6,
    source: SOURCES.paternity,
  },
];

/** Fathers of stillborn children: two weeks (MSF), whatever the row. */
export const PATERNITY_STILLBIRTH_WEEKS = { weeks: 2, source: SOURCES.paternityStillbirth } as const;

export interface SharedParentalRule extends Effective {
  readonly weeks: number;
  readonly minServiceMonths: number;
  readonly perWeekCapCents: number;
}

export const SHARED_PARENTAL_RULES: readonly SharedParentalRule[] = [
  {
    effectiveFrom: "2025-04-01",
    effectiveTo: "2026-04-01",
    effectiveFromBasis: "PUBLISHED",
    verifiedOn: VERIFIED,
    weeks: 6,
    minServiceMonths: 3,
    perWeekCapCents: 250_000,
    source: SOURCES.sharedParental,
  },
  {
    // "10 weeks of SPL for children born from 1 April 2026 onwards" (also when the EDD is on/after).
    effectiveFrom: "2026-04-01",
    effectiveTo: null,
    effectiveFromBasis: "PUBLISHED",
    verifiedOn: VERIFIED,
    weeks: 10,
    minServiceMonths: 3,
    perWeekCapCents: 250_000,
    source: SOURCES.sharedParental,
  },
];

export interface AdoptionRule extends Effective {
  readonly weeks: number;
  readonly minServiceMonths: number;
  /** The child must be younger than this many months at the formal intent to adopt. */
  readonly maxChildAgeMonths: number;
  readonly perWeekCapCents: number | null;
  readonly funding: readonly FundingRule[];
}

export const ADOPTION_RULES: readonly AdoptionRule[] = [
  {
    effectiveFrom: ENGINE_COVERAGE_START,
    effectiveTo: null,
    effectiveFromBasis: "ENGINE_COVERAGE_START",
    verifiedOn: VERIFIED,
    weeks: 12,
    minServiceMonths: 3,
    maxChildAgeMonths: 12,
    perWeekCapCents: 250_000,
    funding: [
      { fromBirthOrder: 1, employerWeeks: 4, unpaidWeeks: 0, governmentCapCents: 2_000_000 },
      { fromBirthOrder: 3, employerWeeks: 0, unpaidWeeks: 0, governmentCapCents: 3_000_000 },
    ],
    source: SOURCES.adoption,
  },
];

export interface ChildcareRule extends Effective {
  readonly minServiceMonths: number;
  /** Government-Paid Childcare Leave: Singapore Citizen child under `gpclMaxAge` (exclusive). */
  readonly gpclDays: number;
  readonly gpclMaxAge: number;
  /** GPCL days paid by the employer first; the rest are reimbursed. */
  readonly gpclEmployerDays: number;
  /** New hires with < 12 completed months: completed months → days (MOM table). */
  readonly gpclProrated: Readonly<Record<number, number>>;
  /** Extended childcare leave: youngest SC child aged `eclMinAge`–`eclMaxAge` (inclusive). */
  readonly eclDays: number;
  readonly eclMinAge: number;
  readonly eclMaxAge: number;
  /** GPCL + ECL in one year. */
  readonly combinedMaxDays: number;
  /** EA childcare: non-citizen child under `gpclMaxAge`, employer-paid, not pro-rated. */
  readonly eaDays: number;
  /** Government reimbursement cap per day, including CPF. */
  readonly perDayCapCents: number;
  readonly lifetimeGpclDaysPerChild: number;
  readonly lifetimeEclDaysPerChild: number;
}

export const CHILDCARE_RULES: readonly ChildcareRule[] = [
  {
    effectiveFrom: ENGINE_COVERAGE_START,
    effectiveTo: null,
    effectiveFromBasis: "ENGINE_COVERAGE_START",
    verifiedOn: VERIFIED,
    minServiceMonths: 3,
    gpclDays: 6,
    gpclMaxAge: 7,
    gpclEmployerDays: 3,
    gpclProrated: { 3: 2, 4: 2, 5: 3, 6: 3, 7: 4, 8: 4, 9: 5, 10: 5, 11: 6 },
    eclDays: 2,
    eclMinAge: 7,
    eclMaxAge: 12,
    combinedMaxDays: 6,
    eaDays: 2,
    perDayCapCents: 50_000,
    lifetimeGpclDaysPerChild: 42,
    lifetimeEclDaysPerChild: 12,
    source: SOURCES.childcare,
  },
];

export interface InfantCareRule extends Effective {
  readonly daysPerYear: number;
  readonly maxChildAge: number;
  readonly minServiceMonths: number;
}

export const INFANT_CARE_RULES: readonly InfantCareRule[] = [
  {
    // 6 days a year before 1 Jan 2024 (encoded from 2023 only).
    effectiveFrom: LEAVE_HISTORY_START,
    effectiveTo: "2024-01-01",
    verifiedOn: VERIFIED,
    daysPerYear: 6,
    maxChildAge: 2,
    minServiceMonths: 3,
    source: SOURCES.infantCare,
  },
  {
    effectiveFrom: "2024-01-01",
    effectiveTo: null,
    effectiveFromBasis: "PUBLISHED",
    verifiedOn: VERIFIED,
    daysPerYear: 12,
    maxChildAge: 2,
    minServiceMonths: 3,
    source: SOURCES.infantCare,
  },
];

/** Unpaid infant care leave: at most 24 days per child (since 1 Jan 2024). */
export const INFANT_CARE_LIFETIME_DAYS_PER_CHILD = 24;

/**
 * Announced at the 2026 National Day Rally, NOT in force: childcare and extended childcare leave
 * merge for Singapore Citizen children aged 12 and below, 8/10/12 days a year for 1/2/3+ children.
 * No effective date has been published, so no calculator applies it.
 */
export const NDR_2026_CHILDCARE = {
  effectiveFrom: null,
  effectiveTo: null,
  status: "ANNOUNCED_NOT_EFFECTIVE",
  citizenChildrenOnly: true,
  maxChildAge: 12,
  daysByChildCount: [
    { children: 1, days: 8 },
    { children: 2, days: 10 },
    { children: 3, days: 12 },
  ],
  verifiedOn: VERIFIED,
  source: SOURCES.ndr2026,
  citizenSource: SOURCES.ndr2026Citizen,
} as const;
