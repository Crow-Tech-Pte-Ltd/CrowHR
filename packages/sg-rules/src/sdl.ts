import { parseMonth } from "./internal/dates.ts";
import { exactCents, exactDollarsText } from "./internal/exact.ts";
import { assertCents, money, pct } from "./internal/money.ts";
import { pickInForce } from "./tables/effective.ts";
import {
  SDL_EXEMPTIONS,
  SDL_EXEMPTIONS_SOURCE,
  SDL_NO_WAGES_SOURCE,
  SDL_RATES,
  type SdlExemption,
  type SdlRate,
} from "./tables/sdl.ts";
import type { Cents, RuleIssue, WorkingStep, YearMonth } from "./types.ts";

export interface SdlInput {
  readonly month: YearMonth;
  /** All wages paid or payable for the month: OW + AW including bonus, no CPF ceilings. */
  readonly totalWagesCents: Cents;
  /** Statutory exemption, if any (recorded with its evidence by the caller). */
  readonly exemption?: SdlExemption;
}

export interface SdlResult {
  readonly month: YearMonth;
  readonly liable: boolean;
  readonly exemption: SdlExemption | null;
  /**
   * Exact per-employee levy in units of 1/10,000 cent (= wageCents × 25 for 0.25%). CPF publishes
   * no per-employee rounding; the employer total is rounded once (see `computeSdlTotal`).
   */
  readonly units1e4Cent: number;
  /** Exact levy in dollars, e.g. "3.0864". */
  readonly exactDollars: string;
  readonly appliedLimit: "MINIMUM" | "MAXIMUM" | null;
  readonly rate: SdlRate;
  readonly working: readonly WorkingStep[];
  readonly issues: readonly RuleIssue[];
}

const UNITS_PER_CENT = 10_000;

/** SDL for one employee for one month. Employer-only: never deduct it from the employee. */
export function computeSdl(input: SdlInput): SdlResult {
  parseMonth(input.month, "month");
  assertCents(input.totalWagesCents, "totalWagesCents");
  const rate = pickInForce(SDL_RATES, `${input.month}-01`, "SDL");
  const base = { month: input.month, rate, issues: [] as RuleIssue[] };
  if (input.exemption) {
    return {
      ...base,
      liable: false,
      exemption: input.exemption,
      units1e4Cent: 0,
      exactDollars: "0.00",
      appliedLimit: null,
      working: [{ code: "SDL_EXEMPT", text: `No SDL: exempt — ${SDL_EXEMPTIONS[input.exemption]}` }],
      issues: [
        {
          code: "SDL_EXEMPTION_EVIDENCE",
          severity: "info",
          message: "Keep the evidence for the SDL exemption (e.g. the institution's letter) with the employee record.",
          source: SDL_EXEMPTIONS_SOURCE,
        },
      ],
    };
  }
  if (input.totalWagesCents === 0) {
    return {
      ...base,
      liable: false,
      exemption: null,
      units1e4Cent: 0,
      exactDollars: "0.00",
      appliedLimit: null,
      working: [
        {
          code: "SDL_NO_WAGES",
          text: "No SDL: no wages paid or payable for the month (e.g. full month of no-pay leave). The $2 minimum applies only when wages are paid or payable.",
        },
      ],
      issues: [
        {
          code: "SDL_NO_WAGES",
          severity: "info",
          message: "No wages for the month, so no SDL.",
          source: SDL_NO_WAGES_SOURCE,
        },
      ],
    };
  }
  const raw = input.totalWagesCents * rate.rateBps; // units of 1/10,000 cent
  let units = raw;
  let appliedLimit: SdlResult["appliedLimit"] = null;
  let text: string;
  if (input.totalWagesCents < rate.minAppliesBelowTotalWagesCents) {
    units = rate.minPerEmployeeCents * UNITS_PER_CENT;
    appliedLimit = "MINIMUM";
    text = `Total wages ${money(input.totalWagesCents)} < ${money(rate.minAppliesBelowTotalWagesCents)} → minimum SDL ${money(rate.minPerEmployeeCents)}.`;
  } else if (input.totalWagesCents > rate.maxAppliesAboveTotalWagesCents) {
    units = rate.maxPerEmployeeCents * UNITS_PER_CENT;
    appliedLimit = "MAXIMUM";
    text = `Total wages ${money(input.totalWagesCents)} > ${money(rate.maxAppliesAboveTotalWagesCents)} → maximum SDL ${money(rate.maxPerEmployeeCents)}.`;
  } else {
    text = `SDL = ${pct(rate.rateBps)} × ${money(input.totalWagesCents)} = $${exactDollarsText(exactCents(raw, UNITS_PER_CENT))} (exact; rounded only in the employer total).`;
  }
  return {
    ...base,
    liable: true,
    exemption: null,
    units1e4Cent: units,
    exactDollars: exactDollarsText(exactCents(units, UNITS_PER_CENT)),
    appliedLimit,
    working: [{ code: "SDL_EMPLOYEE", text }],
  };
}

export interface SdlTotal {
  readonly units1e4Cent: number;
  readonly exactDollars: string;
  /** Payable for the CSN: the exact sum rounded DOWN to the nearest dollar, in cents. */
  readonly payableCents: Cents;
  readonly working: readonly WorkingStep[];
}

/** Employer total: "Add up the SDL calculated for each employee and then round the total amount down to the nearest dollar." */
export function computeSdlTotal(employees: readonly Pick<SdlResult, "units1e4Cent">[]): SdlTotal {
  const units = employees.reduce((sum, e) => sum + e.units1e4Cent, 0);
  if (!Number.isSafeInteger(units)) throw new RangeError("SDL total exceeds the safe integer range.");
  const payableCents = Math.floor(units / (100 * UNITS_PER_CENT)) * 100;
  const exactDollars = exactDollarsText(exactCents(units, UNITS_PER_CENT));
  return {
    units1e4Cent: units,
    exactDollars,
    payableCents,
    working: [
      {
        code: "SDL_TOTAL",
        text: `SDL for ${employees.length} employee(s) = $${exactDollars} exact → rounded down to ${money(payableCents)} payable.`,
      },
    ],
  };
}
