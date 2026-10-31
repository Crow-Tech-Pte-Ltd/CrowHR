import {
  type CellType,
  type CellValue,
  centsToDecimal,
  type ExportColumn,
  type ExportRow,
  minutesToHours,
  sgDateTime,
  tenthsToDecimal,
} from "./cells.ts";

/**
 * CSV writer (add-reporting spec "CSV and XLSX export"): UTF-8 with a BOM so Excel on Windows reads
 * it as UTF-8, RFC 4180 quoting, CRLF line ends, ISO dates, money as plain decimals (`1234.56`),
 * percentages with one place. Text cells that a spreadsheet would run as a formula (`= + - @`, and
 * tab/CR) are prefixed with an apostrophe. Streams: rows are written as they arrive.
 */

export const CSV_BOM = "﻿";
export const CSV_CONTENT_TYPE = "text/csv; charset=utf-8";

const FORMULA_START = /^[=+\-@\t\r]/;

function quote(s: string): string {
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function formatCsvCell(value: CellValue, type: CellType): string {
  if (value === null || value === undefined || value === "") return "";
  switch (type) {
    case "money_cents":
      return centsToDecimal(Number(value));
    case "percent":
      return tenthsToDecimal(Number(value));
    case "hours":
      return minutesToHours(Number(value));
    case "integer":
    case "decimal":
      return String(value);
    case "boolean":
      return value ? "Yes" : "No";
    case "date":
      return String(value).slice(0, 10);
    case "datetime":
      return sgDateTime(String(value));
    default: {
      const s = String(value);
      return quote(FORMULA_START.test(s) ? `'${s}` : s);
    }
  }
}

export function csvHeader(columns: readonly ExportColumn[]): string {
  return `${columns.map((c) => quote(c.title)).join(",")}\r\n`;
}

export function csvLine(columns: readonly ExportColumn[], row: ExportRow): string {
  return `${columns.map((c) => formatCsvCell(row[c.key], c.type)).join(",")}\r\n`;
}

/** A whole CSV document as a string (small exports and tests). */
export function toCsvDocument(columns: readonly ExportColumn[], rows: readonly ExportRow[]): string {
  return CSV_BOM + csvHeader(columns) + rows.map((r) => csvLine(columns, r)).join("");
}

/** Streams a CSV document from batches of rows. */
export function csvStream(
  columns: readonly ExportColumn[],
  batches: AsyncIterable<readonly ExportRow[]>,
): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  const it = batches[Symbol.asyncIterator]();
  let started = false;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (!started) {
        started = true;
        controller.enqueue(enc.encode(CSV_BOM + csvHeader(columns)));
        return;
      }
      const next = await it.next();
      if (next.done) {
        controller.close();
        return;
      }
      controller.enqueue(enc.encode(next.value.map((r) => csvLine(columns, r)).join("")));
    },
    async cancel() {
      await it.return?.();
    },
  });
}
