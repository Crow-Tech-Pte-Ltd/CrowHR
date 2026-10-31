/**
 * Replays all 16 CPF Board AW-ceiling worked examples month by month, carrying year-to-date state
 * exactly as the payroll module will (yearToDateAfter → next month's yearToDate), and compares every
 * month with CPF's published table.
 */
import { describe, expect, it } from "vitest";
import { OFFICIAL_AW_EXAMPLES, type OfficialAwExample } from "../__fixtures__/cpf-aw-official-examples.ts";
import { type CpfYearToDate, computeCpf } from "./index.ts";

/**
 * The last month of employment as payroll would know it: CPF's examples estimate the AW ceiling as if
 * the departure were unknown until the last month, so it is revealed only from that month onwards
 * (including AW paid after leaving). A rehire starts a new stint with no known end.
 */
function lastMonthFor(ex: OfficialAwExample, month: number): string | undefined {
  const current = ex.stints.find((s) => month >= s.firstMonth && (s.lastMonth === undefined || month <= s.lastMonth));
  const stint = current ?? [...ex.stints].reverse().find((s) => s.lastMonth !== undefined && s.lastMonth < month);
  if (stint?.lastMonth === undefined || month < stint.lastMonth) return undefined;
  return `2026-${String(stint.lastMonth).padStart(2, "0")}`;
}

describe("CPF AW ceiling: official worked examples (2026)", () => {
  it.each(OFFICIAL_AW_EXAMPLES.map((ex) => [ex.example, ex.title, ex] as const))("example %i: %s", (_n, _t, ex) => {
    let ytd: CpfYearToDate = { owSubjectCents: 0, awPayments: [] };
    for (const [month, owPaid, owSubject, owEr, owEe, awPaid, awSubject, awEr, awEe] of ex.rows) {
      const contributionMonth = `2026-${String(month).padStart(2, "0")}`;
      const lastMonth = lastMonthFor(ex, month);
      const r = computeCpf({
        contributionMonth,
        birthDate: ex.birthDate,
        residency: { status: "SC" },
        owCents: owPaid,
        awCents: awPaid,
        yearToDate: ytd,
        ...(lastMonth ? { employment: { lastMonth } } : {}),
      });
      if (!r.ok) throw new Error(`${contributionMonth} blocked`);
      const shortfall = r.priorAw.shortfall;
      const label = `example ${ex.example} ${contributionMonth}`;
      expect(r.priorAw.excess, label).toBeNull();
      expect(r.owSubjectCents, label).toBe(owSubject);
      expect(r.awSubjectCents + (shortfall?.awCents ?? 0), label).toBe(awSubject);
      expect(r.totalCents + (shortfall?.totalCents ?? 0), label).toBe(owEr + owEe + awEr + awEe);
      expect(r.employeeCents + (shortfall?.employeeCents ?? 0), label).toBe(owEe + awEe);
      ytd = r.yearToDateAfter;
    }
  });

  it("example 14 June: shortfall mixing 37% and 34% AW is rounded once ($11,250 / $6,054)", () => {
    const r = computeCpf({
      contributionMonth: "2026-06",
      birthDate: "1971-03-10",
      residency: { status: "SC" },
      owCents: 1_000_000,
      awCents: 0,
      employment: { lastMonth: "2026-06" },
      yearToDate: {
        owSubjectCents: 4_000_000,
        awPayments: [
          { payableMonth: "2026-01", owCents: 1_000_000, awPayableCents: 285_060, awSubjectCents: 285_060 },
          { payableMonth: "2026-02", owCents: 1_000_000, awPayableCents: 310_040, awSubjectCents: 310_040 },
          { payableMonth: "2026-03", owCents: 1_000_000, awPayableCents: 2_400_050, awSubjectCents: 4_900 },
          { payableMonth: "2026-04", owCents: 1_000_000, awPayableCents: 702_250, awSubjectCents: 0 },
        ],
      },
    });
    if (!r.ok) throw new Error("blocked");
    expect(r.priorAw.shortfall).toMatchObject({
      awCents: 3_097_400,
      totalCents: 1_125_000,
      employeeCents: 605_400,
      employerCents: 519_600,
    });
    expect(r.priorAw.shortfall?.lines.map((l) => [l.payableMonth, l.deltaCents, l.totalRateBps])).toEqual([
      ["2026-03", 2_395_150, 3_700],
      ["2026-04", 702_250, 3_400],
    ]);
    // This month's own contribution is computed and rounded separately (CPF shows 1,280 / 1,440).
    expect([r.totalCents, r.employeeCents, r.employerCents]).toEqual([272_000, 144_000, 128_000]);
  });
});
