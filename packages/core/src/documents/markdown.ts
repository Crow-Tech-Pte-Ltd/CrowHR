/**
 * Restricted Markdown for letter templates (add-documents design decision 1). A small whitelist
 * parser, written here so nothing outside the whitelist can slip through a general Markdown
 * library: headings (`#`–`###`), paragraphs, `**bold**`, `*italic*`, bullet and numbered lists,
 * pipe tables, `\pagebreak` on its own line, `https` links, `{{namespace.field}}` merge fields and
 * `<!-- ket:<id> -->` anchors. Raw HTML, images and any other link are errors with a line number.
 *
 * Merge fields are resolved on the parsed tree (`resolveFields`), never by string substitution, so
 * a value such as "<script>" or "**x**" is only ever text.
 */

export type Inline =
  | { t: "text"; text: string }
  | { t: "bold"; children: Inline[] }
  | { t: "italic"; children: Inline[] }
  | { t: "field"; id: string; line: number }
  | { t: "link"; href: string; children: Inline[] };

export type Block =
  | { t: "heading"; level: 1 | 2 | 3; children: Inline[]; line: number }
  | { t: "paragraph"; children: Inline[]; line: number }
  | { t: "list"; ordered: boolean; items: Inline[][]; line: number }
  | { t: "table"; header: Inline[][]; rows: Inline[][][]; line: number }
  | { t: "pagebreak"; line: number }
  | { t: "anchor"; id: string; line: number };

export interface MarkdownIssue {
  line: number;
  message: string;
}

const ANCHOR = /^<!--\s*ket:([a-z_]+)\s*-->$/;
const FIELD = /\{\{\s*([^{}]*?)\s*\}\}/g;

function parseInline(src: string, line: number, issues: MarkdownIssue[]): Inline[] {
  const out: Inline[] = [];
  let i = 0;
  let buf = "";
  const flush = () => {
    if (buf) out.push({ t: "text", text: buf });
    buf = "";
  };
  while (i < src.length) {
    const rest = src.slice(i);
    if (rest.startsWith("{{")) {
      const m = /^\{\{\s*([^{}]*?)\s*\}\}/.exec(rest);
      if (m) {
        flush();
        out.push({ t: "field", id: m[1] ?? "", line });
        i += m[0].length;
        continue;
      }
    }
    if (rest.startsWith("![")) {
      issues.push({
        line,
        message: "Images aren't allowed in letter templates. The organisation logo is added for you.",
      });
      i += 2;
      continue;
    }
    if (rest.startsWith("**")) {
      const end = rest.indexOf("**", 2);
      if (end > 2) {
        flush();
        out.push({ t: "bold", children: parseInline(rest.slice(2, end), line, issues) });
        i += end + 2;
        continue;
      }
    }
    if ((rest[0] === "*" || rest[0] === "_") && rest[1] !== " " && rest[1] !== rest[0]) {
      const mark = rest[0];
      const end = rest.indexOf(mark, 1);
      if (end > 1) {
        flush();
        out.push({ t: "italic", children: parseInline(rest.slice(1, end), line, issues) });
        i += end + 1;
        continue;
      }
    }
    if (rest[0] === "[") {
      const m = /^\[([^\]]*)\]\(([^)\s]*)\)/.exec(rest);
      if (m) {
        flush();
        const href = m[2] ?? "";
        if (!/^https:\/\/[^\s]+$/i.test(href)) {
          issues.push({ line, message: `Only https links are allowed (found "${href.slice(0, 60)}").` });
        }
        out.push({ t: "link", href, children: parseInline(m[1] ?? "", line, issues) });
        i += m[0].length;
        continue;
      }
    }
    if (rest[0] === "<" && /^<\/?[a-z!?]/i.test(rest)) {
      issues.push({
        line,
        message: "Raw HTML isn't allowed in letter templates. Use Markdown: **bold**, *italic*, lists and tables.",
      });
      const close = rest.indexOf(">");
      i += close > 0 ? close + 1 : 1;
      continue;
    }
    if (rest[0] === "\\" && rest.length > 1 && "*_[]{}\\|#<".includes(rest[1] as string)) {
      buf += rest[1];
      i += 2;
      continue;
    }
    buf += rest[0];
    i++;
  }
  flush();
  return out;
}

function splitRow(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  return trimmed.split(/(?<!\\)\|/).map((c) => c.trim());
}

/** Parses a template body. Issues are collected rather than thrown, so the editor can list them all. */
export function parseMarkdown(src: string): { blocks: Block[]; issues: MarkdownIssue[] } {
  const lines = src.replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  const issues: MarkdownIssue[] = [];
  let i = 0;
  while (i < lines.length) {
    const raw = lines[i] as string;
    const line = raw.trim();
    const n = i + 1;
    if (!line) {
      i++;
      continue;
    }
    const anchor = ANCHOR.exec(line);
    if (anchor) {
      blocks.push({ t: "anchor", id: anchor[1] as string, line: n });
      i++;
      continue;
    }
    if (line.startsWith("<!--")) {
      issues.push({ line: n, message: "Comments are only allowed as KET anchors, like <!-- ket:start_date -->." });
      i++;
      continue;
    }
    if (line === "\\pagebreak") {
      blocks.push({ t: "pagebreak", line: n });
      i++;
      continue;
    }
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      const level = (h[1] as string).length;
      if (level > 3) issues.push({ line: n, message: "Use at most three heading levels (#, ## or ###)." });
      blocks.push({
        t: "heading",
        level: Math.min(level, 3) as 1 | 2 | 3,
        children: parseInline(h[2] ?? "", n, issues),
        line: n,
      });
      i++;
      continue;
    }
    if (/^([-*+]|\d+[.)])\s+/.test(line)) {
      const ordered = /^\d/.test(line);
      const items: Inline[][] = [];
      while (i < lines.length && /^([-*+]|\d+[.)])\s+/.test((lines[i] as string).trim())) {
        const text = (lines[i] as string).trim().replace(/^([-*+]|\d+[.)])\s+/, "");
        items.push(parseInline(text, i + 1, issues));
        i++;
      }
      blocks.push({ t: "list", ordered, items, line: n });
      continue;
    }
    if (line.startsWith("|")) {
      const rows: string[] = [];
      while (i < lines.length && (lines[i] as string).trim().startsWith("|")) {
        rows.push((lines[i] as string).trim());
        i++;
      }
      const sep = rows[1] && /^\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?$/.test(rows[1]);
      if (!sep) {
        issues.push({ line: n, message: "A table needs a header row, then a separator row like | --- | --- |." });
        continue;
      }
      const header = splitRow(rows[0] as string).map((c) => parseInline(c, n, issues));
      const body = rows.slice(2).map((r, k) => splitRow(r).map((c) => parseInline(c, n + 2 + k, issues)));
      blocks.push({ t: "table", header, rows: body, line: n });
      continue;
    }
    // Paragraph: consecutive non-blank lines that start no other block.
    const parts: string[] = [];
    const start = n;
    while (i < lines.length) {
      const l = (lines[i] as string).trim();
      if (
        !l ||
        ANCHOR.test(l) ||
        l.startsWith("<!--") ||
        l === "\\pagebreak" ||
        /^#{1,6}\s/.test(l) ||
        /^([-*+]|\d+[.)])\s+/.test(l) ||
        l.startsWith("|")
      )
        break;
      parts.push(l);
      i++;
    }
    // Letters keep their line breaks (address blocks, sign-offs): lines inside a paragraph stay lines.
    blocks.push({
      t: "paragraph",
      children: parts.flatMap((p, k) => [
        ...(k ? [{ t: "text" as const, text: "\n" }] : []),
        ...parseInline(p, start + k, issues),
      ]),
      line: start,
    });
  }
  return { blocks, issues };
}

function inlineFields(nodes: readonly Inline[], out: { id: string; line: number }[]) {
  for (const n of nodes) {
    if (n.t === "field") out.push({ id: n.id, line: n.line });
    else if (n.t !== "text") inlineFields(n.children, out);
  }
}

/** Every merge field used, with its line, in order. */
export function fieldsUsed(blocks: readonly Block[]): { id: string; line: number }[] {
  const out: { id: string; line: number }[] = [];
  for (const b of blocks) {
    if (b.t === "heading" || b.t === "paragraph") inlineFields(b.children, out);
    else if (b.t === "list") for (const it of b.items) inlineFields(it, out);
    else if (b.t === "table") for (const row of [b.header, ...b.rows]) for (const c of row) inlineFields(c, out);
  }
  return out;
}

/** Ids of KET anchors in order. */
export function anchorsUsed(blocks: readonly Block[]): string[] {
  return blocks.flatMap((b) => (b.t === "anchor" ? [b.id] : []));
}

function resolveInline(nodes: readonly Inline[], value: (id: string) => string): Inline[] {
  return nodes.map((n): Inline => {
    if (n.t === "field") return { t: "text", text: value(n.id) };
    if (n.t === "text") return n;
    return { ...n, children: resolveInline(n.children, value) };
  });
}

/** Replaces every field node with a text node holding its value. Values are never parsed. */
export function resolveFields(blocks: readonly Block[], value: (id: string) => string): Block[] {
  return blocks.map((b): Block => {
    switch (b.t) {
      case "heading":
      case "paragraph":
        return { ...b, children: resolveInline(b.children, value) };
      case "list":
        return { ...b, items: b.items.map((it) => resolveInline(it, value)) };
      case "table":
        return {
          ...b,
          header: b.header.map((c) => resolveInline(c, value)),
          rows: b.rows.map((r) => r.map((c) => resolveInline(c, value))),
        };
      default:
        return b;
    }
  });
}

/** Plain text of inline nodes (preview, tests). */
export function inlineText(nodes: readonly Inline[]): string {
  return nodes
    .map((n) => (n.t === "text" ? n.text : n.t === "field" ? `{{${n.id}}}` : inlineText(n.children)))
    .join("");
}

export { FIELD as FIELD_PATTERN };
