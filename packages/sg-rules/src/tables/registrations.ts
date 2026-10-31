/**
 * Statutory lookups the organisation and people modules need (moved from core's
 * `organisation/statutory.ts`). Read 31 Oct 2026; research/sg-regulatory.md §§5.3, 9, 10.
 */

/**
 * CPF Submission Number payment types: "The CSN is UEN (or NRIC/FIN) + payment type + serial number,
 * e.g. 234567891APTE01. Payment types are PTE (mandatory), AMS, VCT and MSE."
 */
export const CSN_SOURCE =
  "https://www.cpf.gov.sg/employer/making-cpf-contributions/applying-for-a-cpf-submission-number";
export const CSN_PAYMENT_TYPES = ["PTE", "AMS", "VCT", "MSE"] as const;
export type CsnPaymentType = (typeof CSN_PAYMENT_TYPES)[number];

/**
 * Rest days: "One unpaid rest day a week" (MOM; Employment Act Part 4). Crow HR requires every fixed
 * schedule to name one rest day because leave and OT rules key off it for all staff.
 */
export const REST_DAY_SOURCE = "https://www.mom.gov.sg/employment-practices/hours-of-work-overtime-and-rest-days";
export const REST_DAYS_PER_WEEK = 1;

/**
 * Work pass types, from MOM's pass pages: EP, S Pass, Work Permit, Dependant's Pass and LTVP with a
 * Letter of Consent, PEP, ONE Pass and TEP.
 */
export const WORK_PASS_SOURCES = {
  EP: "https://www.mom.gov.sg/passes-and-permits/employment-pass/key-facts",
  S_PASS: "https://www.mom.gov.sg/passes-and-permits/s-pass/key-facts",
  WP: "https://www.mom.gov.sg/passes-and-permits/work-permit-for-foreign-worker",
  DP_LOC: "https://www.mom.gov.sg/passes-and-permits/loc-for-dependants-pass-business-owners",
  LTVP_LOC: "https://www.mom.gov.sg/passes-and-permits/loc-for-ica-issued-ltvp-holders/eligibility",
  PEP: "https://www.mom.gov.sg/passes-and-permits/personalised-employment-pass/eligibility",
  ONE: "https://www.mom.gov.sg/passes-and-permits/overseas-networks-expertise-pass/key-facts",
  TEP: "https://www.mom.gov.sg/passes-and-permits/training-employment-pass/eligibility",
} as const;

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
