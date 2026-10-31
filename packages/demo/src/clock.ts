import type { Clock } from "@crowhr/core";

/**
 * The demo company lives on 31 October 2026 (Asia/Singapore). Its payroll history, work-pass
 * expiries and CPF age boundaries are written for that date, so the demo clock starts there — at
 * the visitor's current time of day — and then runs in real time. Without the anchor, a visit in
 * 2027 would show October 2026 as a stale "current" draft run and every pending task as overdue.
 * The offset is stored with the database and recomputed on reset.
 */
export const DEMO_TODAY = "2026-10-31";
const SGT_OFFSET_MS = 8 * 3600_000;
const DAY_MS = 24 * 3600_000;

/** Offset (ms) that maps real time onto the demo date at the same Singapore time of day. */
export function demoClockOffset(realNow: Date, today = DEMO_TODAY): number {
  const sgMs = realNow.getTime() + SGT_OFFSET_MS;
  const timeOfDay = ((sgMs % DAY_MS) + DAY_MS) % DAY_MS;
  const demoMidnightUtc = Date.parse(`${today}T00:00:00.000Z`) - SGT_OFFSET_MS;
  return demoMidnightUtc + timeOfDay - realNow.getTime();
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
