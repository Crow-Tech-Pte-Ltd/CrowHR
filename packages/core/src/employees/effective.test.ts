import { describe, expect, it } from "vitest";
import { AppError } from "../errors.ts";
import { addDays } from "./dates.ts";
import { applyInsert, applyRemove, assertNoOverlap, covers, findAsAt, type Interval, planInsert } from "./effective.ts";

type Row = Interval & { id: string; v: number };

describe("half-open effective intervals", () => {
  const rows: Row[] = [
    { id: "a", v: 1, effectiveFrom: "2026-01-01", effectiveTo: "2026-09-01" },
    { id: "b", v: 2, effectiveFrom: "2026-09-01", effectiveTo: null },
  ];

  it("includes the start date and excludes the end date", () => {
    expect(covers(rows[0] as Row, "2026-01-01")).toBe(true);
    expect(covers(rows[0] as Row, "2026-08-31")).toBe(true);
    expect(covers(rows[0] as Row, "2026-09-01")).toBe(false);
  });

  it("as-at on boundaries picks the right version", () => {
    expect(findAsAt(rows, "2026-08-31")?.id).toBe("a");
    expect(findAsAt(rows, "2026-09-01")?.id).toBe("b");
    expect(findAsAt(rows, "2099-12-31")?.id).toBe("b");
    expect(findAsAt(rows, "2025-12-31")).toBeUndefined();
  });

  it("inserting a version closes the previous one", () => {
    const next = applyInsert(rows, { id: "c", v: 3, effectiveFrom: "2027-01-01" });
    expect(next.find((r) => r.id === "b")?.effectiveTo).toBe("2027-01-01");
    expect(next.find((r) => r.id === "c")?.effectiveTo).toBeNull();
  });

  it("inserting before a future version ends where the future one starts", () => {
    const next = applyInsert(rows, { id: "c", v: 3, effectiveFrom: "2026-05-01" });
    expect(next.find((r) => r.id === "a")?.effectiveTo).toBe("2026-05-01");
    expect(next.find((r) => r.id === "c")?.effectiveTo).toBe("2026-09-01");
    assertNoOverlap(next);
  });

  it("rejects a second version on the same start date", () => {
    expect(() => planInsert(rows, "2026-09-01")).toThrow(AppError);
  });

  it("detects overlaps and empty intervals", () => {
    expect(() =>
      assertNoOverlap([
        { effectiveFrom: "2026-01-01", effectiveTo: null },
        { effectiveFrom: "2026-06-01", effectiveTo: null },
      ]),
    ).toThrow(/overlap/);
    expect(() => assertNoOverlap([{ effectiveFrom: "2026-01-01", effectiveTo: "2026-01-01" }])).toThrow();
  });

  it("removing a version re-opens its predecessor", () => {
    const next = applyRemove(rows, "b");
    expect(next).toEqual([{ id: "a", v: 1, effectiveFrom: "2026-01-01", effectiveTo: null }]);
  });
});

/** Deterministic PRNG so the property test is reproducible. */
function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("property: random event sequences never overlap", () => {
  it("holds for 300 random sequences of inserts and cancellations", () => {
    for (let seed = 1; seed <= 300; seed++) {
      const rand = mulberry32(seed);
      let timeline: Row[] = [{ id: "hire", v: 0, effectiveFrom: "2025-01-01", effectiveTo: null }];
      const values = new Map<string, number>([["hire", 0]]);
      for (let step = 0; step < 25; step++) {
        if (rand() < 0.25 && timeline.length > 1) {
          const victim = timeline[1 + Math.floor(rand() * (timeline.length - 1))] as Row;
          timeline = applyRemove(timeline, victim.id);
        } else {
          const from = addDays("2025-01-02", Math.floor(rand() * 900));
          const id = `e${step}`;
          try {
            timeline = applyInsert(timeline, { id, v: step + 1, effectiveFrom: from });
            values.set(id, step + 1);
          } catch (err) {
            expect(err).toBeInstanceOf(AppError); // same-date collision is rejected, never applied
          }
        }
        assertNoOverlap(timeline);
        // Coverage: from the hire date onward, every date resolves to exactly one version.
        for (let d = 0; d < 950; d += 37) {
          const date = addDays("2025-01-01", d);
          expect(timeline.filter((r) => covers(r, date))).toHaveLength(1);
        }
      }
    }
  });
});
