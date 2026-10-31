import { describe, expect, it } from "vitest";
import {
  currencyExponent,
  divRoundHalfUp,
  formatMinor,
  formatRateMicros,
  lineSgdCents,
  MoneyOverflowError,
  parseRateMicros,
  sgd,
  sumCents,
  toSgdCents,
} from "./money.ts";

describe("toSgdCents (integer FX, half-up to the cent)", () => {
  it("MYR 125.50 @ 0.301234 → 3780 (37.804867 rounds down)", () => {
    expect(toSgdCents(12_550, 2, 301_234)).toBe(3780);
  });

  it("JPY 5,000 (exponent 0) @ 0.008912 → 4456", () => {
    expect(toSgdCents(5000, 0, 8912)).toBe(4456);
  });

  it("KWD 1.250 (exponent 3) @ 4.412345 → 552 (5.51543125)", () => {
    expect(currencyExponent("KWD")).toBe(3);
    expect(toSgdCents(1250, 3, 4_412_345)).toBe(552);
  });

  it("rounds exactly .5 cent up, and just below .5 down", () => {
    // USD 0.01 @ 0.500000 = 0.005 SGD = 0.5 cent → 1 cent.
    expect(toSgdCents(1, 2, 500_000)).toBe(1);
    // USD 0.01 @ 0.499999 = 0.49999 cent → 0.
    expect(toSgdCents(1, 2, 499_999)).toBe(0);
    // USD 1.00 @ 1.345 → 134.5 cents → 135.
    expect(toSgdCents(100, 2, 1_345_000)).toBe(135);
  });

  it("is exact where floats are not", () => {
    // 3 × 1.115 = 3.345 exactly → 334.5 cents → 335; float maths gives 334.49999….
    expect(toSgdCents(300, 2, 1_115_000)).toBe(335);
  });

  it("throws instead of losing precision on overflow", () => {
    expect(() => toSgdCents(Number.MAX_SAFE_INTEGER, 0, 999_000_000_000)).toThrow(MoneyOverflowError);
    expect(() => sumCents([Number.MAX_SAFE_INTEGER, 1])).toThrow(MoneyOverflowError);
  });

  it("rejects non-positive or non-integer inputs", () => {
    expect(() => toSgdCents(0, 2, 1)).toThrow(RangeError);
    expect(() => toSgdCents(10.5, 2, 1)).toThrow(RangeError);
    expect(() => toSgdCents(10, 2, -1)).toThrow(RangeError);
    expect(() => toSgdCents(10, 5, 1)).toThrow(RangeError);
  });

  it("SGD lines are their own amount; foreign lines need a known currency and a rate", () => {
    expect(lineSgdCents({ currency: "SGD", amountMinor: 4560, rateMicros: null })).toBe(4560);
    expect(lineSgdCents({ currency: "MYR", amountMinor: 12_550, rateMicros: 301_234 })).toBe(3780);
    expect(() => lineSgdCents({ currency: "XXX", amountMinor: 1, rateMicros: 1 })).toThrow(/Unknown currency/);
    expect(() => lineSgdCents({ currency: "USD", amountMinor: 1, rateMicros: null })).toThrow(/rate/);
  });

  it("divRoundHalfUp", () => {
    expect(divRoundHalfUp(5n, 10n)).toBe(1n);
    expect(divRoundHalfUp(4n, 10n)).toBe(0n);
    expect(divRoundHalfUp(15n, 10n)).toBe(2n);
  });
});

describe("rates and formatting", () => {
  it("parses rates with up to 6 decimal places into millionths", () => {
    expect(parseRateMicros("0.301234")).toBe(301_234);
    expect(parseRateMicros("1.35")).toBe(1_350_000);
    expect(parseRateMicros("105")).toBe(105_000_000);
    expect(parseRateMicros("0.0000001")).toBeNull();
    expect(parseRateMicros("0")).toBeNull();
    expect(parseRateMicros("-1")).toBeNull();
    expect(parseRateMicros("1e3")).toBeNull();
    expect(parseRateMicros("1,35")).toBeNull();
  });

  it("formats", () => {
    expect(formatRateMicros(301_234)).toBe("0.301234");
    expect(sgd(123_456)).toBe("S$1,234.56");
    expect(sgd(5)).toBe("S$0.05");
    expect(formatMinor("JPY", 5000)).toBe("JPY 5,000");
    expect(formatMinor("KWD", 1250)).toBe("KWD 1.250");
    expect(formatMinor("MYR", 12_550)).toBe("MYR 125.50");
  });

  it("knows the exponents of common currencies", () => {
    expect(currencyExponent("sgd")).toBe(2);
    expect(currencyExponent("JPY")).toBe(0);
    expect(currencyExponent("KRW")).toBe(0);
    expect(currencyExponent("BHD")).toBe(3);
    expect(currencyExponent("ZZZ")).toBeNull();
  });
});
