/**
 * CPF contribution rules (CPF Act 1953 as administered by the CPF Board).
 *
 * Rates are integer basis points (1 bp = 0.01%); the phase-in coefficient is also in bps
 * (0.6 = 6000). Money is integer cents. Intervals are [effectiveFrom, effectiveTo).
 *
 * Every rate cell below was transcribed from the CPF Board's published rate-table PDFs and
 * machine-checked against the PDF text (see packages/sg-rules/VERIFICATION.md). Rates apply to
 * wages for the contribution month: OW of the month earned, AW of the month it is due and payable.
 */

import type { Effective } from "./effective.ts";

const SOURCE_2025 =
  "https://www.cpf.gov.sg/content/dam/web/employer/employer-obligations/documents/jan2025_contributionandallocationrates.pdf";
const SOURCE_2026 =
  "https://www.cpf.gov.sg/content/dam/web/employer/employer-obligations/documents/CPFcontributionratesfrom1Jan2026.pdf";
const SOURCE_2027 =
  "https://www.cpf.gov.sg/content/dam/web/employer/employer-obligations/documents/jan2027cpfcontributionrates.pdf";

export type CpfAgeBand = "AGE_55_AND_BELOW" | "ABOVE_55_TO_60" | "ABOVE_60_TO_65" | "ABOVE_65_TO_70" | "ABOVE_70";

export const CPF_AGE_BANDS: readonly CpfAgeBand[] = [
  "AGE_55_AND_BELOW",
  "ABOVE_55_TO_60",
  "ABOVE_60_TO_65",
  "ABOVE_65_TO_70",
  "ABOVE_70",
];

/**
 * Birthday milestones at which the age band changes. New rates apply from the first day of the
 * month AFTER the month of the 55th/60th/65th/70th birthday.
 * Source: https://www.cpf.gov.sg/employer/employer-obligations/how-much-cpf-contributions-to-pay
 * and https://www.cpf.gov.sg/service/article/when-will-my-employee-s-cpf-contribution-rates-change-when-they-turn-55-60-65-or-70
 */
export const CPF_AGE_MILESTONES = {
  years: [55, 60, 65, 70] as const,
  source: "https://www.cpf.gov.sg/employer/employer-obligations/how-much-cpf-contributions-to-pay",
};

/**
 * Residency categories that select a rate table.
 * SPR1/SPR2 = 1st/2nd year of SPR status; GG = graduated employer and employee (default),
 * FG = full employer + graduated employee (joint application), FF = full rates (joint application).
 */
export type CpfResidencyCategory =
  | "SC"
  | "SPR1_GG"
  | "SPR1_FG"
  | "SPR1_FF"
  | "SPR2_GG"
  | "SPR2_FG"
  | "SPR2_FF"
  | "SPR3";

export interface CpfAgeRow {
  /** Rate × TW in the "> $50 to $500" band; also the TW term of the phase-in formula. */
  readonly employerOnlyBps: number;
  /** k in "rate (TW) + k (TW − $500)", and the employee share k (TW − $500). */
  readonly phaseInCoefficientBps: number;
  /** Total rate in the "> $750" band. */
  readonly totalBps: number;
  /** Employee rate in the "> $750" band. */
  readonly employeeBps: number;
  /** Tables 2 and 3 publish "Above 65" as one band; it is repeated for 65–70 and above 70. */
  readonly publishedAgeLabel?: "ABOVE_65";
}

export interface CpfWageBandThresholds {
  /** TW ≤ this: no contribution. */
  readonly nilUpToCents: number;
  /** TW ≤ this: employer only. */
  readonly employerOnlyUpToCents: number;
  /** TW ≤ this: phase-in; above it, full rates. */
  readonly phaseInUpToCents: number;
  /** The "$500" in k (TW − $500). */
  readonly phaseInBaseCents: number;
}

/** "$50 or less", "> $50 to $500", "> $500 to $750", "> $750" — identical in every table 2025–2027. */
export const CPF_WAGE_BAND_THRESHOLDS: CpfWageBandThresholds = {
  nilUpToCents: 5_000,
  employerOnlyUpToCents: 50_000,
  phaseInUpToCents: 75_000,
  phaseInBaseCents: 50_000,
};

export interface CpfRateTable extends Effective {
  readonly id: string;
  /** Table number in the CPF PDF (1 = SC / SPR 3rd year+, 2–5 = SPR 1st/2nd year). */
  readonly publishedTableNo: 1 | 2 | 3 | 4 | 5;
  readonly residencyCategories: readonly CpfResidencyCategory[];
  readonly rows: Readonly<Record<CpfAgeBand, CpfAgeRow>>;
}

/**
 * The latest published CPF rate tables run to 31 Dec 2027 (published 21 May 2026). For later
 * months the 2027 tables are carried forward and results are flagged `ratesAssumedCarriedForward`
 * until CPF publishes the next tables. Exclusive bound.
 */
export const CPF_RATES_PUBLISHED_UNTIL = "2028-01-01";

export interface CpfOwCeiling extends Effective {
  readonly monthlyCents: number;
}

/** OW ceiling per calendar month, per employer. */
export const CPF_OW_CEILINGS: readonly CpfOwCeiling[] = [
  {
    effectiveFrom: "2025-01-01",
    effectiveTo: "2026-01-01",
    monthlyCents: 740_000,
    source: SOURCE_2025,
    effectiveFromBasis: "PUBLISHED",
  },
  {
    effectiveFrom: "2026-01-01",
    effectiveTo: null,
    monthlyCents: 800_000,
    source: SOURCE_2026,
    effectiveFromBasis: "PUBLISHED",
    verifiedOn: "2026-10-31",
  },
];

export interface CpfAnnualSalaryCeiling extends Effective {
  readonly annualCents: number;
}

/**
 * Annual Salary Ceiling. AW ceiling for the year = this − total OW subject to CPF for the year,
 * per employee, per employer, per calendar year.
 * Sources: https://www.cpf.gov.sg/employer/employer-obligations/what-constitutes-wages-for-cpf-contributions
 * (current value) and https://www.cpf.gov.sg/service/article/what-is-the-ordinary-wage-ow-ceiling (from 1 Jan 2016).
 */
export const CPF_ANNUAL_SALARY_CEILINGS: readonly CpfAnnualSalaryCeiling[] = [
  {
    effectiveFrom: "2016-01-01",
    effectiveTo: null,
    annualCents: 10_200_000,
    source: "https://www.cpf.gov.sg/service/article/what-is-the-ordinary-wage-ow-ceiling",
    effectiveFromBasis: "PUBLISHED",
    verifiedOn: "2026-10-31",
  },
];

/** CPF AW ceiling procedure (estimate at each AW payment; recompute in last month or December). */
export const CPF_AW_CEILING_SOURCE =
  "https://www.cpf.gov.sg/service/sfc/servlet.shepherd/document/download/069IW00000jyH92YAE";

/** SPR year boundaries and conversion-month treatment. */
export const CPF_SPR_SOURCE =
  "https://www.cpf.gov.sg/service/article/do-i-need-to-pay-cpf-contributions-for-my-foreign-employee-who-has-recently-obtained-singapore-permanent-residence-status";

export const CPF_RATE_TABLES: readonly CpfRateTable[] = [
  {
    id: "CPF_2025_SC_AND_SPR3",
    publishedTableNo: 1,
    residencyCategories: ["SC", "SPR3", "SPR1_FF", "SPR2_FF"],
    effectiveFrom: "2025-01-01",
    effectiveTo: "2026-01-01",
    source: SOURCE_2025,
    effectiveFromBasis: "PUBLISHED",
    rows: {
      AGE_55_AND_BELOW: { employerOnlyBps: 1700, phaseInCoefficientBps: 6000, totalBps: 3700, employeeBps: 2000 },
      ABOVE_55_TO_60: { employerOnlyBps: 1550, phaseInCoefficientBps: 5100, totalBps: 3250, employeeBps: 1700 },
      ABOVE_60_TO_65: { employerOnlyBps: 1200, phaseInCoefficientBps: 3450, totalBps: 2350, employeeBps: 1150 },
      ABOVE_65_TO_70: { employerOnlyBps: 900, phaseInCoefficientBps: 2250, totalBps: 1650, employeeBps: 750 },
      ABOVE_70: { employerOnlyBps: 750, phaseInCoefficientBps: 1500, totalBps: 1250, employeeBps: 500 },
    },
  },
  {
    id: "CPF_2026_SC_AND_SPR3",
    publishedTableNo: 1,
    residencyCategories: ["SC", "SPR3", "SPR1_FF", "SPR2_FF"],
    effectiveFrom: "2026-01-01",
    effectiveTo: "2027-01-01",
    source: SOURCE_2026,
    effectiveFromBasis: "PUBLISHED",
    rows: {
      AGE_55_AND_BELOW: { employerOnlyBps: 1700, phaseInCoefficientBps: 6000, totalBps: 3700, employeeBps: 2000 },
      ABOVE_55_TO_60: { employerOnlyBps: 1600, phaseInCoefficientBps: 5400, totalBps: 3400, employeeBps: 1800 },
      ABOVE_60_TO_65: { employerOnlyBps: 1250, phaseInCoefficientBps: 3750, totalBps: 2500, employeeBps: 1250 },
      ABOVE_65_TO_70: { employerOnlyBps: 900, phaseInCoefficientBps: 2250, totalBps: 1650, employeeBps: 750 },
      ABOVE_70: { employerOnlyBps: 750, phaseInCoefficientBps: 1500, totalBps: 1250, employeeBps: 500 },
    },
  },
  {
    id: "CPF_2027_SC_AND_SPR3",
    publishedTableNo: 1,
    residencyCategories: ["SC", "SPR3", "SPR1_FF", "SPR2_FF"],
    effectiveFrom: "2027-01-01",
    effectiveTo: null,
    source: SOURCE_2027,
    effectiveFromBasis: "PUBLISHED",
    rows: {
      AGE_55_AND_BELOW: { employerOnlyBps: 1700, phaseInCoefficientBps: 6000, totalBps: 3700, employeeBps: 2000 },
      ABOVE_55_TO_60: { employerOnlyBps: 1650, phaseInCoefficientBps: 5700, totalBps: 3550, employeeBps: 1900 },
      ABOVE_60_TO_65: { employerOnlyBps: 1300, phaseInCoefficientBps: 3900, totalBps: 2600, employeeBps: 1300 },
      ABOVE_65_TO_70: { employerOnlyBps: 900, phaseInCoefficientBps: 2250, totalBps: 1650, employeeBps: 750 },
      ABOVE_70: { employerOnlyBps: 750, phaseInCoefficientBps: 1500, totalBps: 1250, employeeBps: 500 },
    },
  },
  {
    id: "CPF_2025_SPR1_GG",
    publishedTableNo: 2,
    residencyCategories: ["SPR1_GG"],
    effectiveFrom: "2025-01-01",
    effectiveTo: "2026-01-01",
    source: SOURCE_2025,
    effectiveFromBasis: "PUBLISHED",
    rows: {
      AGE_55_AND_BELOW: { employerOnlyBps: 400, phaseInCoefficientBps: 1500, totalBps: 900, employeeBps: 500 },
      ABOVE_55_TO_60: { employerOnlyBps: 400, phaseInCoefficientBps: 1500, totalBps: 900, employeeBps: 500 },
      ABOVE_60_TO_65: { employerOnlyBps: 350, phaseInCoefficientBps: 1500, totalBps: 850, employeeBps: 500 },
      ABOVE_65_TO_70: {
        employerOnlyBps: 350,
        phaseInCoefficientBps: 1500,
        totalBps: 850,
        employeeBps: 500,
        publishedAgeLabel: "ABOVE_65",
      },
      ABOVE_70: {
        employerOnlyBps: 350,
        phaseInCoefficientBps: 1500,
        totalBps: 850,
        employeeBps: 500,
        publishedAgeLabel: "ABOVE_65",
      },
    },
  },
  {
    id: "CPF_2026_SPR1_GG",
    publishedTableNo: 2,
    residencyCategories: ["SPR1_GG"],
    effectiveFrom: "2026-01-01",
    effectiveTo: "2027-01-01",
    source: SOURCE_2026,
    effectiveFromBasis: "PUBLISHED",
    rows: {
      AGE_55_AND_BELOW: { employerOnlyBps: 400, phaseInCoefficientBps: 1500, totalBps: 900, employeeBps: 500 },
      ABOVE_55_TO_60: { employerOnlyBps: 400, phaseInCoefficientBps: 1500, totalBps: 900, employeeBps: 500 },
      ABOVE_60_TO_65: { employerOnlyBps: 350, phaseInCoefficientBps: 1500, totalBps: 850, employeeBps: 500 },
      ABOVE_65_TO_70: {
        employerOnlyBps: 350,
        phaseInCoefficientBps: 1500,
        totalBps: 850,
        employeeBps: 500,
        publishedAgeLabel: "ABOVE_65",
      },
      ABOVE_70: {
        employerOnlyBps: 350,
        phaseInCoefficientBps: 1500,
        totalBps: 850,
        employeeBps: 500,
        publishedAgeLabel: "ABOVE_65",
      },
    },
  },
  {
    id: "CPF_2027_SPR1_GG",
    publishedTableNo: 2,
    residencyCategories: ["SPR1_GG"],
    effectiveFrom: "2027-01-01",
    effectiveTo: null,
    source: SOURCE_2027,
    effectiveFromBasis: "PUBLISHED",
    rows: {
      AGE_55_AND_BELOW: { employerOnlyBps: 400, phaseInCoefficientBps: 1500, totalBps: 900, employeeBps: 500 },
      ABOVE_55_TO_60: { employerOnlyBps: 400, phaseInCoefficientBps: 1500, totalBps: 900, employeeBps: 500 },
      ABOVE_60_TO_65: { employerOnlyBps: 350, phaseInCoefficientBps: 1500, totalBps: 850, employeeBps: 500 },
      ABOVE_65_TO_70: {
        employerOnlyBps: 350,
        phaseInCoefficientBps: 1500,
        totalBps: 850,
        employeeBps: 500,
        publishedAgeLabel: "ABOVE_65",
      },
      ABOVE_70: {
        employerOnlyBps: 350,
        phaseInCoefficientBps: 1500,
        totalBps: 850,
        employeeBps: 500,
        publishedAgeLabel: "ABOVE_65",
      },
    },
  },
  {
    id: "CPF_2025_SPR2_GG",
    publishedTableNo: 3,
    residencyCategories: ["SPR2_GG"],
    effectiveFrom: "2025-01-01",
    effectiveTo: "2026-01-01",
    source: SOURCE_2025,
    effectiveFromBasis: "PUBLISHED",
    rows: {
      AGE_55_AND_BELOW: { employerOnlyBps: 900, phaseInCoefficientBps: 4500, totalBps: 2400, employeeBps: 1500 },
      ABOVE_55_TO_60: { employerOnlyBps: 600, phaseInCoefficientBps: 3750, totalBps: 1850, employeeBps: 1250 },
      ABOVE_60_TO_65: { employerOnlyBps: 350, phaseInCoefficientBps: 2250, totalBps: 1100, employeeBps: 750 },
      ABOVE_65_TO_70: {
        employerOnlyBps: 350,
        phaseInCoefficientBps: 1500,
        totalBps: 850,
        employeeBps: 500,
        publishedAgeLabel: "ABOVE_65",
      },
      ABOVE_70: {
        employerOnlyBps: 350,
        phaseInCoefficientBps: 1500,
        totalBps: 850,
        employeeBps: 500,
        publishedAgeLabel: "ABOVE_65",
      },
    },
  },
  {
    id: "CPF_2026_SPR2_GG",
    publishedTableNo: 3,
    residencyCategories: ["SPR2_GG"],
    effectiveFrom: "2026-01-01",
    effectiveTo: "2027-01-01",
    source: SOURCE_2026,
    effectiveFromBasis: "PUBLISHED",
    rows: {
      AGE_55_AND_BELOW: { employerOnlyBps: 900, phaseInCoefficientBps: 4500, totalBps: 2400, employeeBps: 1500 },
      ABOVE_55_TO_60: { employerOnlyBps: 600, phaseInCoefficientBps: 3750, totalBps: 1850, employeeBps: 1250 },
      ABOVE_60_TO_65: { employerOnlyBps: 350, phaseInCoefficientBps: 2250, totalBps: 1100, employeeBps: 750 },
      ABOVE_65_TO_70: {
        employerOnlyBps: 350,
        phaseInCoefficientBps: 1500,
        totalBps: 850,
        employeeBps: 500,
        publishedAgeLabel: "ABOVE_65",
      },
      ABOVE_70: {
        employerOnlyBps: 350,
        phaseInCoefficientBps: 1500,
        totalBps: 850,
        employeeBps: 500,
        publishedAgeLabel: "ABOVE_65",
      },
    },
  },
  {
    id: "CPF_2027_SPR2_GG",
    publishedTableNo: 3,
    residencyCategories: ["SPR2_GG"],
    effectiveFrom: "2027-01-01",
    effectiveTo: null,
    source: SOURCE_2027,
    effectiveFromBasis: "PUBLISHED",
    rows: {
      AGE_55_AND_BELOW: { employerOnlyBps: 900, phaseInCoefficientBps: 4500, totalBps: 2400, employeeBps: 1500 },
      ABOVE_55_TO_60: { employerOnlyBps: 600, phaseInCoefficientBps: 3750, totalBps: 1850, employeeBps: 1250 },
      ABOVE_60_TO_65: { employerOnlyBps: 350, phaseInCoefficientBps: 2250, totalBps: 1100, employeeBps: 750 },
      ABOVE_65_TO_70: {
        employerOnlyBps: 350,
        phaseInCoefficientBps: 1500,
        totalBps: 850,
        employeeBps: 500,
        publishedAgeLabel: "ABOVE_65",
      },
      ABOVE_70: {
        employerOnlyBps: 350,
        phaseInCoefficientBps: 1500,
        totalBps: 850,
        employeeBps: 500,
        publishedAgeLabel: "ABOVE_65",
      },
    },
  },
  {
    id: "CPF_2025_SPR1_FG",
    publishedTableNo: 4,
    residencyCategories: ["SPR1_FG"],
    effectiveFrom: "2025-01-01",
    effectiveTo: "2026-01-01",
    source: SOURCE_2025,
    effectiveFromBasis: "PUBLISHED",
    rows: {
      AGE_55_AND_BELOW: { employerOnlyBps: 1700, phaseInCoefficientBps: 1500, totalBps: 2200, employeeBps: 500 },
      ABOVE_55_TO_60: { employerOnlyBps: 1550, phaseInCoefficientBps: 1500, totalBps: 2050, employeeBps: 500 },
      ABOVE_60_TO_65: { employerOnlyBps: 1200, phaseInCoefficientBps: 1500, totalBps: 1700, employeeBps: 500 },
      ABOVE_65_TO_70: { employerOnlyBps: 900, phaseInCoefficientBps: 1500, totalBps: 1400, employeeBps: 500 },
      ABOVE_70: { employerOnlyBps: 750, phaseInCoefficientBps: 1500, totalBps: 1250, employeeBps: 500 },
    },
  },
  {
    id: "CPF_2026_SPR1_FG",
    publishedTableNo: 4,
    residencyCategories: ["SPR1_FG"],
    effectiveFrom: "2026-01-01",
    effectiveTo: "2027-01-01",
    source: SOURCE_2026,
    effectiveFromBasis: "PUBLISHED",
    rows: {
      AGE_55_AND_BELOW: { employerOnlyBps: 1700, phaseInCoefficientBps: 1500, totalBps: 2200, employeeBps: 500 },
      ABOVE_55_TO_60: { employerOnlyBps: 1600, phaseInCoefficientBps: 1500, totalBps: 2100, employeeBps: 500 },
      ABOVE_60_TO_65: { employerOnlyBps: 1250, phaseInCoefficientBps: 1500, totalBps: 1750, employeeBps: 500 },
      ABOVE_65_TO_70: { employerOnlyBps: 900, phaseInCoefficientBps: 1500, totalBps: 1400, employeeBps: 500 },
      ABOVE_70: { employerOnlyBps: 750, phaseInCoefficientBps: 1500, totalBps: 1250, employeeBps: 500 },
    },
  },
  {
    id: "CPF_2027_SPR1_FG",
    publishedTableNo: 4,
    residencyCategories: ["SPR1_FG"],
    effectiveFrom: "2027-01-01",
    effectiveTo: null,
    source: SOURCE_2027,
    effectiveFromBasis: "PUBLISHED",
    rows: {
      AGE_55_AND_BELOW: { employerOnlyBps: 1700, phaseInCoefficientBps: 1500, totalBps: 2200, employeeBps: 500 },
      ABOVE_55_TO_60: { employerOnlyBps: 1650, phaseInCoefficientBps: 1500, totalBps: 2150, employeeBps: 500 },
      ABOVE_60_TO_65: { employerOnlyBps: 1300, phaseInCoefficientBps: 1500, totalBps: 1800, employeeBps: 500 },
      ABOVE_65_TO_70: { employerOnlyBps: 900, phaseInCoefficientBps: 1500, totalBps: 1400, employeeBps: 500 },
      ABOVE_70: { employerOnlyBps: 750, phaseInCoefficientBps: 1500, totalBps: 1250, employeeBps: 500 },
    },
  },
  {
    id: "CPF_2025_SPR2_FG",
    publishedTableNo: 5,
    residencyCategories: ["SPR2_FG"],
    effectiveFrom: "2025-01-01",
    effectiveTo: "2026-01-01",
    source: SOURCE_2025,
    effectiveFromBasis: "PUBLISHED",
    rows: {
      AGE_55_AND_BELOW: { employerOnlyBps: 1700, phaseInCoefficientBps: 4500, totalBps: 3200, employeeBps: 1500 },
      ABOVE_55_TO_60: { employerOnlyBps: 1550, phaseInCoefficientBps: 3750, totalBps: 2800, employeeBps: 1250 },
      ABOVE_60_TO_65: { employerOnlyBps: 1200, phaseInCoefficientBps: 2250, totalBps: 1950, employeeBps: 750 },
      ABOVE_65_TO_70: { employerOnlyBps: 900, phaseInCoefficientBps: 1500, totalBps: 1400, employeeBps: 500 },
      ABOVE_70: { employerOnlyBps: 750, phaseInCoefficientBps: 1500, totalBps: 1250, employeeBps: 500 },
    },
  },
  {
    id: "CPF_2026_SPR2_FG",
    publishedTableNo: 5,
    residencyCategories: ["SPR2_FG"],
    effectiveFrom: "2026-01-01",
    effectiveTo: "2027-01-01",
    source: SOURCE_2026,
    effectiveFromBasis: "PUBLISHED",
    rows: {
      AGE_55_AND_BELOW: { employerOnlyBps: 1700, phaseInCoefficientBps: 4500, totalBps: 3200, employeeBps: 1500 },
      ABOVE_55_TO_60: { employerOnlyBps: 1600, phaseInCoefficientBps: 3750, totalBps: 2850, employeeBps: 1250 },
      ABOVE_60_TO_65: { employerOnlyBps: 1250, phaseInCoefficientBps: 2250, totalBps: 2000, employeeBps: 750 },
      ABOVE_65_TO_70: { employerOnlyBps: 900, phaseInCoefficientBps: 1500, totalBps: 1400, employeeBps: 500 },
      ABOVE_70: { employerOnlyBps: 750, phaseInCoefficientBps: 1500, totalBps: 1250, employeeBps: 500 },
    },
  },
  {
    id: "CPF_2027_SPR2_FG",
    publishedTableNo: 5,
    residencyCategories: ["SPR2_FG"],
    effectiveFrom: "2027-01-01",
    effectiveTo: null,
    source: SOURCE_2027,
    effectiveFromBasis: "PUBLISHED",
    rows: {
      AGE_55_AND_BELOW: { employerOnlyBps: 1700, phaseInCoefficientBps: 4500, totalBps: 3200, employeeBps: 1500 },
      ABOVE_55_TO_60: { employerOnlyBps: 1650, phaseInCoefficientBps: 3750, totalBps: 2900, employeeBps: 1250 },
      ABOVE_60_TO_65: { employerOnlyBps: 1300, phaseInCoefficientBps: 2250, totalBps: 2050, employeeBps: 750 },
      ABOVE_65_TO_70: { employerOnlyBps: 900, phaseInCoefficientBps: 1500, totalBps: 1400, employeeBps: 500 },
      ABOVE_70: { employerOnlyBps: 750, phaseInCoefficientBps: 1500, totalBps: 1250, employeeBps: 500 },
    },
  },
];
