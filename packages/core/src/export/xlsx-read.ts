import { readStoredEntry } from "./zip.ts";

/**
 * Re-parses a workbook written by `writeXlsxWorkbook` (tests, the e2e totals check). It reads only
 * what our writer emits: stored entries, inline strings and numbers. Not a general XLSX reader.
 */
export interface ParsedCell {
  ref: string;
  value: string | number;
  style: number;
}

function unescapeXml(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&");
}

export function readXlsxSheet(bytes: Uint8Array, sheet = 1): ParsedCell[][] {
  const xml = readStoredEntry(bytes, `xl/worksheets/sheet${sheet}.xml`);
  if (!xml) throw new Error(`sheet${sheet}.xml not found`);
  const text = new TextDecoder().decode(xml);
  const rows: ParsedCell[][] = [];
  for (const rowMatch of text.matchAll(/<row r="(\d+)">(.*?)<\/row>/g)) {
    const cells: ParsedCell[] = [];
    for (const c of (rowMatch[2] ?? "").matchAll(/<c r="([A-Z]+\d+)"([^>]*)>(.*?)<\/c>/g)) {
      const attrs = c[2] ?? "";
      const style = Number(/ s="(\d+)"/.exec(attrs)?.[1] ?? 0);
      const body = c[3] ?? "";
      const value = attrs.includes('t="inlineStr"')
        ? unescapeXml(/<t[^>]*>(.*?)<\/t>/s.exec(body)?.[1] ?? "")
        : Number(/<v>(.*?)<\/v>/.exec(body)?.[1]);
      cells.push({ ref: c[1] as string, value, style });
    }
    rows.push(cells);
  }
  return rows;
}

export function readXlsxPart(bytes: Uint8Array, name: string): string | null {
  const part = readStoredEntry(bytes, name);
  return part ? new TextDecoder().decode(part) : null;
}
