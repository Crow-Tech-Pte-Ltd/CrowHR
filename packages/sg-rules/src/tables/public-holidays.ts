/**
 * Gazetted Singapore public holidays (Holidays Act), as published by MOM. 11 per year.
 * `observedOn`: the gazetted Monday holiday when the holiday falls on a Sunday (for employees whose
 * rest day is Sunday). Saturday holidays have no gazetted substitute.
 * Ad-hoc holidays (e.g. Polling Day, Parliamentary Elections Act s 35) are added by admins.
 */

import type { Effective } from "./effective.ts";

export interface PublicHoliday {
  readonly date: string;
  readonly name: string;
  readonly observedOn?: string;
}

export interface PublicHolidayYear extends Effective {
  readonly year: number;
  readonly holidays: readonly PublicHoliday[];
}

/** "11 paid public holidays a year". */
export const PUBLIC_HOLIDAYS_PER_YEAR = {
  count: 11,
  source: "https://www.mom.gov.sg/employment-practices/public-holidays-entitlement-and-pay",
} as const;

export const PUBLIC_HOLIDAY_YEARS: readonly PublicHolidayYear[] = [
  {
    year: 2026,
    effectiveFrom: "2026-01-01",
    effectiveTo: "2027-01-01",
    source: "https://www.mom.gov.sg/newsroom/press-releases/2025/0616-public-holidays-for-2026",
    effectiveFromBasis: "PUBLISHED",
    holidays: [
      { date: "2026-01-01", name: "New Year's Day" },
      { date: "2026-02-17", name: "Chinese New Year" },
      { date: "2026-02-18", name: "Chinese New Year" },
      { date: "2026-03-21", name: "Hari Raya Puasa" },
      { date: "2026-04-03", name: "Good Friday" },
      { date: "2026-05-01", name: "Labour Day" },
      { date: "2026-05-27", name: "Hari Raya Haji" },
      { date: "2026-05-31", name: "Vesak Day", observedOn: "2026-06-01" },
      { date: "2026-08-09", name: "National Day", observedOn: "2026-08-10" },
      { date: "2026-11-08", name: "Deepavali", observedOn: "2026-11-09" },
      { date: "2026-12-25", name: "Christmas Day" },
    ],
  },
  {
    year: 2027,
    effectiveFrom: "2027-01-01",
    effectiveTo: "2028-01-01",
    source: "https://www.mom.gov.sg/newsroom/press-releases/2026/0618-public-holidays-for-2027",
    effectiveFromBasis: "PUBLISHED",
    holidays: [
      { date: "2027-01-01", name: "New Year's Day" },
      { date: "2027-02-06", name: "Chinese New Year" },
      { date: "2027-02-07", name: "Chinese New Year", observedOn: "2027-02-08" },
      { date: "2027-03-10", name: "Hari Raya Puasa" },
      { date: "2027-03-26", name: "Good Friday" },
      { date: "2027-05-01", name: "Labour Day" },
      { date: "2027-05-17", name: "Hari Raya Haji" },
      { date: "2027-05-20", name: "Vesak Day" },
      { date: "2027-08-09", name: "National Day" },
      { date: "2027-10-28", name: "Deepavali" },
      { date: "2027-12-25", name: "Christmas Day" },
    ],
  },
];
