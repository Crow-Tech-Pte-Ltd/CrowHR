/**
 * Employment Act terms used when hiring and when someone leaves: the minimum notice period when
 * the contract is silent, and the minimum age for employing a child. Numbers as published by MOM
 * (checked 31 Oct 2026). Intervals are [effectiveFrom, effectiveTo).
 */

import type { Effective } from "./effective.ts";

/** MOM "Termination with notice" (last updated 22 Apr 2026): Employment Act s 10(3). */
export const MOM_NOTICE =
  "https://www.mom.gov.sg/employment-practices/termination-of-employment/termination-with-notice";
/** MOM "Young persons and children" (last updated 24 Jul 2025): Employment Act Part 8, s 68. */
export const MOM_YOUNG_PERSONS = "https://www.mom.gov.sg/employment-practices/young-persons-and-children";

export interface NoticeBand {
  /** Service from the first day of employment to the day notice is given. The band applies below this; null = no upper bound. */
  readonly serviceBelow: { readonly weeks: number } | { readonly years: number } | null;
  /** Minimum notice in calendar days, the day notice is given counting as day 1. */
  readonly noticeDays: number;
  /** As MOM writes it. */
  readonly label: string;
}

export interface NoticeRule extends Effective {
  /** Ordered by service. Applies only when the contract does not state a notice period. */
  readonly bands: readonly NoticeBand[];
}

/**
 * "If there is no notice period in your contract", MOM: less than 26 weeks → 1 day; 26 weeks to
 * less than 2 years → 1 week; 2 years to less than 5 years → 2 weeks; 5 years or more → 4 weeks.
 * The page states no start date, so the row is applied from the engine coverage start.
 */
export const NOTICE_RULES: readonly NoticeRule[] = [
  {
    effectiveFrom: "2025-01-01",
    effectiveTo: null,
    bands: [
      { serviceBelow: { weeks: 26 }, noticeDays: 1, label: "1 day" },
      { serviceBelow: { years: 2 }, noticeDays: 7, label: "1 week" },
      { serviceBelow: { years: 5 }, noticeDays: 14, label: "2 weeks" },
      { serviceBelow: null, noticeDays: 28, label: "4 weeks" },
    ],
    source: MOM_NOTICE,
    effectiveFromBasis: "ENGINE_COVERAGE_START",
    verifiedOn: "2026-10-31",
  },
];

export interface MinimumAgeRule extends Effective {
  /**
   * Employment Act s 68(3): "A child who is 13 years of age or above may be employed in light work
   * suited to his or her capacity in a non-industrial undertaking." Below this age a child may only
   * work in an industrial undertaking that employs members of the same family (s 68(2)).
   */
  readonly minimumAge: number;
  /** MOM: children aged 13 to less than 15 may do light duties only; no industrial work unless with family members. */
  readonly lightDutiesOnlyBelowAge: number;
  /** MOM: young persons aged 15 to less than 16 in industrial work: notify MOM and submit a medical report within 30 days. */
  readonly industrialNotificationBelowAge: number;
  readonly industrialNotificationDays: number;
}

export const MINIMUM_AGE_RULES: readonly MinimumAgeRule[] = [
  {
    effectiveFrom: "2025-01-01",
    effectiveTo: null,
    minimumAge: 13,
    lightDutiesOnlyBelowAge: 15,
    industrialNotificationBelowAge: 16,
    industrialNotificationDays: 30,
    source: MOM_YOUNG_PERSONS,
    effectiveFromBasis: "ENGINE_COVERAGE_START",
    verifiedOn: "2026-10-31",
  },
];
