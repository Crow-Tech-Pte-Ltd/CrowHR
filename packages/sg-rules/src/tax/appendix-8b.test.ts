import { describe, expect, it } from "vitest";
import { RulesNotAvailableError, SgRulesInputError } from "../errors.ts";
import { APPENDIX_8B_RULES, appendix8bRuleFor } from "../tables/iras-appendices.ts";
import {
  computeShareGain,
  formatDecimalUnits,
  parseDecimalUnits,
  type ShareGainInput,
  totalAppendix8b,
} from "./appendix-8b.ts";

/**
 * Vectors: IRAS e-Tax Guide "Tax Treatment of ESOP and Other Forms of ESOW Plans" (6th ed., 30 Jan
 * 2026), Annex C Examples 1 and 2; the rounding and section split are AIS-API data items E1(h), E2, E3.
 */

const base: ShareGainInput = {
  incomeYear: 2026,
  planType: "ESOP",
  grantedOn: "2024-03-01",
  eventDate: "2026-05-04",
  exercisePrice: "5",
  openMarketValue: "7",
  shares: "5000",
};

describe("Appendix 8B gross gain (f − e) × g", () => {
  it("Annex C Example 1: restricted ESOP, moratorium lifted 4 May 2025, ($7.00 − $5.00) × 5,000 = $10,000", () => {
    const g = computeShareGain({ ...base, incomeYear: 2025, grantedOn: "2022-03-01", eventDate: "2025-05-04" });
    expect(g).toMatchObject({ grossGainCents: 1_000_000, section: "S10_1_B" });
    expect(g.working.at(-1)?.text).toContain("$10,000.00");
  });

  it("Annex C Example 2's arithmetic: ESOW shares at no cost, $3.20 × 10,000 = $32,000 (S10(1)(b))", () => {
    const g = computeShareGain({
      ...base,
      planType: "ESOW",
      grantedOn: "2025-06-01",
      eventDate: "2026-06-01",
      exercisePrice: "0",
      openMarketValue: "3.20",
      shares: "10000",
    });
    expect(g).toMatchObject({ grossGainCents: 3_200_000, section: "S10_1_B" });
  });

  it("drops decimals beyond the cent (AIS item E1(h))", () => {
    // (1.23456 − 0.00001) × 3.33333 = 4.1151… → $4.11
    const g = computeShareGain({ ...base, exercisePrice: "0.00001", openMarketValue: "1.23456", shares: "3.33333" });
    expect(g.grossGainCents).toBe(411);
  });

  it("puts ESOP granted before 1 Jan 2003 under S10(1)(g), and ESOW of any date under S10(1)(b)", () => {
    expect(computeShareGain({ ...base, grantedOn: "2002-12-31" }).section).toBe("S10_1_G");
    expect(computeShareGain({ ...base, grantedOn: "2003-01-01" }).section).toBe("S10_1_B");
    expect(computeShareGain({ ...base, planType: "ESOW", grantedOn: "2002-12-31" }).section).toBe("S10_1_B");
  });

  it.each<[string, Partial<ShareGainInput>, RegExp]>([
    ["a loss", { openMarketValue: "4.99" }, /does not take losses/],
    ["no gain", { openMarketValue: "5" }, /does not take losses/],
    ["an event outside the income year", { eventDate: "2025-12-31" }, /must be in 2026/],
    ["an event before the grant", { grantedOn: "2026-06-01", eventDate: "2026-05-31" }, /before the date of grant/],
    ["a grant in the future", { grantedOn: "2026-12-01", eventDate: "2026-12-02", today: "2026-11-13" }, /future/],
    ["zero shares", { shares: "0" }, /number of shares/],
    ["zero open market value", { openMarketValue: "0", exercisePrice: "0" }, /open market value/],
    ["six decimal places", { openMarketValue: "7.123456" }, /5 decimal places/],
    ["ten integer digits", { shares: "1234567890" }, /9 digits/],
    ["a negative price", { exercisePrice: "-1" }, /decimal number/],
    ["an exponent", { shares: "1e3" }, /decimal number/],
    ["an unknown plan", { planType: "ERIS" as "ESOP" }, /ESOP or ESOW/],
    ["a bad date", { grantedOn: "2026-02-30" }, /not a real calendar date/],
  ])("rejects %s with a message saying how to fix it", (_name, patch, message) => {
    const run = () => computeShareGain({ ...base, ...patch });
    expect(run).toThrow(SgRulesInputError);
    expect(run).toThrow(message);
  });

  it("rejects a gain larger than IRAS's field (Decimals 9,2)", () => {
    expect(() =>
      computeShareGain({ ...base, exercisePrice: "0", openMarketValue: "999999999", shares: "999999999" }),
    ).toThrow(/999,999,999.99/);
  });
});

describe("Appendix 8B totals and IR8A d7", () => {
  it("sums each section and drops the decimals for IR8A d7(a) and d7(b)", () => {
    const b = computeShareGain({ ...base, openMarketValue: "7.00008", shares: "5000" }); // $10,000.40
    const g = computeShareGain({ ...base, grantedOn: "2001-01-01", openMarketValue: "5.5", shares: "3" }); // $1.50
    const t = totalAppendix8b([b, g, { grossGainCents: 99, section: "S10_1_B" }]);
    expect(t).toEqual({ s101bCents: 1_000_139, s101gCents: 150, ir8aD7aDollars: 10_001, ir8aD7bDollars: 1 });
    expect(totalAppendix8b([])).toEqual({ s101bCents: 0, s101gCents: 0, ir8aD7aDollars: 0, ir8aD7bDollars: 0 });
  });
});

describe("decimal share prices and counts", () => {
  it("parses and prints up to 5 decimal places exactly", () => {
    expect(parseDecimalUnits("1.5", "Price", 2026)).toBe(150_000n);
    expect(parseDecimalUnits("0.00001", "Price", 2026)).toBe(1n);
    expect(parseDecimalUnits("123456789.12345", "Price", 2026)).toBe(12_345_678_912_345n);
    expect(formatDecimalUnits(150_000n)).toBe("1.5");
    expect(formatDecimalUnits(1n)).toBe("0.00001");
    expect(formatDecimalUnits(500_000_000n)).toBe("5000");
    expect(formatDecimalUnits(0n)).toBe("0");
  });
});

describe("Appendix 8B rule table", () => {
  it("is cited and in force for income years 2025 onwards", () => {
    expect(appendix8bRuleFor(2027)).toBe(APPENDIX_8B_RULES[0]);
    expect(APPENDIX_8B_RULES[0]?.source).toBe("https://file.go.gov.sg/aisapi2-dataitems.xlsx");
    expect(() => appendix8bRuleFor(2024)).toThrow(RulesNotAvailableError);
  });
});
