import { describe, expect, it } from "vitest";
import {
  isPeriodOver,
  latestEndedPeriod,
  nextPeriod,
  periodLabel,
  periodOf,
  periodsOverlap,
  previousPeriod,
  submittableFrom,
} from "./periods.ts";

/** Timesheet periods (add-timesheet-approval spec "Timesheet approval setting", design decision 1). */
describe("timesheet periods", () => {
  it("monthly: the calendar month, including February in a leap year", () => {
    expect(periodOf("2026-11-13", "monthly")).toEqual({ start: "2026-11-01", end: "2026-11-30" });
    expect(periodOf("2026-12-31", "monthly")).toEqual({ start: "2026-12-01", end: "2026-12-31" });
    expect(periodOf("2028-02-10", "monthly")).toEqual({ start: "2028-02-01", end: "2028-02-29" });
  });

  it("semi-monthly: 1st–15th and 16th–last day", () => {
    expect(periodOf("2026-11-15", "semi_monthly")).toEqual({ start: "2026-11-01", end: "2026-11-15" });
    expect(periodOf("2026-11-16", "semi_monthly")).toEqual({ start: "2026-11-16", end: "2026-11-30" });
    expect(periodOf("2027-02-20", "semi_monthly")).toEqual({ start: "2027-02-16", end: "2027-02-28" });
  });

  it("weekly: Monday to Sunday, across a month and a year end", () => {
    // Friday 13 Nov 2026.
    expect(periodOf("2026-11-13", "weekly")).toEqual({ start: "2026-11-09", end: "2026-11-15" });
    // Sunday belongs to the week that started on the Monday before.
    expect(periodOf("2026-11-15", "weekly")).toEqual({ start: "2026-11-09", end: "2026-11-15" });
    expect(periodOf("2026-12-31", "weekly")).toEqual({ start: "2026-12-28", end: "2027-01-03" });
  });

  it("previous and next periods", () => {
    const nov = periodOf("2026-11-13", "monthly");
    expect(previousPeriod(nov, "monthly")).toEqual({ start: "2026-10-01", end: "2026-10-31" });
    expect(nextPeriod(nov, "monthly")).toEqual({ start: "2026-12-01", end: "2026-12-31" });
    const firstHalf = periodOf("2026-11-03", "semi_monthly");
    expect(previousPeriod(firstHalf, "semi_monthly")).toEqual({ start: "2026-10-16", end: "2026-10-31" });
    const week = periodOf("2026-11-13", "weekly");
    expect(previousPeriod(week, "weekly")).toEqual({ start: "2026-11-02", end: "2026-11-08" });
    expect(nextPeriod(week, "weekly")).toEqual({ start: "2026-11-16", end: "2026-11-22" });
  });

  it("a period can be submitted from 04:00 SGT on the day after it ends (the overnight cut-off)", () => {
    const oct = { start: "2026-10-01", end: "2026-10-31" };
    expect(submittableFrom(oct).toISOString()).toBe("2026-10-31T20:00:00.000Z"); // 1 Nov 04:00 SGT
    expect(isPeriodOver(oct, new Date("2026-10-31T19:59:59.000Z"))).toBe(false); // 1 Nov 03:59:59 SGT
    expect(isPeriodOver(oct, new Date("2026-10-31T20:00:00.000Z"))).toBe(true);
  });

  it("the latest ended period is the one before today's, or earlier before 04:00 on its first day", () => {
    // Friday 13 Nov 2026, 10:00 SGT.
    const now = new Date("2026-11-13T02:00:00.000Z");
    expect(latestEndedPeriod(now, "monthly")).toEqual({ start: "2026-10-01", end: "2026-10-31" });
    expect(latestEndedPeriod(now, "weekly")).toEqual({ start: "2026-11-02", end: "2026-11-08" });
    // Monday 16 Nov 02:00 SGT: last week's Sunday may still be closing an overnight shift.
    expect(latestEndedPeriod(new Date("2026-11-15T18:00:00.000Z"), "weekly")).toEqual({
      start: "2026-11-02",
      end: "2026-11-08",
    });
  });

  it("labels and overlap", () => {
    expect(periodLabel({ start: "2026-10-01", end: "2026-10-31" })).toBe("1–31 Oct 2026");
    expect(periodLabel({ start: "2026-12-28", end: "2027-01-03" })).toBe("28 Dec 2026 – 3 Jan 2027");
    expect(periodsOverlap({ start: "2026-10-01", end: "2026-10-31" }, { start: "2026-10-26", end: "2026-11-01" })).toBe(
      true,
    );
    expect(periodsOverlap({ start: "2026-10-01", end: "2026-10-31" }, { start: "2026-11-01", end: "2026-11-15" })).toBe(
      false,
    );
  });
});
