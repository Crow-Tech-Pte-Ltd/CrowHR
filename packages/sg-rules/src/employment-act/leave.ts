import { SgRulesInputError } from "../errors.ts";
import { completedMonths, dateLabel, parseDate } from "../internal/dates.ts";
import { pickInForce } from "../tables/effective.ts";
import { ANNUAL_LEAVE_RULES, SICK_LEAVE_RULES } from "../tables/leave.ts";
import type { IsoDate, WorkingStep } from "../types.ts";

export interface AnnualLeaveInput {
  /** First day of service. */
  readonly employmentStartDate: IsoDate;
  /** Date to evaluate (for a leaver: the last day of employment). */
  readonly asOfDate: IsoDate;
  /** True when `asOfDate` is the last day of employment: the final service year is pro-rated. */
  readonly leaving?: boolean;
  /**
   * Months of service excluded because of unpaid leave (MOM excludes unpaid leave from service; whether
   * a single unpaid day excludes a whole month is a company policy decision).
   */
  readonly excludedMonths?: number;
}

export interface AnnualLeaveResult {
  readonly completedMonths: number;
  /** 1-based year of service the as-of date falls in. */
  readonly serviceYear: number;
  /** Full statutory entitlement for that service year. */
  readonly fullYearDays: number;
  /** At least 3 months of service. */
  readonly eligible: boolean;
  readonly prorated: boolean;
  /** Statutory days for the service year as of the date (pro-rated in the first year and the year of leaving). */
  readonly entitlementDays: number;
  readonly working: readonly WorkingStep[];
}

/** MOM: "If the fraction of a day is less than one-half, round it down. If it is half or more, round it up to one day." */
function roundLeaveDays(numerator: number, denominator: number): number {
  return Math.floor((2 * numerator + denominator) / (2 * denominator));
}

/**
 * Statutory annual leave (Employment Act): 7 days in year 1 rising by 1 a year to 14 from year 8,
 * after 3 months' service; pro-rated by completed months in the first year and the year of leaving.
 */
export function annualLeaveEntitlement(input: AnnualLeaveInput): AnnualLeaveResult {
  const rule = pickInForce(ANNUAL_LEAVE_RULES, input.asOfDate, "annual leave");
  const excluded = input.excludedMonths ?? 0;
  if (!Number.isInteger(excluded) || excluded < 0)
    throw new SgRulesInputError("excludedMonths must be a non-negative whole number.");
  const months = Math.max(0, completedMonths(input.employmentStartDate, input.asOfDate) - excluded);
  const serviceYear = Math.floor(months / 12) + 1;
  const scale = rule.daysByServiceYear;
  const fullYearDays = scale[Math.min(serviceYear, scale.length) - 1] as number;
  const eligible = months >= rule.minServiceMonths;
  const monthsInYear = months - (serviceYear - 1) * 12;
  const prorated = serviceYear === 1 || input.leaving === true;
  const entitlementDays = !eligible ? 0 : prorated ? roundLeaveDays(monthsInYear * fullYearDays, 12) : fullYearDays;
  const working: WorkingStep[] = [
    {
      code: "EA_AL_SERVICE",
      text: `${months} completed months of service from ${dateLabel(input.employmentStartDate)} to ${dateLabel(input.asOfDate)}${excluded ? ` (${excluded} excluded for unpaid leave)` : ""} → service year ${serviceYear}, full entitlement ${fullYearDays} days.`,
    },
  ];
  if (!eligible) {
    working.push({
      code: "EA_AL_NOT_ELIGIBLE",
      text: `Less than ${rule.minServiceMonths} months of service → no annual leave yet.`,
    });
  } else if (prorated) {
    working.push({
      code: "EA_AL_PRORATED",
      text: `${serviceYear === 1 ? "First year" : "Year of leaving"}: ${monthsInYear}/12 × ${fullYearDays} = ${((monthsInYear * fullYearDays) / 12).toFixed(2)} → ${entitlementDays} days (half a day or more rounds up).`,
    });
  }
  return { completedMonths: months, serviceYear, fullYearDays, eligible, prorated, entitlementDays, working };
}

export interface SickLeaveResult {
  readonly completedMonths: number;
  readonly eligible: boolean;
  readonly outpatientDays: number;
  /** Hospitalisation days INCLUDING the outpatient days. */
  readonly hospitalisationDays: number;
  readonly working: readonly WorkingStep[];
}

/** Paid sick leave by completed months of service (5/15 at 3 months … 14/60 from 6 months). */
export function sickLeaveEntitlement(input: {
  readonly employmentStartDate: IsoDate;
  readonly asOfDate: IsoDate;
}): SickLeaveResult {
  parseDate(input.employmentStartDate, "employmentStartDate");
  const rule = pickInForce(SICK_LEAVE_RULES, input.asOfDate, "sick leave");
  const months = completedMonths(input.employmentStartDate, input.asOfDate);
  const step = [...rule.steps].reverse().find((s) => months >= s.completedMonths);
  const outpatientDays = step?.outpatientDays ?? 0;
  const hospitalisationDays = step?.hospitalisationDays ?? 0;
  return {
    completedMonths: months,
    eligible: months >= rule.minServiceMonths,
    outpatientDays,
    hospitalisationDays,
    working: [
      {
        code: "EA_SICK_LEAVE",
        text:
          step === undefined
            ? `${months} completed months of service: less than ${rule.minServiceMonths} months → no paid sick leave.`
            : `${months} completed months of service → ${outpatientDays} days outpatient, ${hospitalisationDays} days hospitalisation (including outpatient).`,
      },
    ],
  };
}
