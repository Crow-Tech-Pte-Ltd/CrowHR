/**
 * Self-Help Group fund contribution tables (CPF Act: Contribution to Community Fund rules).
 * Deducted from the employee's wages (unless opted out) and paid with the CPF submission.
 * Band rule: the amount of the first band whose `upToInclusiveCents` ≥ total wages for the month
 * (OW + AW, no CPF ceilings); `null` = no upper limit. Intervals are [effectiveFrom, effectiveTo).
 */

import { type Effective, ENGINE_COVERAGE_START } from "./effective.ts";

export type ShgFund = "CDAC" | "ECF" | "MBMF" | "SINDA";

export interface ShgBand {
  readonly upToInclusiveCents: number | null;
  readonly amountCents: number;
}

export interface ShgTable extends Effective {
  readonly fund: ShgFund;
  /** CPF EZPay payment code. */
  readonly cpfPaymentCode: string;
  readonly bands: readonly ShgBand[];
}

const CPF_SHG = "https://www.cpf.gov.sg/employer/employer-obligations/contributions-to-self-help-groups";

export const SHG_TABLES: readonly ShgTable[] = [
  {
    fund: "CDAC",
    cpfPaymentCode: "04",
    // CPF does not publish the start date of the current CDAC table; amounts verified current.
    effectiveFrom: ENGINE_COVERAGE_START,
    effectiveTo: null,
    effectiveFromBasis: "ENGINE_COVERAGE_START",
    verifiedOn: "2026-10-31",
    source: CPF_SHG,
    bands: [
      { upToInclusiveCents: 200_000, amountCents: 50 },
      { upToInclusiveCents: 350_000, amountCents: 100 },
      { upToInclusiveCents: 500_000, amountCents: 150 },
      { upToInclusiveCents: 750_000, amountCents: 200 },
      { upToInclusiveCents: null, amountCents: 300 },
    ],
  },
  {
    fund: "ECF",
    cpfPaymentCode: "05",
    effectiveFrom: ENGINE_COVERAGE_START,
    effectiveTo: null,
    effectiveFromBasis: "ENGINE_COVERAGE_START",
    verifiedOn: "2026-10-31",
    source: CPF_SHG,
    bands: [
      { upToInclusiveCents: 100_000, amountCents: 200 },
      { upToInclusiveCents: 150_000, amountCents: 400 },
      { upToInclusiveCents: 250_000, amountCents: 600 },
      { upToInclusiveCents: 400_000, amountCents: 900 },
      { upToInclusiveCents: 700_000, amountCents: 1_200 },
      { upToInclusiveCents: 1_000_000, amountCents: 1_600 },
      { upToInclusiveCents: null, amountCents: 2_000 },
    ],
  },
  {
    fund: "MBMF",
    cpfPaymentCode: "02",
    // MUIS: table effective for wages earned from 1 Jun 2016.
    // https://www.muis.gov.sg/give-back/mbmf/employer-information/
    effectiveFrom: "2016-06-01",
    effectiveTo: null,
    effectiveFromBasis: "PUBLISHED",
    verifiedOn: "2026-10-31",
    source: CPF_SHG,
    bands: [
      { upToInclusiveCents: 100_000, amountCents: 300 },
      { upToInclusiveCents: 200_000, amountCents: 450 },
      { upToInclusiveCents: 300_000, amountCents: 650 },
      { upToInclusiveCents: 400_000, amountCents: 1_500 },
      { upToInclusiveCents: 600_000, amountCents: 1_950 },
      { upToInclusiveCents: 800_000, amountCents: 2_200 },
      { upToInclusiveCents: 1_000_000, amountCents: 2_400 },
      { upToInclusiveCents: null, amountCents: 2_600 },
    ],
  },
  {
    fund: "SINDA",
    cpfPaymentCode: "03",
    effectiveFrom: ENGINE_COVERAGE_START,
    effectiveTo: null,
    effectiveFromBasis: "ENGINE_COVERAGE_START",
    verifiedOn: "2026-10-31",
    source: CPF_SHG,
    bands: [
      { upToInclusiveCents: 100_000, amountCents: 100 },
      { upToInclusiveCents: 150_000, amountCents: 300 },
      { upToInclusiveCents: 250_000, amountCents: 500 },
      { upToInclusiveCents: 450_000, amountCents: 700 },
      { upToInclusiveCents: 750_000, amountCents: 900 },
      { upToInclusiveCents: 1_000_000, amountCents: 1_200 },
      { upToInclusiveCents: 1_500_000, amountCents: 1_800 },
      { upToInclusiveCents: null, amountCents: 3_000 },
    ],
  },
];

/** Fund determination rules (race on NRIC, first race of a double-barrelled race, MBMF by religion). */
export const SHG_DETERMINATION_SOURCE =
  "https://www.cpf.gov.sg/service/article/how-do-i-determine-which-self-help-group-shg-my-employee-should-contribute-to";

/**
 * Groups SINDA treats as of Indian descent ("includes Bangladeshis, Bengalis, Parsees, Sikhs,
 * Sinhalese, Telegus, Pakistanis, Sri Lankans, Goanese, Malayalees, Punjabis, Tamils, Gujaratis,
 * Sindhis and all people from the Indian sub-continent"). Source: CPF SHG page (above).
 */
export const SINDA_INDIAN_DESCENT_RACES: readonly string[] = [
  "INDIAN",
  "BANGLADESHI",
  "BENGALI",
  "PARSEE",
  "SIKH",
  "SINHALESE",
  "TELEGU",
  "PAKISTANI",
  "SRI LANKAN",
  "GOANESE",
  "MALAYALEE",
  "PUNJABI",
  "TAMIL",
  "GUJARATI",
  "SINDHI",
];
