import { simpleCsv } from "../../export/csv.ts";
/**
 * Runtime-agnostic RFC 4180 CSV parser for imports (no Node APIs, no
 * dependencies). UTF-8 with or without BOM, comma separator, header row,
 * quoted fields with embedded commas, quotes ("") and newlines, CRLF or LF.
 */
export const MAX_IMPORT_BYTES = 5 * 1024 * 1024;
export const MAX_IMPORT_ROWS = 2000;

export interface ParsedCsv {
  headers: string[];
  /** Data rows keyed by normalised header. `line` is the 1-based spreadsheet row (header = 1). */
  rows: { line: number; values: Record<string, string> }[];
}

export type ParseResult = { ok: true; csv: ParsedCsv } | { ok: false; message: string };

/** `Date of birth` / `date_of_birth` / ` DOB ` → `date_of_birth` / `dob`. */
export function normaliseHeader(h: string): string {
  return h
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export function parseCsv(input: string | Uint8Array): ParseResult {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input).byteLength : input.byteLength;
  if (bytes > MAX_IMPORT_BYTES) {
    return { ok: false, message: "The file is larger than 5 MB. Split it into smaller files and import each." };
  }
  let text: string;
  try {
    text = typeof input === "string" ? input : new TextDecoder("utf-8", { fatal: true }).decode(input);
  } catch {
    return { ok: false, message: "The file is not UTF-8. In Excel, use Save As → CSV UTF-8 (Comma delimited)." };
  }
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);

  const records: string[][] = [];
  let field = "";
  let record: string[] = [];
  let inQuotes = false;
  let i = 0;
  while (i < text.length) {
    const ch = text[i] as string;
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += ch;
      i++;
      continue;
    }
    if (ch === '"' && field === "") {
      inQuotes = true;
      i++;
      continue;
    }
    if (ch === ",") {
      record.push(field);
      field = "";
      i++;
      continue;
    }
    if (ch === "\r" || ch === "\n") {
      record.push(field);
      records.push(record);
      record = [];
      field = "";
      if (ch === "\r" && text[i + 1] === "\n") i++;
      i++;
      continue;
    }
    field += ch;
    i++;
  }
  if (inQuotes) return { ok: false, message: 'A quoted field is not closed. Check for a stray double quote (").' };
  if (field !== "" || record.length) {
    record.push(field);
    records.push(record);
  }
  const nonEmpty = records
    .map((r, idx) => ({ r, line: idx + 1 }))
    .filter(({ r }) => !(r.length === 1 && (r[0] as string).trim() === ""));
  const header = nonEmpty.shift();
  if (!header) return { ok: false, message: "The file is empty. Start from the downloadable template." };
  const headers = header.r.map(normaliseHeader);
  const dupes = headers.filter((h, idx) => h && headers.indexOf(h) !== idx);
  if (dupes.length) return { ok: false, message: `The column "${dupes[0]}" appears twice. Keep one.` };
  if (nonEmpty.length > MAX_IMPORT_ROWS) {
    return {
      ok: false,
      message: `The file has ${nonEmpty.length} data rows; the limit is ${MAX_IMPORT_ROWS}. Split it into smaller files.`,
    };
  }
  const rows = nonEmpty.map(({ r, line }) => {
    const values: Record<string, string> = {};
    headers.forEach((h, idx) => {
      if (h) values[h] = (r[idx] ?? "").trim();
    });
    return { line, values };
  });
  return { ok: true, csv: { headers, rows } };
}

export type DateParse = { ok: true; value: string } | { ok: false; message: string };

/** Accepts `YYYY-MM-DD` and `DD/MM/YYYY` only (spec), returning ISO. */
export function parseImportDate(raw: string): DateParse {
  const v = raw.trim();
  let y: number;
  let m: number;
  let d: number;
  let match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  if (match) {
    [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  } else {
    match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(v);
    if (!match) return { ok: false, message: "Use YYYY-MM-DD (2026-10-31) or DD/MM/YYYY (31/10/2026)." };
    [d, m, y] = [Number(match[1]), Number(match[2]), Number(match[3])];
  }
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) {
    return { ok: false, message: "That date does not exist. Check the day and month." };
  }
  return { ok: true, value: date.toISOString().slice(0, 10) };
}

export type MoneyParse = { ok: true; cents: number } | { ok: false; message: string };

/** Dollars with up to 2 decimals (`36000.00`, `1,250.5`, `S$12`) → integer cents, exactly (no floats). */
export function parseDollarsToCents(raw: string): MoneyParse {
  const v = raw.trim().replace(/^S?\$/i, "").replace(/,/g, "");
  const m = /^(\d+)(?:\.(\d{0,2}))?$/.exec(v);
  if (!m) {
    return /^\d+\.\d{3,}$/.test(v)
      ? { ok: false, message: "Use at most 2 decimal places, like 36000.00." }
      : { ok: false, message: "Enter an amount in dollars, like 36000.00 (no negative amounts)." };
  }
  const cents = Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0"));
  if (!Number.isSafeInteger(cents)) return { ok: false, message: "That amount is too large." };
  return { ok: true, cents };
}

/** Levenshtein distance, for "did you mean" hints. */
export function editDistance(a: string, b: string): number {
  const s = a.toLowerCase();
  const t = b.toLowerCase();
  const dp = Array.from({ length: t.length + 1 }, (_, j) => j);
  for (let i = 1; i <= s.length; i++) {
    let prev = dp[0] as number;
    dp[0] = i;
    for (let j = 1; j <= t.length; j++) {
      const tmp = dp[j] as number;
      dp[j] = Math.min((dp[j] as number) + 1, (dp[j - 1] as number) + 1, prev + (s[i - 1] === t[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return dp[t.length] as number;
}

export function closestName(target: string, names: readonly string[]): string | null {
  let best: string | null = null;
  let bestD = Number.POSITIVE_INFINITY;
  for (const n of names) {
    const d = editDistance(target, n);
    if (d < bestD) {
      bestD = d;
      best = n;
    }
  }
  return best;
}

/** CSV writer counterpart: quotes when needed and neutralises spreadsheet formulas. */
export function toCsv(headers: readonly string[], rows: readonly (readonly (string | number | null)[])[]): string {
  return simpleCsv(headers, rows);
}
