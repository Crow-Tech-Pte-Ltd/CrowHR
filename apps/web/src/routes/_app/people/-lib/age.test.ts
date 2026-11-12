import { describe, expect, it } from "vitest";
import { ageNotices } from "./age.ts";

describe("young hire conditions shown in the hire form", () => {
  it("13 and 14: light duties only", () => {
    const [n] = ageNotices("2012-11-14", "2026-11-13");
    expect(n).toMatchObject({ code: "EA_CHILD_LIGHT_DUTIES_ONLY", severity: "warning" });
    expect(n?.message).toContain("Aged 13");
  });

  it("15: MOM notification and medical report for industrial work", () => {
    expect(ageNotices("2011-11-13", "2026-11-13")).toEqual([
      expect.objectContaining({ code: "EA_YOUNG_PERSON_CONDITIONS", severity: "warning" }),
    ]);
  });

  it("16 on the start date: nothing to show", () => {
    expect(ageNotices("2010-11-13", "2026-11-13")).toEqual([]);
  });

  it("under 13 is refused, as the server does", () => {
    expect(ageNotices("2014-01-01", "2026-11-13")).toEqual([
      expect.objectContaining({ code: "EA_BELOW_MINIMUM_AGE", severity: "blocking" }),
    ]);
  });

  it("stays quiet while a date is incomplete, out of order or before the encoded rules", () => {
    expect(ageNotices("", "2026-11-13")).toEqual([]);
    expect(ageNotices("2012-11", "2026-11-13")).toEqual([]);
    expect(ageNotices("2026-12-01", "2026-11-13")).toEqual([]);
    expect(ageNotices("2012-01-01", "2020-01-01")).toEqual([]);
  });
});
