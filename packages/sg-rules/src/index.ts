/**
 * @crowhr/sg-rules — Singapore statutory rules.
 *
 * NOT IMPLEMENTED: this package is a skeleton. The `CountryRules` interface
 * below is a placeholder that the statutory-rules workstream will replace.
 * It deliberately contains no CPF/SDL/FWL/leave/overtime numbers: every
 * statutory constant added here must carry an effective date and a source URL
 * (AGENTS.md hard rule 3).
 *
 * Constraints for whoever fills this in:
 * - zero runtime dependencies, pure functions only (runs in Node and browser);
 * - money is integer cents (`number`, always a safe integer);
 * - rule tables are effective-dated so historical payroll can be recomputed.
 */

/** ISO 3166-1 alpha-2 country code. */
export type CountryCode = "SG";

/** An ISO calendar date, `YYYY-MM-DD`. */
export type IsoDate = string;

/**
 * NOT IMPLEMENTED: placeholder shape for a country's statutory rule set.
 * Only the identity fields exist; calculators (CPF, SDL, FWL, leave, OT)
 * will be added by the sg-rules workstream via an OpenSpec change.
 */
export interface CountryRules {
  readonly country: CountryCode;
  /** Human-readable name of the rule set, e.g. "Singapore". */
  readonly name: string;
  /** ISO 4217 currency code used for all amounts (integer minor units). */
  readonly currency: "SGD";
}

/** NOT IMPLEMENTED: identity only, no statutory calculators yet. */
export const singaporeRules: CountryRules = {
  country: "SG",
  name: "Singapore",
  currency: "SGD",
};
