/**
 * Statutory lookups the organisation and people module needs. AGENTS.md
 * rule 3: every value carries an effective date and a source.
 *
 * These belong in `packages/sg-rules` (roadmap: "sg-rules lookups … the rest
 * are follow-ups for the sg-rules workstream"). They live here, cited, until
 * that workstream owns a home for them; the function signatures are what
 * sg-rules should export so the move is mechanical.
 */
import type { IsoDate } from "../employees/dates.ts";

/**
 * CPF Submission Number payment types. "The CSN is UEN (or NRIC/FIN) + payment
 * type + serial number, e.g. 234567891APTE01. Payment types are PTE
 * (mandatory), AMS, VCT and MSE."
 * Source: https://www.cpf.gov.sg/employer/making-cpf-contributions/applying-for-a-cpf-submission-number
 * (read 31 Oct 2026; research/sg-regulatory.md §9). Effective: in force on 2026-10-31.
 */
export const CSN_PAYMENT_TYPES = ["PTE", "AMS", "VCT", "MSE"] as const;
export type CsnPaymentType = (typeof CSN_PAYMENT_TYPES)[number];

/**
 * Rest days: "One unpaid rest day a week."
 * Source: https://www.mom.gov.sg/employment-practices/hours-of-work-overtime-and-rest-days
 * (read 31 Oct 2026; research/sg-regulatory.md §5.3). Strictly this is a Part 4
 * entitlement; Crow HR requires every fixed schedule to name one rest day
 * because leave and OT rules key off it for all staff.
 */
export const REST_DAYS_PER_WEEK = 1;

/**
 * Work pass types. Source: MOM pass pages summarised in
 * research/sg-regulatory.md §10 and §10.8 (read 31 Oct 2026).
 * EP https://www.mom.gov.sg/passes-and-permits/employment-pass/key-facts,
 * S Pass https://www.mom.gov.sg/passes-and-permits/s-pass/key-facts,
 * DP/LOC https://www.mom.gov.sg/passes-and-permits/loc-for-dependants-pass-business-owners,
 * LTVP/LOC https://www.mom.gov.sg/passes-and-permits/loc-for-ica-issued-ltvp-holders/eligibility,
 * PEP https://www.mom.gov.sg/passes-and-permits/personalised-employment-pass/eligibility,
 * ONE Pass https://www.mom.gov.sg/passes-and-permits/overseas-networks-expertise-pass/key-facts,
 * TEP https://www.mom.gov.sg/passes-and-permits/training-employment-pass/eligibility.
 * Work Permit: research/sg-regulatory.md §10.3.
 */
export const WORK_PASS_TYPES = [
  { code: "EP", label: "Employment Pass" },
  { code: "S_PASS", label: "S Pass" },
  { code: "WP", label: "Work Permit" },
  { code: "DP_LOC", label: "Dependant's Pass with LOC" },
  { code: "LTVP_LOC", label: "LTVP with LOC" },
  { code: "PEP", label: "Personalised Employment Pass" },
  { code: "ONE", label: "ONE Pass" },
  { code: "TEP", label: "Training Employment Pass" },
  { code: "OTHER", label: "Other" },
] as const;
export type WorkPassType = (typeof WORK_PASS_TYPES)[number]["code"];

/** Passes expiring within this many days are surfaced to HR (spec: employees / Work passes). Product rule, not statutory. */
export const WORK_PASS_REMINDER_DAYS = 90;

/**
 * Minimum employment age on a date.
 * NOT IMPLEMENTED: research/sg-regulatory.md does not cite the Employment Act
 * provisions on children and young persons, so no value is used and no hire is
 * refused for age. Returns null ("no rule available") until sg-rules cites it.
 */
export function minimumEmploymentAge(_onDate: IsoDate): number | null {
  return null;
}

/**
 * Statutory minimum notice period in days when the contract is silent.
 * NOT IMPLEMENTED: the EA s.10 notice table by length of service is not in
 * research/sg-regulatory.md. Callers must supply the contractual notice period;
 * there is no statutory fallback yet.
 */
export function statutoryNoticeDays(_serviceDays: number, _onDate: IsoDate): number | null {
  return null;
}
