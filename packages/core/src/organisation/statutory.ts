/**
 * Statutory lookups for the organisation and people modules. The cited values live in
 * `@crowhr/sg-rules` (`tables/registrations.ts`); this file re-exports them and keeps product rules.
 */
export {
  CSN_PAYMENT_TYPES,
  type CsnPaymentType,
  REST_DAYS_PER_WEEK,
  WORK_PASS_TYPES,
  type WorkPassType,
} from "@crowhr/sg-rules";

/** Passes expiring within this many days are surfaced to HR (spec: employees / Work passes). Product rule, not statutory. */
export const WORK_PASS_REMINDER_DAYS = 90;

// Minimum employment age and the default notice period live in @crowhr/sg-rules
// (`checkEmploymentAge`, `statutoryMinimumNotice`), cited to MOM.
