import { describe, expect, it } from "vitest";
import { RulesNotAvailableError } from "./errors.ts";
import { estimateLevy, FWL_DEDUCTIBLE_FROM_SALARY } from "./fwl.ts";
import { computeSdl, computeSdlTotal } from "./sdl.ts";
import { computeShg, determineShgFunds, raceLabel, residencyLabel } from "./shg.ts";

describe("SDL", () => {
  it("is zero, not the $2 minimum, when no wages are paid or payable", () => {
    const r = computeSdl({ month: "2026-10", totalWagesCents: 0 });
    expect(r).toMatchObject({ liable: false, units1e4Cent: 0, exactDollars: "0.00", appliedLimit: null });
  });

  it("applies the minimum from 1 cent and records exemptions", () => {
    expect(computeSdl({ month: "2026-10", totalWagesCents: 1 })).toMatchObject({
      units1e4Cent: 2_000_000,
      appliedLimit: "MINIMUM",
    });
    const ex = computeSdl({ month: "2026-10", totalWagesCents: 300_000, exemption: "SCHOOL_HOLIDAY_STUDENT" });
    expect(ex).toMatchObject({ liable: false, units1e4Cent: 0, exemption: "SCHOOL_HOLIDAY_STUDENT" });
    expect(ex.issues.map((i) => i.code)).toEqual(["SDL_EXEMPTION_EVIDENCE"]);
  });

  it("uses the SSG row before 1 Jul 2026 and the SWDA row after (same parameters)", () => {
    expect(computeSdl({ month: "2026-06", totalWagesCents: 200_000 }).rate.administeredBy).toMatch(/SSG/);
    expect(computeSdl({ month: "2026-07", totalWagesCents: 200_000 }).rate.administeredBy).toMatch(/SWDA/);
    expect(computeSdl({ month: "2008-10", totalWagesCents: 200_000 }).units1e4Cent).toBe(5_000_000);
    expect(() => computeSdl({ month: "2008-09", totalWagesCents: 200_000 })).toThrow(RulesNotAvailableError);
  });

  it("sums exact amounts and floors the employer total once", () => {
    const t = computeSdlTotal(
      [123_456, 123_456, 123_456].map((w) => computeSdl({ month: "2026-10", totalWagesCents: w })),
    );
    expect(t).toMatchObject({ exactDollars: "9.2592", payableCents: 900 });
    expect(t.working[0]?.text).toBe("SDL for 3 employee(s) = $9.2592 exact → rounded down to $9.00 payable.");
    expect(computeSdlTotal([])).toMatchObject({ payableCents: 0 });
  });
});

describe("SHG fund determination", () => {
  const sc = { residency: "SC" as const, isMuslim: false };
  it.each([
    [{ ...sc, race: ["Chinese"] }, ["CDAC"]],
    [{ ...sc, residency: "SPR" as const, race: ["Eurasian"] }, ["ECF"]],
    [{ ...sc, race: ["Indian", "Chinese"] }, ["SINDA"]],
    [{ ...sc, race: ["Tamil"] }, ["SINDA"]],
    [{ ...sc, race: ["Indian"], isMuslim: true }, ["MBMF", "SINDA"]],
    [{ ...sc, race: ["Malay"] }, []],
    [{ ...sc, race: ["Malay"], isMuslim: true }, ["MBMF"]],
    [{ residency: "FOREIGNER" as const, passType: "EP" as const, race: ["Indian"], isMuslim: false }, ["SINDA"]],
    [{ residency: "FOREIGNER" as const, passType: "S_PASS" as const, race: ["Indian"], isMuslim: false }, []],
    [
      { residency: "FOREIGNER" as const, passType: "WORK_PERMIT" as const, race: ["Bangladeshi"], isMuslim: true },
      ["MBMF"],
    ],
    [{ residency: "FOREIGNER" as const, passType: "EP" as const, race: ["Chinese"], isMuslim: false }, []],
    [{ ...sc, race: ["Chinese"], elections: { optedOut: ["CDAC" as const] } }, []],
    [{ ...sc, race: ["Indian", "Chinese"], elections: { additional: ["CDAC" as const] } }, ["CDAC", "SINDA"]],
  ])("%j → %j", (input, funds) => {
    expect(determineShgFunds(input).funds).toEqual(funds);
  });

  it("warns when race is missing, notes opt-out evidence and multiple funds, never guesses", () => {
    expect(determineShgFunds({ ...sc, race: [] }).issues.map((i) => i.code)).toEqual(["SHG_RACE_MISSING"]);
    expect(
      determineShgFunds({ residency: "FOREIGNER", passType: "WORK_PERMIT", race: [], isMuslim: false }).issues,
    ).toEqual([]);
    expect(determineShgFunds({ ...sc, race: ["Chinese"], elections: { optedOut: ["CDAC"] } }).issues[0]?.code).toBe(
      "SHG_OPT_OUT_EVIDENCE",
    );
    expect(determineShgFunds({ ...sc, race: ["Indian"], isMuslim: true }).issues.map((i) => i.code)).toEqual([
      "SHG_MULTIPLE_FUNDS",
    ]);
  });
});

describe("SHG working text", () => {
  it("names races and residency in words, not as stored codes", () => {
    const text = (input: Parameters<typeof determineShgFunds>[0]) =>
      determineShgFunds(input)
        .working.map((w) => w.text)
        .join(" ");
    expect(text({ residency: "SC", race: ["chinese"], isMuslim: false })).toBe("Chinese, Singapore Citizen → CDAC.");
    expect(text({ residency: "SPR", race: ["EURASIAN"], isMuslim: false })).toBe(
      "Eurasian, Singapore Permanent Resident → ECF.",
    );
    expect(text({ residency: "SC", race: ["sri_lankan"], isMuslim: false })).toBe(
      "Sri Lankan (Indian descent), Singapore Citizen → SINDA.",
    );
    expect(text({ residency: "SC", race: ["malay", "chinese"], isMuslim: false })).toContain(
      "Double-barrelled race Malay-Chinese: the first race listed (Malay) determines the fund.",
    );
    expect(raceLabel("indian")).toBe("Indian");
    expect(residencyLabel("FOREIGNER")).toBe("Foreigner");
  });
});

describe("SHG contributions", () => {
  it("uses fixed amounts when agreed, and nothing when no wages are paid", () => {
    const r = computeShg({
      month: "2026-10",
      totalWagesCents: 350_000,
      funds: ["MBMF", "SINDA"],
      fixedAmountsCents: { MBMF: 500 },
    });
    expect(r.byFund).toEqual({ MBMF: 500, SINDA: 700 });
    expect(computeShg({ month: "2026-10", totalWagesCents: 0, funds: ["CDAC"] }).totalCents).toBe(0);
  });

  it("warns at $50 or less and rejects a fund listed twice", () => {
    expect(computeShg({ month: "2026-10", totalWagesCents: 5_000, funds: ["CDAC"] }).issues[0]?.code).toBe(
      "SHG_VERY_LOW_WAGES",
    );
    expect(() => computeShg({ month: "2026-10", totalWagesCents: 100, funds: ["CDAC", "CDAC"] })).toThrow(/twice/);
  });
});

describe("FWL estimate (never a deduction)", () => {
  const sPass = { pass: "S_PASS" as const, sector: "ALL", tier: "ALL", skill: null, passIssuedOn: "2025-01-10" };

  it("is never deductible from salary", () => {
    expect(FWL_DEDUCTIBLE_FROM_SALARY).toBe(false);
  });

  it("charges the monthly rate for a full month and labels it an estimate", () => {
    const r = estimateLevy({ ...sPass, month: "2026-10" });
    expect(r).toMatchObject({ basis: "ESTIMATE", estimateCents: 65_000, fullMonth: true, liableDays: 31 });
    expect(r.label).toBe("Estimate — MOM levy bill is authoritative");
  });

  it("uses ceil(monthly × 12 / 365) per day for part months", () => {
    expect(estimateLevy({ ...sPass, month: "2026-10", passIssuedOn: "2026-10-15" }).estimateCents).toBe(17 * 2_137);
    const cancelled = estimateLevy({
      ...sPass,
      month: "2026-10",
      passEnds: { date: "2026-10-20", reason: "CANCELLED" },
    });
    expect(cancelled).toMatchObject({ liableDays: 19, estimateCents: 19 * 2_137 });
    expect(cancelled.issues.map((i) => i.code)).toContain("FWL_PART_MONTH_DAY_COUNT");
    expect(
      estimateLevy({ ...sPass, month: "2026-10", passEnds: { date: "2026-10-20", reason: "EXPIRED" } }).liableDays,
    ).toBe(20);
    expect(estimateLevy({ ...sPass, month: "2026-10", waiverDays: 7 }).estimateCents).toBe(24 * 2_137);
    expect(
      estimateLevy({ ...sPass, month: "2026-10", passEnds: { date: "2026-09-01", reason: "CANCELLED" } }).estimateCents,
    ).toBe(0);
  });

  it("finds Work Permit rates by sector, tier and skill and refuses unknown ones", () => {
    const wp = {
      pass: "WORK_PERMIT" as const,
      sector: "SERVICES",
      tier: "TIER_1",
      skill: "BASIC_SKILLED",
      passIssuedOn: "2024-05-01",
    };
    expect(estimateLevy({ ...wp, month: "2026-10" }).estimateCents).toBe(45_000);
    expect(() => estimateLevy({ ...wp, tier: "TIER_9", month: "2026-10" })).toThrow(RulesNotAvailableError);
    expect(() => estimateLevy({ ...wp, month: "2026-10", waiverDays: -1 })).toThrow(/waiverDays/);
  });
});
