import { describe, expect, it } from "vitest";
import { employee } from "../leave/fixtures.test-helpers.ts";
import type { LeaveCalendarEntry } from "../leave/outputs.ts";
import { type ConflictInput, computeConflicts, type ShiftLike } from "./conflicts.ts";
import { shiftInstants } from "./time.ts";

/** `computeConflicts` with a `LeaveCalendar` double and pure employee facts (no database). */
const E = "00000000-0000-7000-8000-000000000002";
const WEEK = "2026-11-02"; // Mon 2 Nov 2026; Sun 8 Nov is Deepavali (gazetted 2026-11-08)
let seq = 0;

function shift(date: string, start: string, end: string, breakMinutes = 60, employeeId: string | null = E): ShiftLike {
  seq += 1;
  return {
    id: `00000000-0000-7000-8000-${String(seq).padStart(12, "0")}`,
    rosterId: "r",
    employeeId,
    kind: "shift",
    date,
    breakMinutes,
    ...shiftInstants(date, start, end),
  };
}

function rest(date: string): ShiftLike {
  seq += 1;
  return {
    id: `00000000-0000-7000-8000-${String(seq).padStart(12, "0")}`,
    rosterId: "r",
    employeeId: E,
    kind: "rest",
    date,
    startsAt: null,
    endsAt: null,
    breakMinutes: 0,
  };
}

function run(shifts: ShiftLike[], opts: Partial<ConflictInput> & { leave?: LeaveCalendarEntry[] } = {}) {
  const t = opts.times ?? new Map([[E, employee({ days: null })]]);
  return computeConflicts({
    shifts,
    context: opts.context ?? shifts,
    times: t,
    leave: opts.leave ?? [],
    weekStart: WEEK,
    startTimeFor: () => "09:00",
  });
}

const kinds = (r: ReturnType<typeof run>, s: ShiftLike) => (r.byShift.get(s.id) ?? []).map((c) => c.kind);

describe("computeConflicts", () => {
  it("overlap between two shifts of one employee is a blocking conflict", () => {
    const a = shift("2026-11-03", "09:00", "17:00");
    const b = shift("2026-11-03", "16:00", "22:00");
    const r = run([a, b]);
    expect(r.byShift.get(b.id)?.find((c) => c.kind === "overlap")).toMatchObject({
      severity: "block",
      message: "Overlaps 09:00–17:00 on Tue 3 Nov 2026.",
    });
  });

  it("full-day approved leave conflicts and must be acknowledged; pending leave is a hint", () => {
    const a = shift("2026-11-03", "09:00", "17:00");
    const b = shift("2026-11-04", "09:00", "17:00");
    const r = run([a, b], {
      leave: [
        { employeeId: E, date: "2026-11-03", session: "full", status: "approved" },
        { employeeId: E, date: "2026-11-04", session: "full", status: "pending" },
      ],
    });
    expect(r.byShift.get(a.id)?.[0]).toMatchObject({ kind: "on_leave", severity: "ack", label: "On leave" });
    expect(r.byShift.get(b.id)?.[0]).toMatchObject({ kind: "pending_leave", severity: "hint", label: "Leave pending" });
  });

  it("half-day leave by the work schedule's boundary for fixed-week staff", () => {
    const office = new Map([[E, employee({})]]); // Mon–Fri 8 h from 09:00: the boundary is 13:00
    const morning = shift("2026-11-03", "08:00", "12:00", 0);
    const evening = shift("2026-11-04", "14:00", "18:00", 0);
    const r = run([morning, evening], {
      times: office,
      leave: [
        { employeeId: E, date: "2026-11-03", session: "pm", status: "approved" },
        { employeeId: E, date: "2026-11-04", session: "pm", status: "approved" },
      ],
    });
    expect(kinds(r, morning)).not.toContain("on_leave");
    expect(r.byShift.get(evening.id)?.find((c) => c.kind === "on_leave")?.label).toBe("On leave (PM)");
  });

  it("half-day leave always touches a shift-schedule shift (the boundary is the shift's midpoint)", () => {
    const a = shift("2026-11-03", "14:00", "18:00", 0);
    const r = run([a], { leave: [{ employeeId: E, date: "2026-11-03", session: "am", status: "approved" }] });
    expect(r.byShift.get(a.id)?.[0]?.label).toBe("On leave (AM)");
  });

  it("shifts before the hire date or after the last day are outside employment", () => {
    const t = new Map([[E, employee({ days: null, hireDate: "2026-11-04", lastWorkingDay: null })]]);
    const before = shift("2026-11-03", "09:00", "17:00");
    const after = shift("2026-11-05", "09:00", "17:00");
    const r = run([before, after], { times: t });
    expect(r.byShift.get(before.id)?.[0]).toMatchObject({
      kind: "outside_employment",
      severity: "ack",
      message: "Starts work on Wed 4 Nov 2026.",
    });
    expect(kinds(r, after)).not.toContain("outside_employment");
    const left = new Map([[E, employee({ days: null, hireDate: "2024-01-02", lastWorkingDay: "2026-11-04" })]]);
    expect(run([after], { times: left }).byShift.get(after.id)?.[0]?.message).toBe("Left on Wed 4 Nov 2026.");
  });

  it("a public holiday and an assumed Sunday rest day carry their pay implications", () => {
    const sunday = shift("2026-11-08", "10:00", "18:00");
    const r = run([sunday]);
    const c = r.byShift.get(sunday.id) ?? [];
    expect(c.find((x) => x.kind === "public_holiday")?.message).toMatch(
      /^Public holiday \(Deepavali\): Part 4 staff who work get an extra day's basic pay/,
    );
    expect(c.find((x) => x.kind === "rest_day")?.message).toMatch(
      /No rest day is marked this week, so Sun is assumed\.$/,
    );
    expect(r.assumedRestDay.get(E)).toBe("2026-11-08");
  });

  it("a marked rest day replaces the Sunday default", () => {
    const wed = rest("2026-11-04");
    const sunday = shift("2026-11-07", "10:00", "18:00");
    const onRest = shift("2026-11-04", "10:00", "14:00", 0);
    const r = run([wed, sunday, onRest]);
    expect(kinds(r, sunday)).not.toContain("rest_day");
    expect(r.byShift.get(onRest.id)?.find((c) => c.kind === "rest_day")?.message).toMatch(/^Rest-day work:/);
    expect(r.assumedRestDay.get(E)).toBeNull();
  });

  it("fixed-week staff: the work schedule's rest day applies", () => {
    const office = new Map([[E, employee({})]]); // Sunday rest
    const sunday = shift("2026-11-01", "10:00", "14:00", 0); // previous week's Sunday is not this week
    const thisSunday = shift("2026-11-08", "10:00", "14:00", 0);
    const r = run([thisSunday], { times: office, context: [sunday, thisSunday] });
    expect(kinds(r, thisSunday)).toContain("rest_day");
  });

  it("hour limits: 13 h day, six 10 h days, no rest day, and the 72-hour month", () => {
    const long = shift("2026-11-02", "07:00", "21:00", 60); // 13 h paid
    expect(r1(long)).toContain("daily_hours");
    function r1(s: ShiftLike) {
      return kinds(run([s]), s);
    }
    const six = ["02", "03", "04", "05", "06", "07"].map((d) => shift(`2026-11-${d}`, "08:00", "19:00", 60));
    const r = run(six);
    expect(r.byShift.get(six[0]?.id ?? "")?.find((c) => c.kind === "overtime")?.message).toBe(
      "2 h beyond normal daily hours (8 h): paid as overtime.",
    );
    expect(r.byEmployee.get(E)?.map((c) => [c.kind, c.message])).toEqual([
      ["weekly_hours", "60 h rostered: 16 h beyond the 44-hour week, paid as overtime."],
    ]);
    const seven = [...six, shift("2026-11-08", "08:00", "19:00", 60)];
    expect(
      run(seven)
        .byEmployee.get(E)
        ?.map((c) => c.kind),
    ).toContain("no_rest_day");
    // Four weeks of six 12 h days in November: well over 72 h of overtime.
    const month: ShiftLike[] = [];
    for (const w of ["2026-11-02", "2026-11-09", "2026-11-16", "2026-11-23"]) {
      for (let i = 0; i < 6; i++) {
        const d = new Date(`${w}T00:00:00Z`);
        d.setUTCDate(d.getUTCDate() + i);
        month.push(shift(d.toISOString().slice(0, 10), "08:00", "21:00", 60));
      }
    }
    const thisWeek = month.slice(0, 6);
    const m = run(thisWeek, { context: month });
    expect(m.byEmployee.get(E)?.find((c) => c.kind === "ot_cap")?.message).toMatch(
      /of overtime rostered this month: more than the 72-hour monthly limit/,
    );
    expect(m.minutesByEmployee.get(E)).toBe(6 * 12 * 60);
  });

  it("open shifts have no conflicts", () => {
    const open = shift("2026-11-03", "09:00", "17:00", 60, null);
    const r = run([open]);
    expect(r.byShift.size).toBe(0);
  });
});
