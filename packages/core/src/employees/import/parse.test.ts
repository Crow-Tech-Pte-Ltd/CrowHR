import { describe, expect, it } from "vitest";
import {
  closestName,
  MAX_IMPORT_ROWS,
  normaliseHeader,
  parseCsv,
  parseDollarsToCents,
  parseImportDate,
  toCsv,
} from "./parse.ts";

describe("parseCsv", () => {
  it("handles a UTF-8 BOM, CRLF, quoted commas, quotes and newlines", () => {
    const r = parseCsv('﻿Legal Name,Note\r\n"Tan, Mei Ling","She said ""hi""\nthen left"\r\n');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.csv.headers).toEqual(["legal_name", "note"]);
    expect(r.csv.rows).toEqual([
      { line: 2, values: { legal_name: "Tan, Mei Ling", note: 'She said "hi"\nthen left' } },
    ]);
  });

  it("skips blank lines and reports spreadsheet line numbers", () => {
    const r = parseCsv("a,b\n1,2\n\n3,4\n");
    expect(r.ok && r.csv.rows.map((x) => x.line)).toEqual([2, 4]);
  });

  it("decodes bytes and rejects non-UTF-8", () => {
    expect(parseCsv(new TextEncoder().encode("a\nRényi\n")).ok).toBe(true);
    const latin1 = new Uint8Array([0x61, 0x0a, 0x52, 0xe9, 0x6e, 0x0a]);
    const r = parseCsv(latin1);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toContain("CSV UTF-8");
  });

  it("enforces the 5 MB and 2 000-row caps", () => {
    const big = `a\n${"x".repeat(5 * 1024 * 1024)}\n`;
    const r1 = parseCsv(big);
    expect(!r1.ok && r1.message).toContain("5 MB");
    const many = `a\n${Array.from({ length: MAX_IMPORT_ROWS + 1 }, (_, i) => i).join("\n")}\n`;
    const r2 = parseCsv(many);
    expect(!r2.ok && r2.message).toContain("2000");
    expect(parseCsv(`a\n${Array.from({ length: MAX_IMPORT_ROWS }, (_, i) => i).join("\n")}`).ok).toBe(true);
  });

  it("rejects unclosed quotes, empty files and duplicate columns", () => {
    expect(parseCsv('a\n"oops\n').ok).toBe(false);
    expect(parseCsv("").ok).toBe(false);
    expect(parseCsv("a,A\n1,2").ok).toBe(false);
  });

  it("normalises headers", () => {
    expect(normaliseHeader(" Date of Birth ")).toBe("date_of_birth");
  });
});

describe("dates and money", () => {
  it("accepts YYYY-MM-DD and DD/MM/YYYY only", () => {
    expect(parseImportDate("2026-10-31")).toEqual({ ok: true, value: "2026-10-31" });
    expect(parseImportDate("31/10/2026")).toEqual({ ok: true, value: "2026-10-31" });
    expect(parseImportDate("1/2/2026")).toEqual({ ok: true, value: "2026-02-01" });
    for (const bad of ["10/31/2026", "2026/10/31", "31-10-2026", "31 Oct 2026", "2026-02-30"]) {
      expect(parseImportDate(bad).ok).toBe(false);
    }
  });

  it("converts dollars to cents exactly", () => {
    expect(parseDollarsToCents("36000.00")).toEqual({ ok: true, cents: 3_600_000 });
    expect(parseDollarsToCents("0.1")).toEqual({ ok: true, cents: 10 });
    expect(parseDollarsToCents("S$1,234.56")).toEqual({ ok: true, cents: 123_456 });
    expect(parseDollarsToCents("1.005").ok).toBe(false);
    expect(parseDollarsToCents("-5").ok).toBe(false);
  });

  it("suggests the closest name", () => {
    expect(closestName("Finanse", ["Sales", "Finance", "Operations"])).toBe("Finance");
  });

  it("writes CSV that neutralises formulas", () => {
    expect(toCsv(["a"], [["=SUM(A1)"], ["x,y"], [-5]])).toBe('a\r\n\'=SUM(A1)\r\n"x,y"\r\n-5\r\n');
  });
});
