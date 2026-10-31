import { addDays } from "../employees/dates.ts";

/** Times and dates for rosters (Asia/Singapore, UTC+8, no DST; design decision 2). */

const SG_OFFSET_MS = 8 * 3_600_000;
const MIN = 60_000;

export const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

export function minutesOf(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number) as [number, number];
  return h * 60 + m;
}

/** Shift length in minutes; an end at or before the start ends the next day. */
export function spanMinutes(start: string, end: string): number {
  const s = minutesOf(start);
  const e = minutesOf(end);
  return e > s ? e - s : e + 24 * 60 - s;
}

/** The instants of a shift starting on `date` (SGT). */
export function shiftInstants(date: string, start: string, end: string): { startsAt: Date; endsAt: Date } {
  const startsAt = new Date(`${date}T${start}:00+08:00`);
  return { startsAt, endsAt: new Date(startsAt.getTime() + spanMinutes(start, end) * MIN) };
}

export function paidMinutes(startsAt: Date, endsAt: Date, breakMinutes: number): number {
  return Math.max(0, Math.round((endsAt.getTime() - startsAt.getTime()) / MIN) - breakMinutes);
}

/** `HH:MM` (SGT) of an instant. */
export function sgTime(at: Date): string {
  return new Date(at.getTime() + SG_OFFSET_MS).toISOString().slice(11, 16);
}

/** SGT date of an instant. */
export function sgDate(at: Date): string {
  return new Date(at.getTime() + SG_OFFSET_MS).toISOString().slice(0, 10);
}

/** Monday of the ISO week containing `date`. */
export function mondayOf(date: string): string {
  const dow = new Date(`${date}T00:00:00Z`).getUTCDay();
  return addDays(date, -((dow + 6) % 7));
}

export function isMonday(date: string): boolean {
  return new Date(`${date}T00:00:00Z`).getUTCDay() === 1;
}

export function weekDates(weekStart: string): string[] {
  return Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

/** "Wed 2 Dec 2026". */
export function dayLabel(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  return `${WEEKDAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** "09:00–17:00". */
export function rangeLabel(startsAt: Date, endsAt: Date): string {
  return `${sgTime(startsAt)}–${sgTime(endsAt)}`;
}

/** "7 h 30 min", "8 h", "45 min". */
export function hoursText(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h && m ? `${h} h ${m} min` : h ? `${h} h` : `${m} min`;
}
