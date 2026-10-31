import { describe, expect, it } from "vitest";
import { SgRulesInputError } from "../errors.ts";
import { MOM_NOTICE, MOM_YOUNG_PERSONS } from "../tables/employment-terms.ts";
import { checkEmploymentAge, statutoryMinimumNotice } from "./notice-and-age.ts";

const notice = (serviceStart: string, noticeGivenOn: string) =>
  statutoryMinimumNotice({ serviceStart, noticeGivenOn }).noticeDays;

describe("statutory minimum notice (contract silent; EA s 10(3), MOM)", () => {
  it("follows MOM's table by length of service", () => {
    expect(notice("2026-01-05", "2026-03-01")).toBe(1); // < 26 weeks
    expect(notice("2025-01-06", "2026-06-01")).toBe(7); // 26 weeks to < 2 years
    expect(notice("2022-03-01", "2026-03-01")).toBe(14); // 2 to < 5 years
    expect(notice("2015-07-01", "2026-03-01")).toBe(28); // 5 years or more
  });

  it("switches at exactly 26 weeks, 2 years and 5 years of service", () => {
    // Day 181 vs day 182 of service (both ends counted).
    expect(notice("2026-01-01", "2026-06-30")).toBe(1);
    expect(notice("2026-01-01", "2026-07-01")).toBe(7);
    // 24 completed months: 1 Mar 2024 → 28 Feb 2026.
    expect(notice("2024-03-01", "2026-02-27")).toBe(7);
    expect(notice("2024-03-01", "2026-02-28")).toBe(14);
    expect(notice("2021-03-01", "2026-02-28")).toBe(28);
  });

  it("cites MOM and reports the service used", () => {
    expect(statutoryMinimumNotice({ serviceStart: "2026-01-01", noticeGivenOn: "2026-01-01" })).toEqual({
      noticeDays: 1,
      label: "1 day",
      service: { days: 1, completedMonths: 0 },
      source: MOM_NOTICE,
    });
  });

  it("rejects notice before the start date and dates outside the encoded rules", () => {
    expect(() => notice("2026-03-01", "2026-02-01")).toThrow(SgRulesInputError);
    expect(() => notice("2020-01-01", "2024-06-01")).toThrow(/No statutory notice rule/);
  });
});

describe("minimum employment age (EA s 68, MOM young persons and children)", () => {
  it("refuses under 13, the day before the 13th birthday", () => {
    const r = checkEmploymentAge({ dob: "2013-11-02", onDate: "2026-11-01" });
    expect(r).toMatchObject({ age: 12, allowed: false, minimumAge: 13 });
    expect(r.issues[0]).toMatchObject({
      code: "EA_BELOW_MINIMUM_AGE",
      severity: "blocking",
      source: MOM_YOUNG_PERSONS,
    });
  });

  it("allows 13 to under 15 for light duties, and 15 to under 16 with the industrial-work notification", () => {
    expect(checkEmploymentAge({ dob: "2013-11-01", onDate: "2026-11-01" })).toMatchObject({
      age: 13,
      allowed: true,
      issues: [{ code: "EA_CHILD_LIGHT_DUTIES_ONLY", severity: "warning" }],
    });
    expect(checkEmploymentAge({ dob: "2011-01-01", onDate: "2026-11-01" }).issues[0]?.code).toBe(
      "EA_YOUNG_PERSON_CONDITIONS",
    );
    expect(checkEmploymentAge({ dob: "2010-11-01", onDate: "2026-11-01" })).toMatchObject({ age: 16, issues: [] });
  });

  it("rejects a birth date after the date checked", () => {
    expect(() => checkEmploymentAge({ dob: "2027-01-01", onDate: "2026-11-01" })).toThrow(SgRulesInputError);
  });
});
