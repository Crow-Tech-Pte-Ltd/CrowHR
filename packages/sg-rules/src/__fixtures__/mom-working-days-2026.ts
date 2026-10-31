/**
 * MOM incomplete-month working-day table for 2026 (rest day Sunday), used as a test fixture for the
 * working-day calendar. https://www.mom.gov.sg/-/media/mom/documents/employment-practices/incomplete-month.xls
 */
export const MOM_WORKING_DAYS_2026 = {
  source: "https://www.mom.gov.sg/-/media/mom/documents/employment-practices/incomplete-month.xls",
  fiveDay: [22, 20, 22, 22, 21, 22, 23, 21, 22, 22, 21, 23],
  fiveAndHalfDay: [24.5, 22, 24, 24, 23.5, 24, 25, 23.5, 24, 24.5, 23, 25],
  sixDay: [27, 24, 26, 26, 26, 26, 27, 26, 26, 27, 25, 27],
} as const;
