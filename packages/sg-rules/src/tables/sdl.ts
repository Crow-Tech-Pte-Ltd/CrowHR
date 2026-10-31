/**
 * Skills Development Levy (Skills Development Levy Act 1979). Employer-only levy, collected by
 * the CPF Board with the CPF submission. Never deducted from the employee.
 * Intervals are [effectiveFrom, effectiveTo).
 */

import type { Effective } from "./effective.ts";

export interface SdlRate extends Effective {
  readonly administeredBy: string;
  /** 0.25% = 25 bps of total monthly wages (OW + AW, no CPF ceilings). */
  readonly rateBps: number;
  readonly minPerEmployeeCents: number;
  /** The minimum applies to an employee earning LESS than this. */
  readonly minAppliesBelowTotalWagesCents: number;
  readonly maxPerEmployeeCents: number;
  /** The maximum applies to an employee earning MORE than this. */
  readonly maxAppliesAboveTotalWagesCents: number;
}

const SSG_FAQ = "https://file.go.gov.sg/sdl-generic-faq.pdf";
const CPF_SDL = "https://www.cpf.gov.sg/employer/employer-obligations/skills-development-levy";

export const SDL_RATES: readonly SdlRate[] = [
  {
    // SSG Generic SDL FAQ A2–A3: "With effect from 1 October 2008, the SDL payable is at 0.25% of the
    // monthly wages for each employee, with the minimum payable of $2 (for an employee earning less
    // than $800 a month) and a maximum of $11.25 (for an employee earning more than $4,500 a month)."
    effectiveFrom: "2008-10-01",
    effectiveTo: "2026-07-01",
    administeredBy: "SkillsFuture Singapore (SSG)",
    rateBps: 25,
    minPerEmployeeCents: 200,
    minAppliesBelowTotalWagesCents: 80_000,
    maxPerEmployeeCents: 1_125,
    maxAppliesAboveTotalWagesCents: 450_000,
    source: SSG_FAQ,
    effectiveFromBasis: "PUBLISHED",
  },
  {
    // Same parameters; administration moved to the Skills and Workforce Development Agency (SWDA)
    // on 1 Jul 2026 (Act 17 of 2026). CPF still collects SDL. Values verified on CPF's SDL page.
    effectiveFrom: "2026-07-01",
    effectiveTo: null,
    administeredBy: "Skills and Workforce Development Agency (SWDA)",
    rateBps: 25,
    minPerEmployeeCents: 200,
    minAppliesBelowTotalWagesCents: 80_000,
    maxPerEmployeeCents: 1_125,
    maxAppliesAboveTotalWagesCents: 450_000,
    source: CPF_SDL,
    effectiveFromBasis: "PUBLISHED",
    verifiedOn: "2026-10-31",
  },
];

/**
 * Employees on whom SDL is not payable. Sources: SSG Generic SDL FAQ section C1
 * (https://file.go.gov.sg/sdl-generic-faq.pdf) and the Skills Development Levy (Exemption) Order 2014
 * (https://sso.agc.gov.sg/SL/SDLA1979-S258-2014). Being part-time or casual is NOT an exemption.
 */
export const SDL_EXEMPTIONS = {
  DOMESTIC_WORKER_OF_INDIVIDUAL:
    "Domestic servant, chauffeur or gardener wholly and exclusively employed by an individual otherwise than in connection with that individual's trade, business, profession or vocation.",
  NO_SERVICE_IN_SINGAPORE:
    "Rendered no services in Singapore in relation to the month (does not cover leave arising from employment in Singapore).",
  APPROVED_INSTITUTION_TRAINING:
    "Matriculated or registered student of ITE, a polytechnic or an autonomous university listed in the Exemption Order, employed for training approved by the institution.",
  OVERSEAS_TERTIARY_TRAINING:
    "Student of an overseas tertiary institution required to train in Singapore for not more than 6 months, with the institution's letter submitted to the levy authority.",
  SCHOOL_HOLIDAY_STUDENT:
    'Registered student of a school under the Education Act (not having completed "A" levels) employed during gazetted school holidays.',
} as const;

export type SdlExemption = keyof typeof SDL_EXEMPTIONS;

export const SDL_EXEMPTIONS_SOURCE = SSG_FAQ;

/**
 * SSG FAQ D4: if the employer neither pays nor is liable to pay wages for the period (e.g. a full
 * month of no-pay leave), no SDL is payable — the $2 minimum does not apply.
 */
export const SDL_NO_WAGES_SOURCE = SSG_FAQ;
