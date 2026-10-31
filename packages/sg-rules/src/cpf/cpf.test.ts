import { describe, expect, it } from "vitest";
import { SgRulesInputError } from "../errors.ts";
import {
  annualAwCeiling,
  type CpfMonthInput,
  type CpfMonthResult,
  type CpfYearToDate,
  computeCpf,
  cpfAgeBand,
  cpfAgeBandLabel,
  diffCpf,
  nextAgeBandChange,
  reconcileAdditionalWages,
  resolveResidency,
  sprYear,
} from "./index.ts";

const EMPTY: CpfYearToDate = { owSubjectCents: 0, awPayments: [] };

function base(overrides: Partial<CpfMonthInput> = {}): CpfMonthInput {
  return {
    contributionMonth: "2026-03",
    birthDate: "1990-05-10",
    residency: { status: "SC" },
    owCents: 300_000,
    awCents: 0,
    yearToDate: EMPTY,
    ...overrides,
  };
}

function ok(input: CpfMonthInput): CpfMonthResult {
  const r = computeCpf(input);
  if (!r.ok) throw new Error(`unexpected block: ${r.blockingIssues.map((i) => i.code).join()}`);
  return r;
}

const amounts = (r: CpfMonthResult) => [r.totalCents, r.employeeCents, r.employerCents];

describe("wage band boundaries (SC ≤ 55, 2026) at ±1 cent", () => {
  it.each([
    [4_999, "NIL", [0, 0, 0]],
    [5_000, "NIL", [0, 0, 0]],
    [5_001, "EMPLOYER_ONLY", [900, 0, 900]], // 17% × 50.01 = 8.5017 → $9
    [49_999, "EMPLOYER_ONLY", [8_500, 0, 8_500]], // 84.9983 → $85
    [50_000, "EMPLOYER_ONLY", [8_500, 0, 8_500]],
    [50_001, "PHASE_IN", [8_500, 0, 8_500]], // 85.0017 + 0.006 → $85, employee floor(0.006) = 0
    [74_999, "PHASE_IN", [27_700, 14_900, 12_800]], // 127.4983 + 149.994 = 277.4923 → $277; ee 149.994 → $149
    [75_000, "PHASE_IN", [27_800, 15_000, 12_800]], // 277.50 → $278 (half rounds up)
    [75_001, "FULL", [27_800, 15_000, 12_800]], // 277.5037 → $278; ee 150.002 → $150
    [799_999, "FULL", [296_000, 159_900, 136_100]],
    [800_000, "FULL", [296_000, 160_000, 136_000]],
    [800_001, "FULL", [296_000, 160_000, 136_000]],
  ] as const)("TW %i cents → %s %j", (ow, band, expected) => {
    const r = ok(base({ owCents: ow }));
    expect(r.wageBand).toBe(band);
    expect(amounts(r)).toEqual(expected);
  });

  it("is monotone, non-negative and never deducts from an employee on $500 or less — every table, every age band", () => {
    const tws = [
      0, 5_000, 5_001, 25_000, 50_000, 50_001, 60_000, 74_999, 75_000, 75_001, 300_000, 799_999, 800_000, 900_000,
    ];
    const residencies = [
      { status: "SC" as const },
      { status: "SPR" as const, sprDate: "2026-01-15", option: "GG" as const },
      { status: "SPR" as const, sprDate: "2025-01-15", option: "GG" as const },
      { status: "SPR" as const, sprDate: "2026-01-15", option: "FG" as const },
      { status: "SPR" as const, sprDate: "2025-01-15", option: "FG" as const },
    ];
    for (const month of ["2025-06", "2026-06", "2027-06"]) {
      for (const residency of residencies) {
        if (residency.status === "SPR" && month === "2025-06" && residency.sprDate === "2026-01-15") continue;
        for (const age of [30, 57, 62, 67, 75]) {
          let prev = [0, 0];
          for (const tw of tws) {
            const r = ok(
              base({
                contributionMonth: month,
                birthDate: `${Number(month.slice(0, 4)) - age}-01-01`,
                residency,
                owCents: tw,
              }),
            );
            expect(r.employeeCents).toBeGreaterThanOrEqual(0);
            expect(r.employerCents).toBeGreaterThanOrEqual(0);
            if (tw <= 50_000) expect(r.employeeCents).toBe(0);
            expect(r.totalCents).toBeGreaterThanOrEqual(prev[0] as number);
            expect(r.employeeCents).toBeGreaterThanOrEqual(prev[1] as number);
            prev = [r.totalCents, r.employeeCents];
          }
        }
      }
    }
  });

  it("explains the rounding in the working, from the exact amount (RD-03: $370.4958 → $370)", () => {
    const r = ok(base({ contributionMonth: "2026-04", owCents: 100_134 }));
    const text = r.working.map((w) => w.text).join("\n");
    expect(text).toContain("Total = 37% × $1,001.34 = $370.4958 → rounded to the nearest dollar $370.00.");
    expect(text).toContain("Employee = 20% × $1,001.34 = $200.268 → rounded down to $200.00.");
    expect(text).toContain("Total wages for the month before ceilings $1,001.34: > $750 → full rates.");
    expect(r.exact.totalCents).toBe("1852479/50"); // 37,049.58 cents
  });

  it("explains the phase-in and employer-only formulas", () => {
    const phase = ok(base({ owCents: 60_000 })).working.map((w) => w.text);
    expect(phase).toContain(
      "Total = 17% × $600.00 + 0.6 × ($600.00 − $500.00) = $162.00 → rounded to the nearest dollar $162.00.",
    );
    const er = ok(base({ owCents: 30_000 })).working.map((w) => w.text);
    expect(er).toContain("Employee = $0.00: nothing may be deducted from an employee earning $500 or less.");
    expect(ok(base({ owCents: 0 })).working.map((w) => w.code)).toContain("CPF_TOTAL");
  });
});

describe("age band: month after the birthday", () => {
  it.each([
    ["1971-01-13", "2026-01", "AGE_55_AND_BELOW"],
    ["1971-01-13", "2026-02", "ABOVE_55_TO_60"],
    ["1966-03-01", "2026-03", "ABOVE_55_TO_60"],
    ["1966-03-01", "2026-04", "ABOVE_60_TO_65"],
    ["1961-10-31", "2026-10", "ABOVE_60_TO_65"],
    ["1961-10-31", "2026-11", "ABOVE_65_TO_70"],
    ["1956-12-15", "2026-12", "ABOVE_65_TO_70"],
    ["1956-12-15", "2027-01", "ABOVE_70"],
    ["1972-02-29", "2027-02", "AGE_55_AND_BELOW"], // 55th "birthday" falls in Feb 2027 (no 29th)
    ["1972-02-29", "2027-03", "ABOVE_55_TO_60"],
  ])("born %s, wages for %s → %s", (dob, month, band) => {
    expect(cpfAgeBand(dob, month)).toBe(band);
  });

  it("warns the month before a band change, and finds the next change", () => {
    const r = ok(base({ contributionMonth: "2026-01", birthDate: "1971-01-13" }));
    expect(r.issues.find((i) => i.code === "CPF_AGE_BAND_CHANGES_NEXT_MONTH")?.message).toMatch(
      /Feb 2026.*above 55 to 60/,
    );
    expect(nextAgeBandChange("1971-01-13", "2025-06")).toEqual({ month: "2026-02", band: "ABOVE_55_TO_60" });
    expect(nextAgeBandChange("1940-01-01", "2026-06")).toBeNull();
  });
});

describe("SPR years and elections", () => {
  it("follows CPF's examples: SPR 15 Jan 2026 → yr1 to Jan 2027, yr2 to Jan 2028, yr3 from Feb 2028", () => {
    expect(sprYear("2026-01-15", "2025-12")).toBeNull();
    expect(sprYear("2026-01-15", "2026-01")).toBe(1);
    expect(sprYear("2026-01-15", "2027-01")).toBe(1);
    expect(sprYear("2026-01-15", "2027-02")).toBe(2);
    expect(sprYear("2026-01-15", "2028-01")).toBe(2);
    expect(sprYear("2026-01-15", "2028-02")).toBe(3);
    expect(sprYear("2016-01-05", "2017-01")).toBe(1);
    expect(sprYear("2016-01-05", "2018-02")).toBe(3);
  });

  it("warns in the anniversary month and the conversion month", () => {
    const anniversary = ok(base({ contributionMonth: "2027-01", residency: { status: "SPR", sprDate: "2026-01-15" } }));
    expect(anniversary.residencyCategory).toBe("SPR1_GG");
    expect(anniversary.issues.map((i) => i.code)).toContain("CPF_SPR_YEAR_CHANGES_NEXT_MONTH");
    const conversion = ok(base({ contributionMonth: "2026-03", residency: { status: "SPR", sprDate: "2026-03-15" } }));
    expect(conversion.issues.map((i) => i.code)).toContain("CPF_SPR_CONVERSION_MONTH");
    const firstOfMonth = ok(
      base({ contributionMonth: "2026-03", residency: { status: "SPR", sprDate: "2026-03-01" } }),
    );
    expect(firstOfMonth.issues.map((i) => i.code)).not.toContain("CPF_SPR_CONVERSION_MONTH");
  });

  it("treats months before the SPR month as no CPF", () => {
    const r = ok(base({ contributionMonth: "2026-02", residency: { status: "SPR", sprDate: "2026-03-15" } }));
    expect(r.residencyCategory).toBe("FOREIGNER");
    expect(amounts(r)).toEqual([0, 0, 0]);
    expect(r.working[0]?.text).toMatch(/not yet an SPR/);
  });

  it("applies an F/G election only from its approved month", () => {
    const residency = {
      status: "SPR" as const,
      sprDate: "2026-01-15",
      option: "FG" as const,
      optionFromMonth: "2026-05",
    };
    expect(ok(base({ contributionMonth: "2026-04", residency })).residencyCategory).toBe("SPR1_GG");
    expect(ok(base({ contributionMonth: "2026-05", residency })).residencyCategory).toBe("SPR1_FG");
    expect(resolveResidency({ status: "SPR", sprDate: "2025-01-15", option: "FF" }, "2026-06").category).toBe(
      "SPR2_FF",
    );
    expect(resolveResidency({ status: "SPR", sprDate: "2020-01-15", option: "FG" }, "2026-06").category).toBe("SPR3");
  });
});

describe("AW ceiling", () => {
  it("annual AW ceiling = $102,000 − annual OW subject, never negative", () => {
    expect(annualAwCeiling(2026, 9_600_000)).toBe(600_000);
    expect(annualAwCeiling(2026, 11_000_000)).toBe(0);
  });

  it("is exhausted over several bonus months, then nothing more is subject", () => {
    let ytd = EMPTY;
    const subject: number[] = [];
    for (const [month, aw] of [
      ["2026-01", 0],
      ["2026-02", 250_000],
      ["2026-03", 0],
      ["2026-04", 250_000],
      ["2026-05", 250_000],
      ["2026-06", 250_000],
    ] as const) {
      const r = ok(base({ contributionMonth: month, owCents: 900_000, awCents: aw, yearToDate: ytd }));
      subject.push(r.awSubjectCents);
      ytd = r.yearToDateAfter;
    }
    // Estimated ceiling $6,000 (OW capped at $8,000 × 12): $2,500 + $2,500 + $1,000 + $0.
    expect(subject).toEqual([0, 250_000, 0, 250_000, 100_000, 0]);
    expect(ytd.owSubjectCents).toBe(4_800_000);
    expect(ytd.awPayments.map((p) => p.awSubjectCents)).toEqual([250_000, 250_000, 100_000, 0]);
  });

  it("recomputes in December with actual OW and finds an excess when a salary rise shrinks the ceiling below AW already subjected", () => {
    // Jan–Jun $5,000, Jul–Dec $6,000 (raise not projected in June). Bonus $40,000 in June, $10,000 in Dec.
    let ytd = EMPTY;
    let last: CpfMonthResult | undefined;
    for (let m = 1; m <= 12; m++) {
      const month = `2026-${String(m).padStart(2, "0")}`;
      const aw = m === 6 ? 4_000_000 : m === 12 ? 1_000_000 : 0;
      last = ok(base({ contributionMonth: month, owCents: m <= 6 ? 500_000 : 600_000, awCents: aw, yearToDate: ytd }));
      if (m === 6) expect(last.awSubjectCents).toBe(4_000_000); // ceiling est. 102,000 − 60,000 = 42,000
      ytd = last.yearToDateAfter;
    }
    expect(last?.awCeiling).toMatchObject({
      basis: "ACTUAL",
      annualOwSubjectCents: 6_600_000,
      annualAwCeilingCents: 3_600_000,
    });
    // Actual ceiling $36,000 < $40,000 already subjected in June → excess refund path, nothing new subject.
    expect(last?.awSubjectCents).toBe(0);
    expect(last?.priorAw.excess).toMatchObject({ awCents: 400_000, totalCents: 148_000, employeeCents: 80_000 });
    expect(last?.priorAw.shortfall).toBeNull();
    expect(last?.issues.map((i) => i.code)).toContain("CPF_AW_EXCESS_REFUND");
  });

  it("uses projectedMonthlyOwCents for a pro-rated joining month, and the known last month for the projection", () => {
    const joiner = ok(
      base({
        contributionMonth: "2026-06",
        owCents: 400_000,
        awCents: 100_000,
        awCeilingEstimate: { projectedMonthlyOwCents: 800_000 },
      }),
    );
    expect(joiner.awCeiling?.annualOwSubjectCents).toBe(400_000 + 6 * 800_000);
    const leaver = ok(
      base({ contributionMonth: "2026-03", owCents: 800_000, awCents: 100_000, employment: { lastMonth: "2026-05" } }),
    );
    expect(leaver.awCeiling).toMatchObject({ basis: "ESTIMATE", annualOwSubjectCents: 3 * 800_000 });
    const nextYearLeaver = ok(
      base({ contributionMonth: "2026-03", owCents: 800_000, awCents: 100_000, employment: { lastMonth: "2027-05" } }),
    );
    expect(nextYearLeaver.awCeiling?.annualOwSubjectCents).toBe(10 * 800_000);
    const override = ok(base({ awCents: 100_000, awCeilingEstimate: { annualOwSubjectCents: 9_000_000 } }));
    expect(override.awCeiling).toMatchObject({ basis: "OVERRIDE", annualAwCeilingCents: 1_200_000 });
  });

  it("blocks the unpublished low-wage case instead of computing a negative contribution", () => {
    // OW $300 + AW $300 wholly above the ceiling: pre-cap TW $600 selects phase-in; subject TW $300 would give −$120 employee.
    const r = computeCpf(
      base({
        contributionMonth: "2026-07",
        owCents: 30_000,
        awCents: 30_000,
        yearToDate: {
          owSubjectCents: 180_000,
          awPayments: [
            { payableMonth: "2026-01", owCents: 30_000, awPayableCents: 9_840_000, awSubjectCents: 9_840_000 },
          ],
        },
      }),
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.blockingIssues[0]?.code).toBe("CPF_LOW_WAGE_CAPPED_AW_UNSUPPORTED");
  });

  it("reconciles AW directly and blocks re-subjecting AW of a low-wage month", () => {
    const rec = reconcileAdditionalWages({
      birthDate: "1990-05-10",
      residency: { status: "SC" },
      annualAwCeilingCents: 1_000_000,
      awPayments: [
        { payableMonth: "2026-03", owCents: 20_000, awPayableCents: 40_000, awSubjectCents: 0 },
        { payableMonth: "2026-01", owCents: 800_000, awPayableCents: 500_000, awSubjectCents: 500_000 },
      ],
    });
    expect(rec.payments.map((p) => p.payableMonth)).toEqual(["2026-01", "2026-03"]);
    expect(rec.subjectTotalCents).toBe(540_000);
    expect(rec.blockingIssues.map((i) => i.code)).toEqual(["CPF_LOW_WAGE_CAPPED_AW_UNSUPPORTED"]);
    expect(() =>
      reconcileAdditionalWages({
        birthDate: "1990-05-10",
        residency: { status: "FOREIGNER" },
        annualAwCeilingCents: 1_000_000,
        awPayments: [{ payableMonth: "2026-03", owCents: 800_000, awPayableCents: 40_000, awSubjectCents: 0 }],
      }),
    ).toThrow(/no CPF liability/);
  });

  it("keys each re-subjected AW to its own month's residency when it changed", () => {
    const rec = reconcileAdditionalWages({
      birthDate: "1990-05-10",
      residency: { status: "SC" },
      annualAwCeilingCents: 1_000_000,
      awPayments: [
        {
          payableMonth: "2026-02",
          owCents: 800_000,
          awPayableCents: 100_000,
          awSubjectCents: 0,
          residency: { status: "SPR", sprDate: "2026-01-15" },
        },
      ],
    });
    expect(rec.shortfall?.lines[0]).toMatchObject({ rateTableId: "CPF_2026_SPR1_GG", totalRateBps: 900 });
  });
});

describe("year boundary and rates carried forward", () => {
  it("Dec 2026 wages use 2026 rates; Jan 2027 wages use 2027 rates (age 57)", () => {
    const dec = ok(base({ contributionMonth: "2026-12", birthDate: "1969-06-01", owCents: 500_000 }));
    const jan = ok(base({ contributionMonth: "2027-01", birthDate: "1969-06-01", owCents: 500_000 }));
    expect(amounts(dec)).toEqual([170_000, 90_000, 80_000]);
    expect(amounts(jan)).toEqual([177_500, 95_000, 82_500]);
  });

  it("flags 2028 months as carried forward with a warning", () => {
    const r = ok(base({ contributionMonth: "2028-03" }));
    expect(r.ratesAssumedCarriedForward).toBe(true);
    expect(r.rateTable?.id).toBe("CPF_2027_SC_AND_SPR3");
    expect(r.issues.find((i) => i.code === "CPF_RATES_ASSUMED_CARRIED_FORWARD")?.severity).toBe("warning");
  });
});

describe("zero wages, negative adjustments and invalid input", () => {
  it("zero wages: nil band, nothing payable, state unchanged except the month", () => {
    const r = ok(base({ owCents: 0 }));
    expect(r.wageBand).toBe("NIL");
    expect(amounts(r)).toEqual([0, 0, 0]);
    expect(r.yearToDateAfter).toEqual(EMPTY);
  });

  it("rejects negative wages: a backpay reversal is a recomputation of the original month, diffed", () => {
    expect(() => computeCpf(base({ owCents: -100 }))).toThrow(SgRulesInputError);
    const original = ok(base({ owCents: 300_000 }));
    const revised = ok(base({ owCents: 280_000 }));
    const d = diffCpf(original, revised);
    expect(d).toMatchObject({ totalCents: -7_400, employeeCents: -4_000, employerCents: -3_400 });
    expect(d.issues.map((i) => i.code)).toEqual(["CPF_CORRECTION_OVERPAID"]);
    expect(diffCpf(revised, original).issues.map((i) => i.code)).toEqual(["CPF_CORRECTION_EMPLOYEE_SHORTFALL"]);
  });

  it.each([
    [{ contributionMonth: "2026-13" }, /no month 13/],
    [{ contributionMonth: "March" }, /YYYY-MM/],
    [{ birthDate: "1990-02-30" }, /not a real calendar date/],
    [{ owCents: 1.5 }, /integer cents/],
    [{ employment: { lastMonth: "2026/05" } }, /YYYY-MM/],
    [{ awCeilingEstimate: { annualOwSubjectCents: -1 } }, /must not be negative/],
    [{ awCeilingEstimate: { projectedMonthlyOwCents: 0.5 } }, /integer cents/],
    [
      {
        yearToDate: {
          owSubjectCents: 0,
          awPayments: [{ payableMonth: "2025-12", owCents: 0, awPayableCents: 1, awSubjectCents: 0 }],
        },
      },
      /earlier months of 2026/,
    ],
    [
      {
        yearToDate: {
          owSubjectCents: 0,
          awPayments: [{ payableMonth: "2026-03", owCents: 0, awPayableCents: 1, awSubjectCents: 0 }],
        },
      },
      /earlier months of 2026/,
    ],
    [
      {
        yearToDate: {
          owSubjectCents: 0,
          awPayments: [{ payableMonth: "2026-01", owCents: 0, awPayableCents: 1, awSubjectCents: 2 }],
        },
      },
      /exceeds the AW payable/,
    ],
    [{ residency: { status: "SPR", sprDate: "2026-01-15", option: "FG", optionFromMonth: "May" } }, /YYYY-MM/],
  ] as [Partial<CpfMonthInput>, RegExp][])("rejects %j", (overrides, message) => {
    expect(() => computeCpf(base(overrides))).toThrow(message);
  });

  it("refuses months outside the encoded CPF tables", () => {
    expect(() => computeCpf(base({ contributionMonth: "2024-12" }))).toThrow(/No CPF rate table/);
  });
});

describe("labels and reconciliation of a low-wage month", () => {
  it("labels age bands in plain English", () => {
    expect(cpfAgeBandLabel("ABOVE_60_TO_65")).toBe("above 60 to 65");
  });

  it("uses the band's marginal rate for a re-subjected AW month in the nil band (no contribution)", () => {
    const rec = reconcileAdditionalWages({
      birthDate: "1990-05-10",
      residency: { status: "SC" },
      annualAwCeilingCents: 10_000,
      awPayments: [{ payableMonth: "2026-01", owCents: 0, awPayableCents: 4_000, awSubjectCents: 0 }],
    });
    expect(rec.shortfall).toMatchObject({ awCents: 4_000, totalCents: 0, employeeCents: 0 });
    expect(rec.blockingIssues).toHaveLength(1);
  });
});
