import type { TimesheetPeriodKind } from "../db/schema/attendance.ts";
import { addDays, displayDate, singaporeToday } from "../employees/dates.ts";

/**
 * Timesheet periods (add-timesheet-approval design decision 1). Pure, and deliberately free of
 * other attendance imports (punches, timesheets and the lock checks all import it): a period is
 * computed from a date and the organisation's setting; submissions store their own range, so
 * changing the setting never moves an approved period.
 */

export type { TimesheetPeriodKind };

/** An out punch before this hour (SGT) closes the previous day's open shift. */
export const OVERNIGHT_CUTOFF_HOUR = 4;

export interface Period {
  /** YYYY-MM-DD, inclusive. */
  start: string;
  /** YYYY-MM-DD, inclusive. */
  end: string;
}

function lastDayOfMonth(year: number, month: number): string {
  // Day 0 of the next month is the last day of this one.
  return new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
}

/** The period of `kind` that contains `date`. */
export function periodOf(date: string, kind: TimesheetPeriodKind): Period {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const month = `${y}-${String(m).padStart(2, "0")}`;
  if (kind === "monthly") return { start: `${month}-01`, end: lastDayOfMonth(y, m) };
  if (kind === "semi_monthly") {
    return d <= 15 ? { start: `${month}-01`, end: `${month}-15` } : { start: `${month}-16`, end: lastDayOfMonth(y, m) };
  }
  // Weekly: Monday to Sunday (getUTCDay: 0 = Sunday).
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  const start = addDays(date, -((dow + 6) % 7));
  return { start, end: addDays(start, 6) };
}

export function previousPeriod(p: Period, kind: TimesheetPeriodKind): Period {
  return periodOf(addDays(p.start, -1), kind);
}

export function nextPeriod(p: Period, kind: TimesheetPeriodKind): Period {
  return periodOf(addDays(p.end, 1), kind);
}

/**
 * When a period may be submitted: 04:00 SGT on the day after its last day. Before attendance's
 * overnight cut-off a clock-out can still close a shift on the period's last work date.
 */
export function submittableFrom(p: Period): Date {
  const hh = String(OVERNIGHT_CUTOFF_HOUR).padStart(2, "0");
  return new Date(`${addDays(p.end, 1)}T${hh}:00:00+08:00`);
}

export function isPeriodOver(p: Period, now: Date): boolean {
  return now.getTime() >= submittableFrom(p).getTime();
}

/** The most recent period that is over at `now`. */
export function latestEndedPeriod(now: Date, kind: TimesheetPeriodKind): Period {
  let p = periodOf(singaporeToday(now), kind);
  while (!isPeriodOver(p, now)) p = previousPeriod(p, kind);
  return p;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** `1–31 Oct 2026`, `26 Oct – 1 Nov 2026`, `28 Dec 2026 – 3 Jan 2027`. */
export function periodLabel(p: Period): string {
  const [ys, ms, ds] = p.start.split("-").map(Number) as [number, number, number];
  const [ye, me, de] = p.end.split("-").map(Number) as [number, number, number];
  if (p.start === p.end) return displayDate(p.start);
  if (ys === ye && ms === me) return `${ds}–${de} ${MONTHS[me - 1]} ${ye}`;
  if (ys === ye) return `${ds} ${MONTHS[ms - 1]} – ${de} ${MONTHS[me - 1]} ${ye}`;
  return `${displayDate(p.start)} – ${displayDate(p.end)}`;
}

export function periodsOverlap(a: Period, b: Period): boolean {
  return a.start <= b.end && b.start <= a.end;
}
