import { describe, expect, it } from "vitest";
import { RulesNotAvailableError } from "../errors.ts";
import { dayOfWeek } from "../internal/dates.ts";
import { ceilToCent, exactCents } from "../internal/exact.ts";
import { CPF_AGE_BANDS, CPF_RATE_TABLES, CPF_WAGE_BAND_THRESHOLDS } from "./cpf.ts";
import { effectiveRangeIssues } from "./effective.ts";
import { FWL_RATES } from "./fwl.ts";
import { resolveRules, ruleFamilies } from "./index.ts";
import { PUBLIC_HOLIDAY_YEARS } from "./public-holidays.ts";
import { SDL_RATES } from "./sdl.ts";
import { SHG_TABLES } from "./shg.ts";

describe("rule data integrity", () => {
  it("has no gaps, overlaps, inverted ranges or uncited rows in any rule family", () => {
    const issues = ruleFamilies().flatMap((f) => effectiveRangeIssues(f.family, f.rows));
    expect(issues).toEqual([]);
  });

  it("detects gaps, overlaps, missing sources and late starts", () => {
    const row = (effectiveFrom: string, effectiveTo: string | null, source = "https://x.example") => ({
      effectiveFrom,
      effectiveTo,
      source,
    });
    expect(effectiveRangeIssues("f", [row("2025-01-01", "2026-01-01"), row("2026-02-01", null)])).toEqual([
      { family: "f", problem: "gap between 2026-01-01 and 2026-02-01" },
    ]);
    expect(effectiveRangeIssues("f", [row("2025-01-01", "2026-06-01"), row("2026-01-01", null)])[0]?.problem).toMatch(
      /overlap/,
    );
    expect(effectiveRangeIssues("f", [row("2025-01-01", null, "http://insecure")])[0]?.problem).toMatch(
      /no https source/,
    );
    expect(effectiveRangeIssues("f", [row("2025-06-01", "2025-01-01")]).map((i) => i.problem)).toContain(
      "row from 2025-06-01 ends on or before it starts",
    );
    expect(effectiveRangeIssues("f", [row("2025-03-01", null)])[0]?.problem).toMatch(/after coverage start/);
    expect(effectiveRangeIssues("f", [row("2025-01-01", "2026-01-01")])[0]?.problem).toMatch(/no open-ended row/);
    expect(effectiveRangeIssues("f", [])[0]?.problem).toBe("family has no rows");
  });

  it("every FWL rate row is cited and MOM's published daily rate equals ceil(monthly × 12 / 365)", () => {
    for (const r of FWL_RATES) {
      expect(r.source).toMatch(/^https:\/\/www\.mom\.gov\.sg\//);
      expect(ceilToCent(exactCents(r.monthlyCents * 12, 365)), `${r.pass} ${r.sector} ${r.tier} ${r.skill}`).toBe(
        r.publishedDailyCents,
      );
    }
  });
});

describe("CPF rate tables: internal consistency of every published cell", () => {
  const cases = CPF_RATE_TABLES.flatMap((t) => CPF_AGE_BANDS.map((b) => [t.id, b, t.rows[b]] as const));

  it.each(cases)(
    "%s %s: employer-only + employee = total, k = 3 × employee rate, continuous at $750",
    (_id, _b, row) => {
      expect(row.employerOnlyBps + row.employeeBps).toBe(row.totalBps);
      expect(row.phaseInCoefficientBps).toBe(3 * row.employeeBps);
      const tw = CPF_WAGE_BAND_THRESHOLDS.phaseInUpToCents;
      const base = CPF_WAGE_BAND_THRESHOLDS.phaseInBaseCents;
      // Phase-in formula at TW = $750 equals the full-rate formula (both in cents × 10,000).
      expect(tw * row.employerOnlyBps + (tw - base) * row.phaseInCoefficientBps).toBe(tw * row.totalBps);
      expect((tw - base) * row.phaseInCoefficientBps).toBe(tw * row.employeeBps);
    },
  );

  it("2026 Table 1 OW maxima match the PDF ('Max. of $2,960 … $1,000')", () => {
    const t = CPF_RATE_TABLES.find((x) => x.id === "CPF_2026_SC_AND_SPR3");
    const maxima = CPF_AGE_BANDS.map((b) => ((t?.rows[b].totalBps ?? 0) * 800_000) / 10_000);
    expect(maxima).toEqual([296_000, 272_000, 200_000, 132_000, 100_000]);
  });
});

describe("other tables", () => {
  it("SDL minimum and maximum meet the 0.25% line exactly at $800 and $4,500", () => {
    for (const r of SDL_RATES) {
      expect((r.minAppliesBelowTotalWagesCents * r.rateBps) / 10_000).toBe(r.minPerEmployeeCents);
      expect((r.maxAppliesAboveTotalWagesCents * r.rateBps) / 10_000).toBe(r.maxPerEmployeeCents);
    }
  });

  it("SHG bands ascend and end open-ended", () => {
    for (const t of SHG_TABLES) {
      const limits = t.bands.map((b) => b.upToInclusiveCents);
      expect(limits.at(-1)).toBeNull();
      const finite = limits.slice(0, -1) as number[];
      expect([...finite].sort((a, b) => a - b)).toEqual(finite);
      expect(t.bands.map((b) => b.amountCents)).toEqual([...t.bands.map((b) => b.amountCents)].sort((a, b) => a - b));
    }
  });

  it("public holidays: 11 per year, all in the year, every observed date is the Monday after a Sunday", () => {
    for (const y of PUBLIC_HOLIDAY_YEARS) {
      expect(y.holidays).toHaveLength(11);
      for (const h of y.holidays) {
        expect(h.date.startsWith(String(y.year))).toBe(true);
        if (h.observedOn) {
          expect(dayOfWeek(h.date)).toBe(0);
          expect(dayOfWeek(h.observedOn)).toBe(1);
        }
      }
    }
  });
});

describe("resolveRules", () => {
  it("uses [from, to) intervals: 31 Dec 2026 is 2026, 1 Jan 2027 is 2027 — never both", () => {
    const dec = resolveRules("2026-12-31");
    const jan = resolveRules("2027-01-01");
    expect(dec.cpf.tables.SC.id).toBe("CPF_2026_SC_AND_SPR3");
    expect(jan.cpf.tables.SC.id).toBe("CPF_2027_SC_AND_SPR3");
    expect(dec.cpf.tables.SC.rows.ABOVE_55_TO_60.totalBps).toBe(3_400);
    expect(jan.cpf.tables.SC.rows.ABOVE_55_TO_60.totalBps).toBe(3_550);
    expect(dec.publicHolidays?.year).toBe(2026);
    expect(jan.publicHolidays?.year).toBe(2027);
  });

  it("switches the OW ceiling on 1 Jan 2026 and SDL administration on 1 Jul 2026", () => {
    expect(resolveRules("2025-12-31").cpf.owCeiling.monthlyCents).toBe(740_000);
    expect(resolveRules("2026-01-01").cpf.owCeiling.monthlyCents).toBe(800_000);
    expect(resolveRules("2026-06-30").sdl.administeredBy).toMatch(/SSG/);
    expect(resolveRules("2026-07-01").sdl.administeredBy).toMatch(/SWDA/);
  });

  it("covers every residency category and fund, with 2025 SPR tables from the 2025 PDF", () => {
    const r = resolveRules("2025-06-15");
    expect(r.cpf.tables.SPR1_GG.id).toBe("CPF_2025_SPR1_GG");
    expect(r.cpf.tables.SPR2_FG.rows.ABOVE_55_TO_60.totalBps).toBe(2_800);
    expect(Object.keys(r.shg).sort()).toEqual(["CDAC", "ECF", "MBMF", "SINDA"]);
    expect(r.cpf.ratesAssumedCarriedForward).toBe(false);
  });

  it("flags 2028 as carried forward and has no 2028 holidays", () => {
    const r = resolveRules("2028-02-01");
    expect(r.cpf.ratesAssumedCarriedForward).toBe(true);
    expect(r.cpf.tables.SC.id).toBe("CPF_2027_SC_AND_SPR3");
    expect(r.publicHolidays).toBeNull();
  });

  it("refuses dates before the encoded coverage", () => {
    expect(() => resolveRules("2024-12-31")).toThrow(RulesNotAvailableError);
    expect(() => resolveRules("2026-02-30")).toThrow(/not a real calendar date/);
  });
});
