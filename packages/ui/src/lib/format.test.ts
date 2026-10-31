import { describe, expect, it } from "vitest";
import { formatDate, formatMoney, fromIsoDate, initials, maskNric, parseMoneyToCents, toIsoDate } from "./format.ts";

describe("formatMoney", () => {
  it.each([
    [0, "S$0.00"],
    [5, "S$0.05"],
    [123456, "S$1,234.56"],
    [100000000, "S$1,000,000.00"],
    [-500, "-S$5.00"],
    [Number.MAX_SAFE_INTEGER, "S$90,071,992,547,409.91"],
  ])("%i cents → %s", (cents, expected) => {
    expect(formatMoney(cents)).toBe(expected);
  });

  it("omits the symbol on request", () => {
    expect(formatMoney(123456, { symbol: false })).toBe("1,234.56");
  });

  it("refuses non-integer or unsafe cents", () => {
    expect(() => formatMoney(1.5)).toThrow(RangeError);
    expect(() => formatMoney(2 ** 53)).toThrow(RangeError);
  });
});

describe("parseMoneyToCents", () => {
  it.each([
    ["1234", 123400],
    ["1,234.5", 123450],
    ["S$1,234.56", 123456],
    ["s$ 12", 1200],
    ["$0.07", 7],
    [".5", 50],
    ["10.", 1000],
    ["-3.10", -310],
    ["0.1", 10],
    ["0.29", 29], // 0.29 * 100 = 28.999999999999996 in floats — must not happen
  ])("%j → %i", (input, cents) => {
    expect(parseMoneyToCents(input)).toEqual({ ok: true, cents });
  });

  it.each([
    ["", "empty"],
    ["  ", "empty"],
    ["abc", "invalid"],
    ["1.2.3", "invalid"],
    [".", "invalid"],
    ["1.234", "too_many_decimals"],
    ["99999999999999999", "too_large"],
  ])("%j → %s", (input, reason) => {
    expect(parseMoneyToCents(input)).toEqual({ ok: false, reason });
  });
});

describe("dates", () => {
  it("formats ISO dates without timezone drift", () => {
    expect(formatDate("2026-10-31")).toBe("31 Oct 2026");
    expect(formatDate("2026-01-05T23:30:00+08:00")).toBe("5 Jan 2026");
  });

  it("round-trips local dates", () => {
    expect(toIsoDate(fromIsoDate("2026-02-28"))).toBe("2026-02-28");
    expect(formatDate(fromIsoDate("2026-12-01"))).toBe("1 Dec 2026");
  });
});

describe("maskNric", () => {
  it("masks NRIC/FIN as S****567D", () => {
    expect(maskNric("S1234567D")).toBe("S****567D");
    expect(maskNric("g7654321k")).toBe("G****321K");
  });

  it("fully masks anything else", () => {
    expect(maskNric("hello")).toBe("*********");
  });
});

describe("initials", () => {
  it("takes the first two words", () => {
    expect(initials("Tan Mei Ling")).toBe("TM");
    expect(initials("Arjun")).toBe("A");
  });
});
