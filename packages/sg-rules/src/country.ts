/**
 * Country abstraction the payroll module depends on. A country package (this one for SG; a future
 * `my-rules` for Malaysia) turns one employee-month of classified pay into statutory lines, and
 * aggregates the employer-level amounts. Payroll stores the opaque per-employee state it returns.
 */

import type { Cents, IsoDate, RuleIssue, WorkingStep } from "./types.ts";

/** ISO 3166-1 alpha-2 country code. */
export type CountryCode = string;

export interface StatutoryLine {
  /** Stable code, e.g. "CPF_EMPLOYEE", "SHG_CDAC", "SDL". */
  readonly code: string;
  readonly label: string;
  /** EMPLOYEE lines are deducted from pay; EMPLOYER lines are employer cost. */
  readonly payer: "EMPLOYEE" | "EMPLOYER";
  readonly amountCents: Cents;
  /** Who the amount is remitted to, e.g. "CPF Board". */
  readonly remitTo: string;
}

export interface EmployeeMonthOutcome<TState> {
  /** False when a rule could not be applied safely (see `issues` with severity "blocking"). */
  readonly ok: boolean;
  readonly lines: readonly StatutoryLine[];
  readonly working: readonly WorkingStep[];
  readonly issues: readonly RuleIssue[];
  /** State to persist and pass back next month. Unchanged when `ok` is false. */
  readonly stateAfter: TState;
}

export interface EmployerMonthOutcome {
  readonly lines: readonly StatutoryLine[];
  readonly working: readonly WorkingStep[];
}

export interface CountryRules<TInput, TState, TOutcome extends EmployeeMonthOutcome<TState>> {
  readonly country: CountryCode;
  readonly name: string;
  /** ISO 4217; all amounts are integer minor units. */
  readonly currency: string;
  /** First date with a complete cited rule set, and when the data was last verified. */
  readonly coverage: { readonly from: IsoDate; readonly verifiedOn: IsoDate };
  /** Per-employee state at the start of a calendar year with an employer. */
  initialState(): TState;
  computeEmployeeMonth(input: TInput): TOutcome;
  /** Employer-level amounts rounded across employees (e.g. Singapore SDL). */
  computeEmployerMonth(outcomes: readonly TOutcome[]): EmployerMonthOutcome;
}
