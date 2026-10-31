import { describe, expect, it } from "vitest";
import type { ExportColumn } from "./cells.ts";
import { dateSerial, moneyNumber, writeXlsxWorkbook } from "./xlsx.ts";
import { readXlsxPart, readXlsxSheet } from "./xlsx-read.ts";
import { zipDirectory } from "./zip.ts";

const cols: ExportColumn[] = [
  { key: "dept", title: "Department", type: "text" },
  { key: "gross", title: "Gross (SGD)", type: "money_cents" },
  { key: "month", title: "Month", type: "date" },
  { key: "count", title: "Headcount", type: "integer" },
  { key: "rate", title: "Turnover", type: "percent" },
  { key: "ot", title: "OT hours", type: "hours" },
];

describe("XLSX writer", () => {
  it("writes typed cells, formats, a frozen filtered header and a Parameters sheet", async () => {
    const { bytes, rows } = await writeXlsxWorkbook({
      sheet: "Payroll cost",
      columns: cols,
      batches: [[{ dept: "Kitchen & <Bar>", gross: 123456, month: "2026-10-01", count: 4, rate: 143, ot: 90 }]],
      parameters: [
        ["Report", "Payroll cost"],
        ["From", "2026-10"],
      ],
      totals: { dept: "Total", gross: 123456 },
    });
    expect(rows).toBe(1);
    expect(zipDirectory(bytes)?.map((e) => e.name)).toEqual([
      "[Content_Types].xml",
      "_rels/.rels",
      "xl/workbook.xml",
      "xl/_rels/workbook.xml.rels",
      "xl/styles.xml",
      "xl/worksheets/sheet1.xml",
      "xl/worksheets/sheet2.xml",
    ]);
    const sheet = readXlsxSheet(bytes);
    expect(sheet[0]?.map((c) => c.value)).toEqual(cols.map((c) => c.title));
    expect(sheet[0]?.every((c) => c.style === 1)).toBe(true);
    const [dept, gross, month, count, rate, ot] = sheet[1] ?? [];
    expect(dept?.value).toBe("Kitchen & <Bar>");
    // Money exact in XLSX: 123456 cents → 1234.56 formatted #,##0.00.
    expect(gross).toMatchObject({ value: 1234.56, style: 2 });
    expect(month).toMatchObject({ value: dateSerial("2026-10-01"), style: 3 });
    expect(dateSerial("2026-10-01")).toBe(46296);
    expect(count?.value).toBe(4);
    expect(rate).toMatchObject({ value: 0.143, style: 5 });
    expect(ot).toMatchObject({ value: 1.5, style: 6 });
    expect(sheet[2]?.map((c) => c.value)).toEqual(["Total", 1234.56]);
    const xml = readXlsxPart(bytes, "xl/worksheets/sheet1.xml") ?? "";
    expect(xml).toContain('<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>');
    expect(xml).toContain('<autoFilter ref="A1:F2"/>');
    expect(readXlsxPart(bytes, "xl/styles.xml")).toContain('formatCode="#,##0.00"');
    expect(readXlsxPart(bytes, "xl/styles.xml")).toContain('formatCode="dd mmm yyyy"');
    expect(readXlsxPart(bytes, "xl/workbook.xml")).toContain('<sheet name="Parameters"');
    expect(readXlsxSheet(bytes, 2).map((r) => r.map((c) => c.value))).toEqual([
      ["Report", "Payroll cost"],
      ["From", "2026-10"],
    ]);
  });

  it("round-trips money exactly to 2 places at the boundaries", () => {
    for (const cents of [0, 1, -1, 99, 100, 123456, 2 ** 31, 2 ** 53 / 100 - 1, -(2 ** 53 / 100 - 1)]) {
      const c = Math.trunc(cents);
      const n = moneyNumber(c);
      expect(Math.round(n * 100)).toBe(c);
      expect(n.toFixed(2)).toBe(
        `${c < 0 ? "-" : ""}${Math.trunc(Math.abs(c) / 100)}.${String(Math.abs(c) % 100).padStart(2, "0")}`,
      );
    }
  });

  it("streams batches from an async iterable", async () => {
    async function* batches() {
      for (let b = 0; b < 3; b++) yield Array.from({ length: 500 }, (_, i) => ({ dept: `D${b}-${i}`, count: i }));
    }
    const { bytes, rows } = await writeXlsxWorkbook({
      sheet: "Big",
      columns: cols,
      batches: batches(),
      parameters: [],
    });
    expect(rows).toBe(1500);
    expect(readXlsxSheet(bytes)).toHaveLength(1501);
  });
});
