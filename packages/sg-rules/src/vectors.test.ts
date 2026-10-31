/**
 * Research test vectors (research/sg-test-vectors.json, copied with two documented corrections to
 * src/__fixtures__/sg-test-vectors.json). One test per vector; every amount asserted to the cent.
 */
import { describe, expect, it } from "vitest";
import vectors from "./__fixtures__/sg-test-vectors.json" with { type: "json" };
import { type CpfAwPayment, type CpfResidency, computeCpf } from "./cpf/index.ts";
import { computeSdl, computeSdlTotal } from "./sdl.ts";
import { computeShg } from "./shg.ts";
import type { CpfAgeBand } from "./tables/cpf.ts";
import type { ShgFund } from "./tables/shg.ts";

interface CpfVector {
  id: string;
  title: string;
  provenance: string;
  inputs: {
    wageMonth: string;
    residency: "SC" | "SPR" | "FOREIGNER";
    ageBand: CpfAgeBand;
    birthDate?: string;
    spr?: { sprDate: string; option: "GG" | "FG" | "FF" };
    owPaidCents: number;
    awPaidCents: number;
    owSubjectToCpfCents?: number;
    shgFund?: ShgFund;
    awCeilingContext?: { annualOwSubjectForCeilingCents: number; awSubjectYtdBeforeCents: number };
    ytdOwSubjectCents?: number;
    employmentLastMonth?: string;
    awHistory?: CpfAwPayment[];
  };
  expected: {
    rateTable: string | null;
    effectiveResidencyCategory: string;
    owSubjectToCpfCents: number;
    awSubjectToCpfCents: number;
    awCeilingCents?: number;
    totalCpfCents: number;
    employeeCpfCents: number;
    employerCpfCents: number;
    sdlUnits1e4Cent: number;
    sdlExactDollars: string;
    shgCents: number;
    ratesAssumedCarriedForward?: boolean;
    currentMonth?: { totalCpfCents: number; employeeCpfCents: number; employerCpfCents: number };
    priorAwShortfall?: { awCents: number; totalCpfCents: number; employeeCpfCents: number; employerCpfCents: number };
  };
}

/** Vectors that state only an age band get a birth date that lands mid-band in the wage month. */
const AGE_FOR_BAND: Record<CpfAgeBand, number> = {
  AGE_55_AND_BELOW: 30,
  ABOVE_55_TO_60: 57,
  ABOVE_60_TO_65: 62,
  ABOVE_65_TO_70: 67,
  ABOVE_70: 75,
};

function birthDateFor(v: CpfVector): string {
  if (v.inputs.birthDate) return v.inputs.birthDate;
  const year = Number(v.inputs.wageMonth.slice(0, 4)) - AGE_FOR_BAND[v.inputs.ageBand];
  return `${year}-01-01`;
}

function residencyFor(v: CpfVector): CpfResidency {
  if (v.inputs.residency === "SPR") {
    if (!v.inputs.spr) throw new Error(`${v.id}: SPR vector without spr details`);
    return { status: "SPR", sprDate: v.inputs.spr.sprDate, option: v.inputs.spr.option };
  }
  return { status: v.inputs.residency };
}

function historyFor(v: CpfVector): CpfAwPayment[] {
  if (v.inputs.awHistory) return v.inputs.awHistory;
  const before = v.inputs.awCeilingContext?.awSubjectYtdBeforeCents ?? 0;
  if (before === 0) return [];
  // The vector only states "AW already subject this year"; model it as one fully-subjected earlier payment.
  const month = Number(v.inputs.wageMonth.slice(5, 7));
  return [
    {
      payableMonth: `${v.inputs.wageMonth.slice(0, 4)}-${String(month - 1).padStart(2, "0")}`,
      owCents: 800_000,
      awPayableCents: before,
      awSubjectCents: before,
    },
  ];
}

const cpfVectors = vectors.cpfVectors as CpfVector[];

describe("CPF test vectors", () => {
  it.each(cpfVectors.map((v) => [v.id, v] as const))("%s", (_id, v) => {
    const owCents = v.inputs.owSubjectToCpfCents ?? v.inputs.owPaidCents;
    const ctx = v.inputs.awCeilingContext;
    const result = computeCpf({
      contributionMonth: v.inputs.wageMonth,
      birthDate: birthDateFor(v),
      residency: residencyFor(v),
      owCents,
      awCents: v.inputs.awPaidCents,
      yearToDate: { owSubjectCents: v.inputs.ytdOwSubjectCents ?? 0, awPayments: historyFor(v) },
      ...(v.inputs.employmentLastMonth ? { employment: { lastMonth: v.inputs.employmentLastMonth } } : {}),
      ...(ctx ? { awCeilingEstimate: { annualOwSubjectCents: ctx.annualOwSubjectForCeilingCents } } : {}),
    });
    if (!result.ok) throw new Error(`${v.id} blocked: ${result.blockingIssues.map((i) => i.message).join("; ")}`);
    const e = v.expected;

    expect(result.residencyCategory).toBe(e.effectiveResidencyCategory);
    if (v.inputs.residency !== "FOREIGNER") expect(result.ageBand).toBe(v.inputs.ageBand);
    if (e.rateTable === null) {
      expect(result.rateTable).toBeNull();
    } else {
      const [year, tableNo] = e.rateTable.split(":T");
      expect(result.rateTable?.publishedTableNo).toBe(Number(tableNo));
      expect(result.rateTable?.effectiveFrom.slice(0, 4)).toBe(year);
    }
    expect(result.ratesAssumedCarriedForward).toBe(e.ratesAssumedCarriedForward ?? false);
    expect(result.owSubjectCents).toBe(e.owSubjectToCpfCents);
    expect(result.awSubjectCents).toBe(e.awSubjectToCpfCents);
    if (e.awCeilingCents !== undefined) expect(result.awCeiling?.annualAwCeilingCents).toBe(e.awCeilingCents);

    const shortfall = result.priorAw.shortfall;
    expect(result.totalCents + (shortfall?.totalCents ?? 0)).toBe(e.totalCpfCents);
    expect(result.employeeCents + (shortfall?.employeeCents ?? 0)).toBe(e.employeeCpfCents);
    expect(result.employerCents + (shortfall?.employerCents ?? 0)).toBe(e.employerCpfCents);
    if (e.currentMonth) {
      expect([result.totalCents, result.employeeCents, result.employerCents]).toEqual([
        e.currentMonth.totalCpfCents,
        e.currentMonth.employeeCpfCents,
        e.currentMonth.employerCpfCents,
      ]);
    }
    if (e.priorAwShortfall) {
      expect(shortfall).toMatchObject({
        awCents: e.priorAwShortfall.awCents,
        totalCents: e.priorAwShortfall.totalCpfCents,
        employeeCents: e.priorAwShortfall.employeeCpfCents,
        employerCents: e.priorAwShortfall.employerCpfCents,
      });
    } else {
      expect(shortfall).toBeNull();
    }

    // SDL and SHG use all wages paid in the month (pre-conversion OW included for SPR-10).
    const totalWagesCents = v.inputs.owPaidCents + v.inputs.awPaidCents;
    const sdl = computeSdl({ month: v.inputs.wageMonth, totalWagesCents });
    expect(sdl.units1e4Cent).toBe(e.sdlUnits1e4Cent);
    expect(sdl.exactDollars).toBe(normaliseDollars(e.sdlExactDollars));
    const shg = computeShg({
      month: v.inputs.wageMonth,
      totalWagesCents,
      funds: v.inputs.shgFund ? [v.inputs.shgFund] : [],
    });
    expect(shg.totalCents).toBe(e.shgCents);
  });
});

/** Fixture prints "7.50" / "2.50335"; the engine prints at least 2 decimals, trailing zeros trimmed beyond that. */
function normaliseDollars(s: string): string {
  const [w, f = ""] = s.split(".");
  return `${w}.${f.replace(/0+$/, "").padEnd(2, "0")}`;
}

interface SdlVector {
  id: string;
  inputs: { totalWagesCents?: number; totalWagesCentsPerEmployee?: number[] };
  expected: { sdlUnits1e4Cent?: number; sdlExactDollars: string; sdlPayableCents?: number };
}

describe("SDL test vectors", () => {
  it.each((vectors.sdlVectors as SdlVector[]).map((v) => [v.id, v] as const))("%s", (_id, v) => {
    if (v.inputs.totalWagesCentsPerEmployee) {
      const each = v.inputs.totalWagesCentsPerEmployee.map((w) => computeSdl({ month: "2026-10", totalWagesCents: w }));
      const total = computeSdlTotal(each);
      expect(total.exactDollars).toBe(normaliseDollars(v.expected.sdlExactDollars));
      expect(total.payableCents).toBe(v.expected.sdlPayableCents);
    } else {
      const r = computeSdl({ month: "2026-10", totalWagesCents: v.inputs.totalWagesCents ?? Number.NaN });
      expect(r.units1e4Cent).toBe(v.expected.sdlUnits1e4Cent);
      expect(r.exactDollars).toBe(normaliseDollars(v.expected.sdlExactDollars));
    }
  });
});

interface ShgVector {
  id: string;
  inputs: { fund?: ShgFund; funds?: ShgFund[]; totalWagesCents?: number; owPaidCents?: number; awPaidCents?: number };
  expected: { shgCents: number; shgCentsByFund?: Record<string, number> };
}

describe("SHG test vectors", () => {
  it.each((vectors.shgVectors as ShgVector[]).map((v) => [v.id, v] as const))("%s", (_id, v) => {
    const funds = v.inputs.funds ?? (v.inputs.fund ? [v.inputs.fund] : []);
    const totalWagesCents = v.inputs.totalWagesCents ?? (v.inputs.owPaidCents ?? 0) + (v.inputs.awPaidCents ?? 0);
    const r = computeShg({ month: "2026-10", totalWagesCents, funds });
    expect(r.totalCents).toBe(v.expected.shgCents);
    if (v.expected.shgCentsByFund) expect(r.byFund).toEqual(v.expected.shgCentsByFund);
  });
});
