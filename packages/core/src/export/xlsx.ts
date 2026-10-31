import { type CellType, type CellValue, centsToDecimal, type ExportColumn, type ExportRow } from "./cells.ts";
import { concatBytes, zipStoreChunks } from "./zip.ts";

/**
 * Minimal, runtime-agnostic XLSX writer (add-reporting design decision 3, the "minimal writer"
 * branch: no dependency, so it runs unchanged in Node and in the browser demo). One data sheet of
 * typed cells plus a "Parameters" sheet:
 * - money: numeric cells holding `cents / 100`, format `#,##0.00` (every cent value below
 *   2^53 / 100 is the nearest double to its 2-place decimal, so it reads back exactly);
 * - dates: date serials formatted `dd mmm yyyy`; date-times in Singapore time;
 * - percentages: fractions formatted `0.0%`; hours: decimals formatted `0.00`;
 * - a bold, frozen header row with an auto-filter over the data.
 * Rows are consumed batch by batch and encoded straight to bytes, so row objects never pile up.
 */

export const XLSX_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

const enc = new TextEncoder();

export function xmlEscape(s: string): string {
  return (
    s
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      // biome-ignore lint/suspicious/noControlCharactersInRegex: strip characters XML 1.0 forbids.
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "")
  );
}

export function columnName(i: number): string {
  let n = i + 1;
  let s = "";
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

const EPOCH = Date.UTC(1899, 11, 30);

/** Excel date serial for `YYYY-MM-DD` (1900 date system). */
export function dateSerial(iso: string): number {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number) as [number, number, number];
  return (Date.UTC(y, m - 1, d) - EPOCH) / 86_400_000;
}

/** Excel date-time serial for an ISO instant, in Singapore time (UTC+8). */
export function dateTimeSerial(iso: string): number {
  return (Date.parse(iso) + 8 * 3600_000 - EPOCH) / 86_400_000;
}

/** Money cell value: exact decimal text parsed as a double (the nearest double to the 2-place value). */
export function moneyNumber(cents: number): number {
  return Number(centsToDecimal(cents));
}

// Style indexes into cellXfs below.
const STYLE = { default: 0, header: 1, money: 2, date: 3, datetime: 4, percent: 5, hours: 6 } as const;

const STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="4"><numFmt numFmtId="164" formatCode="#,##0.00"/><numFmt numFmtId="165" formatCode="dd mmm yyyy"/><numFmt numFmtId="166" formatCode="dd mmm yyyy hh:mm"/><numFmt numFmtId="167" formatCode="0.0%"/></numFmts><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="7"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="166" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="167" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="2" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs></styleSheet>`;

function inlineString(ref: string, s: string, style: number = STYLE.default): string {
  const st = style ? ` s="${style}"` : "";
  return `<c r="${ref}" t="inlineStr"${st}><is><t xml:space="preserve">${xmlEscape(s)}</t></is></c>`;
}

function num(ref: string, n: number, style: number): string {
  if (!Number.isFinite(n)) return "";
  return `<c r="${ref}"${style ? ` s="${style}"` : ""}><v>${n}</v></c>`;
}

export function xlsxCell(ref: string, value: CellValue, type: CellType): string {
  if (value === null || value === undefined || value === "") return "";
  switch (type) {
    case "money_cents":
      return num(ref, moneyNumber(Number(value)), STYLE.money);
    case "integer":
    case "decimal":
      return num(ref, Number(value), STYLE.default);
    case "percent":
      return num(ref, Number(value) / 1000, STYLE.percent);
    case "hours":
      return num(ref, Math.round((Number(value) * 100) / 60) / 100, STYLE.hours);
    case "date":
      return num(ref, dateSerial(String(value)), STYLE.date);
    case "datetime":
      return num(ref, dateTimeSerial(String(value)), STYLE.datetime);
    case "boolean":
      return inlineString(ref, value ? "Yes" : "No");
    default:
      return inlineString(ref, String(value));
  }
}

function sheetName(s: string): string {
  return s.replace(/[\\/?*[\]:]/g, " ").slice(0, 31) || "Report";
}

export interface XlsxInput {
  sheet: string;
  columns: readonly ExportColumn[];
  batches: AsyncIterable<readonly ExportRow[]> | Iterable<readonly ExportRow[]>;
  /** Label/value pairs for the "Parameters" sheet (report, parameters, generator, time). */
  parameters: readonly [string, string][];
  /** Optional totals row appended after the data (bold label in the first column). */
  totals?: ExportRow | null;
}

/** Builds the workbook. Returns the bytes and the number of data rows written. */
export async function writeXlsxWorkbook(input: XlsxInput): Promise<{ bytes: Uint8Array; rows: number }> {
  const cols = input.columns;
  const lastCol = columnName(Math.max(cols.length, 1) - 1);
  const head = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetData>`;
  const chunks: Uint8Array[] = [enc.encode(head)];
  chunks.push(
    enc.encode(
      `<row r="1">${cols.map((c, i) => inlineString(`${columnName(i)}1`, c.title, STYLE.header)).join("")}</row>`,
    ),
  );
  let r = 1;
  const writeRow = (row: ExportRow) => {
    r++;
    chunks.push(
      enc.encode(
        `<row r="${r}">${cols.map((c, i) => xlsxCell(`${columnName(i)}${r}`, row[c.key], c.type)).join("")}</row>`,
      ),
    );
  };
  for await (const batch of input.batches as AsyncIterable<readonly ExportRow[]>)
    for (const row of batch) writeRow(row);
  const dataRows = r - 1;
  const filterRef = `A1:${lastCol}${Math.max(r, 1)}`;
  if (input.totals) writeRow(input.totals);
  chunks.push(enc.encode(`</sheetData><autoFilter ref="${filterRef}"/></worksheet>`));

  const params = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${input.parameters
    .map(
      ([k, v], i) =>
        `<row r="${i + 1}">${inlineString(`A${i + 1}`, k, STYLE.header)}${inlineString(`B${i + 1}`, v)}</row>`,
    )
    .join("")}</sheetData></worksheet>`;
  const name = xmlEscape(sheetName(input.sheet));
  const files: [string, string | Uint8Array[]][] = [
    [
      "[Content_Types].xml",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`,
    ],
    [
      "_rels/.rels",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    ],
    [
      "xl/workbook.xml",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${name}" sheetId="1" r:id="rId1"/><sheet name="Parameters" sheetId="2" r:id="rId2"/></sheets><definedNames><definedName name="_xlnm._FilterDatabase" localSheetId="0" hidden="1">'${name.replace(/'/g, "''")}'!$A$1:$${lastCol}$${Math.max(dataRows + 1, 1)}</definedName></definedNames></workbook>`,
    ],
    [
      "xl/_rels/workbook.xml.rels",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
    ],
    ["xl/styles.xml", STYLES_XML],
    ["xl/worksheets/sheet1.xml", chunks],
    ["xl/worksheets/sheet2.xml", params],
  ];
  const zipped = zipStoreChunks(
    files.map(([n, c]) => ({ name: n, chunks: typeof c === "string" ? [enc.encode(c)] : c })),
  );
  return { bytes: concatBytes(zipped), rows: dataRows };
}
