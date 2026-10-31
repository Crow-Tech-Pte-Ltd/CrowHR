import { describe, expect, it } from "vitest";
import { countLeave, holidaysFor, patternOf } from "./calendar.ts";
import { employee, MON_FRI, MON_FRI_SAT_HALF, SUN_FRI_SAT_REST } from "./fixtures.test-helpers.ts";

const days = (startDate: string, endDate: string, extra: Partial<Parameters<typeof countLeave>[1]> = {}) => ({
  startDate,
  endDate,
  startSession: "full" as const,
  endSession: "full" as const,
  dayCounting: "working_days" as const,
  unit: "days" as const,
  ...extra,
});

describe("working-day calculator", () => {
  it("maps a Monday-first week onto sg-rules' Sunday-first pattern and rest day", () => {
    expect(patternOf(MON_FRI)).toEqual({ pattern: [0, 1, 1, 1, 1, 1, 0], restDay: 0, workingDaysPerWeek: 5 });
    expect(patternOf(SUN_FRI_SAT_REST)).toMatchObject({ restDay: 6, workingDaysPerWeek: 6 });
    expect(patternOf(MON_FRI_SAT_HALF).workingDaysPerWeek).toBe(5.5);
  });

  it("Sunday holiday → gazetted Monday for a Sunday rest day", () => {
    const h = holidaysFor(employee({}), 2026);
    expect(h.get("2026-11-09")).toBe("Deepavali (in lieu)");
    expect(h.has("2026-11-08")).toBe(false);
    expect(h.get("2026-12-25")).toBe("Christmas Day");
  });

  it("Saturday holiday on an off day: no day off by default, the next working day when the org chooses", () => {
    expect(holidaysFor(employee({}), 2026).has("2026-03-23")).toBe(false);
    expect(holidaysFor(employee({}), 2026).has("2026-03-21")).toBe(false);
    expect(holidaysFor(employee({ offDayHoliday: "next_working_day" }), 2026).get("2026-03-23")).toBe(
      "Hari Raya Puasa (in lieu)",
    );
  });

  it("holiday on a Saturday rest day → the next working day (Sunday for a Sun–Fri week)", () => {
    const t = employee({ days: SUN_FRI_SAT_REST });
    const h = holidaysFor(t, 2026);
    expect(h.get("2026-03-22")).toBe("Hari Raya Puasa (in lieu)");
    // Sunday 8 Nov is a working day for this employee: the holiday stays on Sunday.
    expect(h.get("2026-11-08")).toBe("Deepavali");
    expect(h.has("2026-11-09")).toBe(false);
  });

  it("ad-hoc holidays (Polling Day) count like gazetted ones", () => {
    const t = employee({ orgHolidays: [{ date: "2026-12-24", name: "Polling Day" }] });
    const r = countLeave(t, days("2026-12-23", "2026-12-24"));
    expect(r.totalHundredths).toBe(100);
    expect(r.days[1]?.note).toBe("Public holiday: Polling Day");
  });

  it("half days: afternoon start and morning end; a half working day has no afternoon", () => {
    const t = employee({});
    expect(
      countLeave(t, days("2026-11-10", "2026-11-11", { startSession: "pm", endSession: "am" })).totalHundredths,
    ).toBe(100);
    expect(countLeave(t, days("2026-11-10", "2026-11-10", { startSession: "am" })).totalHundredths).toBe(50);
    const half = employee({ days: MON_FRI_SAT_HALF });
    expect(countLeave(half, days("2026-11-14", "2026-11-14")).totalHundredths).toBe(50);
    expect(countLeave(half, days("2026-11-14", "2026-11-14", { startSession: "pm" })).totalHundredths).toBe(0);
    const bad = countLeave(t, days("2026-11-10", "2026-11-11", { startSession: "am", endSession: "pm" }));
    expect(bad.errors.map((e) => e.path)).toEqual(["startSession", "endSession"]);
  });

  it("hours: each day counts its scheduled minutes", () => {
    const pt = employee({
      days: MON_FRI.map((d) => (d.type === "working" ? { type: "working" as const, minutes: 240 } : d)),
      employmentType: "part_time",
    });
    expect(countLeave(pt, days("2026-11-10", "2026-11-11", { unit: "hours" })).totalHundredths).toBe(800);
    expect(
      countLeave(pt, days("2026-11-10", "2026-11-10", { unit: "hours", startSession: "am" })).totalHundredths,
    ).toBe(200);
  });

  it("parental leave counts holidays inside the period", () => {
    const t = employee({});
    const r = countLeave(t, days("2026-12-21", "2026-12-27", { dayCounting: "working_days_including_holidays" }));
    expect(r.totalHundredths).toBe(500);
  });

  it("splits by leave year and refuses dates outside employment", () => {
    const t = employee({ hireDate: "2026-12-29" });
    const r = countLeave(t, days("2026-12-28", "2027-01-05"));
    expect(r.errors[0]?.message).toMatch(/outside the employee's employment/);
    const ok = countLeave(t, days("2026-12-30", "2027-01-05"));
    expect([...ok.byYear]).toEqual([
      [2026, 200],
      [2027, 200],
    ]);
  });

  it("shift schedules count every non-holiday day, with a warning", () => {
    const t = employee({ days: null });
    // Sat 7, Sun 8 (Deepavali itself: no roster to move it), Mon 9.
    const r = countLeave(t, days("2026-11-07", "2026-11-09"));
    expect(r.totalHundredths).toBe(200);
    expect(r.warnings.join(" ")).toMatch(/shift schedule/);
    expect(countLeave(t, days("2026-12-25", "2026-12-25")).totalHundredths).toBe(0);
  });

  it("warns when a year's holidays aren't published", () => {
    const t = employee({});
    const r = countLeave(t, days("2029-03-05", "2029-03-06"));
    expect(r.totalHundredths).toBe(200);
    expect(r.warnings.join(" ")).toMatch(/2029 aren't published/);
    // The look-back into the previous year (late-December holidays) never warns.
    const t2026 = employee({});
    expect(countLeave(t2026, days("2026-03-05", "2026-03-06")).warnings).toEqual([]);
  });
});
