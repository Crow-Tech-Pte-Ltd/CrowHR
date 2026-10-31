import {
  checkProjectedMonthlyOvertime,
  checkRosterWeek,
  publicHolidayWorkNote,
  type RuleIssue,
  restDayWorkNote,
} from "@crowhr/sg-rules";
import { addDays } from "../employees/dates.ts";
import { dayInfo, type EmployeeTime, mondayIndex, scheduleOn, tenureOn } from "../leave/calendar.ts";
import type { LeaveCalendarEntry } from "../leave/outputs.ts";
import { dayLabel, mondayOf, paidMinutes, rangeLabel, weekDates } from "./time.ts";

/**
 * Conflicts are computed on read, never stored (design decision 5). `computeConflicts` is pure:
 * the loader in `rosters.ts` gives it the shifts, the employees' time facts and the leave
 * calendar, so tests can pass doubles.
 */

export type ConflictKind =
  | "overlap"
  | "on_leave"
  | "outside_employment"
  | "pending_leave"
  | "public_holiday"
  | "rest_day"
  | "daily_hours"
  | "overtime"
  | "weekly_hours"
  | "no_rest_day"
  | "ot_cap";

/** `block`: cannot be saved. `ack`: must be acknowledged to publish. `warning`, `hint`: shown. */
export type ConflictSeverity = "block" | "ack" | "warning" | "hint";

export interface Conflict {
  kind: ConflictKind;
  severity: ConflictSeverity;
  /** Short cell label, e.g. "On leave". */
  label: string;
  message: string;
  source: string | null;
}

export const ACK_KINDS: readonly ConflictKind[] = ["on_leave", "outside_employment"];

export interface ShiftLike {
  id: string;
  rosterId: string;
  employeeId: string | null;
  kind: "shift" | "rest";
  date: string;
  startsAt: Date | null;
  endsAt: Date | null;
  breakMinutes: number;
}

export interface ConflictInput {
  /** Shifts to report on (one roster's working copy). */
  shifts: readonly ShiftLike[];
  /** Every working-copy row of the same employees over the months the week touches (any roster). */
  context: readonly ShiftLike[];
  times: ReadonlyMap<string, EmployeeTime>;
  leave: readonly (LeaveCalendarEntry & { label?: string })[];
  /** Scheduled start of a fixed working day (HH:MM), for the half-day AM/PM boundary. */
  startTimeFor(employeeId: string, date: string): string;
  weekStart: string;
}

export interface ConflictResult {
  byShift: Map<string, Conflict[]>;
  /** Week-level warnings per employee (44-hour week, no rest day, 72-hour month). */
  byEmployee: Map<string, Conflict[]>;
  /** The rest day used for checks when none is marked ("Sunday" for shift schedules), per employee. */
  assumedRestDay: Map<string, string | null>;
  minutesByEmployee: Map<string, number>;
}

const MIN = 60_000;
const overlaps = (a0: number, a1: number, b0: number, b1: number) => a0 < b1 && b0 < a1;

function fromIssue(
  kind: ConflictKind,
  label: string,
  issue: RuleIssue,
  severity: ConflictSeverity = "warning",
): Conflict {
  return { kind, severity, label, message: issue.message, source: issue.source ?? null };
}

/** The employee's rest date in the week: a marked rest cell, else the work schedule's (fixed) or Sunday. */
export function restDateOf(
  t: EmployeeTime | undefined,
  weekStart: string,
  rows: readonly ShiftLike[],
): { date: string | null; assumed: boolean } {
  const marked = rows.find((r) => r.kind === "rest" && mondayOf(r.date) === weekStart);
  if (marked) return { date: marked.date, assumed: false };
  if (!t) return { date: null, assumed: true };
  for (const d of weekDates(weekStart)) {
    const s = scheduleOn(t, d);
    if (s?.version.days) {
      const i = s.version.days.findIndex((x) => x.type === "rest");
      return { date: i < 0 ? null : addDays(weekStart, i), assumed: true };
    }
  }
  return { date: addDays(weekStart, 6), assumed: true };
}

/** Paid minutes per roster date for one employee in one week (shifts only). */
function minutesByDate(rows: readonly ShiftLike[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const r of rows) {
    if (r.kind !== "shift" || !r.startsAt || !r.endsAt) continue;
    out.set(r.date, (out.get(r.date) ?? 0) + paidMinutes(r.startsAt, r.endsAt, r.breakMinutes));
  }
  return out;
}

function weekCheck(t: EmployeeTime | undefined, weekStart: string, rows: readonly ShiftLike[]) {
  const mine = rows.filter((r) => mondayOf(r.date) === weekStart);
  const minutes = minutesByDate(mine);
  const rest = restDateOf(t, weekStart, mine);
  return checkRosterWeek({
    days: weekDates(weekStart).map((date) => ({
      date,
      minutes: minutes.get(date) ?? 0,
      restDay: date === rest.date,
      publicHoliday: t ? dayInfo(t, date).holiday !== null : false,
    })),
  });
}

export function computeConflicts(input: ConflictInput): ConflictResult {
  const byShift = new Map<string, Conflict[]>();
  const byEmployee = new Map<string, Conflict[]>();
  const assumedRestDay = new Map<string, string | null>();
  const minutesByEmployee = new Map<string, number>();
  const push = (id: string, c: Conflict) => {
    const list = byShift.get(id) ?? [];
    if (!list.some((x) => x.kind === c.kind)) list.push(c);
    byShift.set(id, list);
  };
  const employeeIds = [...new Set(input.shifts.map((s) => s.employeeId).filter((x): x is string => !!x))];
  for (const employeeId of employeeIds) {
    const t = input.times.get(employeeId);
    const all = input.context.filter((r) => r.employeeId === employeeId);
    const mineInWeek = all.filter((r) => mondayOf(r.date) === input.weekStart);
    const rest = restDateOf(t, input.weekStart, mineInWeek);
    assumedRestDay.set(employeeId, rest.assumed ? rest.date : null);
    const week = weekCheck(t, input.weekStart, all);
    minutesByEmployee.set(employeeId, week.totalMinutes);

    for (const s of input.shifts) {
      if (s.employeeId !== employeeId || s.kind !== "shift" || !s.startsAt || !s.endsAt) continue;
      const s0 = s.startsAt.getTime();
      const s1 = s.endsAt.getTime();
      // overlap (normally blocked at save; shown if two editors raced across rosters)
      for (const o of all) {
        if (o.id === s.id || o.kind !== "shift" || !o.startsAt || !o.endsAt) continue;
        if (overlaps(s0, s1, o.startsAt.getTime(), o.endsAt.getTime())) {
          push(s.id, {
            kind: "overlap",
            severity: "block",
            label: "Overlaps",
            message: `Overlaps ${rangeLabel(o.startsAt, o.endsAt)} on ${dayLabel(o.date)}.`,
            source: null,
          });
        }
      }
      if (t && !tenureOn(t, s.date)) {
        const first = t.tenures[0]?.hireDate;
        const last = t.tenures.at(-1)?.lastWorkingDay;
        push(s.id, {
          kind: "outside_employment",
          severity: "ack",
          label: "Not employed",
          message:
            first && s.date < first
              ? `Starts work on ${dayLabel(first)}.`
              : last
                ? `Left on ${dayLabel(last)}.`
                : "Not employed on this date.",
          source: null,
        });
      }
      for (const l of input.leave) {
        if (l.employeeId !== employeeId || l.date !== s.date) continue;
        let hit = l.session === "full";
        if (!hit && t) {
          const sched = scheduleOn(t, s.date);
          if (!sched?.version.days) {
            // Shift schedule: the half-day boundary is the shift's midpoint, so AM leave takes its
            // first half and PM leave its second: either way the shift is affected.
            hit = true;
          } else {
            const day = sched.version.days[mondayIndex(s.date)];
            const start = new Date(`${s.date}T${input.startTimeFor(employeeId, s.date)}:00+08:00`).getTime();
            const mid = start + Math.round((day?.minutes ?? 480) / 2) * MIN;
            const end = start + 24 * 60 * MIN;
            hit = l.session === "am" ? overlaps(s0, s1, start, mid) : overlaps(s0, s1, mid, end);
          }
        }
        if (!hit) continue;
        const half = l.session === "full" ? "" : ` (${l.session.toUpperCase()})`;
        if (l.status === "approved") {
          push(s.id, {
            kind: "on_leave",
            severity: "ack",
            label: `On leave${half}`,
            message: `${l.label ?? "Approved leave"}${half} on ${dayLabel(s.date)}.`,
            source: null,
          });
        } else {
          push(s.id, {
            kind: "pending_leave",
            severity: "hint",
            label: `Leave pending${half}`,
            message: `${l.label ?? "Leave"}${half} on ${dayLabel(s.date)} is waiting for approval.`,
            source: null,
          });
        }
      }
      const holiday = t ? dayInfo(t, s.date).holiday : null;
      if (holiday) {
        const n = publicHolidayWorkNote(holiday);
        push(s.id, { kind: "public_holiday", severity: "warning", label: "Public holiday", ...n });
      }
      if (rest.date === s.date) {
        const n = restDayWorkNote();
        push(s.id, {
          kind: "rest_day",
          severity: "warning",
          label: "Rest day",
          message: rest.assumed
            ? `${n.message} No rest day is marked this week, so ${dayLabel(s.date).slice(0, 3)} is assumed.`
            : n.message,
          source: n.source,
        });
      }
      const day = week.days.find((d) => d.date === s.date);
      for (const issue of day?.issues ?? []) {
        if (issue.code === "EA_DAILY_HOURS_LIMIT") push(s.id, fromIssue("daily_hours", "Over 12 h", issue));
        if (issue.code === "EA_BEYOND_NORMAL_DAILY") push(s.id, fromIssue("overtime", "Overtime", issue, "hint"));
      }
    }

    const weekly: Conflict[] = [];
    for (const issue of week.issues) {
      if (issue.code === "EA_WEEKLY_NORMAL_HOURS") weekly.push(fromIssue("weekly_hours", "Over 44 h", issue));
      if (issue.code === "EA_NO_REST_DAY") weekly.push(fromIssue("no_rest_day", "No rest day", issue));
    }
    // Projected OT in each calendar month the week touches, across every week of that month.
    for (const month of new Set(weekDates(input.weekStart).map((d) => d.slice(0, 7)))) {
      const first = `${month}-01`;
      let cap = 0;
      for (let w = mondayOf(first); w.slice(0, 7) <= month; w = addDays(w, 7)) {
        for (const d of weekCheck(t, w, all).days) if (d.date.startsWith(month)) cap += d.capMinutes;
      }
      for (const issue of checkProjectedMonthlyOvertime({ date: first, minutes: cap })) {
        weekly.push(fromIssue("ot_cap", "Over 72 h OT", issue));
      }
    }
    if (weekly.length) byEmployee.set(employeeId, weekly);
  }
  return { byShift, byEmployee, assumedRestDay, minutesByEmployee };
}
