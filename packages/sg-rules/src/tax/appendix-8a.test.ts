import { describe, expect, it } from "vitest";
import { RulesNotAvailableError, SgRulesInputError } from "../errors.ts";
import { APPENDIX_8A_RULES, appendix8aRuleFor } from "../tables/iras-appendices.ts";
import {
  computeCarBenefit,
  computeHotelBenefit,
  computeResidenceBenefit,
  occupationDays,
  type ResidenceInput,
  totalAppendix8a,
} from "./appendix-8a.ts";

/**
 * Vectors are IRAS's own worked examples (research/sg-ir8a-appendices.md):
 * - EN-8A: Explanatory Notes for Form IR8A and Appendix 8A, YA2027, item 12 example.
 * - Accommodation: iras.gov.sg "Accommodation and Related Benefits", Examples 1–4.
 * - Car: iras.gov.sg "Car and Car-related Benefits", Examples 1–5 (income year 2025).
 */

const none = { rentPaidByEmployeeCents: 0, utilitiesCents: 0, servantCents: 0 } as const;

describe("place of residence (Appendix 8A items 1–2)", () => {
  it("reproduces EN-8A's example: owned, fully furnished, AV $40,000 shared by 2 for 90 days", () => {
    const r = computeResidenceBenefit({
      incomeYear: 2026,
      basis: "owned",
      occupiedFrom: "2026-03-01",
      occupiedTo: "2026-05-29",
      employeesSharing: 2,
      annualValueCents: 4_000_000,
      furnishing: "full",
      rentPaidByEmployeeCents: 200_000,
      utilitiesCents: 25_000,
      servantCents: 120_000,
    });
    expect(r).toMatchObject({
      days: 90,
      annualValueForPeriodCents: 493_150, // $40,000/2 × 90/365 = $4,931.5068… → $4,931.50
      annualValueEntered: false,
      furnitureFittingsCents: 246_575, // 50% × $4,931.50
      rentPaidByEmployerCents: null,
      residenceValueCents: 739_725, // 2d $7,397.25
      rentPaidByEmployeeCents: 200_000,
      residenceTaxableCents: 539_725, // 2f $5,397.25
      utilitiesCents: 25_000,
      driverCents: 0,
      servantCents: 120_000,
      householdCents: 145_000, // 2j $1,450.00
      totalCents: 684_725,
    });
    expect(r.working.map((w) => w.code)).toEqual(
      expect.arrayContaining(["A8A_DAYS", "A8A_2A_ANNUAL_VALUE", "A8A_2B_FURNITURE", "A8A_2F_RESIDENCE", "A8A_2J"]),
    );
    expect(r.working.find((w) => w.code === "A8A_2A_ANNUAL_VALUE")?.text).toContain(
      "= ≈$4,931.506849 → $4,931.50 (rounded down to the cent)",
    );
    // With the hotel stay of the same example, the Appendix 8A total is $9,347.25.
    const total = totalAppendix8a(
      {
        residences: [r],
        hotels: [computeHotelBenefit({ costCents: 250_000, paidByEmployeeCents: 0 }, 2026)],
      },
      2026,
    );
    expect(total.totalCents).toBe(934_725);
    expect(total.ir8aD8Dollars).toBe(9_347);
  });

  it("partly furnished premises are valued at 40% of the annual value for the period", () => {
    const r = computeResidenceBenefit({
      incomeYear: 2026,
      basis: "owned",
      occupiedFrom: "2026-01-01",
      occupiedTo: "2026-12-31",
      employeesSharing: 1,
      annualValueCents: 3_000_000,
      furnishing: "partial",
      ...none,
    });
    expect([r.days, r.annualValueForPeriodCents, r.furnitureFittingsCents, r.residenceTaxableCents]).toEqual([
      365, 3_000_000, 1_200_000, 4_200_000,
    ]);
  });

  it("uses an annual value for the period entered by HR (e.g. AV revised mid-year), still computing 2b", () => {
    const r = computeResidenceBenefit({
      incomeYear: 2026,
      basis: "owned",
      occupiedFrom: "2026-01-01",
      occupiedTo: "2026-12-31",
      employeesSharing: 1,
      annualValueForPeriodCents: 2_500_001,
      furnishing: "full",
      ...none,
    });
    expect([r.annualValueForPeriodCents, r.annualValueEntered, r.furnitureFittingsCents]).toEqual([
      2_500_001,
      true,
      1_250_000, // 50% × $25,000.01 = $12,500.005 → rounded down to the cent
    ]);
  });

  it.each([
    // Accommodation Example 1: rent $50,000 incl. F&F, employee pays $6,000 → $44,000.
    ["Example 1", 1, 5_000_000, 600_000, "2026-01-01", "2026-12-31", 4_400_000],
    // Example 2: same, shared with another employee → $50,000/2 − $6,000 = $19,000.
    ["Example 2", 2, 5_000_000, 600_000, "2026-01-01", "2026-12-31", 1_900_000],
    // Example 3: 90 days, rent for the period $15,000, employee pays $2,000 → $13,000 (AV not used).
    ["Example 3", 1, 1_500_000, 200_000, "2026-03-01", "2026-05-29", 1_300_000],
  ])("rented premises, Accommodation %s", (_name, sharing, rent, paid, from, to, taxable) => {
    const r = computeResidenceBenefit({
      incomeYear: 2026,
      basis: "rented",
      occupiedFrom: from,
      occupiedTo: to,
      employeesSharing: sharing,
      rentPaidByEmployerCents: rent,
      ...none,
      rentPaidByEmployeeCents: paid,
    });
    expect(r.residenceTaxableCents).toBe(taxable);
    expect(r.annualValueForPeriodCents).toBeNull();
    expect(r.furnitureFittingsCents).toBeNull();
  });

  it("rounds an apportioned rent down to the cent", () => {
    const r = computeResidenceBenefit({
      incomeYear: 2026,
      basis: "rented",
      occupiedFrom: "2026-01-01",
      occupiedTo: "2026-12-31",
      employeesSharing: 3,
      rentPaidByEmployerCents: 100,
      ...none,
    });
    expect(r.rentPaidByEmployerCents).toBe(33);
  });

  it("clamps the residence value at zero when the employee pays more than it is worth (AIS item D2(f))", () => {
    const r = computeResidenceBenefit({
      incomeYear: 2026,
      basis: "rented",
      occupiedFrom: "2026-01-01",
      occupiedTo: "2026-01-31",
      employeesSharing: 1,
      rentPaidByEmployerCents: 100_000,
      ...none,
      rentPaidByEmployeeCents: 150_000,
    });
    expect(r.residenceTaxableCents).toBe(0);
    expect(r.issues.map((i) => i.code)).toContain("A8A_2F_CLAMPED");
  });

  it("values a driver at annual cost × private ÷ total mileage, without a place of residence", () => {
    const r = computeResidenceBenefit({
      incomeYear: 2026,
      basis: "none",
      occupiedFrom: null,
      occupiedTo: null,
      employeesSharing: 1,
      ...none,
      driver: { annualCostCents: 3_600_000, personalKm: 4_000, totalKm: 12_000 },
    });
    expect([r.days, r.driverCents, r.householdCents, r.residenceTaxableCents, r.totalCents]).toEqual([
      null,
      1_200_000,
      1_200_000,
      0,
      1_200_000,
    ]);
  });

  it("refuses to compute the annual value in a leap year, but accepts one entered by HR", () => {
    const owned: ResidenceInput = {
      incomeYear: 2028,
      basis: "owned",
      occupiedFrom: "2028-01-01",
      occupiedTo: "2028-12-31",
      employeesSharing: 1,
      annualValueCents: 3_000_000,
      furnishing: "full",
      ...none,
    };
    expect(() => computeResidenceBenefit(owned)).toThrow(RulesNotAvailableError);
    expect(() => computeResidenceBenefit(owned)).toThrow(/leap year/);
    const entered = computeResidenceBenefit({ ...owned, annualValueCents: null, annualValueForPeriodCents: 3_000_000 });
    expect([entered.days, entered.furnitureFittingsCents]).toEqual([366, 1_500_000]);
  });

  it.each<[string, Partial<ResidenceInput>, RegExp]>([
    ["dates outside the year", { occupiedFrom: "2025-12-31" }, /must be in 2026/],
    ["dates in the wrong order", { occupiedFrom: "2026-06-02", occupiedTo: "2026-06-01" }, /on or before/],
    ["missing dates", { occupiedTo: null }, /period of occupation/],
    ["sharing of 0", { employeesSharing: 0 }, /1 to 999/],
    ["rented without rent", { basis: "rented", annualValueCents: null, furnishing: null }, /rent the employer paid/],
    ["annual value on rented premises", { basis: "rented", rentPaidByEmployerCents: 100 }, /valued at the rent paid/],
    ["owned without annual value", { annualValueCents: null }, /annual value/],
    ["owned with both annual values", { annualValueForPeriodCents: 100 }, /not both/],
    ["owned without furnishing", { furnishing: null }, /partly furnished/],
    ["rent on owned premises", { rentPaidByEmployerCents: 100 }, /owns/],
    ["negative amount", { utilitiesCents: -1 }, /negative/],
    ["fractional cents", { servantCents: 1.5 }, /integer cents/],
    ["driver mileage above total", { driver: { annualCostCents: 100, personalKm: 2, totalKm: 1 } }, /private mileage/],
    ["driver without mileage", { driver: { annualCostCents: 100, personalKm: 0, totalKm: 0 } }, /total mileage/],
    ["an amount above IRAS's field size", { utilitiesCents: 1_000_000_000 }, /9,999,999.99/],
  ])("rejects %s with a message saying how to fix it", (_name, patch, message) => {
    const base: ResidenceInput = {
      incomeYear: 2026,
      basis: "owned",
      occupiedFrom: "2026-01-01",
      occupiedTo: "2026-12-31",
      employeesSharing: 1,
      annualValueCents: 1_000_000,
      furnishing: "full",
      ...none,
    };
    const run = () => computeResidenceBenefit({ ...base, ...patch });
    expect(run).toThrow(SgRulesInputError);
    expect(run).toThrow(message);
  });

  it("rejects an empty 'no place of residence' record and rent or dates on one", () => {
    const base: ResidenceInput = {
      incomeYear: 2026,
      basis: "none",
      occupiedFrom: null,
      occupiedTo: null,
      employeesSharing: 1,
      ...none,
    };
    expect(() => computeResidenceBenefit(base)).toThrow(/Nothing to report/);
    expect(() => computeResidenceBenefit({ ...base, utilitiesCents: 1, annualValueCents: 5 })).toThrow(
      /no place of residence/,
    );
    expect(() => computeResidenceBenefit({ ...base, utilitiesCents: 1, rentPaidByEmployeeCents: 5 })).toThrow(
      /no place of residence/,
    );
  });

  it("counts both ends of the period", () => {
    expect(occupationDays(2026, "2026-03-01", "2026-05-29")).toBe(90);
    expect(occupationDays(2026, "2026-12-31", "2026-12-31")).toBe(1);
    expect(occupationDays(2028, "2028-01-01", "2028-12-31")).toBe(366);
  });
});

describe("hotel accommodation (item 3)", () => {
  it("is the actual cost less what the employee paid (Accommodation Example 4)", () => {
    const h = computeHotelBenefit({ costCents: 620_000, paidByEmployeeCents: 50_000 }, 2026);
    expect(h.taxableCents).toBe(570_000);
    expect(h.working[0]?.text).toContain("$5,700.00");
  });

  it("rejects a payment above the cost (nothing to report)", () => {
    expect(() => computeHotelBenefit({ costCents: 100, paidByEmployeeCents: 101 }, 2026)).toThrow(
      /more than the stay cost/,
    );
  });
});

describe("car benefit (item 4i), IRAS Car Examples 1–5", () => {
  it("Example 1: new car for the whole of 2025 → $8,592", () => {
    const c = computeCarBenefit({
      incomeYear: 2025,
      kind: "new",
      usedFrom: "2025-01-01",
      usedTo: "2025-12-31",
      costCents: 12_000_000,
      parfRebateCents: 2_400_000,
      runningCostsCents: 1_045_000,
    });
    // 3/7 × [($120,000 − $24,000)/10 + $10,450] = 3/7 × $20,050 = $8,592.857…
    expect([c.days, c.daysInYear, c.valueCents]).toEqual([365, 365, 859_285]);
    expect(c.working.at(-1)?.text).toContain("$8,592.85");
  });

  it("Example 2: new car from 1 Aug 2025 (153 days) → $5,793", () => {
    const c = computeCarBenefit({
      incomeYear: 2025,
      kind: "new",
      usedFrom: "2025-08-01",
      usedTo: "2025-12-31",
      costCents: 15_764_000,
      parfRebateCents: 2_600_000,
      runningCostsCents: 800_000,
    });
    expect(c.days).toBe(153);
    expect(Math.floor(c.valueCents / 100)).toBe(5_793);
  });

  it("Example 3: second-hand car, COE expiring in 6 years 2 months counted as 7 → $5,533", () => {
    const c = computeCarBenefit({
      incomeYear: 2025,
      kind: "second_hand",
      usedFrom: "2025-08-01",
      usedTo: "2025-12-31",
      costCents: 10_502_500,
      parfRebateCents: 2_800_000,
      coeYears: 7,
      runningCostsCents: 830_000,
    });
    expect(Math.floor(c.valueCents / 100)).toBe(5_533);
  });

  it("Example 4: COE renewed for 5 years → $1,420 + $6,196 (IRAS rounds each period to dollars)", () => {
    const before = computeCarBenefit({
      incomeYear: 2025,
      kind: "new",
      usedFrom: "2025-01-01",
      usedTo: "2025-03-31",
      costCents: 8_000_000,
      parfRebateCents: 1_050_000,
      runningCostsCents: 160_000,
    });
    const after = computeCarBenefit({
      incomeYear: 2025,
      kind: "renewed_coe",
      usedFrom: "2025-04-01",
      usedTo: "2025-12-31",
      costCents: 2_500_000,
      parfRebateCents: 1_050_000,
      coeYears: 5,
      runningCostsCents: 911_000,
    });
    expect([before.days, after.days]).toEqual([90, 275]);
    expect([Math.floor(before.valueCents / 100), Math.floor(after.valueCents / 100)]).toEqual([1_420, 6_196]);
    // Each period rounded down to the cent: $1,420.15 + $6,196.84 = $7,616.99, i.e. IRAS's $7,616 in d8.
    const total = totalAppendix8a({ cars: [before, after] }, 2025);
    expect([total.items["4i"], total.ir8aD8Dollars]).toEqual([761_699, 7_616]);
  });

  it("Example 5: leased car → $15,642", () => {
    const c = computeCarBenefit({
      incomeYear: 2025,
      kind: "leased",
      usedFrom: "2025-01-01",
      usedTo: "2025-12-31",
      rentalCents: 3_000_000,
      runningCostsCents: 650_000,
    });
    expect(c.valueCents).toBe(1_564_285);
  });

  it("divides by 366 days in a leap year, as IRAS's car benefit calculator does", () => {
    const c = computeCarBenefit({
      incomeYear: 2028,
      kind: "new",
      usedFrom: "2028-01-01",
      usedTo: "2028-01-31",
      costCents: 3_660_000,
      parfRebateCents: 0,
      runningCostsCents: 0,
    });
    // 3/7 × ($36,600/10 × 31/366) = 3/7 × $310 = $132.857…
    expect([c.daysInYear, c.valueCents]).toEqual([366, 13_285]);
  });

  it.each<[string, Parameters<typeof computeCarBenefit>[0], RegExp]>([
    [
      "PARF above cost",
      {
        incomeYear: 2026,
        kind: "new",
        usedFrom: "2026-01-01",
        usedTo: "2026-01-31",
        costCents: 1,
        parfRebateCents: 2,
        runningCostsCents: 0,
      },
      /PARF rebate cannot be more than the car cost/,
    ],
    [
      "second-hand without COE years",
      {
        incomeYear: 2026,
        kind: "second_hand",
        usedFrom: "2026-01-01",
        usedTo: "2026-01-31",
        costCents: 1,
        parfRebateCents: 0,
        runningCostsCents: 0,
      },
      /years from purchase to COE expiry/,
    ],
    [
      "renewed COE of 7 years",
      {
        incomeYear: 2026,
        kind: "renewed_coe",
        usedFrom: "2026-01-01",
        usedTo: "2026-01-31",
        costCents: 1,
        parfRebateCents: 0,
        coeYears: 7,
        runningCostsCents: 0,
      },
      /5 or 10 years/,
    ],
    [
      "leased without rental",
      { incomeYear: 2026, kind: "leased", usedFrom: "2026-01-01", usedTo: "2026-01-31", runningCostsCents: 0 },
      /rental/,
    ],
    [
      "leased with a car cost",
      {
        incomeYear: 2026,
        kind: "leased",
        usedFrom: "2026-01-01",
        usedTo: "2026-01-31",
        rentalCents: 1,
        costCents: 5,
        runningCostsCents: 0,
      },
      /leased car has no car cost/,
    ],
    [
      "new car without cost",
      { incomeYear: 2026, kind: "new", usedFrom: "2026-01-01", usedTo: "2026-01-31", runningCostsCents: 0 },
      /car cost/,
    ],
    [
      "use outside the year",
      {
        incomeYear: 2026,
        kind: "leased",
        usedFrom: "2026-12-01",
        usedTo: "2027-01-31",
        rentalCents: 1,
        runningCostsCents: 0,
      },
      /must be in 2026/,
    ],
  ])("rejects %s", (_name, input, message) => {
    expect(() => computeCarBenefit(input)).toThrow(SgRulesInputError);
    expect(() => computeCarBenefit(input)).toThrow(message);
  });
});

describe("Appendix 8A total and IR8A d8", () => {
  it("adds 2f, 2j, 3c and 4a–4j, then drops the decimals for IR8A d8", () => {
    const t = totalAppendix8a(
      {
        hotels: [
          computeHotelBenefit({ costCents: 100_050, paidByEmployeeCents: 0 }, 2026),
          computeHotelBenefit({ costCents: 20_000, paidByEmployeeCents: 5_000 }, 2026),
        ],
        others: [
          { item: "4a", amountCents: 300_000 },
          { item: "4a", amountCents: 25 },
          { item: "4j", amountCents: 49 },
        ],
      },
      2026,
    );
    expect(t.hotel).toEqual({ costCents: 120_050, paidByEmployeeCents: 5_000, taxableCents: 115_050 });
    expect(t.items["4a"]).toBe(300_025);
    expect(t.items["4j"]).toBe(49);
    expect(t.totalCents).toBe(415_124);
    expect(t.ir8aD8Dollars).toBe(4_151);
    expect(t.issues).toEqual([]);
  });

  it("is zero with nothing recorded", () => {
    expect(totalAppendix8a({}, 2026)).toMatchObject({ totalCents: 0, ir8aD8Dollars: 0 });
  });

  it("flags a field above the $9,999,999.99 IRAS's form accepts", () => {
    const t = totalAppendix8a(
      {
        others: [
          { item: "4c", amountCents: 999_999_999 },
          { item: "4c", amountCents: 1 },
        ],
      },
      2026,
    );
    expect(t.issues.map((i) => i.code)).toContain("A8A_FIELD_TOO_LARGE");
  });

  it("rejects an unknown item or a bad amount", () => {
    expect(() => totalAppendix8a({ others: [{ item: "4z" as "4a", amountCents: 1 }] }, 2026)).toThrow(/item/);
    expect(() => totalAppendix8a({ others: [{ item: "4b", amountCents: -1 }] }, 2026)).toThrow(/negative/);
  });
});

describe("Appendix 8A rule table", () => {
  it("is cited and in force for income years 2025 onwards", () => {
    expect(appendix8aRuleFor(2026)).toBe(APPENDIX_8A_RULES[0]);
    for (const r of APPENDIX_8A_RULES) expect(r.source).toMatch(/^https:\/\/www\.iras\.gov\.sg\//);
    expect(() => appendix8aRuleFor(2024)).toThrow(RulesNotAvailableError);
    expect(() => appendix8aRuleFor(1.5)).toThrow(SgRulesInputError);
  });
});
