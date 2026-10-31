import { describe, expect, it } from "vitest";
import { RulesNotAvailableError } from "../errors.ts";
import { completedMonths } from "../internal/dates.ts";
import { annualLeaveEntitlement, sickLeaveEntitlement } from "./leave.ts";
import { PUBLIC_HOLIDAYS_PER_YEAR_COUNT, publicHolidays, publicHolidayTreatment } from "./public-holidays.ts";
import { WORK_PATTERNS } from "./salary.ts";

describe("completed months of service", () => {
  it.each([
    ["2026-03-14", "2026-07-31", 4], // MOM's example
    ["2026-03-14", "2026-07-13", 4],
    ["2026-03-14", "2026-07-12", 3],
    ["2026-01-01", "2026-03-31", 3],
    ["2026-01-01", "2026-03-30", 2],
    ["2026-01-31", "2026-02-28", 1], // anniversary clamped to month end
    ["2026-01-31", "2026-02-27", 0],
    ["2026-05-01", "2026-04-30", 0],
  ])("%s → %s = %i", (start, asOf, months) => {
    expect(completedMonths(start, asOf)).toBe(months);
  });
});

describe("annual leave", () => {
  it("is nil before 3 months of service", () => {
    const r = annualLeaveEntitlement({ employmentStartDate: "2026-01-01", asOfDate: "2026-03-30" });
    expect(r).toMatchObject({ eligible: false, entitlementDays: 0, serviceYear: 1, fullYearDays: 7 });
    expect(r.working.map((w) => w.code)).toContain("EA_AL_NOT_ELIGIBLE");
  });

  it.each([
    ["2026-03-31", 3, 2], // 1.75 → 2
    ["2026-05-31", 5, 3], // 2.9167 → 3
    ["2026-06-30", 6, 4], // 3.5 → 4 (half rounds up)
    ["2026-09-30", 9, 5], // 5.25 → 5
    ["2026-12-31", 12, 8], // year 2 starts: full 8
  ])("first-year pro-ration as of %s (%i months) → %i days", (asOfDate, months, days) => {
    const r = annualLeaveEntitlement({ employmentStartDate: "2026-01-01", asOfDate });
    expect(r.completedMonths).toBe(months);
    expect(r.entitlementDays).toBe(days);
  });

  it("reproduces MOM's leaving example: 14 Mar → 31 Jul, 4 completed months of a 10-day year → 3 days", () => {
    const r = annualLeaveEntitlement({ employmentStartDate: "2023-03-14", asOfDate: "2026-07-31", leaving: true });
    expect(r).toMatchObject({ serviceYear: 4, fullYearDays: 10, prorated: true, entitlementDays: 3 });
    expect(r.working.at(-1)?.text).toMatch(/Year of leaving: 4\/12 × 10 = 3\.33 → 3 days/);
  });

  it("gives the full scale after year 1 and 14 days from year 8", () => {
    expect(annualLeaveEntitlement({ employmentStartDate: "2024-01-01", asOfDate: "2026-06-30" }).entitlementDays).toBe(
      9,
    );
    expect(annualLeaveEntitlement({ employmentStartDate: "2010-01-01", asOfDate: "2026-06-30" }).entitlementDays).toBe(
      14,
    );
  });

  it("excludes unpaid-leave months from service", () => {
    const r = annualLeaveEntitlement({ employmentStartDate: "2026-01-01", asOfDate: "2026-06-30", excludedMonths: 1 });
    expect(r).toMatchObject({ completedMonths: 5, entitlementDays: 3 });
    expect(() =>
      annualLeaveEntitlement({ employmentStartDate: "2026-01-01", asOfDate: "2026-06-30", excludedMonths: -1 }),
    ).toThrow();
  });
});

describe("sick leave", () => {
  it.each([
    ["2026-03-30", 0, 0, false],
    ["2026-03-31", 5, 15, true],
    ["2026-04-30", 8, 30, true],
    ["2026-05-31", 11, 45, true],
    ["2026-06-30", 14, 60, true],
    ["2027-09-30", 14, 60, true],
  ])("as of %s → %i outpatient / %i hospitalisation", (asOfDate, op, hosp, eligible) => {
    const r = sickLeaveEntitlement({ employmentStartDate: "2026-01-01", asOfDate });
    expect([r.outpatientDays, r.hospitalisationDays, r.eligible]).toEqual([op, hosp, eligible]);
    expect(r.working).toHaveLength(1);
  });
});

describe("public holidays", () => {
  it("lists 11 gazetted holidays per published year and refuses unpublished years", () => {
    expect(publicHolidays(2026)).toHaveLength(PUBLIC_HOLIDAYS_PER_YEAR_COUNT);
    expect(publicHolidays(2027).find((h) => h.name === "Chinese New Year" && h.observedOn)?.observedOn).toBe(
      "2027-02-08",
    );
    expect(() => publicHolidays(2028)).toThrow(RulesNotAvailableError);
  });

  const holiday = (date: string) => {
    const h = [...publicHolidays(2026), ...publicHolidays(2027)].find((x) => x.date === date);
    if (!h) throw new Error(date);
    return h;
  };

  it("Sunday holiday, Sunday rest day → gazetted Monday", () => {
    const r = publicHolidayTreatment({ holiday: holiday("2026-08-09"), restDay: 0, pattern: WORK_PATTERNS.FIVE_DAY });
    expect(r).toMatchObject({ treatment: "GAZETTED_MONDAY", substituteDate: "2026-08-10" });
  });

  it("Saturday holiday for a 5-day week → another day off or one extra day's gross pay (no automatic Monday)", () => {
    const r = publicHolidayTreatment({ holiday: holiday("2026-03-21"), restDay: 0, pattern: WORK_PATTERNS.FIVE_DAY });
    expect(r.treatment).toBe("DAY_OFF_OR_EXTRA_GROSS_DAY");
    expect(r.substituteDate).toBeNull();
  });

  it("holiday on a non-Sunday rest day → next working day", () => {
    const sat = publicHolidayTreatment({ holiday: holiday("2026-03-21"), restDay: 6, pattern: WORK_PATTERNS.FIVE_DAY });
    expect(sat).toMatchObject({ treatment: "NEXT_WORKING_DAY", substituteDate: "2026-03-23" });
    const mondayRest = [1, 0, 1, 1, 1, 1, 1] as const;
    const mon = publicHolidayTreatment({ holiday: holiday("2027-08-09"), restDay: 1, pattern: mondayRest });
    expect(mon).toMatchObject({ treatment: "NEXT_WORKING_DAY", substituteDate: "2027-08-10" });
    const sunWorked = publicHolidayTreatment({ holiday: holiday("2026-08-09"), restDay: 1, pattern: mondayRest });
    expect(sunWorked.treatment).toBe("PAID_HOLIDAY");
  });
});
