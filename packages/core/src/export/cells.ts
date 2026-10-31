/**
 * Typed cells shared by the CSV and XLSX writers (add-reporting design decision 3). Values are
 * stored exactly: money as integer cents, percentages as integer tenths of a percent (14.3% = 143),
 * hours as integer minutes, so no float ever decides a figure. Writers only format them.
 */
export type CellType =
  | "text"
  | "integer"
  | "decimal"
  | "money_cents"
  | "percent"
  | "hours"
  | "date"
  | "datetime"
  | "boolean";

export type CellValue = string | number | boolean | null | undefined;

export interface ExportColumn {
  key: string;
  title: string;
  type: CellType;
}

export type ExportRow = Record<string, CellValue>;

/** "1234.56" / "-0.05" from integer cents, without float arithmetic. */
export function centsToDecimal(cents: number): string {
  if (!Number.isSafeInteger(cents)) throw new RangeError(`Money must be a safe integer of cents, got ${cents}.`);
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${sign}${Math.trunc(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

/** "14.3" from 143 tenths of a percent. */
export function tenthsToDecimal(tenths: number): string {
  const sign = tenths < 0 ? "-" : "";
  const abs = Math.abs(Math.round(tenths));
  return `${sign}${Math.trunc(abs / 10)}.${abs % 10}`;
}

/** "15.30" hours (2 places, half-up) from 918 minutes. */
export function minutesToHours(minutes: number): string {
  const sign = minutes < 0 ? "-" : "";
  const hundredths = Math.round((Math.abs(minutes) * 100) / 60);
  return `${sign}${Math.trunc(hundredths / 100)}.${String(hundredths % 100).padStart(2, "0")}`;
}

/** Singapore local date-time (UTC+8) as `YYYY-MM-DD HH:mm`. */
export function sgDateTime(iso: string): string {
  const d = new Date(Date.parse(iso) + 8 * 3600_000);
  return d.toISOString().slice(0, 16).replace("T", " ");
}
