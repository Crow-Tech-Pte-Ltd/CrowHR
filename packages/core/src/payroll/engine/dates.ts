/** Calendar helpers on ISO dates (UTC arithmetic, no time zones: these are civil dates). */

export function parseIso(date: string): { y: number; m: number; d: number } {
  const [y, m, d] = date.split("-").map(Number);
  return { y: y as number, m: m as number, d: d as number };
}

export function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export function monthBounds(month: string): { start: string; end: string } {
  const [y, m] = month.split("-").map(Number) as [number, number];
  return { start: `${month}-01`, end: `${month}-${String(daysInMonth(y, m)).padStart(2, "0")}` };
}

export function addDays(date: string, days: number): string {
  const { y, m, d } = parseIso(date);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

export function addMonths(month: string, n: number): string {
  const [y, m] = month.split("-").map(Number) as [number, number];
  const idx = y * 12 + (m - 1) + n;
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, "0")}`;
}

/** 0 = Sunday … 6 = Saturday. */
export function dayOfWeek(date: string): number {
  const { y, m, d } = parseIso(date);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export const maxDate = (a: string, b: string) => (a > b ? a : b);
export const minDate = (a: string, b: string) => (a < b ? a : b);

/** Inclusive date range iteration. */
export function* eachDay(from: string, to: string): Generator<string> {
  for (let d = from; d <= to; d = addDays(d, 1)) yield d;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTHS_LONG = [
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

/** `31 Oct 2026` (AGENTS.md Singapore conventions). */
export function dateLabel(date: string): string {
  const { y, m, d } = parseIso(date);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

/** `October 2026`. */
export function monthLabel(month: string): string {
  const [y, m] = month.split("-").map(Number) as [number, number];
  return `${MONTHS_LONG[m - 1]} ${y}`;
}

export function monthShortName(month: string): string {
  return MONTHS_LONG[Number(month.slice(5, 7)) - 1] as string;
}

/** `OCT2026` (CPF EZPay file names). */
export function monthCode(month: string): string {
  return `${(MONTHS[Number(month.slice(5, 7)) - 1] as string).toUpperCase()}${month.slice(0, 4)}`;
}

/** `S$1,234.56`. Integer cents only. */
export function sgd(cents: number): string {
  const neg = cents < 0;
  const abs = Math.abs(cents);
  const dollars = Math.floor(abs / 100)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${neg ? "−" : ""}S$${dollars}.${String(abs % 100).padStart(2, "0")}`;
}
