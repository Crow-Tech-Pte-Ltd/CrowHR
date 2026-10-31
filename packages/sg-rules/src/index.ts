/**
 * @crowhr/sg-rules — Singapore statutory rules.
 *
 * Pure, zero-runtime-dependency calculators over effective-dated, cited rule tables:
 * CPF, SDL, SHG funds, Employment Act pay helpers, leave entitlements, public holidays and an FWL
 * cost estimate. Money is integer cents; intermediate values are exact rationals; every rounding is
 * named and happens where the regulator prescribes. Every result carries a human-readable `working`.
 */

export type {
  CountryCode,
  CountryRules,
  EmployeeMonthOutcome,
  EmployerMonthOutcome,
  StatutoryLine,
} from "./country.ts";
export * from "./cpf/index.ts";
export * from "./employment-act/leave.ts";
export * from "./employment-act/overtime.ts";
export * from "./employment-act/public-holidays.ts";
export {
  dailyRate,
  hourlyBasicRate,
  isPart4Covered,
  type Part4Input,
  type Part4Result,
  type RateResult,
} from "./employment-act/rates.ts";
export * from "./employment-act/salary.ts";
export { RulesNotAvailableError, SgRulesInputError } from "./errors.ts";
export * from "./fwl.ts";
export {
  type ExactCents,
  exactDollarsText,
  exactToString,
  floorToDollar,
  roundHalfUpToCent,
  roundHalfUpToDollar,
} from "./internal/exact.ts";
export * from "./sdl.ts";
export * from "./shg.ts";
export { type SgEmployeeMonthInput, type SgEmployeeMonthOutcome, singaporeRules } from "./singapore.ts";
export type {
  CpfAgeBand,
  CpfAgeRow,
  CpfRateTable,
  CpfResidencyCategory,
  CpfWageBandThresholds,
} from "./tables/cpf.ts";
export { CPF_RATE_TABLES, CPF_RATES_PUBLISHED_UNTIL } from "./tables/cpf.ts";
export { type Effective, ENGINE_COVERAGE_START, effectiveRangeIssues, RULES_VERIFIED_ON } from "./tables/effective.ts";
export { cpfTableFor, publicHolidaysFor, resolveRules, type SgRuleSet, shgTableFor } from "./tables/index.ts";
export type { PublicHoliday, PublicHolidayYear } from "./tables/public-holidays.ts";
export { SDL_EXEMPTIONS, type SdlExemption, type SdlRate } from "./tables/sdl.ts";
export type { ShgFund, ShgTable } from "./tables/shg.ts";
export type { Cents, IsoDate, IssueSeverity, RuleIssue, WorkingStep, YearMonth } from "./types.ts";
