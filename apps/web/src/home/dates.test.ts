import { describe, expect, it } from "vitest";
import { daysBetween, daysLeftLabel, relativeDays, weekday } from "./dates.ts";

describe("home date helpers", () => {
  it("counts calendar days across month ends", () => {
    expect(daysBetween("2026-10-31", "2026-11-06")).toBe(6);
    expect(daysBetween("2026-10-31", "2026-10-29")).toBe(-2);
  });

  it("names weekdays and relative days", () => {
    expect(weekday("2026-10-31")).toBe("Saturday");
    expect(relativeDays(0)).toBe("today");
    expect(relativeDays(18)).toBe("in 18 days");
    expect(relativeDays(-2)).toBe("2 days ago");
  });

  it("labels countdowns without negative numbers", () => {
    expect(daysLeftLabel(0)).toBe("today");
    expect(daysLeftLabel(1)).toBe("1 day");
    expect(daysLeftLabel(49)).toBe("49 days");
    expect(daysLeftLabel(-1)).toBe("1 day ago");
    expect(daysLeftLabel(-11)).toBe("11 days ago");
  });
});
