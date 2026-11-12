/**
 * Client-side money helpers for the claim form. The server is the authority (it recomputes every
 * line); these mirror `packages/core/src/claims/money.ts` exactly so the SGD preview never
 * disagrees with what is stored. Integers only: amounts in minor units, rates in millionths,
 * BigInt for the product, one half-up rounding per line.
 */

/** Currencies offered in the picker (ISO 4217 exponent). The server accepts any ISO 4217 code. */
export const CURRENCIES: { code: string; exponent: number; label: string }[] = [
  { code: "SGD", exponent: 2, label: "Singapore dollar" },
  { code: "MYR", exponent: 2, label: "Malaysian ringgit" },
  { code: "IDR", exponent: 2, label: "Indonesian rupiah" },
  { code: "THB", exponent: 2, label: "Thai baht" },
  { code: "PHP", exponent: 2, label: "Philippine peso" },
  { code: "VND", exponent: 0, label: "Vietnamese dong" },
  { code: "USD", exponent: 2, label: "US dollar" },
  { code: "EUR", exponent: 2, label: "Euro" },
  { code: "GBP", exponent: 2, label: "Pound sterling" },
  { code: "AUD", exponent: 2, label: "Australian dollar" },
  { code: "CNY", exponent: 2, label: "Chinese yuan" },
  { code: "HKD", exponent: 2, label: "Hong Kong dollar" },
  { code: "TWD", exponent: 2, label: "New Taiwan dollar" },
  { code: "JPY", exponent: 0, label: "Japanese yen" },
  { code: "KRW", exponent: 0, label: "South Korean won" },
  { code: "INR", exponent: 2, label: "Indian rupee" },
  { code: "KWD", exponent: 3, label: "Kuwaiti dinar" },
];

export function exponentOf(code: string): number {
  return CURRENCIES.find((c) => c.code === code)?.exponent ?? 2;
}

/** "125.50" → 12550 for exponent 2; "5,000" → 5000 for exponent 0. Null when not a valid amount. */
export function parseMinor(text: string, exponent: number): number | null {
  const t = text.trim().replace(/,/g, "");
  const re = exponent === 0 ? /^(\d{1,15})$/ : new RegExp(`^(\\d{1,15})(?:\\.(\\d{1,${exponent}}))?$`);
  const m = re.exec(t);
  if (!m) return null;
  const minor = Number(m[1]) * 10 ** exponent + Number((m[2] ?? "").padEnd(exponent, "0") || "0");
  return Number.isSafeInteger(minor) && minor > 0 ? minor : null;
}

/** 12550, 2 → "125.50"; 5000, 0 → "5,000". */
export function formatMinorAmount(minor: number, exponent: number): string {
  const div = 10 ** exponent;
  const whole = Math.trunc(minor / div)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return exponent > 0 ? `${whole}.${String(minor % div).padStart(exponent, "0")}` : whole;
}

/** "0.301234" → 301234; null unless a positive decimal with at most 6 places. */
export function parseRateMicros(text: string): number | null {
  const m = /^(\d{1,9})(?:\.(\d{1,6}))?$/.exec(text.trim());
  if (!m) return null;
  const micros = Number(m[1]) * 1_000_000 + Number((m[2] ?? "").padEnd(6, "0"));
  return micros > 0 ? micros : null;
}

/** roundHalfUp(amountMinor × rateMicros × 100 / (10^exponent × 10^6)). */
export function toSgdCents(amountMinor: number, exponent: number, rateMicros: number): number {
  const n = BigInt(amountMinor) * BigInt(rateMicros) * 100n;
  const d = 10n ** BigInt(exponent) * 1_000_000n;
  return Number((2n * n + d) / (2n * d));
}

/** SGD cents for a line being typed, or null while incomplete. */
export function previewSgd(currency: string, amountMinor: number | null, rate: string | null): number | null {
  if (amountMinor === null) return null;
  if (currency === "SGD") return amountMinor;
  const micros = rate ? parseRateMicros(rate) : null;
  return micros === null ? null : toSgdCents(amountMinor, exponentOf(currency), micros);
}

/** 3334 → "33.34%" (basis points, sign dropped). Mirrors core `formatBasisPoints`. */
export function formatBasisPoints(bp: number): string {
  const a = Math.abs(bp);
  return `${Math.trunc(a / 100)}.${String(a % 100).padStart(2, "0")}%`;
}
