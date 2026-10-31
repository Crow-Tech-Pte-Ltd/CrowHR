import { RulesNotAvailableError } from "../errors.ts";
import { addDays, dayOfWeek, parseDate } from "../internal/dates.ts";
import { PUBLIC_HOLIDAY_SUBSTITUTION_SOURCE } from "../tables/employment-act.ts";
import { publicHolidaysFor } from "../tables/index.ts";
import { PUBLIC_HOLIDAYS_PER_YEAR, type PublicHoliday } from "../tables/public-holidays.ts";
import type { IsoDate } from "../types.ts";
import type { WorkPattern } from "./salary.ts";

/** The gazetted public holidays for a year. Throws if MOM has not published them (or they are not encoded). */
export function publicHolidays(year: number): readonly PublicHoliday[] {
  const y = publicHolidaysFor(year);
  if (!y) {
    throw new RulesNotAvailableError(
      `Public holidays for ${year} are not encoded. MOM usually publishes the next year's holidays in June; add them with their source.`,
    );
  }
  return y.holidays;
}

export const PUBLIC_HOLIDAYS_PER_YEAR_COUNT = PUBLIC_HOLIDAYS_PER_YEAR.count;

export type HolidayTreatment =
  /** Holiday on a working day: a paid day off (or extra pay if worked). */
  | "PAID_HOLIDAY"
  /** Sunday holiday, Sunday rest day: the gazetted Monday is the holiday. */
  | "GAZETTED_MONDAY"
  /** Holiday on the employee's (non-Sunday, or no gazetted substitute) rest day: the next working day is a paid holiday. */
  | "NEXT_WORKING_DAY"
  /** Holiday on a non-working day (e.g. Saturday, 5-day week): another day off OR one extra day's gross pay. No automatic Monday. */
  | "DAY_OFF_OR_EXTRA_GROSS_DAY";

export interface HolidayTreatmentResult {
  readonly treatment: HolidayTreatment;
  /** The substitute holiday date where the rule fixes one. */
  readonly substituteDate: IsoDate | null;
  readonly explanation: string;
  readonly source: string;
}

/**
 * What an employee gets for a public holiday given their rest day and work pattern (MOM in-lieu rules).
 * `restDay` is the weekday (0 = Sunday … 6 = Saturday) of the employee's rest day.
 */
export function publicHolidayTreatment(input: {
  readonly holiday: PublicHoliday;
  readonly restDay: number;
  readonly pattern: WorkPattern;
}): HolidayTreatmentResult {
  parseDate(input.holiday.date, "holiday.date");
  const dow = dayOfWeek(input.holiday.date);
  const source = PUBLIC_HOLIDAY_SUBSTITUTION_SOURCE;
  if (dow === input.restDay) {
    if (input.restDay === 0 && input.holiday.observedOn) {
      return {
        treatment: "GAZETTED_MONDAY",
        substituteDate: input.holiday.observedOn,
        explanation: `${input.holiday.name} falls on the employee's Sunday rest day; ${input.holiday.observedOn} is the gazetted public holiday.`,
        source,
      };
    }
    let next = addDays(input.holiday.date, 1);
    for (
      let i = 0;
      i < 7 && ((input.pattern[dayOfWeek(next)] as number) === 0 || dayOfWeek(next) === input.restDay);
      i++
    ) {
      next = addDays(next, 1);
    }
    return {
      treatment: "NEXT_WORKING_DAY",
      substituteDate: next,
      explanation: `${input.holiday.name} falls on the employee's rest day; the next working day (${next}) is a paid holiday.`,
      source,
    };
  }
  if ((input.pattern[dow] as number) === 0) {
    return {
      treatment: "DAY_OFF_OR_EXTRA_GROSS_DAY",
      substituteDate: null,
      explanation: `${input.holiday.name} falls on a non-working day; give another day off or one extra day's gross pay (no automatic Monday).`,
      source,
    };
  }
  return {
    treatment: "PAID_HOLIDAY",
    substituteDate: null,
    explanation: `${input.holiday.name} is a paid holiday.`,
    source,
  };
}
