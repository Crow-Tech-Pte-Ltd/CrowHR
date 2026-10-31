import { SgRulesInputError } from "../errors.ts";
import type { IsoDate, YearMonth } from "../types.ts";

export interface Ymd {
  readonly y: number;
  readonly m: number;
  readonly d: number;
}

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MONTH_RE = /^(\d{4})-(\d{2})$/;

export function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export function parseDate(date: IsoDate, field = "date"): Ymd {
  const match = DATE_RE.exec(date);
  if (!match) throw new SgRulesInputError(`${field} must be an ISO date YYYY-MM-DD, got "${date}".`);
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  if (m < 1 || m > 12 || d < 1 || d > daysInMonth(y, m)) {
    throw new SgRulesInputError(`${field} "${date}" is not a real calendar date.`);
  }
  return { y, m, d };
}

export function parseMonth(month: YearMonth, field = "month"): { y: number; m: number } {
  const match = MONTH_RE.exec(month);
  if (!match) throw new SgRulesInputError(`${field} must be a month YYYY-MM, got "${month}".`);
  const y = Number(match[1]);
  const m = Number(match[2]);
  if (m < 1 || m > 12) throw new SgRulesInputError(`${field} "${month}" has no month ${m}.`);
  return { y, m };
}

const pad = (n: number, w = 2) => String(n).padStart(w, "0");

export function formatMonth(y: number, m: number): YearMonth {
  return `${pad(y, 4)}-${pad(m)}`;
}

export function formatDate(y: number, m: number, d: number): IsoDate {
  return `${pad(y, 4)}-${pad(m)}-${pad(d)}`;
}

/** Months since year 0, for comparisons. */
export function monthIndex(month: YearMonth): number {
  const { y, m } = parseMonth(month);
  return y * 12 + (m - 1);
}

export function addMonths(month: YearMonth, n: number): YearMonth {
  const i = monthIndex(month) + n;
  return formatMonth(Math.floor(i / 12), (i % 12) + 1);
}

export function monthOf(date: IsoDate): YearMonth {
  parseDate(date);
  return date.slice(0, 7);
}

export function epochDay(date: IsoDate): number {
  const { y, m, d } = parseDate(date);
  return Date.UTC(y, m - 1, d) / 86_400_000;
}

export function fromEpochDay(day: number): IsoDate {
  const dt = new Date(day * 86_400_000);
  return formatDate(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}

export function addDays(date: IsoDate, n: number): IsoDate {
  return fromEpochDay(epochDay(date) + n);
}

/** 0 = Sunday … 6 = Saturday. */
export function dayOfWeek(date: IsoDate): number {
  const { y, m, d } = parseDate(date);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Jan 2026". */
export function monthLabel(month: YearMonth): string {
  const { y, m } = parseMonth(month);
  return `${MONTH_NAMES[m - 1]} ${y}`;
}

/** "13 Jan 2026". */
export function dateLabel(date: IsoDate): string {
  const { y, m, d } = parseDate(date);
  return `${d} ${MONTH_NAMES[m - 1]} ${y}`;
}

/**
 * Whole months of service from `start` (first day of service) to `asOf` (inclusive), MOM-style:
 * 14 Mar → 31 Jul is 4 completed months. Partial months are ignored.
 */
export function completedMonths(start: IsoDate, asOf: IsoDate): number {
  const s = parseDate(start, "start date");
  parseDate(asOf, "as-of date");
  if (asOf < start) return 0;
  let months = 0;
  for (;;) {
    const next = months + 1;
    const i = s.y * 12 + (s.m - 1) + next;
    const y = Math.floor(i / 12);
    const m = (i % 12) + 1;
    // Anniversary of the start day in month m (clamped to month end), minus one day = last day of the period.
    const anniversary = formatDate(y, m, Math.min(s.d, daysInMonth(y, m)));
    const periodEnd = s.d > daysInMonth(y, m) ? anniversary : addDays(anniversary, -1);
    if (periodEnd <= asOf) months = next;
    else return months;
  }
}
