import { SgRulesInputError } from "../errors.ts";
import { addMonths, dateLabel, formatMonth, monthIndex, monthLabel, parseDate, parseMonth } from "../internal/dates.ts";
import { CPF_AGE_BANDS, CPF_AGE_MILESTONES, type CpfAgeBand, type CpfResidencyCategory } from "../tables/cpf.ts";
import type { IsoDate, YearMonth } from "../types.ts";

/** SPR contribution option: G/G (default), F/G or F/F (joint application approved by CPF). */
export type SprOption = "GG" | "FG" | "FF";

export type CpfResidency =
  | { readonly status: "SC" }
  | {
      readonly status: "SPR";
      /** SPR status date (ICA Entry Permit). */
      readonly sprDate: IsoDate;
      /** Approved joint election. Store CPF's approval as data; never infer it. Default G/G. */
      readonly option?: SprOption;
      /** First contribution month the election applies to (CPF does not publish when it takes effect). */
      readonly optionFromMonth?: YearMonth;
    }
  | { readonly status: "FOREIGNER" };

/**
 * CPF age band for a contribution month: new rates apply from the first day of the month after
 * the month of the 55th/60th/65th/70th birthday. Month-based, so 29 Feb birthdays need nothing special.
 */
export function cpfAgeBand(birthDate: IsoDate, month: YearMonth): CpfAgeBand {
  const b = parseDate(birthDate, "birthDate");
  const wage = monthIndex(month);
  const passed = CPF_AGE_MILESTONES.years.filter((n) => wage > (b.y + n) * 12 + (b.m - 1)).length;
  return CPF_AGE_BANDS[passed] as CpfAgeBand;
}

/** The next month (after `month`) in which the employee moves to a higher age band, or null if already above 70. */
export function nextAgeBandChange(birthDate: IsoDate, month: YearMonth): { month: YearMonth; band: CpfAgeBand } | null {
  const b = parseDate(birthDate, "birthDate");
  const wage = monthIndex(month);
  for (const n of CPF_AGE_MILESTONES.years) {
    const change = (b.y + n) * 12 + (b.m - 1) + 1;
    if (change > wage) {
      const changeMonth = formatMonth(Math.floor(change / 12), (change % 12) + 1);
      return { month: changeMonth, band: cpfAgeBand(birthDate, changeMonth) };
    }
  }
  return null;
}

/**
 * SPR year for a contribution month. Year 1: SPR date to the last day of the month of the 1st
 * anniversary. Year 2: to the last day of the month of the 2nd anniversary. Year 3 onwards after that.
 * Returns null for months before the SPR month (not yet an SPR: no CPF).
 */
export function sprYear(sprDate: IsoDate, month: YearMonth): 1 | 2 | 3 | null {
  const s = parseDate(sprDate, "sprDate");
  const wage = monthIndex(month);
  const start = s.y * 12 + (s.m - 1);
  if (wage < start) return null;
  if (wage <= start + 12) return 1;
  if (wage <= start + 24) return 2;
  return 3;
}

export interface ResidencyResolution {
  readonly category: CpfResidencyCategory | "FOREIGNER";
  readonly sprYear: 1 | 2 | 3 | null;
  /** True in the month the SPR status starts (only OW from the SPR date and AW payable from it are liable). */
  readonly conversionMonth: boolean;
  readonly explanation: string;
}

export function resolveResidency(residency: CpfResidency, month: YearMonth): ResidencyResolution {
  parseMonth(month, "contributionMonth");
  switch (residency.status) {
    case "SC":
      return { category: "SC", sprYear: null, conversionMonth: false, explanation: "Singapore Citizen" };
    case "FOREIGNER":
      return { category: "FOREIGNER", sprYear: null, conversionMonth: false, explanation: "foreigner (not SC or SPR)" };
    case "SPR": {
      const year = sprYear(residency.sprDate, month);
      if (year === null) {
        return {
          category: "FOREIGNER",
          sprYear: null,
          conversionMonth: false,
          explanation: `not yet an SPR in ${monthLabel(month)} (SPR from ${dateLabel(residency.sprDate)})`,
        };
      }
      const conversionMonth = residency.sprDate.slice(0, 7) === month;
      if (year === 3) {
        return { category: "SPR3", sprYear: 3, conversionMonth, explanation: "SPR, 3rd year onwards (full rates)" };
      }
      if (residency.optionFromMonth !== undefined) parseMonth(residency.optionFromMonth, "optionFromMonth");
      const electionApplies =
        residency.option !== undefined &&
        residency.option !== "GG" &&
        (residency.optionFromMonth === undefined || monthIndex(month) >= monthIndex(residency.optionFromMonth));
      const option: SprOption = electionApplies ? (residency.option as SprOption) : "GG";
      const label = {
        GG: "graduated employer and employee (G/G)",
        FG: "full employer, graduated employee (F/G)",
        FF: "full employer and employee (F/F)",
      }[option];
      const yearEnd = addMonths(residency.sprDate.slice(0, 7), year * 12);
      return {
        category: `SPR${year}_${option}`,
        sprYear: year,
        conversionMonth,
        explanation: `SPR year ${year} (SPR from ${dateLabel(residency.sprDate)}; year ${year} runs to the end of ${monthLabel(yearEnd)}), ${label}`,
      };
    }
    default:
      throw new SgRulesInputError("Unknown residency status.");
  }
}
