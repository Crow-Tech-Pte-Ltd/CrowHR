import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, type PDFFont, type PDFPage, rgb } from "pdf-lib";
import { AzeretMono_Regular, AzeretMono_SemiBold, Ubuntu_Medium, Ubuntu_Regular } from "./fonts.generated.ts";

/**
 * Core PDF primitives (lead decision: core `pdf/`, runtime-agnostic, pure JS, self-hosted fonts).
 * pdf-lib + @pdf-lib/fontkit run unchanged in Node, workers and browsers. Output is byte-stable for
 * the same input: metadata dates are passed in, font subsets get fixed names, and pdf-lib's resource
 * keys come from its seeded RNG. Shared with the documents module (WS6) by request.
 */

export type FontRole = "body" | "bodyStrong" | "mono" | "monoStrong";

export const A4 = { width: 595.28, height: 841.89 } as const;

/** Crow Tech tokens, as RGB 0–1 (packages/ui tailwind preset): ink, muted ink, hairline, kuning. */
export const INK = rgb(0.067, 0.067, 0.071);
export const MUTED = rgb(0.38, 0.38, 0.4);
export const HAIRLINE = rgb(0.85, 0.85, 0.86);
export const KUNING = rgb(1, 0.82, 0.18);
export const SURFACE = rgb(0.973, 0.973, 0.965);
export const WHITE = rgb(1, 1, 1);

function decode(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

let fontBytes: Record<FontRole, Uint8Array> | null = null;
function fonts(): Record<FontRole, Uint8Array> {
  fontBytes ??= {
    body: decode(Ubuntu_Regular),
    bodyStrong: decode(Ubuntu_Medium),
    mono: decode(AzeretMono_Regular),
    monoStrong: decode(AzeretMono_SemiBold),
  };
  return fontBytes;
}

const FONT_NAMES: Record<FontRole, string> = {
  body: "CrowHR-Ubuntu-Regular",
  bodyStrong: "CrowHR-Ubuntu-Medium",
  mono: "CrowHR-AzeretMono-Regular",
  monoStrong: "CrowHR-AzeretMono-SemiBold",
};

/** Characters outside the embedded latin subsets, mapped to ones inside them. */
const FALLBACK: Record<string, string> = { "→": "->", "≤": "<=", "≥": ">=", "✓": "Yes" };
export function pdfSafe(text: string): string {
  return text.replace(/[→≤≥✓]/g, (c) => FALLBACK[c] ?? "?");
}

export interface TextOptions {
  font?: FontRole;
  size?: number;
  color?: ReturnType<typeof rgb>;
  align?: "left" | "right";
  maxWidth?: number;
}

export interface PdfCanvas {
  doc: PDFDocument;
  page: PDFPage;
  font(role: FontRole): PDFFont;
  width(text: string, role: FontRole, size: number): number;
  /** Draws text with its baseline at `y` (points from the bottom). Right-aligned text ends at `x`. */
  text(text: string, x: number, y: number, opts?: TextOptions): void;
  line(x1: number, y1: number, x2: number, y2: number, thickness?: number, color?: ReturnType<typeof rgb>): void;
  rect(
    x: number,
    y: number,
    w: number,
    h: number,
    opts: { fill?: ReturnType<typeof rgb>; border?: ReturnType<typeof rgb>; borderWidth?: number },
  ): void;
  addPage(): void;
}

export interface PdfMeta {
  title: string;
  author: string;
  subject?: string;
  /** Fixed creation date for byte-stable output (e.g. the run's approval time). */
  createdAt: Date;
}

export async function createPdf(meta: PdfMeta): Promise<PdfCanvas> {
  const doc = await PDFDocument.create({ updateMetadata: false });
  doc.registerFontkit(fontkit);
  doc.setTitle(pdfSafe(meta.title));
  doc.setAuthor(pdfSafe(meta.author));
  if (meta.subject) doc.setSubject(pdfSafe(meta.subject));
  doc.setCreator("Crow HR");
  doc.setProducer("Crow HR (pdf-lib)");
  doc.setCreationDate(meta.createdAt);
  doc.setModificationDate(meta.createdAt);
  const embedded = {} as Record<FontRole, PDFFont>;
  for (const role of Object.keys(FONT_NAMES) as FontRole[]) {
    embedded[role] = await doc.embedFont(fonts()[role], { subset: true, customName: FONT_NAMES[role] });
  }
  let page = doc.addPage([A4.width, A4.height]);
  const canvas: PdfCanvas = {
    doc,
    get page() {
      return page;
    },
    font: (role) => embedded[role],
    width: (text, role, size) => embedded[role].widthOfTextAtSize(pdfSafe(text), size),
    text(text, x, y, opts = {}) {
      const role = opts.font ?? "body";
      const size = opts.size ?? 9;
      let s = pdfSafe(text);
      if (opts.maxWidth) {
        while (s.length > 1 && embedded[role].widthOfTextAtSize(s, size) > opts.maxWidth) s = `${s.slice(0, -2)}…`;
      }
      const w = embedded[role].widthOfTextAtSize(s, size);
      page.drawText(s, {
        x: opts.align === "right" ? x - w : x,
        y,
        size,
        font: embedded[role],
        color: opts.color ?? INK,
      });
    },
    line(x1, y1, x2, y2, thickness = 0.5, color = HAIRLINE) {
      page.drawLine({ start: { x: x1, y: y1 }, end: { x: x2, y: y2 }, thickness, color });
    },
    rect(x, y, w, h, opts) {
      page.drawRectangle({
        x,
        y,
        width: w,
        height: h,
        ...(opts.fill ? { color: opts.fill } : {}),
        ...(opts.border ? { borderColor: opts.border, borderWidth: opts.borderWidth ?? 0.5 } : {}),
      });
    },
    addPage() {
      page = doc.addPage([A4.width, A4.height]);
    },
  };
  return canvas;
}

export async function finishPdf(canvas: PdfCanvas): Promise<Uint8Array> {
  return canvas.doc.save({ useObjectStreams: false });
}
