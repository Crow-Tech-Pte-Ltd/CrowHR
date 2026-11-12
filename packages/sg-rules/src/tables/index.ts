import { parseDate } from "../internal/dates.ts";
import type { IsoDate } from "../types.ts";
import {
  CPF_ANNUAL_SALARY_CEILINGS,
  CPF_OW_CEILINGS,
  CPF_RATE_TABLES,
  CPF_RATES_PUBLISHED_UNTIL,
  type CpfAnnualSalaryCeiling,
  type CpfOwCeiling,
  type CpfRateTable,
  type CpfResidencyCategory,
} from "./cpf.ts";
import { type Effective, pickInForce } from "./effective.ts";
import { OVERTIME_RULES, type OvertimeRule, PART4_COVERAGE, type Part4Coverage } from "./employment-act.ts";
import { MINIMUM_AGE_RULES, NOTICE_RULES } from "./employment-terms.ts";
import { APPENDIX_8A_RULES, APPENDIX_8B_RULES } from "./iras-appendices.ts";
import { ANNUAL_LEAVE_RULES, type AnnualLeaveRule, SICK_LEAVE_RULES, type SickLeaveRule } from "./leave.ts";
import { PUBLIC_HOLIDAY_YEARS, type PublicHolidayYear } from "./public-holidays.ts";
import { DEDUCTION_LIMIT_RULES, PAYMENT_DEADLINE_RULES } from "./salary-payment.ts";
import { SDL_RATES, type SdlRate } from "./sdl.ts";
import { SHG_TABLES, type ShgFund, type ShgTable } from "./shg.ts";

export const CPF_RESIDENCY_CATEGORIES: readonly CpfResidencyCategory[] = [
  "SC",
  "SPR1_GG",
  "SPR1_FG",
  "SPR1_FF",
  "SPR2_GG",
  "SPR2_FG",
  "SPR2_FF",
  "SPR3",
];

export const SHG_FUNDS: readonly ShgFund[] = ["CDAC", "ECF", "MBMF", "SINDA"];

/** Every rule version in force on one date. */
export interface SgRuleSet {
  readonly date: IsoDate;
  readonly cpf: {
    readonly owCeiling: CpfOwCeiling;
    readonly annualSalaryCeiling: CpfAnnualSalaryCeiling;
    readonly tables: Readonly<Record<CpfResidencyCategory, CpfRateTable>>;
    /** True when `date` is after the last published CPF tables and they are carried forward. */
    readonly ratesAssumedCarriedForward: boolean;
  };
  readonly sdl: SdlRate;
  readonly shg: Readonly<Record<ShgFund, ShgTable>>;
  readonly employmentAct: { readonly part4: Part4Coverage; readonly overtime: OvertimeRule };
  readonly leave: { readonly annual: AnnualLeaveRule; readonly sick: SickLeaveRule };
  /** Gazetted holidays for the year of `date`, or null when MOM has not published them yet. */
  readonly publicHolidays: PublicHolidayYear | null;
}

export function cpfTableFor(category: CpfResidencyCategory, date: IsoDate): CpfRateTable {
  return pickInForce(
    CPF_RATE_TABLES.filter((t) => t.residencyCategories.includes(category)),
    date,
    `CPF rate table (${category})`,
  );
}

export function shgTableFor(fund: ShgFund, date: IsoDate): ShgTable {
  return pickInForce(
    SHG_TABLES.filter((t) => t.fund === fund),
    date,
    `${fund} contribution table`,
  );
}

export function publicHolidaysFor(year: number): PublicHolidayYear | null {
  return PUBLIC_HOLIDAY_YEARS.find((y) => y.year === year) ?? null;
}

/**
 * Picks the version of every rule family in force on `date`.
 * Throws `RulesNotAvailableError` if any mandatory family has no row for the date.
 */
export function resolveRules(date: IsoDate): SgRuleSet {
  const { y } = parseDate(date, "rules date");
  const tables = Object.fromEntries(CPF_RESIDENCY_CATEGORIES.map((c) => [c, cpfTableFor(c, date)])) as Record<
    CpfResidencyCategory,
    CpfRateTable
  >;
  const shg = Object.fromEntries(SHG_FUNDS.map((f) => [f, shgTableFor(f, date)])) as Record<ShgFund, ShgTable>;
  return {
    date,
    cpf: {
      owCeiling: pickInForce(CPF_OW_CEILINGS, date, "CPF OW ceiling"),
      annualSalaryCeiling: pickInForce(CPF_ANNUAL_SALARY_CEILINGS, date, "CPF Annual Salary Ceiling"),
      tables,
      ratesAssumedCarriedForward: date >= CPF_RATES_PUBLISHED_UNTIL,
    },
    sdl: pickInForce(SDL_RATES, date, "SDL"),
    shg,
    employmentAct: {
      part4: pickInForce(PART4_COVERAGE, date, "Employment Act Part 4 coverage"),
      overtime: pickInForce(OVERTIME_RULES, date, "Employment Act overtime"),
    },
    leave: {
      annual: pickInForce(ANNUAL_LEAVE_RULES, date, "annual leave"),
      sick: pickInForce(SICK_LEAVE_RULES, date, "sick leave"),
    },
    publicHolidays: publicHolidaysFor(y),
  };
}

/** Every family of alternative rows, for the data-integrity test. */
export function ruleFamilies(): { family: string; rows: readonly Effective[]; mandatory: boolean }[] {
  return [
    ...CPF_RESIDENCY_CATEGORIES.map((c) => ({
      family: `CPF rate table ${c}`,
      rows: CPF_RATE_TABLES.filter((t) => t.residencyCategories.includes(c)),
      mandatory: true,
    })),
    { family: "CPF OW ceiling", rows: CPF_OW_CEILINGS, mandatory: true },
    { family: "CPF Annual Salary Ceiling", rows: CPF_ANNUAL_SALARY_CEILINGS, mandatory: true },
    { family: "SDL", rows: SDL_RATES, mandatory: true },
    ...SHG_FUNDS.map((f) => ({ family: `SHG ${f}`, rows: SHG_TABLES.filter((t) => t.fund === f), mandatory: true })),
    { family: "EA Part 4 coverage", rows: PART4_COVERAGE, mandatory: true },
    { family: "EA overtime", rows: OVERTIME_RULES, mandatory: true },
    { family: "Annual leave", rows: ANNUAL_LEAVE_RULES, mandatory: true },
    { family: "Sick leave", rows: SICK_LEAVE_RULES, mandatory: true },
    { family: "EA default notice", rows: NOTICE_RULES, mandatory: true },
    { family: "EA minimum age", rows: MINIMUM_AGE_RULES, mandatory: true },
    { family: "EA salary payment deadlines", rows: PAYMENT_DEADLINE_RULES, mandatory: true },
    { family: "EA deduction limits", rows: DEDUCTION_LIMIT_RULES, mandatory: true },
    { family: "IRAS Appendix 8A", rows: APPENDIX_8A_RULES, mandatory: true },
    { family: "IRAS Appendix 8B", rows: APPENDIX_8B_RULES, mandatory: true },
  ];
}
