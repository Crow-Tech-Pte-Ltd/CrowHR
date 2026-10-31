import { describe, expect, it } from "vitest";
import { SgRulesInputError } from "../errors.ts";
import { addMonths, dateLabel, epochDay, fromEpochDay, monthOf, parseDate } from "./dates.ts";
import {
  add,
  ceilToCent,
  compare,
  exactCents,
  exactDollarsText,
  exactToString,
  floorToCent,
  floorToDollar,
  isNegative,
  roundHalfUpToCent,
  roundHalfUpToDollar,
  sub,
} from "./exact.ts";
import { assertCents, coefficient, money, pct } from "./money.ts";

describe("exact arithmetic and named rounding", () => {
  it("rounds half up to the dollar on the exact value", () => {
    expect(roundHalfUpToDollar(exactCents(37_049_58, 100))).toBe(37_000); // $370.4958
    expect(roundHalfUpToDollar(exactCents(49_950))).toBe(50_000); // $499.50
    expect(roundHalfUpToDollar(exactCents(-150))).toBe(-100); // half up, towards +∞
    expect(floorToDollar(exactCents(-1))).toBe(-100);
    expect(floorToDollar(exactCents(19_999))).toBe(19_900);
  });

  it("rounds to cents", () => {
    expect(roundHalfUpToCent(exactCents(5, 2))).toBe(3);
    expect(ceilToCent(exactCents(5_400, 365))).toBe(15);
    expect(floorToCent(exactCents(-1, 3))).toBe(-1);
  });

  it("normalises, compares and subtracts", () => {
    expect(exactCents(4, -8)).toEqual({ n: -1n, d: 2n });
    expect(() => exactCents(1, 0)).toThrow(SgRulesInputError);
    expect(compare(exactCents(1, 3), exactCents(1, 2))).toBe(-1);
    expect(compare(exactCents(2, 4), exactCents(1, 2))).toBe(0);
    expect(isNegative(sub(exactCents(1), exactCents(2)))).toBe(true);
    expect(exactToString(add(exactCents(1, 3), exactCents(2, 3)))).toBe("1");
    expect(() => roundHalfUpToCent(exactCents(2n ** 60n))).toThrow(/safe integer/);
  });

  it("prints terminating decimals in full and others approximately", () => {
    expect(exactDollarsText(exactCents(123_456_789))).toBe("1,234,567.89");
    expect(exactDollarsText(exactCents(1, 3))).toBe("≈0.003333");
    expect(exactDollarsText(exactCents(-5))).toBe("-0.05");
  });
});

describe("money helpers", () => {
  it("formats and validates", () => {
    expect(money(-123_456)).toBe("-$1,234.56");
    expect(pct(1250)).toBe("12.5%");
    expect(pct(25)).toBe("0.25%");
    expect(coefficient(3750)).toBe("0.375");
    expect(() => assertCents(Number.MAX_SAFE_INTEGER + 1, "x")).toThrow(/safe integer/);
    expect(() => assertCents(-1, "x", { allowNegative: true })).not.toThrow();
  });
});

describe("dates", () => {
  it("parses, labels and does calendar arithmetic", () => {
    expect(() => parseDate("2026-1-1")).toThrow(/YYYY-MM-DD/);
    expect(addMonths("2026-12", 1)).toBe("2027-01");
    expect(addMonths("2026-01", -1)).toBe("2025-12");
    expect(monthOf("2026-02-28")).toBe("2026-02");
    expect(dateLabel("2026-01-13")).toBe("13 Jan 2026");
    expect(fromEpochDay(epochDay("2028-02-29") + 1)).toBe("2028-03-01");
  });
});
