import { SgRulesInputError } from "../errors.ts";
import { parseDate } from "../internal/dates.ts";
import { money } from "../internal/money.ts";
import { appendix8bRuleFor, IRAS_APPENDIX_SOURCES as SRC } from "../tables/iras-appendices.ts";
import type { Cents, IsoDate, WorkingStep } from "../types.ts";

/**
 * Appendix 8B (gains from ESOP / ESOW plans), research/sg-ir8a-appendices.md §3. Gross gain
 * (h) = (f − e) × g (Form 8B; ESOP guide §6), "drop off excess values beyond 2 decimals" (AIS item
 * E1(h)). Prices and share counts take up to 5 decimal places (AIS "Decimals (9,5)") and are held as
 * integers of 1/100,000 so the product is exact.
 */

export type SharePlanType = "ESOP" | "ESOW";
/** S10(1)(b): IR8A d7(a). S10(1)(g): IR8A d7(b), declared by the employee as "Other income". */
export type ShareGainSection = "S10_1_B" | "S10_1_G";

const SCALE = 100_000n;

/** "1.23456" → 123456n (units of 1/100,000). Rejects signs, exponents and too many digits. */
export function parseDecimalUnits(text: string, label: string, incomeYear: number): bigint {
  const rule = appendix8bRuleFor(incomeYear);
  const m = /^(\d+)(?:\.(\d+))?$/.exec(text.trim());
  if (!m) throw new SgRulesInputError(`${label} must be a decimal number such as 12.5 (no commas, signs or currency).`);
  const whole = (m[1] as string).replace(/^0+(?=\d)/, "");
  const frac = m[2] ?? "";
  if (frac.length > rule.decimalPlaces)
    throw new SgRulesInputError(
      `${label} can have at most ${rule.decimalPlaces} decimal places (IRAS's Appendix 8B limit).`,
    );
  if (whole.length > rule.maxIntegerDigits)
    throw new SgRulesInputError(`${label} can have at most ${rule.maxIntegerDigits} digits before the decimal point.`);
  return BigInt(whole) * SCALE + BigInt(frac.padEnd(5, "0"));
}

/** 123456n → "1.23456"; 150000n → "1.5"; whole numbers without a decimal point. */
export function formatDecimalUnits(units: bigint): string {
  const whole = units / SCALE;
  const frac = (units % SCALE).toString().padStart(5, "0").replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : `${whole}`;
}

export interface ShareGainInput {
  readonly incomeYear: number;
  readonly planType: SharePlanType;
  /** c2: date of grant. */
  readonly grantedOn: IsoDate;
  /**
   * d: date of exercise (ESOP), vesting (ESOW with vesting), grant (ESOW with neither), or the date
   * the moratorium is lifted (EN-8B 6(iv)). Must be in the income year (AIS item E1(d)).
   */
  readonly eventDate: IsoDate;
  /** e: exercise price, or price paid or payable per share, in S$ (0 for free shares). */
  readonly exercisePrice: string;
  /** f: open market value per share on the date in d, in S$. */
  readonly openMarketValue: string;
  /** g: number of shares acquired. */
  readonly shares: string;
  /** Today's date: a grant cannot be in the future (AIS item E1(c)2). */
  readonly today?: IsoDate;
}

export interface ShareGainResult {
  /** h: gross gain, decimals beyond the cent dropped. */
  readonly grossGainCents: Cents;
  readonly section: ShareGainSection;
  readonly working: readonly WorkingStep[];
}

export function computeShareGain(input: ShareGainInput): ShareGainResult {
  const rule = appendix8bRuleFor(input.incomeYear);
  if (input.planType !== "ESOP" && input.planType !== "ESOW")
    throw new SgRulesInputError(
      "Type of plan must be ESOP or ESOW. ERIS was phased out after YA 2024 and IRAS no longer takes ERIS records.",
    );
  parseDate(input.grantedOn, "grant date");
  parseDate(input.eventDate, "exercise or vesting date");
  if (input.eventDate.slice(0, 4) !== String(input.incomeYear))
    throw new SgRulesInputError(
      `The date of exercise, vesting or moratorium lifted must be in ${input.incomeYear}: the gain is reported for the year it accrues.`,
    );
  if (input.eventDate < input.grantedOn)
    throw new SgRulesInputError(
      "The date of exercise, vesting or moratorium lifted must not be before the date of grant.",
    );
  if (input.today && input.grantedOn > input.today)
    throw new SgRulesInputError("The date of grant cannot be in the future.");
  const e = parseDecimalUnits(input.exercisePrice, "The exercise price or price paid", input.incomeYear);
  const f = parseDecimalUnits(input.openMarketValue, "The open market value per share", input.incomeYear);
  const g = parseDecimalUnits(input.shares, "The number of shares", input.incomeYear);
  if (f <= 0n)
    throw new SgRulesInputError(
      "Enter the open market value per share (more than 0). If it can't be determined and the shares are not listed on SGX, use the net asset value per share.",
    );
  if (g <= 0n) throw new SgRulesInputError("Enter the number of shares acquired (more than 0).");
  if (f <= e)
    throw new SgRulesInputError(
      "There is no gain: the open market value is not above the price paid. IRAS does not take losses on Appendix 8B, and a loss cannot be offset against other plans.",
    );
  // (f − e) × g is in units of 1/10^10 dollar = 1/10^8 cent; drop everything beyond the cent.
  const gainUnits = (f - e) * g;
  const cents = gainUnits / 100_000_000n;
  if (cents > BigInt(rule.maxGainCents))
    throw new SgRulesInputError(
      `The gain is more than the ${money(rule.maxGainCents)} IRAS's Appendix 8B accepts. Check the price and number of shares.`,
    );
  const grossGainCents = Number(cents);
  const section: ShareGainSection =
    input.planType === "ESOP" && input.grantedOn < rule.s101gEsopGrantedBefore ? "S10_1_G" : "S10_1_B";
  return {
    grossGainCents,
    section,
    working: [
      {
        code: "A8B_SECTION",
        text:
          section === "S10_1_G"
            ? `ESOP granted ${input.grantedOn}, before ${rule.s101gEsopGrantedBefore}: gains under S10(1)(g), IR8A d7(b).`
            : `${input.planType} granted ${input.grantedOn}: gains under S10(1)(b), IR8A d7(a).`,
      },
      {
        code: "A8B_GAIN",
        text: `h = ($${formatDecimalUnits(f)} − $${formatDecimalUnits(e)}) × ${formatDecimalUnits(g)} shares = ${money(grossGainCents)} (decimals beyond the cent dropped).`,
      },
    ],
  };
}

export interface Appendix8bTotal {
  /** AIS item E2: ESOW, and ESOP granted on or after 1 Jan 2003. */
  readonly s101bCents: Cents;
  /** AIS item E3: ESOP granted before 1 Jan 2003. */
  readonly s101gCents: Cents;
  /** IR8A d7(a) / d7(b): decimals dropped (AIS items C18, C19). */
  readonly ir8aD7aDollars: number;
  readonly ir8aD7bDollars: number;
}

export function totalAppendix8b(
  gains: readonly Pick<ShareGainResult, "grossGainCents" | "section">[],
): Appendix8bTotal {
  const s101bCents = gains.filter((g) => g.section === "S10_1_B").reduce((n, g) => n + g.grossGainCents, 0);
  const s101gCents = gains.filter((g) => g.section === "S10_1_G").reduce((n, g) => n + g.grossGainCents, 0);
  return {
    s101bCents,
    s101gCents,
    ir8aD7aDollars: Math.floor(s101bCents / 100),
    ir8aD7bDollars: Math.floor(s101gCents / 100),
  };
}

/** Sources for callers that show where the rules come from. */
export const APPENDIX_8B_SOURCES = { notes: SRC.explanatoryNotes8b, items: SRC.aisDataItems, guide: SRC.esopGuide };
