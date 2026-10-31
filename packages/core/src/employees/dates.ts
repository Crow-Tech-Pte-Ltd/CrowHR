/**
 * ISO calendar dates (`YYYY-MM-DD`) as plain strings. They compare correctly
 * with `<`/`>` and never shift with time zones. Arithmetic goes through UTC
 * midnight so DST and the host zone never matter.
 */
export type IsoDate = string;

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isIsoDate(value: string): boolean {
  const m = ISO_DATE.exec(value);
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.toISOString().slice(0, 10) === value;
}

function toUtc(date: IsoDate): Date {
  const m = ISO_DATE.exec(date);
  if (!m) throw new RangeError(`Expected YYYY-MM-DD, got "${date}".`);
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
}

export function addDays(date: IsoDate, days: number): IsoDate {
  const d = toUtc(date);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Whole days from `a` to `b` (positive when b is later). */
export function daysBetween(a: IsoDate, b: IsoDate): number {
  return Math.round((toUtc(b).getTime() - toUtc(a).getTime()) / 86_400_000);
}

/** Today's calendar date in Asia/Singapore (UTC+8, no DST since 1982). */
export function singaporeToday(now: Date): IsoDate {
  return new Date(now.getTime() + 8 * 3_600_000).toISOString().slice(0, 10);
}

/** Age in whole years on `onDate` for someone born on `dob`. */
export function ageOn(dob: IsoDate, onDate: IsoDate): number {
  const [by, bm, bd] = dob.split("-").map(Number) as [number, number, number];
  const [y, m, d] = onDate.split("-").map(Number) as [number, number, number];
  let age = y - by;
  if (m < bm || (m === bm && d < bd)) age -= 1;
  return age;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

/** `2026-12-02` → `2 Dec 2026` (Singapore display convention). */
export function displayDate(date: IsoDate): string {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

/** `2026-09` → `September 2026`. */
export function displayMonth(year: number, month: number): string {
  const long = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ];
  return `${long[month - 1]} ${year}`;
}
