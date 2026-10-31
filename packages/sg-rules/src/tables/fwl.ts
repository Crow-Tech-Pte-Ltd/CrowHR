/**
 * Foreign Worker Levy monthly rates (Employment of Foreign Manpower Act 1990 s 11), MOM.
 *
 * ESTIMATE ONLY. MOM bills the levy; its bill is authoritative (tier allocation depends on MOM's
 * own quota computation). The levy is borne by the employer and MUST NOT be deducted from salary
 * (EFMA s 25(6)(e), s 22A). Intervals are [effectiveFrom, effectiveTo).
 */

import type { Effective } from "./effective.ts";

export type FwlPass = "S_PASS" | "WORK_PERMIT";

export interface FwlRate extends Effective {
  readonly pass: FwlPass;
  readonly sector: string;
  readonly tier: string;
  readonly skill: string | null;
  readonly monthlyCents: number;
  /** MOM's published daily rate; must equal ceil(monthly × 12 / 365) (checked by test). */
  readonly publishedDailyCents: number;
}

/** "(Monthly levy rate x 12) / 365 = rounding up to the nearest cent", for part months. */
export const FWL_DAILY_RATE_SOURCE =
  "https://www.mom.gov.sg/passes-and-permits/work-permit-for-foreign-worker/sector-specific-rules/services-sector-requirements";

/** Rates in force on 31 Oct 2026. Rows whose start date MOM does not state use ENGINE_COVERAGE_START. */
export const FWL_RATES: readonly FwlRate[] = [
  {
    pass: "S_PASS",
    sector: "ALL",
    tier: "ALL",
    skill: null,
    monthlyCents: 65000,
    publishedDailyCents: 2137,
    effectiveFrom: "2025-09-01",
    effectiveTo: null,
    effectiveFromBasis: "PUBLISHED",
    verifiedOn: "2026-10-31",
    source: "https://www.mom.gov.sg/passes-and-permits/s-pass/quota-and-levy/levy-and-quota-requirements",
  },
  {
    pass: "WORK_PERMIT",
    sector: "SERVICES",
    tier: "TIER_1",
    skill: "HIGHER_SKILLED",
    monthlyCents: 30000,
    publishedDailyCents: 987,
    effectiveFrom: "2025-01-01",
    effectiveTo: null,
    effectiveFromBasis: "ENGINE_COVERAGE_START",
    verifiedOn: "2026-10-31",
    source:
      "https://www.mom.gov.sg/passes-and-permits/work-permit-for-foreign-worker/sector-specific-rules/services-sector-requirements",
  },
  {
    pass: "WORK_PERMIT",
    sector: "SERVICES",
    tier: "TIER_1",
    skill: "BASIC_SKILLED",
    monthlyCents: 45000,
    publishedDailyCents: 1480,
    effectiveFrom: "2025-01-01",
    effectiveTo: null,
    effectiveFromBasis: "ENGINE_COVERAGE_START",
    verifiedOn: "2026-10-31",
    source:
      "https://www.mom.gov.sg/passes-and-permits/work-permit-for-foreign-worker/sector-specific-rules/services-sector-requirements",
  },
  {
    pass: "WORK_PERMIT",
    sector: "SERVICES",
    tier: "TIER_2",
    skill: "HIGHER_SKILLED",
    monthlyCents: 40000,
    publishedDailyCents: 1316,
    effectiveFrom: "2025-01-01",
    effectiveTo: null,
    effectiveFromBasis: "ENGINE_COVERAGE_START",
    verifiedOn: "2026-10-31",
    source:
      "https://www.mom.gov.sg/passes-and-permits/work-permit-for-foreign-worker/sector-specific-rules/services-sector-requirements",
  },
  {
    pass: "WORK_PERMIT",
    sector: "SERVICES",
    tier: "TIER_2",
    skill: "BASIC_SKILLED",
    monthlyCents: 60000,
    publishedDailyCents: 1973,
    effectiveFrom: "2025-01-01",
    effectiveTo: null,
    effectiveFromBasis: "ENGINE_COVERAGE_START",
    verifiedOn: "2026-10-31",
    source:
      "https://www.mom.gov.sg/passes-and-permits/work-permit-for-foreign-worker/sector-specific-rules/services-sector-requirements",
  },
  {
    pass: "WORK_PERMIT",
    sector: "SERVICES",
    tier: "TIER_3",
    skill: "HIGHER_SKILLED",
    monthlyCents: 60000,
    publishedDailyCents: 1973,
    effectiveFrom: "2025-01-01",
    effectiveTo: null,
    effectiveFromBasis: "ENGINE_COVERAGE_START",
    verifiedOn: "2026-10-31",
    source:
      "https://www.mom.gov.sg/passes-and-permits/work-permit-for-foreign-worker/sector-specific-rules/services-sector-requirements",
  },
  {
    pass: "WORK_PERMIT",
    sector: "SERVICES",
    tier: "TIER_3",
    skill: "BASIC_SKILLED",
    monthlyCents: 80000,
    publishedDailyCents: 2631,
    effectiveFrom: "2025-01-01",
    effectiveTo: null,
    effectiveFromBasis: "ENGINE_COVERAGE_START",
    verifiedOn: "2026-10-31",
    source:
      "https://www.mom.gov.sg/passes-and-permits/work-permit-for-foreign-worker/sector-specific-rules/services-sector-requirements",
  },
  {
    pass: "WORK_PERMIT",
    sector: "MANUFACTURING",
    tier: "TIER_1",
    skill: "HIGHER_SKILLED",
    monthlyCents: 25000,
    publishedDailyCents: 822,
    effectiveFrom: "2025-01-01",
    effectiveTo: null,
    effectiveFromBasis: "ENGINE_COVERAGE_START",
    verifiedOn: "2026-10-31",
    source:
      "https://www.mom.gov.sg/passes-and-permits/work-permit-for-foreign-worker/sector-specific-rules/manufacturing-sector-requirements",
  },
  {
    pass: "WORK_PERMIT",
    sector: "MANUFACTURING",
    tier: "TIER_1",
    skill: "BASIC_SKILLED",
    monthlyCents: 37000,
    publishedDailyCents: 1217,
    effectiveFrom: "2025-01-01",
    effectiveTo: null,
    effectiveFromBasis: "ENGINE_COVERAGE_START",
    verifiedOn: "2026-10-31",
    source:
      "https://www.mom.gov.sg/passes-and-permits/work-permit-for-foreign-worker/sector-specific-rules/manufacturing-sector-requirements",
  },
  {
    pass: "WORK_PERMIT",
    sector: "MANUFACTURING",
    tier: "TIER_2",
    skill: "HIGHER_SKILLED",
    monthlyCents: 35000,
    publishedDailyCents: 1151,
    effectiveFrom: "2025-01-01",
    effectiveTo: null,
    effectiveFromBasis: "ENGINE_COVERAGE_START",
    verifiedOn: "2026-10-31",
    source:
      "https://www.mom.gov.sg/passes-and-permits/work-permit-for-foreign-worker/sector-specific-rules/manufacturing-sector-requirements",
  },
  {
    pass: "WORK_PERMIT",
    sector: "MANUFACTURING",
    tier: "TIER_2",
    skill: "BASIC_SKILLED",
    monthlyCents: 47000,
    publishedDailyCents: 1546,
    effectiveFrom: "2025-01-01",
    effectiveTo: null,
    effectiveFromBasis: "ENGINE_COVERAGE_START",
    verifiedOn: "2026-10-31",
    source:
      "https://www.mom.gov.sg/passes-and-permits/work-permit-for-foreign-worker/sector-specific-rules/manufacturing-sector-requirements",
  },
  {
    pass: "WORK_PERMIT",
    sector: "MANUFACTURING",
    tier: "TIER_3",
    skill: "HIGHER_SKILLED",
    monthlyCents: 55000,
    publishedDailyCents: 1809,
    effectiveFrom: "2025-01-01",
    effectiveTo: null,
    effectiveFromBasis: "ENGINE_COVERAGE_START",
    verifiedOn: "2026-10-31",
    source:
      "https://www.mom.gov.sg/passes-and-permits/work-permit-for-foreign-worker/sector-specific-rules/manufacturing-sector-requirements",
  },
  {
    pass: "WORK_PERMIT",
    sector: "MANUFACTURING",
    tier: "TIER_3",
    skill: "BASIC_SKILLED",
    monthlyCents: 65000,
    publishedDailyCents: 2137,
    effectiveFrom: "2025-01-01",
    effectiveTo: null,
    effectiveFromBasis: "ENGINE_COVERAGE_START",
    verifiedOn: "2026-10-31",
    source:
      "https://www.mom.gov.sg/passes-and-permits/work-permit-for-foreign-worker/sector-specific-rules/manufacturing-sector-requirements",
  },
  {
    pass: "WORK_PERMIT",
    sector: "CONSTRUCTION",
    tier: "MYS_NAS_PRC",
    skill: "HIGHER_SKILLED",
    monthlyCents: 30000,
    publishedDailyCents: 987,
    effectiveFrom: "2024-01-01",
    effectiveTo: null,
    effectiveFromBasis: "PUBLISHED",
    verifiedOn: "2026-10-31",
    source:
      "https://www.mom.gov.sg/passes-and-permits/work-permit-for-foreign-worker/sector-specific-rules/construction-sector-requirements",
  },
  {
    pass: "WORK_PERMIT",
    sector: "CONSTRUCTION",
    tier: "MYS_NAS_PRC",
    skill: "BASIC_SKILLED",
    monthlyCents: 70000,
    publishedDailyCents: 2302,
    effectiveFrom: "2024-01-01",
    effectiveTo: null,
    effectiveFromBasis: "PUBLISHED",
    verifiedOn: "2026-10-31",
    source:
      "https://www.mom.gov.sg/passes-and-permits/work-permit-for-foreign-worker/sector-specific-rules/construction-sector-requirements",
  },
  {
    pass: "WORK_PERMIT",
    sector: "CONSTRUCTION",
    tier: "NTS",
    skill: "HIGHER_SKILLED",
    monthlyCents: 50000,
    publishedDailyCents: 1644,
    effectiveFrom: "2024-01-01",
    effectiveTo: null,
    effectiveFromBasis: "PUBLISHED",
    verifiedOn: "2026-10-31",
    source:
      "https://www.mom.gov.sg/passes-and-permits/work-permit-for-foreign-worker/sector-specific-rules/construction-sector-requirements",
  },
  {
    pass: "WORK_PERMIT",
    sector: "CONSTRUCTION",
    tier: "NTS",
    skill: "BASIC_SKILLED",
    monthlyCents: 90000,
    publishedDailyCents: 2959,
    effectiveFrom: "2024-01-01",
    effectiveTo: null,
    effectiveFromBasis: "PUBLISHED",
    verifiedOn: "2026-10-31",
    source:
      "https://www.mom.gov.sg/passes-and-permits/work-permit-for-foreign-worker/sector-specific-rules/construction-sector-requirements",
  },
  {
    pass: "WORK_PERMIT",
    sector: "CONSTRUCTION",
    tier: "OFFSITE_CONSTRUCTION",
    skill: "HIGHER_SKILLED",
    monthlyCents: 25000,
    publishedDailyCents: 822,
    effectiveFrom: "2024-01-01",
    effectiveTo: null,
    effectiveFromBasis: "PUBLISHED",
    verifiedOn: "2026-10-31",
    source:
      "https://www.mom.gov.sg/passes-and-permits/work-permit-for-foreign-worker/sector-specific-rules/construction-sector-requirements",
  },
  {
    pass: "WORK_PERMIT",
    sector: "CONSTRUCTION",
    tier: "OFFSITE_CONSTRUCTION",
    skill: "BASIC_SKILLED",
    monthlyCents: 37000,
    publishedDailyCents: 1217,
    effectiveFrom: "2024-01-01",
    effectiveTo: null,
    effectiveFromBasis: "PUBLISHED",
    verifiedOn: "2026-10-31",
    source:
      "https://www.mom.gov.sg/passes-and-permits/work-permit-for-foreign-worker/sector-specific-rules/construction-sector-requirements",
  },
  {
    pass: "WORK_PERMIT",
    sector: "CONSTRUCTION",
    tier: "ANY_SOURCE",
    skill: "UNSKILLED_NO_CERTIFICATION",
    monthlyCents: 90000,
    publishedDailyCents: 2959,
    effectiveFrom: "2025-01-01",
    effectiveTo: null,
    effectiveFromBasis: "ENGINE_COVERAGE_START",
    verifiedOn: "2026-10-31",
    source:
      "https://www.mom.gov.sg/passes-and-permits/work-permit-for-foreign-worker/sector-specific-rules/construction-sector-requirements",
  },
  {
    pass: "WORK_PERMIT",
    sector: "PROCESS",
    tier: "MYS_NAS_PRC",
    skill: "HIGHER_SKILLED",
    monthlyCents: 20000,
    publishedDailyCents: 658,
    effectiveFrom: "2025-01-01",
    effectiveTo: null,
    effectiveFromBasis: "ENGINE_COVERAGE_START",
    verifiedOn: "2026-10-31",
    source:
      "https://www.mom.gov.sg/passes-and-permits/work-permit-for-foreign-worker/sector-specific-rules/process-sector-requirements",
  },
  {
    pass: "WORK_PERMIT",
    sector: "PROCESS",
    tier: "MYS_NAS_PRC",
    skill: "BASIC_SKILLED",
    monthlyCents: 45000,
    publishedDailyCents: 1480,
    effectiveFrom: "2025-01-01",
    effectiveTo: null,
    effectiveFromBasis: "ENGINE_COVERAGE_START",
    verifiedOn: "2026-10-31",
    source:
      "https://www.mom.gov.sg/passes-and-permits/work-permit-for-foreign-worker/sector-specific-rules/process-sector-requirements",
  },
  {
    pass: "WORK_PERMIT",
    sector: "PROCESS",
    tier: "NTS",
    skill: "HIGHER_SKILLED",
    monthlyCents: 30000,
    publishedDailyCents: 987,
    effectiveFrom: "2025-01-01",
    effectiveTo: null,
    effectiveFromBasis: "ENGINE_COVERAGE_START",
    verifiedOn: "2026-10-31",
    source:
      "https://www.mom.gov.sg/passes-and-permits/work-permit-for-foreign-worker/sector-specific-rules/process-sector-requirements",
  },
  {
    pass: "WORK_PERMIT",
    sector: "PROCESS",
    tier: "NTS",
    skill: "BASIC_SKILLED",
    monthlyCents: 65000,
    publishedDailyCents: 2137,
    effectiveFrom: "2025-01-01",
    effectiveTo: null,
    effectiveFromBasis: "ENGINE_COVERAGE_START",
    verifiedOn: "2026-10-31",
    source:
      "https://www.mom.gov.sg/passes-and-permits/work-permit-for-foreign-worker/sector-specific-rules/process-sector-requirements",
  },
  {
    pass: "WORK_PERMIT",
    sector: "MARINE_SHIPYARD",
    tier: "ALL",
    skill: "HIGHER_SKILLED",
    monthlyCents: 35000,
    publishedDailyCents: 1151,
    effectiveFrom: "2025-01-01",
    effectiveTo: null,
    effectiveFromBasis: "ENGINE_COVERAGE_START",
    verifiedOn: "2026-10-31",
    source:
      "https://www.mom.gov.sg/passes-and-permits/work-permit-for-foreign-worker/sector-specific-rules/marine-sector-requirements",
  },
  {
    pass: "WORK_PERMIT",
    sector: "MARINE_SHIPYARD",
    tier: "ALL",
    skill: "BASIC_SKILLED",
    monthlyCents: 50000,
    publishedDailyCents: 1644,
    effectiveFrom: "2025-01-01",
    effectiveTo: null,
    effectiveFromBasis: "ENGINE_COVERAGE_START",
    verifiedOn: "2026-10-31",
    source:
      "https://www.mom.gov.sg/passes-and-permits/work-permit-for-foreign-worker/sector-specific-rules/marine-sector-requirements",
  },
];

export interface FwlAnnouncedRate {
  readonly pass: FwlPass;
  readonly sector: string;
  readonly tier: string;
  readonly skill: string | null;
  readonly monthlyCents: number;
  readonly source: string;
}

/**
 * Announced in COS 2026 "from 2028" with no implementation date. Recorded for reference and
 * NEVER applied: https://www.mom.gov.sg/-/media/mom/documents/press-releases/2026/factsheet-on-foreign-workforce-policies-03032026.pdf
 */
export const FWL_ANNOUNCED_DATE_TBA: readonly FwlAnnouncedRate[] = [
  {
    pass: "WORK_PERMIT",
    sector: "SERVICES",
    tier: "TIER_1_MERGED",
    skill: "HIGHER_SKILLED",
    monthlyCents: 40000,
    source:
      "https://www.mom.gov.sg/passes-and-permits/work-permit-for-foreign-worker/sector-specific-rules/services-sector-requirements",
  },
  {
    pass: "WORK_PERMIT",
    sector: "SERVICES",
    tier: "TIER_1_MERGED",
    skill: "BASIC_SKILLED",
    monthlyCents: 60000,
    source:
      "https://www.mom.gov.sg/passes-and-permits/work-permit-for-foreign-worker/sector-specific-rules/services-sector-requirements",
  },
  {
    pass: "WORK_PERMIT",
    sector: "SERVICES",
    tier: "TIER_2",
    skill: "HIGHER_SKILLED",
    monthlyCents: 60000,
    source:
      "https://www.mom.gov.sg/passes-and-permits/work-permit-for-foreign-worker/sector-specific-rules/services-sector-requirements",
  },
  {
    pass: "WORK_PERMIT",
    sector: "SERVICES",
    tier: "TIER_2",
    skill: "BASIC_SKILLED",
    monthlyCents: 80000,
    source:
      "https://www.mom.gov.sg/passes-and-permits/work-permit-for-foreign-worker/sector-specific-rules/services-sector-requirements",
  },
  {
    pass: "WORK_PERMIT",
    sector: "MANUFACTURING",
    tier: "TIER_1_MERGED",
    skill: "HIGHER_SKILLED",
    monthlyCents: 30000,
    source:
      "https://www.mom.gov.sg/passes-and-permits/work-permit-for-foreign-worker/sector-specific-rules/manufacturing-sector-requirements",
  },
  {
    pass: "WORK_PERMIT",
    sector: "MANUFACTURING",
    tier: "TIER_1_MERGED",
    skill: "BASIC_SKILLED",
    monthlyCents: 47000,
    source:
      "https://www.mom.gov.sg/passes-and-permits/work-permit-for-foreign-worker/sector-specific-rules/manufacturing-sector-requirements",
  },
  {
    pass: "WORK_PERMIT",
    sector: "MANUFACTURING",
    tier: "TIER_2",
    skill: "HIGHER_SKILLED",
    monthlyCents: 55000,
    source:
      "https://www.mom.gov.sg/passes-and-permits/work-permit-for-foreign-worker/sector-specific-rules/manufacturing-sector-requirements",
  },
  {
    pass: "WORK_PERMIT",
    sector: "MANUFACTURING",
    tier: "TIER_2",
    skill: "BASIC_SKILLED",
    monthlyCents: 65000,
    source:
      "https://www.mom.gov.sg/passes-and-permits/work-permit-for-foreign-worker/sector-specific-rules/manufacturing-sector-requirements",
  },
  {
    pass: "WORK_PERMIT",
    sector: "PROCESS",
    tier: "MYS_NAS_PRC",
    skill: "BASIC_SKILLED",
    monthlyCents: 60000,
    source:
      "https://www.mom.gov.sg/passes-and-permits/work-permit-for-foreign-worker/sector-specific-rules/process-sector-requirements",
  },
  {
    pass: "WORK_PERMIT",
    sector: "PROCESS",
    tier: "NTS",
    skill: "BASIC_SKILLED",
    monthlyCents: 80000,
    source:
      "https://www.mom.gov.sg/passes-and-permits/work-permit-for-foreign-worker/sector-specific-rules/process-sector-requirements",
  },
  {
    pass: "WORK_PERMIT",
    sector: "MARINE_SHIPYARD",
    tier: "ALL",
    skill: "BASIC_SKILLED",
    monthlyCents: 60000,
    source:
      "https://www.mom.gov.sg/passes-and-permits/work-permit-for-foreign-worker/sector-specific-rules/marine-sector-requirements",
  },
];
