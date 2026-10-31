import { SgRulesInputError } from "../errors.ts";
import { addMonths, monthIndex, monthLabel, parseDate, parseMonth } from "../internal/dates.ts";
import {
  add,
  bps,
  type ExactCents,
  exactDollarsText,
  exactToString,
  floorToDollar,
  roundHalfUpToDollar,
  ZERO,
} from "../internal/exact.ts";
import { assertCents, coefficient, money, pct } from "../internal/money.ts";
import {
  CPF_ANNUAL_SALARY_CEILINGS,
  CPF_AW_CEILING_SOURCE,
  CPF_OW_CEILINGS,
  CPF_RATES_PUBLISHED_UNTIL,
  CPF_SPR_SOURCE,
  CPF_WAGE_BAND_THRESHOLDS,
  type CpfAgeBand,
  type CpfAgeRow,
  type CpfRateTable,
  type CpfResidencyCategory,
} from "../tables/cpf.ts";
import { pickInForce } from "../tables/effective.ts";
import { cpfTableFor } from "../tables/index.ts";
import type { Cents, IsoDate, RuleIssue, WorkingStep, YearMonth } from "../types.ts";
import { type CpfResidency, cpfAgeBand, nextAgeBandChange, resolveResidency, sprYear } from "./residency.ts";

export type CpfWageBand = "NIL" | "EMPLOYER_ONLY" | "PHASE_IN" | "FULL";

/**
 * One AW payment earlier in the same calendar year with the same employer. The payroll module
 * persists these (from `yearToDateAfter.awPayments`) and passes them back every month.
 */
export interface CpfAwPayment {
  /** Contribution month in which the AW was due and payable (keys its rate table and ceiling year). */
  readonly payableMonth: YearMonth;
  /** CPF-liable OW of that month before the OW ceiling (selects that month's wage band). */
  readonly owCents: Cents;
  /** CPF-liable AW due and payable that month, before the AW ceiling. */
  readonly awPayableCents: Cents;
  /** Portion of it subjected to CPF so far (after any earlier recomputation). */
  readonly awSubjectCents: Cents;
  /** Residency in that month if it differs from the current input (e.g. SPR who became SC). */
  readonly residency?: CpfResidency;
}

export interface CpfYearToDate {
  /** OW subject to CPF (after the OW ceiling) in earlier months of this calendar year, this employer. */
  readonly owSubjectCents: Cents;
  /** Every earlier AW payment of this calendar year, this employer. */
  readonly awPayments: readonly CpfAwPayment[];
}

export interface CpfMonthInput {
  /** Month the OW was earned and the AW became due and payable. */
  readonly contributionMonth: YearMonth;
  readonly birthDate: IsoDate;
  readonly residency: CpfResidency;
  /**
   * CPF-liable ordinary wages for the month, before the OW ceiling. In an SPR conversion month pass
   * only the OW for days from the SPR date. The caller classifies pay items (OW vs AW, CPF-able).
   */
  readonly owCents: Cents;
  /** CPF-liable additional wages due and payable this month, before the AW ceiling. */
  readonly awCents: Cents;
  readonly yearToDate: CpfYearToDate;
  /** Last month of employment, if known (past, current or future). Drives the AW ceiling basis. */
  readonly employment?: { readonly lastMonth?: YearMonth };
  /**
   * Overrides for the AW-ceiling estimate. `annualOwSubjectCents` replaces the computed annual OW;
   * `projectedMonthlyOwCents` replaces "this month's OW subject" as the projection for later months
   * (use it when this month is pro-rated, e.g. a mid-month joiner).
   */
  readonly awCeilingEstimate?: { readonly annualOwSubjectCents?: Cents; readonly projectedMonthlyOwCents?: Cents };
}

export interface CpfRateTableRef {
  readonly id: string;
  readonly publishedTableNo: number;
  readonly effectiveFrom: IsoDate;
  readonly source: string;
}

export interface CpfAwCeiling {
  /** ESTIMATE: projected OW for the rest of the year. ACTUAL: December or last month of employment (or later). */
  readonly basis: "ESTIMATE" | "ACTUAL" | "OVERRIDE";
  readonly annualOwSubjectCents: Cents;
  /** Annual AW ceiling = Annual Salary Ceiling − annual OW subject (never negative). */
  readonly annualAwCeilingCents: Cents;
  /** Headroom left for this month's AW after earlier AW (as re-allocated). */
  readonly headroomBeforeCents: Cents;
  readonly headroomAfterCents: Cents;
}

export interface CpfAwAdjustmentLine {
  readonly payableMonth: YearMonth;
  /** Positive: newly subjected (shortfall). Negative: no longer subject (excess). */
  readonly deltaCents: Cents;
  readonly rateTableId: string;
  readonly ageBand: CpfAgeBand;
  readonly totalRateBps: number;
  readonly employeeRateBps: number;
}

export interface CpfAwAdjustment {
  /** AW amount re-subjected (shortfall) or released (excess), positive. */
  readonly awCents: Cents;
  readonly totalCents: Cents;
  readonly employeeCents: Cents;
  readonly employerCents: Cents;
  readonly lines: readonly CpfAwAdjustmentLine[];
}

interface CpfCommon {
  readonly contributionMonth: YearMonth;
  readonly working: readonly WorkingStep[];
  readonly issues: readonly RuleIssue[];
}

export interface CpfMonthResult extends CpfCommon {
  readonly ok: true;
  readonly residencyCategory: CpfResidencyCategory | "FOREIGNER";
  readonly ageBand: CpfAgeBand | null;
  readonly rateTable: CpfRateTableRef | null;
  /** True after the last published CPF tables: the latest tables are carried forward. */
  readonly ratesAssumedCarriedForward: boolean;
  readonly wageBand: CpfWageBand | null;
  /** OW + AW before ceilings: selects the wage band. */
  readonly bandWagesCents: Cents;
  readonly owSubjectCents: Cents;
  readonly awSubjectCents: Cents;
  readonly awNotSubjectCents: Cents;
  readonly awCeiling: CpfAwCeiling | null;
  /** This month's contribution on this month's OW and AW (whole dollars). */
  readonly totalCents: Cents;
  readonly employeeCents: Cents;
  readonly employerCents: Cents;
  /** Exact unrounded amounts in cents as "n/d" strings, for audit. */
  readonly exact: { readonly totalCents: string; readonly employeeCents: string };
  /**
   * Re-subjection of earlier AW after the AW ceiling was re-estimated or recomputed, at the rates of
   * the months the AW was payable. A shortfall is paid with this month's contributions as a separate
   * amount; an excess is refunded by CPF on application and is never netted against this month.
   */
  readonly priorAw: { readonly shortfall: CpfAwAdjustment | null; readonly excess: CpfAwAdjustment | null };
  /** State to persist and pass as `yearToDate` next month (same calendar year). */
  readonly yearToDateAfter: CpfYearToDate;
}

export interface CpfBlockedResult extends CpfCommon {
  readonly ok: false;
  readonly blockingIssues: readonly RuleIssue[];
}

interface RateContext {
  readonly category: CpfResidencyCategory;
  readonly ageBand: CpfAgeBand;
  readonly table: CpfRateTable;
  readonly row: CpfAgeRow;
}

function rateContext(birthDate: IsoDate, residency: CpfResidency, month: YearMonth): RateContext | null {
  const res = resolveResidency(residency, month);
  if (res.category === "FOREIGNER") return null;
  const ageBand = cpfAgeBand(birthDate, month);
  const table = cpfTableFor(res.category, `${month}-01`);
  return { category: res.category, ageBand, table, row: table.rows[ageBand] };
}

export function cpfWageBand(totalWagesCents: Cents): CpfWageBand {
  const t = CPF_WAGE_BAND_THRESHOLDS;
  if (totalWagesCents <= t.nilUpToCents) return "NIL";
  if (totalWagesCents <= t.employerOnlyUpToCents) return "EMPLOYER_ONLY";
  if (totalWagesCents <= t.phaseInUpToCents) return "PHASE_IN";
  return "FULL";
}

/** Marginal total and employee rates (bps) of a wage band; used for AW adjustments. */
function marginalRates(row: CpfAgeRow, band: CpfWageBand): { total: number; employee: number } {
  switch (band) {
    case "FULL":
      return { total: row.totalBps, employee: row.employeeBps };
    case "PHASE_IN":
      return { total: row.employerOnlyBps + row.phaseInCoefficientBps, employee: row.phaseInCoefficientBps };
    case "EMPLOYER_ONLY":
      return { total: row.employerOnlyBps, employee: 0 };
    default:
      return { total: 0, employee: 0 };
  }
}

function exactContribution(
  row: CpfAgeRow,
  band: CpfWageBand,
  twCents: Cents,
): { total: ExactCents; employee: ExactCents } {
  const base = CPF_WAGE_BAND_THRESHOLDS.phaseInBaseCents;
  switch (band) {
    case "FULL":
      return { total: bps(twCents, row.totalBps), employee: bps(twCents, row.employeeBps) };
    case "PHASE_IN": {
      const employee = bps(twCents - base, row.phaseInCoefficientBps);
      return { total: add(bps(twCents, row.employerOnlyBps), employee), employee };
    }
    case "EMPLOYER_ONLY":
      return { total: bps(twCents, row.employerOnlyBps), employee: ZERO };
    default:
      return { total: ZERO, employee: ZERO };
  }
}

const AGE_LABEL: Record<CpfAgeBand, string> = {
  AGE_55_AND_BELOW: "55 and below",
  ABOVE_55_TO_60: "above 55 to 60",
  ABOVE_60_TO_65: "above 60 to 65",
  ABOVE_65_TO_70: "above 65 to 70",
  ABOVE_70: "above 70",
};

export function cpfAgeBandLabel(band: CpfAgeBand): string {
  return AGE_LABEL[band];
}

const tableRef = (t: CpfRateTable): CpfRateTableRef => ({
  id: t.id,
  publishedTableNo: t.publishedTableNo,
  effectiveFrom: t.effectiveFrom,
  source: t.source,
});

/** Annual AW ceiling = Annual Salary Ceiling − OW subject to CPF for the year, floored at 0. */
export function annualAwCeiling(year: number, annualOwSubjectCents: Cents): Cents {
  assertCents(annualOwSubjectCents, "annualOwSubjectCents");
  const ceiling = pickInForce(CPF_ANNUAL_SALARY_CEILINGS, `${year}-01-01`, "CPF Annual Salary Ceiling");
  return Math.max(0, ceiling.annualCents - annualOwSubjectCents);
}

export interface AwReconciliationInput {
  readonly birthDate: IsoDate;
  readonly residency: CpfResidency;
  /** Annual AW ceiling to allocate (from `annualAwCeiling`). */
  readonly annualAwCeilingCents: Cents;
  /** Earlier AW payments of the year, any order; allocated chronologically by payable month. */
  readonly awPayments: readonly CpfAwPayment[];
}

export interface AwReconciliation {
  readonly payments: readonly CpfAwPayment[];
  readonly subjectTotalCents: Cents;
  readonly shortfall: CpfAwAdjustment | null;
  readonly excess: CpfAwAdjustment | null;
  readonly blockingIssues: readonly RuleIssue[];
  readonly working: readonly WorkingStep[];
}

function adjustment(lines: CpfAwAdjustmentLine[]): CpfAwAdjustment | null {
  if (lines.length === 0) return null;
  let total = ZERO;
  let employee = ZERO;
  let aw = 0;
  for (const l of lines) {
    const d = Math.abs(l.deltaCents);
    aw += d;
    total = add(total, bps(d, l.totalRateBps));
    employee = add(employee, bps(d, l.employeeRateBps));
  }
  // CPF rounds the combined exact amount once even when lines use different rate tables (AW Ex. 14).
  const totalCents = roundHalfUpToDollar(total);
  const employeeCents = floorToDollar(employee);
  return { awCents: aw, totalCents, employeeCents, employerCents: totalCents - employeeCents, lines };
}

/**
 * Re-allocates the annual AW ceiling over earlier AW payments in chronological order, so earlier AW
 * is subjected first and keeps the rates of the month it was payable (CPF AW examples 9, 11, 13, 14).
 */
export function reconcileAdditionalWages(input: AwReconciliationInput): AwReconciliation {
  assertCents(input.annualAwCeilingCents, "annualAwCeilingCents");
  const sorted = [...input.awPayments].sort((a, b) => monthIndex(a.payableMonth) - monthIndex(b.payableMonth));
  let remaining = input.annualAwCeilingCents;
  const shortfall: CpfAwAdjustmentLine[] = [];
  const excess: CpfAwAdjustmentLine[] = [];
  const blockingIssues: RuleIssue[] = [];
  const working: WorkingStep[] = [];
  const payments = sorted.map((p) => {
    const revised = Math.min(p.awPayableCents, Math.max(0, remaining));
    remaining -= revised;
    const delta = revised - p.awSubjectCents;
    if (delta !== 0) {
      const ctx = rateContext(input.birthDate, p.residency ?? input.residency, p.payableMonth);
      if (ctx === null) {
        throw new SgRulesInputError(`AW payment of ${p.payableMonth} is recorded for a month with no CPF liability.`);
      }
      const band = cpfWageBand(p.owCents + p.awPayableCents);
      if (band !== "FULL") {
        blockingIssues.push(lowWageCappedAwIssue(p.payableMonth));
      }
      const rates = marginalRates(ctx.row, band);
      const line: CpfAwAdjustmentLine = {
        payableMonth: p.payableMonth,
        deltaCents: delta,
        rateTableId: ctx.table.id,
        ageBand: ctx.ageBand,
        totalRateBps: rates.total,
        employeeRateBps: rates.employee,
      };
      (delta > 0 ? shortfall : excess).push(line);
      working.push({
        code: delta > 0 ? "CPF_AW_SHORTFALL_LINE" : "CPF_AW_EXCESS_LINE",
        text: `AW payable ${monthLabel(p.payableMonth)} (${money(p.awPayableCents)}): subject amount ${money(p.awSubjectCents)} → ${money(revised)}, ${delta > 0 ? "a further" : "a reduction of"} ${money(Math.abs(delta))} at that month's rates (${pct(rates.total)} total, ${pct(rates.employee)} employee, ${ctx.table.id}, age ${AGE_LABEL[ctx.ageBand]}).`,
      });
    }
    return { ...p, awSubjectCents: revised };
  });
  const s = adjustment(shortfall);
  const x = adjustment(excess);
  if (s) {
    working.push({
      code: "CPF_AW_SHORTFALL",
      text: `CPF shortfall on earlier AW: ${money(s.awCents)} newly subject → total ${money(s.totalCents)}, employee ${money(s.employeeCents)}, employer ${money(s.employerCents)} (exact amounts summed, then total rounded to the nearest dollar and employee share rounded down).`,
    });
  }
  if (x) {
    working.push({
      code: "CPF_AW_EXCESS",
      text: `Excess CPF on earlier AW: ${money(x.awCents)} no longer subject → indicative refund total ${money(x.totalCents)} (employee ${money(x.employeeCents)}, employer ${money(x.employerCents)}). Apply to CPF Board for the refund; it is not netted against this month.`,
    });
  }
  return {
    payments,
    subjectTotalCents: payments.reduce((sum, p) => sum + p.awSubjectCents, 0),
    shortfall: s,
    excess: x,
    blockingIssues,
    working,
  };
}

function lowWageCappedAwIssue(month: YearMonth): RuleIssue {
  return {
    code: "CPF_LOW_WAGE_CAPPED_AW_UNSUPPORTED",
    severity: "blocking",
    message: `${monthLabel(month)}: total wages before the AW ceiling are $750 or less, but part of the AW is above the AW ceiling. CPF publishes no rule for this combination (its example 16 covers only total wages above $750), and applying the band formula to the capped wages can produce a negative contribution. Confirm the amount with CPF Board and enter it manually.`,
    source: CPF_AW_CEILING_SOURCE,
  };
}

function validate(input: CpfMonthInput): void {
  const { y } = parseMonth(input.contributionMonth, "contributionMonth");
  parseDate(input.birthDate, "birthDate");
  assertCents(input.owCents, "owCents");
  assertCents(input.awCents, "awCents");
  assertCents(input.yearToDate.owSubjectCents, "yearToDate.owSubjectCents");
  if (input.employment?.lastMonth !== undefined) parseMonth(input.employment.lastMonth, "employment.lastMonth");
  const est = input.awCeilingEstimate;
  if (est?.annualOwSubjectCents !== undefined)
    assertCents(est.annualOwSubjectCents, "awCeilingEstimate.annualOwSubjectCents");
  if (est?.projectedMonthlyOwCents !== undefined) {
    assertCents(est.projectedMonthlyOwCents, "awCeilingEstimate.projectedMonthlyOwCents");
  }
  const current = monthIndex(input.contributionMonth);
  for (const p of input.yearToDate.awPayments) {
    const pm = parseMonth(p.payableMonth, "awPayments[].payableMonth");
    if (pm.y !== y || monthIndex(p.payableMonth) >= current) {
      throw new SgRulesInputError(
        `yearToDate.awPayments must be earlier months of ${y}; got ${p.payableMonth}. Start a new year with empty year-to-date state.`,
      );
    }
    assertCents(p.owCents, "awPayments[].owCents");
    assertCents(p.awPayableCents, "awPayments[].awPayableCents");
    assertCents(p.awSubjectCents, "awPayments[].awSubjectCents");
    if (p.awSubjectCents > p.awPayableCents) {
      throw new SgRulesInputError(`AW payment of ${p.payableMonth}: subject amount exceeds the AW payable.`);
    }
  }
}

/**
 * CPF contribution for one employee, one employer, one contribution month.
 *
 * Rounding (every CPF table PDF): total = exact amount rounded to the nearest dollar (cents < 50
 * dropped, ≥ 50 rounded up, judged on the exact value); employee share = rounded down to the dollar;
 * employer = total − employee. OW and AW of the month are summed before rounding.
 */
export function computeCpf(input: CpfMonthInput): CpfMonthResult | CpfBlockedResult {
  validate(input);
  const month = input.contributionMonth;
  const { y, m } = parseMonth(month);
  const monthStart = `${month}-01`;
  const working: WorkingStep[] = [];
  const issues: RuleIssue[] = [];
  const residency = resolveResidency(input.residency, month);
  const ratesAssumedCarriedForward = monthStart >= CPF_RATES_PUBLISHED_UNTIL;

  if (residency.category === "FOREIGNER") {
    working.push({
      code: "CPF_NOT_LIABLE",
      text: `No CPF: ${residency.explanation}. CPF applies only to Singapore Citizens and SPRs.`,
    });
    return {
      ok: true,
      contributionMonth: month,
      residencyCategory: "FOREIGNER",
      ageBand: null,
      rateTable: null,
      ratesAssumedCarriedForward: false,
      wageBand: null,
      bandWagesCents: input.owCents + input.awCents,
      owSubjectCents: 0,
      awSubjectCents: 0,
      awNotSubjectCents: 0,
      awCeiling: null,
      totalCents: 0,
      employeeCents: 0,
      employerCents: 0,
      exact: { totalCents: "0", employeeCents: "0" },
      priorAw: { shortfall: null, excess: null },
      yearToDateAfter: input.yearToDate,
      working,
      issues,
    };
  }

  const ctx = rateContext(input.birthDate, input.residency, month) as RateContext;
  const { row, table, ageBand } = ctx;
  working.push({
    code: "CPF_RATE_TABLE",
    text: `${monthLabel(month)}: ${residency.explanation}; age band ${AGE_LABEL[ageBand]} → ${table.id} (CPF Table ${table.publishedTableNo}).`,
  });
  if (ratesAssumedCarriedForward) {
    issues.push({
      code: "CPF_RATES_ASSUMED_CARRIED_FORWARD",
      severity: "warning",
      message: `CPF has not published rate tables for ${y} in the encoded data; the latest published tables (${table.id}) are carried forward. Update sg-rules when CPF publishes ${y} rates.`,
      source: table.source,
    });
  }
  if (residency.conversionMonth && input.residency.status === "SPR" && parseDate(input.residency.sprDate).d > 1) {
    issues.push({
      code: "CPF_SPR_CONVERSION_MONTH",
      severity: "info",
      message: `SPR status starts ${input.residency.sprDate}: only OW for days from that date and AW payable on or after it are CPF wages. owCents/awCents must contain only those amounts.`,
      source: CPF_SPR_SOURCE,
    });
  }
  const nextBand = nextAgeBandChange(input.birthDate, month);
  if (nextBand && monthIndex(nextBand.month) === monthIndex(month) + 1) {
    issues.push({
      code: "CPF_AGE_BAND_CHANGES_NEXT_MONTH",
      severity: "info",
      message: `From ${monthLabel(nextBand.month)} the age band becomes ${AGE_LABEL[nextBand.band]} (month after the birthday milestone).`,
    });
  }
  if (input.residency.status === "SPR" && residency.sprYear !== null && residency.sprYear < 3) {
    const nextMonth = addMonths(month, 1);
    if (sprYear(input.residency.sprDate, nextMonth) !== residency.sprYear) {
      issues.push({
        code: "CPF_SPR_YEAR_CHANGES_NEXT_MONTH",
        severity: "info",
        message: `SPR year ${residency.sprYear} ends this month; ${monthLabel(nextMonth)} uses SPR year ${residency.sprYear + 1} rates.`,
        source: CPF_SPR_SOURCE,
      });
    }
  }

  // Ordinary wages and the OW ceiling.
  const owCeiling = pickInForce(CPF_OW_CEILINGS, monthStart, "CPF OW ceiling").monthlyCents;
  const owSubject = Math.min(input.owCents, owCeiling);
  working.push({
    code: "CPF_OW_CEILING",
    text:
      input.owCents > owCeiling
        ? `OW ${money(input.owCents)} capped at the OW ceiling ${money(owCeiling)} → OW subject to CPF ${money(owSubject)}.`
        : `OW ${money(input.owCents)} is within the OW ceiling ${money(owCeiling)} → OW subject to CPF ${money(owSubject)}.`,
  });

  // AW ceiling: estimate at each AW payment, actual in December / last month of employment / after leaving.
  const lastMonth = input.employment?.lastMonth;
  const actualMonth = m === 12 || (lastMonth !== undefined && monthIndex(month) >= monthIndex(lastMonth));
  let basis: CpfAwCeiling["basis"];
  let annualOw: number;
  let annualOwText: string;
  const ytdOw = input.yearToDate.owSubjectCents;
  if (input.awCeilingEstimate?.annualOwSubjectCents !== undefined) {
    basis = "OVERRIDE";
    annualOw = input.awCeilingEstimate.annualOwSubjectCents;
    annualOwText = `${money(annualOw)} OW subject for ${y} (supplied)`;
  } else if (actualMonth) {
    basis = "ACTUAL";
    annualOw = ytdOw + owSubject;
    annualOwText = `${money(annualOw)} actual OW subject for ${y} (${money(ytdOw)} earlier + ${money(owSubject)} this month)`;
  } else {
    basis = "ESTIMATE";
    const endIndex = lastMonth !== undefined && parseMonth(lastMonth).y === y ? monthIndex(lastMonth) : y * 12 + 11;
    const remaining = endIndex - monthIndex(month);
    const projected = Math.min(input.awCeilingEstimate?.projectedMonthlyOwCents ?? owSubject, owCeiling);
    annualOw = ytdOw + owSubject + projected * remaining;
    annualOwText = `${money(annualOw)} estimated OW subject for ${y} (${money(ytdOw)} earlier + ${money(owSubject)} this month + ${remaining} × ${money(projected)} projected)`;
  }
  const annualCeiling = pickInForce(CPF_ANNUAL_SALARY_CEILINGS, monthStart, "CPF Annual Salary Ceiling").annualCents;
  const awCeilingCents = annualAwCeiling(y, annualOw);
  working.push({
    code: "CPF_AW_CEILING",
    text: `AW ceiling (${basis.toLowerCase()}): ${money(annualCeiling)} − ${annualOwText} = ${money(awCeilingCents)}.`,
  });

  // Re-allocate earlier AW when AW is paid (Step 1) or in the actual month (Step 2).
  const reconcile = input.awCents > 0 || actualMonth;
  const rec = reconcile
    ? reconcileAdditionalWages({
        birthDate: input.birthDate,
        residency: input.residency,
        annualAwCeilingCents: awCeilingCents,
        awPayments: input.yearToDate.awPayments,
      })
    : null;
  if (rec) working.push(...rec.working);
  const payments = rec ? rec.payments : input.yearToDate.awPayments;
  const usedBefore = payments.reduce((sum, p) => sum + p.awSubjectCents, 0);
  const headroomBefore = Math.max(0, awCeilingCents - usedBefore);
  const awSubject = Math.min(input.awCents, headroomBefore);
  if (input.awCents > 0) {
    working.push({
      code: "CPF_AW_SUBJECT",
      text: `AW headroom ${money(awCeilingCents)} − ${money(usedBefore)} already subject = ${money(headroomBefore)}; AW ${money(input.awCents)} → ${money(awSubject)} subject to CPF${input.awCents > awSubject ? `, ${money(input.awCents - awSubject)} above the AW ceiling` : ""}.`,
    });
  }
  if (rec?.excess) {
    issues.push({
      code: "CPF_AW_EXCESS_REFUND",
      severity: "warning",
      message: `CPF already paid on ${money(rec.excess.awCents)} of earlier AW now exceeds the AW ceiling. Apply to CPF Board for a refund of the excess; do not deduct or net it in payroll.`,
      source: CPF_AW_CEILING_SOURCE,
    });
  }

  // Wage band on total wages before AW capping (CPF AW example 16).
  const bandWages = input.owCents + input.awCents;
  const band = cpfWageBand(bandWages);
  const subjectWages = owSubject + awSubject;
  const bandText = {
    NIL: "$50 or less → no CPF",
    EMPLOYER_ONLY: "> $50 to $500 → employer share only",
    PHASE_IN: "> $500 to $750 → phase-in",
    FULL: "> $750 → full rates",
  }[band];
  working.push({
    code: "CPF_WAGE_BAND",
    text: `Total wages for the month before ceilings ${money(bandWages)}: ${bandText}.`,
  });

  const blockingIssues: RuleIssue[] = [...(rec?.blockingIssues ?? [])];
  if (band !== "FULL" && band !== "NIL" && awSubject < input.awCents) blockingIssues.push(lowWageCappedAwIssue(month));
  if (blockingIssues.length > 0) {
    return { ok: false, contributionMonth: month, blockingIssues, working, issues: [...issues, ...blockingIssues] };
  }

  const exact = exactContribution(row, band, subjectWages);
  const totalCents = roundHalfUpToDollar(exact.total);
  const employeeCents = floorToDollar(exact.employee);
  const employerCents = totalCents - employeeCents;
  const wagesText = awSubject > 0 ? `(${money(owSubject)} + ${money(awSubject)})` : money(subjectWages);
  switch (band) {
    case "FULL":
      working.push({
        code: "CPF_TOTAL",
        text: `Total = ${pct(row.totalBps)} × ${wagesText} = $${exactDollarsText(exact.total)} → rounded to the nearest dollar ${money(totalCents)}.`,
      });
      working.push({
        code: "CPF_EMPLOYEE",
        text: `Employee = ${pct(row.employeeBps)} × ${wagesText} = $${exactDollarsText(exact.employee)} → rounded down to ${money(employeeCents)}.`,
      });
      break;
    case "PHASE_IN":
      working.push({
        code: "CPF_TOTAL",
        text: `Total = ${pct(row.employerOnlyBps)} × ${money(subjectWages)} + ${coefficient(row.phaseInCoefficientBps)} × (${money(subjectWages)} − $500.00) = $${exactDollarsText(exact.total)} → rounded to the nearest dollar ${money(totalCents)}.`,
      });
      working.push({
        code: "CPF_EMPLOYEE",
        text: `Employee = ${coefficient(row.phaseInCoefficientBps)} × (${money(subjectWages)} − $500.00) = $${exactDollarsText(exact.employee)} → rounded down to ${money(employeeCents)}.`,
      });
      break;
    case "EMPLOYER_ONLY":
      working.push({
        code: "CPF_TOTAL",
        text: `Total = ${pct(row.employerOnlyBps)} × ${money(subjectWages)} = $${exactDollarsText(exact.total)} → rounded to the nearest dollar ${money(totalCents)}.`,
      });
      working.push({
        code: "CPF_EMPLOYEE",
        text: "Employee = $0.00: nothing may be deducted from an employee earning $500 or less.",
      });
      break;
    default:
      working.push({ code: "CPF_TOTAL", text: "Total = $0.00." });
  }
  working.push({
    code: "CPF_EMPLOYER",
    text: `Employer = total − employee = ${money(totalCents)} − ${money(employeeCents)} = ${money(employerCents)}.`,
  });

  const newPayments: CpfAwPayment[] = [...payments];
  if (input.awCents > 0) {
    newPayments.push({
      payableMonth: month,
      owCents: input.owCents,
      awPayableCents: input.awCents,
      awSubjectCents: awSubject,
    });
  }
  return {
    ok: true,
    contributionMonth: month,
    residencyCategory: ctx.category,
    ageBand,
    rateTable: tableRef(table),
    ratesAssumedCarriedForward,
    wageBand: band,
    bandWagesCents: bandWages,
    owSubjectCents: owSubject,
    awSubjectCents: awSubject,
    awNotSubjectCents: input.awCents - awSubject,
    awCeiling: {
      basis,
      annualOwSubjectCents: annualOw,
      annualAwCeilingCents: awCeilingCents,
      headroomBeforeCents: headroomBefore,
      headroomAfterCents: headroomBefore - awSubject,
    },
    totalCents,
    employeeCents,
    employerCents,
    exact: { totalCents: exactToString(exact.total), employeeCents: exactToString(exact.employee) },
    priorAw: { shortfall: rec?.shortfall ?? null, excess: rec?.excess ?? null },
    yearToDateAfter: { owSubjectCents: ytdOw + owSubject, awPayments: newPayments },
    working,
    issues,
  };
}

/** Difference between a recomputed month and what was originally computed (for corrections). */
export function diffCpf(
  original: CpfMonthResult,
  revised: CpfMonthResult,
): { totalCents: Cents; employeeCents: Cents; employerCents: Cents; issues: RuleIssue[] } {
  const d = {
    totalCents: revised.totalCents - original.totalCents,
    employeeCents: revised.employeeCents - original.employeeCents,
    employerCents: revised.employerCents - original.employerCents,
  };
  const issues: RuleIssue[] = [];
  if (d.totalCents < 0 || d.employeeCents < 0 || d.employerCents < 0) {
    issues.push({
      code: "CPF_CORRECTION_OVERPAID",
      severity: "warning",
      message:
        "The corrected month needs less CPF than was paid. Apply to CPF Board for a refund; recovering an over-deducted employee share from later wages needs review (CPF Act s 7 not verified).",
      source: "https://www.cpf.gov.sg/service/sfc/servlet.shepherd/version/download/068IW000003YkZlYAK",
    });
  }
  if (d.employeeCents > 0) {
    issues.push({
      code: "CPF_CORRECTION_EMPLOYEE_SHORTFALL",
      severity: "warning",
      message:
        "The corrected month needs more employee CPF. Whether the employer may recover the employee share from later wages is not verified; get review before deducting it.",
    });
  }
  return { ...d, issues };
}
