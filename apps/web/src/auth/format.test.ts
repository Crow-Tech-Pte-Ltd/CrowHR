import { describe, expect, it } from "vitest";
import { formatDateTime, greetingName, relativeTime } from "./format.ts";

describe("auth formatting", () => {
  it("formats instants in Singapore time", () => {
    expect(formatDateTime("2026-10-31T01:05:00Z")).toBe("31 Oct 2026, 09:05");
    expect(formatDateTime(null)).toBe("—");
  });
  it("describes recent activity", () => {
    const now = Date.parse("2026-10-31T01:00:00Z");
    expect(relativeTime("2026-10-31T00:59:30Z", now)).toBe("Just now");
    expect(relativeTime("2026-10-31T00:40:00Z", now)).toBe("20 min ago");
    expect(relativeTime("2026-10-30T22:00:00Z", now)).toBe("3 h ago");
    expect(relativeTime(null, now)).toBe("Never");
  });
});

describe("greetingName", () => {
  it("uses the preferred name, else the full name, never the first word", () => {
    expect(greetingName({ preferredName: null, fullName: "Goh Jun Jie", displayName: "Goh Jun Jie" })).toBe(
      "Goh Jun Jie",
    );
    expect(
      greetingName({ preferredName: "Hafiz", fullName: "Muhammad Hafiz bin Ismail", displayName: "Muhammad Hafiz" }),
    ).toBe("Hafiz");
    expect(greetingName({ preferredName: "  ", fullName: "Priya d/o Raman", displayName: "Priya" })).toBe(
      "Priya d/o Raman",
    );
  });
});
