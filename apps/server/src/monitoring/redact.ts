/**
 * Masks personal data inside free text (error messages, log messages and attributes) before it
 * goes to the monitoring service. The SDK's `dataCollection` settings cover structured request
 * data; this covers what code puts into messages:
 *
 * - Drizzle's `Failed query: <sql>\nparams: <values>`: every failed query carries its bound
 *   values (names, salaries, emails, encrypted identifiers). The SQL stays, the values go.
 * - PostgreSQL errors that quote the rejected input (`invalid input syntax for type integer: "…"`).
 * - NRIC/FIN numbers and email addresses anywhere in the text.
 *
 * No SDK or `@crowhr/core` imports: the logger bridge and `sentry.ts` both use it.
 */

const DRIZZLE_PARAMS = /(Failed query: [\s\S]*?)(\\n|\n)params: [\s\S]*/g;
const PG_QUOTED_INPUT =
  /((?:invalid input syntax for type|invalid input value for enum|is out of range for type|field value out of range)[^"]*: )"[^"]*"/gi;
const PG_VALUE_OUT_OF_RANGE = /\bvalue "[^"]*"( is out of range)/gi;
const NRIC_FIN = /\b[STFGM]\d{7}[A-Z]\b/gi;
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

export function redactText(text: string): string {
  return text
    .replace(DRIZZLE_PARAMS, "$1$2params: [redacted]")
    .replace(PG_QUOTED_INPUT, '$1"[redacted]"')
    .replace(PG_VALUE_OUT_OF_RANGE, 'value "[redacted]"$1')
    .replace(NRIC_FIN, "[nric]")
    .replace(EMAIL, "[email]");
}

/** `redactText` on every string inside a JSON-like value (event extra, breadcrumb and span data). */
export function redactDeep<T>(value: T, depth = 0): T {
  if (typeof value === "string") return redactText(value) as T;
  if (depth > 8 || value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((v) => redactDeep(v, depth + 1)) as T;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) out[k] = redactDeep(v, depth + 1);
  return out as T;
}
