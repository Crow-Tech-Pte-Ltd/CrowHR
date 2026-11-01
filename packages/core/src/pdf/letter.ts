import type { Block, Inline } from "../documents/markdown.ts";
import { A4, createPdf, type FontRole, finishPdf, HAIRLINE, INK, MUTED, type PdfCanvas, SURFACE } from "./document.ts";

/**
 * Letter PDF (add-documents design decision 1): a plain A4 letter from the restricted-Markdown
 * tree, on the shared core renderer (pdf-lib, embedded Ubuntu and Azeret Mono subsets, byte-stable
 * for the same input and `createdAt`). Header: the organisation's name, address and UEN, with its
 * PNG logo when it has one. Footer: the letter title and "Page n of N".
 *
 * NOT IMPLEMENTED: italic. The embedded fonts have no italic face, so *italic* text is set in the
 * regular face (it stays readable; emphasis is lost).
 */

const M = 56;
const RIGHT = A4.width - M;
const WIDTH = RIGHT - M;
const TOP = A4.height - M;
const BOTTOM = 72;

interface Run {
  text: string;
  role: FontRole;
}

function runsOf(nodes: readonly Inline[], strong = false): Run[] {
  const out: Run[] = [];
  for (const n of nodes) {
    if (n.t === "text") out.push({ text: n.text, role: strong ? "bodyStrong" : "body" });
    else if (n.t === "field") out.push({ text: `{{${n.id}}}`, role: "mono" });
    else if (n.t === "bold") out.push(...runsOf(n.children, true));
    else out.push(...runsOf(n.children, strong));
  }
  return out;
}

interface Word {
  text: string;
  role: FontRole;
  /** A space precedes this word on the same line. */
  space: boolean;
}

function wordsOf(runs: readonly Run[]): Word[][] {
  // Returns lines split by explicit newlines (from adjacent template lines kept as breaks).
  const lines: Word[][] = [[]];
  let pendingSpace = false;
  for (const r of runs) {
    const parts = r.text.split(/(\n|\s+)/);
    for (const p of parts) {
      if (p === "") continue;
      if (p === "\n") {
        lines.push([]);
        pendingSpace = false;
        continue;
      }
      if (/^\s+$/.test(p)) {
        pendingSpace = true;
        continue;
      }
      const cur = lines[lines.length - 1] as Word[];
      cur.push({ text: p, role: r.role, space: pendingSpace && cur.length > 0 });
      pendingSpace = false;
    }
  }
  return lines;
}

/** Lays words into lines no wider than `width`; long words break by character. */
function layout(c: PdfCanvas, words: readonly Word[], size: number, width: number): Word[][] {
  const lines: Word[][] = [];
  let line: Word[] = [];
  let w = 0;
  const spaceW = c.width(" ", "body", size);
  for (const word of words) {
    let text = word.text;
    let ww = c.width(text, word.role, size);
    const lead = line.length && word.space ? spaceW : 0;
    if (w + lead + ww <= width) {
      line.push(word);
      w += lead + ww;
      continue;
    }
    if (line.length) lines.push(line);
    line = [];
    w = 0;
    while (ww > width && text.length > 1) {
      let k = text.length - 1;
      while (k > 1 && c.width(text.slice(0, k), word.role, size) > width) k--;
      lines.push([{ text: text.slice(0, k), role: word.role, space: false }]);
      text = text.slice(k);
      ww = c.width(text, word.role, size);
    }
    line.push({ text, role: word.role, space: false });
    w = ww;
  }
  if (line.length || !lines.length) lines.push(line);
  return lines;
}

export interface LetterInput {
  title: string;
  org: { name: string; address: string | null; uen: string | null };
  logoPng?: Uint8Array | null;
  blocks: readonly Block[];
  createdAt: Date;
  author: string;
}

export async function renderLetterPdf(input: LetterInput): Promise<Uint8Array> {
  const c = await createPdf({
    title: input.title,
    author: input.author,
    subject: input.title,
    createdAt: input.createdAt,
    text: JSON.stringify(input),
  });
  let y = TOP;

  const header = async () => {
    let logoW = 0;
    if (input.logoPng) {
      try {
        const img = await c.doc.embedPng(input.logoPng);
        const scale = Math.min(120 / img.width, 40 / img.height, 1);
        logoW = img.width * scale;
        c.page.drawImage(img, {
          x: RIGHT - logoW,
          y: TOP - img.height * scale + 8,
          width: logoW,
          height: img.height * scale,
        });
      } catch {
        // A logo that isn't a valid PNG is left out rather than failing the letter.
      }
    }
    c.text(input.org.name, M, TOP, { font: "bodyStrong", size: 12, maxWidth: WIDTH - logoW - 12 });
    const sub = [input.org.address, input.org.uen ? `UEN ${input.org.uen}` : null].filter(Boolean).join("  ·  ");
    if (sub) c.text(sub, M, TOP - 14, { size: 8, color: MUTED, maxWidth: WIDTH - logoW - 12 });
    c.line(M, TOP - 24, RIGHT, TOP - 24, 0.5, HAIRLINE);
    y = TOP - 48;
  };
  await header();

  const newPage = () => {
    c.addPage();
    y = TOP;
  };
  const ensure = (h: number) => {
    if (y - h < BOTTOM) newPage();
  };

  const drawLine = (line: readonly Word[], x: number, size: number) => {
    let cx = x;
    const spaceW = c.width(" ", "body", size);
    for (const w of line) {
      if (w.space) cx += spaceW;
      c.text(w.text, cx, y, { font: w.role, size, color: INK });
      cx += c.width(w.text, w.role, size);
    }
  };

  const paragraph = (
    nodes: readonly Inline[],
    opts: { size: number; strong?: boolean; indent?: number; bullet?: string; gap: number },
  ) => {
    const lead = opts.size * 1.45;
    const x = M + (opts.indent ?? 0);
    const width = RIGHT - x;
    const groups = wordsOf(runsOf(nodes, opts.strong));
    let first = true;
    for (const g of groups) {
      for (const line of layout(c, g, opts.size, width)) {
        ensure(lead);
        if (first && opts.bullet) c.text(opts.bullet, x - 12, y, { size: opts.size, color: MUTED });
        first = false;
        drawLine(line, x, opts.size);
        y -= lead;
      }
    }
    y -= opts.gap;
  };

  const table = (header: readonly Inline[][], rows: readonly Inline[][][]) => {
    const cols = Math.max(header.length, ...rows.map((r) => r.length), 1);
    const colW = WIDTH / cols;
    const size = 9;
    const lead = size * 1.4;
    const pad = 5;
    const drawRow = (cells: readonly Inline[][], strong: boolean) => {
      const laid = Array.from({ length: cols }, (_, i) =>
        wordsOf(runsOf(cells[i] ?? [], strong)).flatMap((g) => layout(c, g, size, colW - pad * 2)),
      );
      const h = Math.max(1, ...laid.map((l) => l.length)) * lead + pad * 2;
      ensure(h);
      const top = y;
      if (strong) c.rect(M, top - h, WIDTH, h, { fill: SURFACE });
      c.rect(M, top - h, WIDTH, h, { border: HAIRLINE, borderWidth: 0.5 });
      for (let i = 1; i < cols; i++) c.line(M + colW * i, top, M + colW * i, top - h, 0.5, HAIRLINE);
      laid.forEach((lines, i) => {
        let ly = top - pad - size;
        for (const line of lines) {
          const save = y;
          y = ly;
          drawLine(line, M + colW * i + pad, size);
          y = save;
          ly -= lead;
        }
      });
      y = top - h;
    };
    if (header.length) drawRow(header, true);
    for (const r of rows) drawRow(r, false);
    y -= 10;
  };

  for (const b of input.blocks) {
    switch (b.t) {
      case "heading": {
        const size = b.level === 1 ? 16 : b.level === 2 ? 11.5 : 10;
        ensure(size * 3);
        y -= b.level === 1 ? 0 : 4;
        paragraph(b.children, { size, strong: true, gap: b.level === 1 ? 8 : 3 });
        break;
      }
      case "paragraph":
        paragraph(b.children, { size: 10, gap: 7 });
        break;
      case "list":
        b.items.forEach((item, i) => {
          paragraph(item, { size: 10, indent: 16, bullet: b.ordered ? `${i + 1}.` : "·", gap: 2 });
        });
        y -= 5;
        break;
      case "table":
        table(b.header, b.rows);
        break;
      case "pagebreak":
        newPage();
        break;
      default:
        break;
    }
  }

  const pages = c.doc.getPages();
  const mono = c.font("mono");
  pages.forEach((p, i) => {
    const label = `Page ${i + 1} of ${pages.length}`;
    p.drawLine({ start: { x: M, y: 48 }, end: { x: RIGHT, y: 48 }, thickness: 0.5, color: HAIRLINE });
    c.text(input.title, M, 36, { page: p, size: 7.5, maxWidth: WIDTH - 90, color: MUTED });
    p.drawText(label, { x: RIGHT - mono.widthOfTextAtSize(label, 7.5), y: 36, size: 7.5, font: mono, color: MUTED });
  });
  return finishPdf(c);
}
