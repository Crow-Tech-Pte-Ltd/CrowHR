import { SgRulesInputError } from "../errors.ts";

/** "$1,234.56" — used in working text only (UI formatting lives in packages/ui). */
export function money(cents: number): string {
  const negative = cents < 0;
  const abs = Math.abs(cents);
  const dollars = Math.floor(abs / 100)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${negative ? "-" : ""}$${dollars}.${String(abs % 100).padStart(2, "0")}`;
}

/** "37%", "12.5%", "0.25%" from basis points. */
export function pct(basisPoints: number): string {
  const whole = Math.trunc(basisPoints / 100);
  const frac = Math.abs(basisPoints % 100);
  if (frac === 0) return `${whole}%`;
  return `${whole}.${String(frac).padStart(2, "0").replace(/0$/, "")}%`;
}

/** Phase-in coefficient from basis points: 6000 → "0.6", 3750 → "0.375". */
export function coefficient(basisPoints: number): string {
  return (basisPoints / 10_000).toString();
}

export function assertCents(value: number, field: string, opts: { allowNegative?: boolean } = {}): void {
  if (!Number.isSafeInteger(value)) {
    throw new SgRulesInputError(`${field} must be integer cents (a safe integer), got ${value}.`);
  }
  if (!opts.allowNegative && value < 0) {
    throw new SgRulesInputError(
      `${field} must not be negative (got ${value}). Reverse an earlier month by recomputing that month with corrected wages and diffing the results, not by passing negative wages.`,
    );
  }
}
