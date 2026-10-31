import { describe, expect, it } from "vitest";
import { centsToDecimal, type ExportColumn, minutesToHours, tenthsToDecimal } from "./cells.ts";
import { csvStream, formatCsvCell, toCsvDocument } from "./csv.ts";

const cols: ExportColumn[] = [
  { key: "name", title: "Name", type: "text" },
  { key: "amount", title: "Amount (SGD)", type: "money_cents" },
  { key: "on", title: "Date", type: "date" },
  { key: "rate", title: "Rate %", type: "percent" },
];

describe("CSV writer", () => {
  it("writes a BOM, a header and CRLF rows with RFC 4180 quoting", () => {
    const doc = toCsvDocument(cols, [
      { name: 'Tan "Ah Boy", Jr', amount: 123456, on: "2026-10-31", rate: 143 },
      { name: "Line\nbreak", amount: 0, on: null, rate: null },
    ]);
    expect(doc.startsWith("﻿")).toBe(true);
    expect(doc.slice(1).split("\r\n")).toEqual([
      "Name,Amount (SGD),Date,Rate %",
      '"Tan ""Ah Boy"", Jr",1234.56,2026-10-31,14.3',
      '"Line\nbreak",0.00,,',
      "",
    ]);
  });

  it("formats money from integer cents, including negatives and zero", () => {
    expect(centsToDecimal(0)).toBe("0.00");
    expect(centsToDecimal(5)).toBe("0.05");
    expect(centsToDecimal(-5)).toBe("-0.05");
    expect(centsToDecimal(-123456)).toBe("-1234.56");
    expect(centsToDecimal(Number.MAX_SAFE_INTEGER)).toBe("90071992547409.91");
    expect(() => centsToDecimal(1.5)).toThrow(/safe integer/);
    expect(tenthsToDecimal(143)).toBe("14.3");
    expect(tenthsToDecimal(-5)).toBe("-0.5");
    expect(minutesToHours(918)).toBe("15.30");
    expect(minutesToHours(-90)).toBe("-1.50");
  });

  it("neutralises formula injection in text cells only", () => {
    for (const s of ['=HYPERLINK("http://x")', "+1", "-2", "@SUM(A1)", "\tx"]) {
      expect(formatCsvCell(s, "text").replace(/^"|"$/g, "").replace(/""/g, '"')).toBe(`'${s}`);
    }
    expect(formatCsvCell('=HYPERLINK("http://x")', "text")).toBe(`"'=HYPERLINK(""http://x"")"`);
    // A negative amount is a number, not a formula.
    expect(formatCsvCell(-250, "money_cents")).toBe("-2.50");
    expect(formatCsvCell(true, "boolean")).toBe("Yes");
    expect(formatCsvCell("2026-10-31T02:14:00.000Z", "datetime")).toBe("2026-10-31 10:14");
    expect(formatCsvCell(1.5, "decimal")).toBe("1.5");
    expect(formatCsvCell(90, "hours")).toBe("1.50");
  });

  it("streams batches", async () => {
    async function* batches() {
      yield [{ name: "a", amount: 1, on: "2026-01-01", rate: 0 }];
      yield [{ name: "b", amount: 2, on: "2026-01-02", rate: 1000 }];
    }
    const text = await new Response(csvStream(cols, batches())).text();
    // The BOM is kept as the first character of the decoded text.
    expect(text.replace(/^﻿/, "").split("\r\n")).toEqual([
      "Name,Amount (SGD),Date,Rate %",
      "a,0.01,2026-01-01,0.0",
      "b,0.02,2026-01-02,100.0",
      "",
    ]);
  });
});
