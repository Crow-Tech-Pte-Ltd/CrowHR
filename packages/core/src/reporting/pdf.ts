import type { PDFImage } from "pdf-lib";
import { type CellType, type CellValue, minutesToHours, tenthsToDecimal } from "../export/cells.ts";
import { dateLabel, sgd } from "../payroll/engine/dates.ts";
import {
  A4,
  createPdf,
  type FontRole,
  finishPdf,
  HAIRLINE,
  INK,
  MUTED,
  type PdfCanvas,
  SURFACE,
  sealPdfPage,
} from "../pdf/document.ts";
import type { ReportColumn, ReportRow, ReportSummaryItem } from "./types.ts";

const MARGIN = 28;
const BOTTOM = 46;
const PADDING = 4;
const TABLE_SIZE = 8;
const LEADING = 11;

const dateTime = new Intl.DateTimeFormat("en-SG", {
  timeZone: "Asia/Singapore",
  dateStyle: "medium",
  timeStyle: "short",
});

const displayNumber = new Intl.NumberFormat("en-SG", { maximumFractionDigits: 2 });

function numeric(type: CellType): boolean {
  return type === "integer" || type === "decimal" || type === "money_cents" || type === "percent" || type === "hours";
}

function cellText(value: CellValue, type: CellType, key?: string): string {
  if (value === null || value === undefined || value === "") return "—";
  switch (type) {
    case "money_cents":
      return sgd(Number(value));
    case "percent":
      return `${tenthsToDecimal(Number(value))}%`;
    case "hours":
      return `${minutesToHours(Number(value))} h`;
    case "integer":
    case "decimal":
      return displayNumber.format(Number(value));
    case "date":
      return dateLabel(String(value));
    case "datetime":
      return dateTime.format(new Date(String(value)));
    case "boolean":
      return value ? "Yes" : "No";
    default:
      return key === "month" && /^\d{4}-\d{2}$/.test(String(value)) ? dateLabel(`${value}-01`).slice(2) : String(value);
  }
}

function pageSize(columns: number) {
  if (columns <= 7) return A4;
  if (columns <= 13) return { width: A4.height, height: A4.width };
  return { width: Math.max(1190.55, columns * 52 + 2 * MARGIN), height: 841.89 }; // A3 landscape
}

function wrap(c: PdfCanvas, text: string, role: FontRole, size: number, width: number): string[] {
  const lines: string[] = [];
  const fits = (line: string) => c.width(line, role, size) <= width;
  let line = "";
  for (const word of text.split(/[\s\p{Cc}]+/u).filter(Boolean)) {
    const next = line ? `${line} ${word}` : word;
    if (fits(next)) {
      line = next;
      continue;
    }
    if (line) lines.push(line);
    const chars = [...word];
    let start = 0;
    // Split an overlong token (e.g. a run ID) without dropping characters or splitting surrogates.
    while (start < chars.length) {
      let end = start + 1;
      while (end < chars.length && fits(chars.slice(start, end + 1).join(""))) end++;
      line = chars.slice(start, end).join("");
      start = end;
      if (start < chars.length) lines.push(line);
    }
  }
  return [...lines, line];
}

interface ReportPdfInput {
  title: string;
  companyName: string;
  logoPng: Uint8Array | null;
  generatedAt: Date;
  parameters: readonly string[];
  columns: readonly ReportColumn[];
  rows: readonly ReportRow[];
  totals: ReportRow | null;
  summary: readonly ReportSummaryItem[];
  emptyMessage: string | null;
  notes: readonly string[];
}

export async function renderReportPdf(input: ReportPdfInput): Promise<Uint8Array> {
  const { columns, rows, totals } = input;
  const size = pageSize(columns.length);
  const right = size.width - MARGIN;
  const width = right - MARGIN;
  const top = size.height - MARGIN;
  const c = await createPdf({
    title: input.title,
    author: input.companyName,
    createdAt: input.generatedAt,
    pageSize: size,
    text: JSON.stringify({ ...input, logoPng: null }),
  });
  let logo: PDFImage | undefined;
  if (input.logoPng) {
    try {
      logo = await c.doc.embedPng(input.logoPng);
    } catch {
      // The uploaded logo can have a valid PNG signature but fail to decode.
    }
  }
  const logoSize = logo?.scaleToFit(112, 36);
  const textWidth = width - (logoSize ? logoSize.width + 12 : 0);
  const companyLines = wrap(c, input.companyName, "bodyStrong", 10, textWidth);
  const titleLines = wrap(c, input.title, "monoStrong", 17, textWidth);
  const titleTop = top - 20 - companyLines.length * 12;
  const headerRule = titleTop - 12 - (titleLines.length - 1) * 22;
  const contentTop = headerRule - 12;
  let y = contentTop;

  function header() {
    if (logo && logoSize) c.page.drawImage(logo, { x: right - logoSize.width, y: top - logoSize.height, ...logoSize });
    companyLines.forEach((line, i) => {
      c.text(line, MARGIN, top - 9 - i * 12, { font: "bodyStrong", size: 10 });
    });
    titleLines.forEach((line, i) => {
      c.text(line, MARGIN, titleTop - i * 22, { font: "monoStrong", size: 17 });
    });
    c.line(MARGIN, headerRule, right, headerRule, 0.8, INK);
    y = contentTop;
  }

  function newPage() {
    sealPdfPage(c.page);
    c.addPage();
    header();
  }

  function paragraph(text: string, role: FontRole = "body", fontSize = 9) {
    for (const line of wrap(c, text, role, fontSize, width)) {
      if (y - LEADING < BOTTOM) newPage();
      c.text(line, MARGIN, y - fontSize, { font: role, size: fontSize });
      y -= fontSize + 4;
    }
  }

  header();
  paragraph(input.parameters.join("  ·  "));
  for (const item of input.summary) {
    paragraph(`${item.label}: ${item.value == null ? "n/a" : cellText(item.value, item.type)}`, "bodyStrong");
  }
  y -= 6;

  if (input.emptyMessage) paragraph(input.emptyMessage);
  if (rows.length && columns.length) {
    const weights = columns.map((col) => (col.type === "money_cents" ? 2 : col.type === "text" ? 1.45 : 1));
    const unit = (width - columns.length * 44) / weights.reduce((sum, value) => sum + value, 0);
    let x = MARGIN;
    const layout = columns.map((column, i) => {
      const columnWidth = 44 + (weights[i] ?? 1) * unit;
      const cell = { column, x, width: columnWidth, align: numeric(column.type) ? "right" : "left" } as const;
      x += columnWidth;
      return cell;
    });
    interface Cell {
      x: number;
      width: number;
      align: "left" | "right";
      lines: string[];
      role: FontRole;
      fontSize: number;
    }
    const headings = layout.map((cell): Cell => {
      const { column, width } = cell;
      const title = column.type === "money_cents" ? column.title.replace(/ \(S\$\)$/, "") : column.title;
      return {
        ...cell,
        lines: wrap(c, title, "bodyStrong", TABLE_SIZE, width - 2 * PADDING),
        role: "bodyStrong",
        fontSize: TABLE_SIZE,
      };
    });
    const headingLines = Math.max(...headings.map((cell) => cell.lines.length));
    const headerHeight = headingLines * LEADING + 2 * PADDING;
    const freshRows = Math.floor((contentTop - headerHeight - BOTTOM - 2 * PADDING) / LEADING);

    function drawLines(cells: Cell[], start: number, count: number, filled: boolean) {
      const height = count * LEADING + 2 * PADDING;
      if (filled) c.rect(MARGIN, y - height, width, height, { fill: SURFACE });
      for (const { x, width, align, lines, role, fontSize } of cells) {
        const at = align === "right" ? x + width - PADDING : x + PADDING;
        for (let n = 0; n < count; n++) {
          const line = lines[start + n];
          if (line) c.text(line, at, y - PADDING - TABLE_SIZE - n * LEADING, { font: role, size: fontSize, align });
        }
      }
      y -= height;
      c.line(MARGIN, y, right, y, 0.4, HAIRLINE);
    }

    function tableHeading() {
      drawLines(headings, 0, headingLines, true);
    }

    function row(value: ReportRow, total = false) {
      const cells = layout.map((cell): Cell => {
        const { column, width, align } = cell;
        const rightAligned = align === "right";
        const role = rightAligned ? (total ? "monoStrong" : "mono") : total ? "bodyStrong" : "body";
        const text =
          total && value[column.key] === undefined ? "" : cellText(value[column.key], column.type, column.key);
        const available = width - 2 * PADDING;
        if (rightAligned) {
          const measured = c.width(text, role, TABLE_SIZE);
          // Keep figures together, including their decimal places, in the widest reports.
          const fontSize = measured > available ? (TABLE_SIZE * available) / measured : TABLE_SIZE;
          return { ...cell, lines: [text], role, fontSize };
        }
        return { ...cell, lines: wrap(c, text, role, TABLE_SIZE, available), role, fontSize: TABLE_SIZE };
      });
      const length = Math.max(...cells.map((cell) => cell.lines.length));
      let start = 0;
      while (start < length) {
        let fits = Math.floor((y - BOTTOM - 2 * PADDING) / LEADING);
        if (fits < 1 || (start === 0 && length > fits && length <= freshRows)) {
          newPage();
          tableHeading();
          fits = freshRows;
        }
        const count = Math.min(length - start, fits);
        drawLines(cells, start, count, total);
        start += count;
      }
    }

    if (y - headerHeight - LEADING - 2 * PADDING < BOTTOM) newPage();
    tableHeading();
    for (const value of rows) row(value);
    if (totals) row(totals, true);
    y -= 10;
  }
  for (const note of input.notes) paragraph(note, "body", 8);

  const pages = c.doc.getPages();
  for (const [i, page] of pages.entries()) {
    page.drawLine({ start: { x: MARGIN, y: 37 }, end: { x: right, y: 37 }, thickness: 0.5, color: HAIRLINE });
    c.text(`Generated ${dateTime.format(input.generatedAt)} (Singapore time)`, MARGIN, 26, {
      page,
      size: 7.5,
      color: MUTED,
    });
    c.text(`Page ${i + 1} of ${pages.length}`, right, 26, {
      page,
      font: "mono",
      size: 7.5,
      color: MUTED,
      align: "right",
    });
  }
  return finishPdf(c);
}
