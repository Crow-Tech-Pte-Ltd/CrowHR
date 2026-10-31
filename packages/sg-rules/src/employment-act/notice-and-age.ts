import { SgRulesInputError } from "../errors.ts";
import { completedMonths, epochDay, parseDate } from "../internal/dates.ts";
import { pickInForce } from "../tables/effective.ts";
import { MINIMUM_AGE_RULES, NOTICE_RULES, type NoticeBand } from "../tables/employment-terms.ts";
import type { IsoDate, RuleIssue } from "../types.ts";

export interface StatutoryNotice {
  /** Minimum notice in calendar days, counting the day notice is given as day 1. */
  readonly noticeDays: number;
  readonly label: string;
  /** Completed service used to pick the band. */
  readonly service: { readonly days: number; readonly completedMonths: number };
  readonly source: string;
}

function inBand(band: NoticeBand, serviceDays: number, months: number): boolean {
  if (band.serviceBelow === null) return true;
  if ("weeks" in band.serviceBelow) return serviceDays < band.serviceBelow.weeks * 7;
  return months < band.serviceBelow.years * 12;
}

/**
 * Minimum notice either side must give when the contract does not state a notice period
 * (Employment Act s 10(3), MOM "Termination with notice"). A contractual period, if any, applies
 * instead. Service runs from `serviceStart` (first day of employment) to `noticeGivenOn`, both
 * counted: 26 weeks is reached on day 182; years are completed months (MOM-style) ÷ 12.
 */
export function statutoryMinimumNotice(input: { serviceStart: IsoDate; noticeGivenOn: IsoDate }): StatutoryNotice {
  parseDate(input.serviceStart, "serviceStart");
  parseDate(input.noticeGivenOn, "noticeGivenOn");
  if (input.noticeGivenOn < input.serviceStart) {
    throw new SgRulesInputError("noticeGivenOn: notice cannot be given before employment starts.");
  }
  const rule = pickInForce(NOTICE_RULES, input.noticeGivenOn, "statutory notice");
  const days = epochDay(input.noticeGivenOn) - epochDay(input.serviceStart) + 1;
  const months = completedMonths(input.serviceStart, input.noticeGivenOn);
  const band = rule.bands.find((b) => inBand(b, days, months)) as NoticeBand;
  return {
    noticeDays: band.noticeDays,
    label: band.label,
    service: { days, completedMonths: months },
    source: rule.source,
  };
}

export interface EmploymentAgeCheck {
  /** Whole years on `onDate`. */
  readonly age: number;
  /** False below the Employment Act minimum (13); the only exception is a family-only industrial undertaking. */
  readonly allowed: boolean;
  readonly minimumAge: number;
  /** Conditions the employer must observe for an under-16 (blocking issue when not allowed). */
  readonly issues: readonly RuleIssue[];
}

function ageOn(dob: IsoDate, onDate: IsoDate): number {
  const b = parseDate(dob, "dob");
  const d = parseDate(onDate, "onDate");
  return d.y - b.y - (d.m < b.m || (d.m === b.m && d.d < b.d) ? 1 : 0);
}

/** Minimum employment age and the young-worker conditions on `onDate` (Employment Act s 68, MOM). */
export function checkEmploymentAge(input: { dob: IsoDate; onDate: IsoDate }): EmploymentAgeCheck {
  if (input.dob > input.onDate) throw new SgRulesInputError("dob: the date of birth is after the date checked.");
  const rule = pickInForce(MINIMUM_AGE_RULES, input.onDate, "minimum employment age");
  const age = ageOn(input.dob, input.onDate);
  const issues: RuleIssue[] = [];
  if (age < rule.minimumAge) {
    issues.push({
      code: "EA_BELOW_MINIMUM_AGE",
      severity: "blocking",
      message: `Children under ${rule.minimumAge} may not be employed (Employment Act s 68), except in an industrial undertaking that employs only members of the same family.`,
      source: rule.source,
    });
  } else if (age < rule.lightDutiesOnlyBelowAge) {
    issues.push({
      code: "EA_CHILD_LIGHT_DUTIES_ONLY",
      severity: "warning",
      message: `Aged ${age}: light duties suited to their capacity only, and no industrial work unless working with family members. No night work (11pm–6am) and limits on daily hours apply.`,
      source: rule.source,
    });
  } else if (age < rule.industrialNotificationBelowAge) {
    issues.push({
      code: "EA_YOUNG_PERSON_CONDITIONS",
      severity: "warning",
      message: `Aged ${age}: for industrial work, notify MOM and submit a medical report within ${rule.industrialNotificationDays} days of starting. No night work (11pm–6am) and limits on daily hours apply.`,
      source: rule.source,
    });
  }
  return { age, allowed: age >= rule.minimumAge, minimumAge: rule.minimumAge, issues };
}
