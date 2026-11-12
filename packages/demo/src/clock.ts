import type { Clock } from "@crowhr/core";

/**
 * The demo company lives on Saturday 31 October 2026 (Asia/Singapore). Its payroll history,
 * work-pass expiries and CPF age boundaries are written for that date, so the demo clock starts
 * there and then runs in real time. Without the anchor, a visit in 2027 would show October 2026 as
 * a stale "current" draft run and every pending task as overdue. The offset is stored with the
 * database and recomputed on reset.
 *
 * Every visit starts at the same time of day, late morning: the outlets' morning crews have
 * clocked in (seed/morning.ts), so Attendance shows a working Saturday rather than a café where
 * nobody turned up, whatever the visitor's own time zone or hour.
 */
export const DEMO_TODAY = "2026-10-31";
export const DEMO_START_TIME = "11:30";

/** Offset (ms) that maps real time onto the demo date at DEMO_START_TIME in Singapore. */
export function demoClockOffset(realNow: Date, today = DEMO_TODAY, time = DEMO_START_TIME): number {
  return Date.parse(`${today}T${time}:00.000+08:00`) - realNow.getTime();
}

export function offsetClock(offsetMs: number, realNow: () => number = Date.now): Clock {
  return { now: () => new Date(realNow() + offsetMs) };
}

/** A clock the seed moves through the company's history (July → October 2026). */
export function movableSeedClock(start: string) {
  let at = new Date(start).getTime();
  return {
    now: () => new Date(at),
    /** Jump to an instant given as Singapore local time, e.g. `2026-07-24T10:00`. */
    set(sgLocal: string) {
      const next = Date.parse(`${sgLocal}:00.000+08:00`);
      if (Number.isNaN(next)) throw new Error(`Bad seed time ${sgLocal}`);
      at = next;
    },
    advance(ms: number) {
      at += ms;
    },
  };
}
export type SeedClock = ReturnType<typeof movableSeedClock>;
