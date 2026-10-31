/** ISO calendar date, `YYYY-MM-DD`. */
export type IsoDate = string;

/** Calendar month, `YYYY-MM`. */
export type YearMonth = string;

/** Integer cents (SGD). Always a safe integer. */
export type Cents = number;

/** One human-readable line of how a number was worked out, for payslips and audit. */
export interface WorkingStep {
  /** Stable machine code, e.g. `CPF_WAGE_BAND`. */
  readonly code: string;
  /** Plain-English explanation with the actual numbers. */
  readonly text: string;
}

export type IssueSeverity = "info" | "warning" | "blocking";

/**
 * Something the payroll user should know about. `blocking` means the engine refused to produce
 * an amount because the rule for the case is not established; a human must decide.
 */
export interface RuleIssue {
  readonly code: string;
  readonly severity: IssueSeverity;
  readonly message: string;
  readonly source?: string;
}
