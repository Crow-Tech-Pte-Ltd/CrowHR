/**
 * Singapore display conventions (AGENTS.md): `S$1,234.56`, `31 Oct 2026`,
 * NRIC/FIN masked as `S****567D`. Money is always integer cents; nothing
 * here converts money through floating point.
 */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

function assertCents(cents: number): void {
  if (!Number.isSafeInteger(cents)) throw new RangeError(`Money must be a safe integer of cents, got ${cents}.`);
}

function groupThousands(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** 123456 → "S$1,234.56"; -500 → "-S$5.00". `symbol: false` → "1,234.56". */
export function formatMoney(cents: number, options: { symbol?: boolean } = {}): string {
  assertCents(cents);
  const negative = cents < 0;
  const abs = Math.abs(cents);
  const dollars = Math.trunc(abs / 100);
  const rem = abs % 100;
  const body = `${groupThousands(String(dollars))}.${String(rem).padStart(2, "0")}`;
  const withSymbol = options.symbol === false ? body : `S$${body}`;
  return negative ? `-${withSymbol}` : withSymbol;
}

export type MoneyParseResult =
  | { ok: true; cents: number }
  | { ok: false; reason: "empty" | "invalid" | "too_many_decimals" | "too_large" };

/**
 * Parses what a person types into a money field. Accepts "1234", "1,234.5",
 * "S$1,234.56", "$12", "-3.10". Rejects more than two decimal places rather
 * than silently rounding.
 */
export function parseMoneyToCents(input: string): MoneyParseResult {
  const cleaned = input
    .trim()
    .replace(/^(-?)\s*(S\$|\$)\s*/i, "$1")
    .replace(/[,\s]/g, "");
  if (cleaned === "" || cleaned === "-") return { ok: false, reason: "empty" };
  const match = /^(-?)(\d+)?(?:\.(\d*))?$/.exec(cleaned);
  if (!match || (match[2] === undefined && !match[3])) return { ok: false, reason: "invalid" };
  const [, sign, whole = "0", fraction = ""] = match;
  if (fraction.length > 2) return { ok: false, reason: "too_many_decimals" };
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(cents)) return { ok: false, reason: "too_large" };
  return { ok: true, cents: sign === "-" ? -cents : cents };
}

/** Human message for a failed parse, saying how to fix it. */
export function moneyParseMessage(reason: Extract<MoneyParseResult, { ok: false }>["reason"]): string {
  switch (reason) {
    case "empty":
      return "Enter an amount, like 1,250.00.";
    case "invalid":
      return "Use digits with an optional decimal point, like 1,250.00.";
    case "too_many_decimals":
      return "Use at most 2 decimal places (cents).";
    case "too_large":
      return "That amount is too large.";
  }
}

/**
 * `2026-10-31` or a Date → "31 Oct 2026". ISO date strings are formatted from
 * their parts (no timezone shift); Date objects use their local calendar date.
 */
export function formatDate(value: string | Date): string {
  if (typeof value === "string") {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
    if (!m) throw new RangeError(`Expected YYYY-MM-DD, got "${value}".`);
    const [, y, mo, d] = m;
    return `${Number(d)} ${MONTHS[Number(mo) - 1]} ${y}`;
  }
  return `${value.getDate()} ${MONTHS[value.getMonth()]} ${value.getFullYear()}`;
}

/** Local calendar date → `YYYY-MM-DD`. */
export function toIsoDate(date: Date): string {
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${mm}-${dd}`;
}

/** `YYYY-MM-DD` → local Date at midnight. */
export function fromIsoDate(iso: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) throw new RangeError(`Expected YYYY-MM-DD, got "${iso}".`);
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

/**
 * NRIC/FIN masking: keep the prefix letter and the last three digits + check
 * letter. "S1234567D" → "S****567D". Anything that is not NRIC/FIN-shaped is
 * fully masked rather than leaked.
 */
export function maskNric(value: string): string {
  const v = value.trim().toUpperCase();
  if (!/^[STFGM]\d{7}[A-Z]$/.test(v)) return "*********";
  return `${v[0]}****${v.slice(5)}`;
}

/** Connectors in Malay and Indian names ("bin", "binte", "s/o", "a/l"…): never an initial. */
const NAME_CONNECTORS = new Set(["bin", "binte", "binti", "bte", "bt", "s/o", "d/o", "a/l", "a/p", "@"]);

/**
 * Initials for avatars: the first letters of the first two words, skipping connectors.
 * "Tan Mei Ling" → "TM", "Goh Jun Jie" → "GJ", "Kumar s/o Rajan" → "KR". Only for avatars;
 * never derive a "first name" from a full name (greet with the preferred name instead).
 */
export function initials(name: string): string {
  const parts = name
    .trim()
    .split(/\s+/)
    .filter((p) => p && !NAME_CONNECTORS.has(p.toLowerCase()) && /^\p{L}/u.test(p));
  return parts
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
}
