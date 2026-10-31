/** Parental, childcare, infant-care and part-time leave rules (WS5 leave module). */
export * from "./childcare.ts";
export * from "./parental.ts";
export * from "./part-time.ts";
export {
  ADOPTION_RULES,
  type AdoptionRule,
  CHILDCARE_RULES,
  type ChildcareRule,
  EA_MATERNITY_RULES,
  type FundingRule,
  GPML_RULES,
  INFANT_CARE_LIFETIME_DAYS_PER_CHILD,
  INFANT_CARE_RULES,
  type InfantCareRule,
  LEAVE_HISTORY_START,
  type MaternityRule,
  NDR_2026_CHILDCARE,
  PATERNITY_RULES,
  PATERNITY_STILLBIRTH_WEEKS,
  type PaternityRule,
  SHARED_PARENTAL_RULES,
  type SharedParentalRule,
  SOURCES as LEAVE_SOURCES,
} from "./tables.ts";
