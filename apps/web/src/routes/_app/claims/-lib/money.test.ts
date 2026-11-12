import { describe, expect, it } from "vitest";
import { formatBasisPoints, formatMinorAmount, parseMinor, parseRateMicros, previewSgd, toSgdCents } from "./money.ts";

describe("claim form money helpers (mirror core claims/money.ts)", () => {
  it("converts with integer half-up rounding", () => {
    expect(toSgdCents(12_550, 2, 301_234)).toBe(3780);
    expect(toSgdCents(5000, 0, 8912)).toBe(4456);
    expect(toSgdCents(1, 2, 500_000)).toBe(1);
    expect(toSgdCents(300, 2, 1_115_000)).toBe(335);
  });

  it("parses amounts in the currency's minor units without floats", () => {
    expect(parseMinor("125.50", 2)).toBe(12_550);
    expect(parseMinor("1,234.5", 2)).toBe(123_450);
    expect(parseMinor("5,000", 0)).toBe(5000);
    expect(parseMinor("5.5", 0)).toBeNull();
    expect(parseMinor("1.234", 2)).toBeNull();
    expect(parseMinor("1.250", 3)).toBe(1250);
    expect(parseMinor("0", 2)).toBeNull();
    expect(parseMinor("abc", 2)).toBeNull();
  });

  it("parses rates and previews the SGD amount", () => {
    expect(parseRateMicros("0.301234")).toBe(301_234);
    expect(parseRateMicros("0.3012345")).toBeNull();
    expect(previewSgd("MYR", 12_550, "0.301234")).toBe(3780);
    expect(previewSgd("SGD", 4560, null)).toBe(4560);
    expect(previewSgd("USD", 1000, "")).toBeNull();
    expect(formatMinorAmount(5000, 0)).toBe("5,000");
    expect(formatMinorAmount(12_550, 2)).toBe("125.50");
  });
});

describe("exchange-rate warning percentage", () => {
  it("shows basis points as a percentage with two decimals, without the sign", () => {
    expect(formatBasisPoints(3334)).toBe("33.34%");
    expect(formatBasisPoints(-2001)).toBe("20.01%");
    expect(formatBasisPoints(5)).toBe("0.05%");
  });
});
