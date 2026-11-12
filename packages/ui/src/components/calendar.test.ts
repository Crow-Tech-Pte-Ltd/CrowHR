import { describe, expect, it } from "vitest";
import { toIsoDate } from "../lib/format.ts";
import { dayButtonLabel, singaporeToday } from "./calendar.tsx";

describe("dayButtonLabel", () => {
  it("names a day in Singapore's order, with the visible day number as a word", () => {
    expect(dayButtonLabel(new Date(2026, 10, 10), {})).toBe("Tuesday 10 November 2026");
    expect(dayButtonLabel(new Date(2026, 9, 31), { today: true, selected: true })).toBe(
      "Today, Saturday 31 October 2026, selected",
    );
  });
});

describe("singaporeToday", () => {
  it("is already tomorrow in Singapore at 00:30 SGT, whatever the browser's time zone", () => {
    // 16:30 UTC on 1 Nov is 00:30 on 2 Nov in Singapore.
    expect(toIsoDate(singaporeToday(Date.parse("2026-11-01T16:30:00Z")))).toBe("2026-11-02");
  });

  it("is still today just before midnight Singapore time", () => {
    expect(toIsoDate(singaporeToday(Date.parse("2026-11-01T15:59:59Z")))).toBe("2026-11-01");
  });

  it("returns local midnight, the form the date picker compares against", () => {
    const d = singaporeToday(Date.parse("2026-12-31T20:00:00Z"));
    expect([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours()]).toEqual([2027, 0, 1, 0]);
  });
});
