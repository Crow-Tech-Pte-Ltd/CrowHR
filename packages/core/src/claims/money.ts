import { AppError } from "../errors.ts";

/**
 * Claim money (add-claims design decision 1). Everything is an integer:
 *
 * - SGD amounts are cents.
 * - A foreign amount is `amountMinor` in that currency's minor units (ISO 4217 exponent:
 *   JPY 0, SGD 2, KWD 3).
 * - The manual exchange rate is SGD per 1 unit of the foreign currency with at most 6 decimal
 *   places, stored as an integer number of millionths (`rateMicros`; 0.301234 → 301234).
 *
 * Conversion rule (documented in docs/limitations.md "Claims"):
 *
 *   sgdCents = roundHalfUp( amountMinor × rateMicros × 10² / (10^exponent × 10⁶) )
 *
 * computed exactly with BigInt, then rounded half-up to the cent ONCE per line (amounts and rates
 * are positive, so half-up = half away from zero). The claim total is the sum of the rounded
 * line amounts; we never round a sum of unrounded values. A result that is not a safe integer
 * throws rather than silently losing precision.
 */

/**
 * ISO 4217 minor-unit exponents for active currency and fund codes. A code not in this table is
 * rejected as an unknown currency.
 * Source: ISO 4217 List One (current currency and funds), maintenance agency SIX,
 * https://www.six-group.com/en/products-services/financial-information/data-standards.html
 * (list published 1 Jan 2025 with XCG; ANG kept until its withdrawal). Checked 31 Oct 2026.
 */
const ZERO = "BIF CLP DJF GNF ISK JPY KMF KRW PYG RWF UGX UYI VND VUV XAF XOF XPF";
const THREE = "BHD IQD JOD KWD LYD OMR TND";
const FOUR = "CLF UYW";
const TWO =
  "AED AFN ALL AMD ANG AOA ARS AUD AWG AZN BAM BBD BDT BGN BMD BND BOB BOV BRL BSD BTN BWP BYN BZD CAD CDF CHE CHF CHW CNY COP COU CRC CUP CVE CZK DKK DOP DZD EGP ERN ETB EUR FJD FKP GBP GEL GHS GIP GMD GTQ GYD HKD HNL HTG HUF IDR ILS INR IRR JMD KES KGS KHR KPW KYD KZT LAK LBP LKR LRD LSL MAD MDL MGA MKD MMK MNT MOP MRU MUR MVR MWK MXN MXV MYR MZN NAD NGN NIO NOK NPR NZD PAB PEN PGK PHP PKR PLN QAR RON RSD RUB SAR SBD SCR SDG SEK SGD SHP SLE SOS SRD SSP STN SVC SYP SZL THB TJS TMT TOP TRY TTD TWD TZS UAH USD USN UYU UZS VED VES WST XCD XCG YER ZAR ZMW ZWG";

export const CURRENCY_EXPONENTS: ReadonlyMap<string, number> = new Map([
  ...ZERO.split(" ").map((c) => [c, 0] as const),
  ...TWO.split(" ").map((c) => [c, 2] as const),
  ...THREE.split(" ").map((c) => [c, 3] as const),
  ...FOUR.split(" ").map((c) => [c, 4] as const),
]);

export const CURRENCY_CODES: readonly string[] = [...CURRENCY_EXPONENTS.keys()].sort();

export function currencyExponent(code: string): number | null {
  return CURRENCY_EXPONENTS.get(code.toUpperCase()) ?? null;
}

/** Thrown (as a plain Error) on overflow; services wrap it in a 400. */
export class MoneyOverflowError extends Error {
  override name = "MoneyOverflowError";
}

function assertSafe(value: bigint, what: string): number {
  if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < BigInt(Number.MIN_SAFE_INTEGER)) {
    throw new MoneyOverflowError(`${what} is too large to store exactly.`);
  }
  return Number(value);
}

/** Positive integer division rounded half-up (both operands > 0). */
export function divRoundHalfUp(numerator: bigint, denominator: bigint): bigint {
  if (denominator <= 0n || numerator < 0n) throw new RangeError("divRoundHalfUp expects n >= 0 and d > 0");
  return (2n * numerator + denominator) / (2n * denominator);
}

/**
 * Converts a foreign amount to SGD cents (see the module comment for the rule).
 * `toSgdCents(12550, 2, 301234)` → 3780 (MYR 125.50 @ 0.301234 = S$37.804867).
 */
export function toSgdCents(amountMinor: number, exponent: number, rateMicros: number): number {
  for (const [v, name] of [
    [amountMinor, "amountMinor"],
    [rateMicros, "rateMicros"],
  ] as const) {
    if (!Number.isSafeInteger(v) || v <= 0) throw new RangeError(`${name} must be a positive safe integer.`);
  }
  if (!Number.isInteger(exponent) || exponent < 0 || exponent > 4) throw new RangeError("exponent must be 0–4.");
  const numerator = BigInt(amountMinor) * BigInt(rateMicros) * 100n;
  const denominator = 10n ** BigInt(exponent) * 1_000_000n;
  return assertSafe(divRoundHalfUp(numerator, denominator), "The SGD amount");
}

/** SGD line amount in cents: the amount itself for SGD, converted otherwise. */
export function lineSgdCents(input: { currency: string; amountMinor: number; rateMicros: number | null }): number {
  if (input.currency === "SGD") {
    if (!Number.isSafeInteger(input.amountMinor) || input.amountMinor <= 0)
      throw new RangeError("amountMinor must be a positive safe integer.");
    return input.amountMinor;
  }
  const exp = currencyExponent(input.currency);
  if (exp === null) throw new RangeError(`Unknown currency ${input.currency}.`);
  if (input.rateMicros === null) throw new RangeError("A foreign-currency line needs an exchange rate.");
  return toSgdCents(input.amountMinor, exp, input.rateMicros);
}

/** Sum of cents, asserted safe. */
export function sumCents(values: readonly number[]): number {
  return assertSafe(
    values.reduce((acc, v) => acc + BigInt(v), 0n),
    "The total",
  );
}

const RATE = /^(\d{1,9})(?:\.(\d{1,6}))?$/;

/**
 * Parses an exchange rate typed as a decimal string ("0.301234", "1.35", "105") into millionths.
 * Returns null when the text is not a positive decimal with at most 6 decimal places.
 */
export function parseRateMicros(text: string): number | null {
  const m = RATE.exec(text.trim());
  if (!m) return null;
  const micros = Number(m[1]) * 1_000_000 + Number((m[2] ?? "").padEnd(6, "0"));
  return micros > 0 && Number.isSafeInteger(micros) ? micros : null;
}

/** 301234 → "0.301234"; 1350000 → "1.350000". Always 6 decimal places, as entered precision. */
export function formatRateMicros(micros: number): string {
  return `${Math.trunc(micros / 1_000_000)}.${String(micros % 1_000_000).padStart(6, "0")}`;
}

/** "S$1,234.56" for messages (the web formats with @crowhr/ui `formatMoney`). */
export function sgd(cents: number): string {
  const neg = cents < 0;
  const abs = Math.abs(cents);
  const dollars = Math.trunc(abs / 100)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${neg ? "-" : ""}S$${dollars}.${String(abs % 100).padStart(2, "0")}`;
}

/** "MYR 125.50", "JPY 5,000", "KWD 1.250". */
export function formatMinor(currency: string, amountMinor: number): string {
  const exp = currencyExponent(currency) ?? 2;
  const div = 10 ** exp;
  const whole = Math.trunc(amountMinor / div)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const frac = exp > 0 ? `.${String(amountMinor % div).padStart(exp, "0")}` : "";
  return `${currency} ${whole}${frac}`;
}

/** Wraps overflow/range errors from these helpers as a 400 naming the line. */
export function moneyError(err: unknown, path: string): never {
  if (err instanceof MoneyOverflowError || err instanceof RangeError) {
    throw new AppError("validation_failed", "An amount is too large or not valid.", {
      issues: [{ path, message: `${err.message} Check the amount and rate.` }],
    });
  }
  throw err;
}
