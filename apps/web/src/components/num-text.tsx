import * as React from "react";

// Amounts ("S$1,234.56", "-S$5.00", "USD 12.00") and other figures ("31", "2.5", "09:30").
const FIGURE = /(-?S\$[\d,]+(?:\.\d+)?|\b[A-Z]{3} [\d,]+(?:\.\d+)?|\d[\d,]*(?:[.:]\d+)*)/g;

/** Splits a sentence into text and figures (exported for tests). */
export function splitFigures(text: string): { text: string; figure: boolean }[] {
  const parts: { text: string; figure: boolean }[] = [];
  let last = 0;
  for (const m of text.matchAll(FIGURE)) {
    const at = m.index ?? 0;
    if (at > last) parts.push({ text: text.slice(last, at), figure: false });
    parts.push({ text: m[0], figure: true });
    last = at + m[0].length;
  }
  if (last < text.length) parts.push({ text: text.slice(last), figure: false });
  return parts;
}

/**
 * A sentence from the server ("Mobile phone · Singtel: S$48.00 · 1 receipt") in the body font,
 * with only its figures in tabular Azeret Mono, so prose doesn't wrap as a wall of mono.
 */
export function NumText({ children }: { children: string }) {
  return (
    <>
      {splitFigures(children).map((p, i) =>
        p.figure ? (
          // biome-ignore lint/suspicious/noArrayIndexKey: the parts of one fixed string, in order.
          <span key={i} className="num">
            {p.text}
          </span>
        ) : (
          // biome-ignore lint/suspicious/noArrayIndexKey: the parts of one fixed string, in order.
          <React.Fragment key={i}>{p.text}</React.Fragment>
        ),
      )}
    </>
  );
}
