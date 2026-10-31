/**
 * Exact rational arithmetic on money, in cents, using bigint.
 *
 * Statutory amounts are computed exactly (e.g. 37% × $1,001.34 = $370.4958) and rounded once,
 * by a named rule, at the point the regulator prescribes. Nothing is pre-rounded to cents.
 */

import { SgRulesInputError } from "../errors.ts";

/** An exact amount of money in cents: n / d cents, d > 0, in lowest terms. */
export interface ExactCents {
  readonly n: bigint;
  readonly d: bigint;
}

const gcd = (a: bigint, b: bigint): bigint => {
  let x = a < 0n ? -a : a;
  let y = b < 0n ? -b : b;
  while (y !== 0n) {
    const t = x % y;
    x = y;
    y = t;
  }
  return x === 0n ? 1n : x;
};

export function exactCents(n: bigint | number, d: bigint | number = 1n): ExactCents {
  let nn = BigInt(n);
  let dd = BigInt(d);
  if (dd === 0n) throw new SgRulesInputError("Division by zero in exact arithmetic.");
  if (dd < 0n) {
    nn = -nn;
    dd = -dd;
  }
  const g = gcd(nn, dd);
  return { n: nn / g, d: dd / g };
}

export const ZERO: ExactCents = { n: 0n, d: 1n };

export function add(...xs: readonly ExactCents[]): ExactCents {
  let n = 0n;
  let d = 1n;
  for (const x of xs) {
    n = n * x.d + x.n * d;
    d = d * x.d;
  }
  return exactCents(n, d);
}

export function sub(a: ExactCents, b: ExactCents): ExactCents {
  return exactCents(a.n * b.d - b.n * a.d, a.d * b.d);
}

/** cents × (num / den), exact. */
export function scale(cents: number | ExactCents, num: bigint | number, den: bigint | number = 1n): ExactCents {
  const x = typeof cents === "number" ? exactCents(cents) : cents;
  return exactCents(x.n * BigInt(num), x.d * BigInt(den));
}

/** cents × basis points / 10,000, exact. */
export function bps(cents: number | ExactCents, basisPoints: number): ExactCents {
  return scale(cents, basisPoints, 10_000n);
}

export function compare(a: ExactCents, b: ExactCents): number {
  const l = a.n * b.d;
  const r = b.n * a.d;
  return l < r ? -1 : l > r ? 1 : 0;
}

export function min(a: ExactCents, b: ExactCents): ExactCents {
  return compare(a, b) <= 0 ? a : b;
}

export function isNegative(a: ExactCents): boolean {
  return a.n < 0n;
}

const floorDiv = (n: bigint, d: bigint): bigint => {
  const q = n / d;
  return n % d !== 0n && n < 0n !== d < 0n ? q - 1n : q;
};

const toSafeNumber = (v: bigint): number => {
  const n = Number(v);
  if (!Number.isSafeInteger(n)) throw new SgRulesInputError(`Amount ${v} cents exceeds the safe integer range.`);
  return n;
};

/**
 * CPF "rounded to the nearest dollar": drop cents below 50, round up 50 cents and above,
 * judged on the exact (unrounded) amount. Returns cents (a multiple of 100).
 * Source: https://www.cpf.gov.sg/content/dam/web/employer/employer-obligations/documents/CPFcontributionratesfrom1Jan2026.pdf
 */
export function roundHalfUpToDollar(x: ExactCents): number {
  return toSafeNumber(floorDiv(2n * x.n + 100n * x.d, 200n * x.d) * 100n);
}

/** CPF employee share: "rounded down to the nearest dollar". Returns cents (a multiple of 100). */
export function floorToDollar(x: ExactCents): number {
  return toSafeNumber(floorDiv(x.n, 100n * x.d) * 100n);
}

/** Round half up to a whole cent. Used where no regulator rule exists; each use is documented. */
export function roundHalfUpToCent(x: ExactCents): number {
  return toSafeNumber(floorDiv(2n * x.n + x.d, 2n * x.d));
}

/** Round up to the next whole cent (MOM levy daily rate: "rounding up to the nearest cent"). */
export function ceilToCent(x: ExactCents): number {
  return toSafeNumber(-floorDiv(-x.n, x.d));
}

/** Round down to a whole cent. */
export function floorToCent(x: ExactCents): number {
  return toSafeNumber(floorDiv(x.n, x.d));
}

/**
 * Decimal text of an exact amount in dollars, e.g. "370.4958". Terminating decimals are printed
 * in full; non-terminating ones are printed to 6 places with a "≈" prefix.
 */
export function exactDollarsText(x: ExactCents): string {
  const n = x.n;
  const d = x.d * 100n;
  let rest = d;
  while (rest % 2n === 0n) rest /= 2n;
  while (rest % 5n === 0n) rest /= 5n;
  const terminating = rest === 1n;
  const negative = n < 0n;
  const abs = negative ? -n : n;
  const whole = abs / d;
  let rem = abs % d;
  let digits = "";
  const maxDigits = terminating ? 40 : 6;
  while (rem !== 0n && digits.length < maxDigits) {
    rem *= 10n;
    digits += (rem / d).toString();
    rem %= d;
  }
  while (digits.length < 2) digits += "0";
  const wholeText = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${terminating ? "" : "≈"}${negative ? "-" : ""}${wholeText}.${digits}`;
}

/** Exact amount as a canonical "n/d" cents string for persistence and audit. */
export function exactToString(x: ExactCents): string {
  return x.d === 1n ? `${x.n}` : `${x.n}/${x.d}`;
}
