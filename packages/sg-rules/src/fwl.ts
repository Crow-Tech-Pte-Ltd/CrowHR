import { RulesNotAvailableError, SgRulesInputError } from "./errors.ts";
import { addDays, daysInMonth, epochDay, parseDate, parseMonth } from "./internal/dates.ts";
import { ceilToCent, exactCents } from "./internal/exact.ts";
import { money } from "./internal/money.ts";
import { isInForce } from "./tables/effective.ts";
import { FWL_DAILY_RATE_SOURCE, FWL_RATES, type FwlPass, type FwlRate } from "./tables/fwl.ts";

/** The levy rate table, for pickers (e.g. the sector and tier choices in payroll settings). */
export { FWL_RATES, type FwlPass, type FwlRate };

import type { Cents, IsoDate, RuleIssue, WorkingStep, YearMonth } from "./types.ts";

/**
 * The Foreign Worker Levy is borne by the employer and must never be deducted from the worker's
 * salary (EFMA s 25(6)(e), s 22A; MOM FAQ). Payroll deduction types must be blocked accordingly.
 */
export const FWL_DEDUCTIBLE_FROM_SALARY = false;

export const FWL_NO_DEDUCTION_SOURCE =
  "https://www.mom.gov.sg/faq/levy/can-employers-pass-on-the-foreign-worker-levy-costs--to-their-foreign-workers";

export interface LevyEstimateInput {
  readonly month: YearMonth;
  readonly pass: FwlPass;
  /** MOM sector, e.g. "SERVICES" ("ALL" for S Pass). */
  readonly sector: string;
  /** Tier or source group as on the MOM levy bill, e.g. "TIER_2", "MYS_NAS_PRC" ("ALL" for S Pass). */
  readonly tier: string;
  /** "HIGHER_SKILLED" / "BASIC_SKILLED" / … (null for S Pass). */
  readonly skill: string | null;
  /** Pass issue date (levy liability starts on issue). */
  readonly passIssuedOn: IsoDate;
  /** Pass end: levy runs until 1 day before cancellation, or through the expiry date. */
  readonly passEnds?: { readonly date: IsoDate; readonly reason: "CANCELLED" | "EXPIRED" };
  /** Days in the month covered by an approved levy waiver. */
  readonly waiverDays?: number;
}

export interface LevyEstimate {
  /** Always "ESTIMATE": the MOM levy bill is authoritative. */
  readonly basis: "ESTIMATE";
  readonly label: string;
  readonly estimateCents: Cents;
  readonly liableDays: number;
  readonly fullMonth: boolean;
  readonly rate: FwlRate;
  readonly working: readonly WorkingStep[];
  readonly issues: readonly RuleIssue[];
}

/**
 * Estimate of the monthly levy for one pass holder, for cost reports and GL accruals only.
 * Full months use the monthly rate; part months use MOM's daily rate, ceil(monthly × 12 / 365) per day.
 */
export function estimateLevy(input: LevyEstimateInput): LevyEstimate {
  const { y, m } = parseMonth(input.month, "month");
  parseDate(input.passIssuedOn, "passIssuedOn");
  const monthStart = `${input.month}-01`;
  const monthEnd = `${input.month}-${String(daysInMonth(y, m)).padStart(2, "0")}`;
  const rate = FWL_RATES.find(
    (r) =>
      r.pass === input.pass &&
      r.sector === input.sector &&
      r.tier === input.tier &&
      r.skill === input.skill &&
      isInForce(r, monthStart),
  );
  if (!rate) {
    throw new RulesNotAvailableError(
      `No levy rate encoded for ${input.pass} ${input.sector} ${input.tier} ${input.skill ?? ""} in ${input.month}.`,
    );
  }
  let lastLiable: IsoDate = monthEnd;
  if (input.passEnds) {
    parseDate(input.passEnds.date, "passEnds.date");
    const end = input.passEnds.reason === "CANCELLED" ? addDays(input.passEnds.date, -1) : input.passEnds.date;
    if (end < lastLiable) lastLiable = end;
  }
  const firstLiableDay = Math.max(epochDay(input.passIssuedOn), epochDay(monthStart));
  const waiver = input.waiverDays ?? 0;
  if (!Number.isInteger(waiver) || waiver < 0)
    throw new SgRulesInputError("waiverDays must be a non-negative whole number.");
  const spanDays = Math.max(0, epochDay(lastLiable) - firstLiableDay + 1);
  const liableDays = Math.max(0, spanDays - waiver);
  const fullMonth = liableDays === daysInMonth(y, m);
  const daily = ceilToCent(exactCents(rate.monthlyCents * 12, 365));
  const estimateCents = fullMonth ? rate.monthlyCents : daily * liableDays;
  const issues: RuleIssue[] = [
    {
      code: "FWL_ESTIMATE_ONLY",
      severity: "info",
      message:
        "Estimate only: MOM's levy bill is authoritative. The levy is an employer cost and must not be deducted from salary.",
      source: FWL_NO_DEDUCTION_SOURCE,
    },
  ];
  if (!fullMonth && liableDays > 0) {
    issues.push({
      code: "FWL_PART_MONTH_DAY_COUNT",
      severity: "info",
      message:
        "Part-month day counting (issue day inclusive; until 1 day before cancellation; expiry day inclusive) follows MOM's wording but is not fully specified; reconcile with the MOM bill.",
      source: FWL_DAILY_RATE_SOURCE,
    });
  }
  return {
    basis: "ESTIMATE",
    label: "Estimate — MOM levy bill is authoritative",
    estimateCents,
    liableDays,
    fullMonth,
    rate,
    working: [
      {
        code: "FWL_ESTIMATE",
        text: fullMonth
          ? `Full month liable → monthly levy ${money(rate.monthlyCents)}.`
          : `${liableDays} liable day(s) × daily rate ${money(daily)} (ceil(${money(rate.monthlyCents)} × 12 / 365)) = ${money(estimateCents)}.`,
      },
    ],
    issues,
  };
}
