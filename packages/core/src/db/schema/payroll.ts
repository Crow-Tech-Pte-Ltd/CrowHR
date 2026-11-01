import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type { PayInput, PayIssue, PayResult, RunItemKind, WageClass } from "../../payroll/engine/types.ts";
import type { DeductionCategory } from "../../payroll/rules.ts";
import { allowanceTypes, employees } from "./employees.ts";
import { organisations } from "./organisations.ts";

/**
 * Payroll (add-payroll). Conventions as in `organisation.ts`: org_id everywhere, `unique (org_id, id)`
 * on every table, composite foreign keys between tenant tables, money as bigint cents.
 *
 * Runs are never rewritten after approval: a correction is a new `adjustment` run, and the original
 * only gains `superseded_by_run_id` when the adjustment is approved.
 */

const orgId = () =>
  uuid("org_id")
    .notNull()
    .references(() => organisations.id, { onDelete: "cascade" });

const cents = (name: string) => bigint(name, { mode: "number" });

/** One row per organisation. */
export const payrollSettings = pgTable("payroll_settings", {
  orgId: uuid("org_id")
    .primaryKey()
    .references(() => organisations.id, { onDelete: "cascade" }),
  /** Day of the month salary is paid (1–31, clamped to the month's last day); null = last day of the period. */
  payDay: smallint("pay_day"),
  /** Day of the month inputs close (reminder to payroll admins 3 days before); null = the pay date. */
  cutoffDay: smallint("cutoff_day"),
  /** Release payslips to employees as soon as a run is approved. */
  autoRelease: boolean("auto_release").notNull().default(false),
  /** CPF EZPay advice code for regular runs (01–99). */
  cpfAdviceCode: text("cpf_advice_code").notNull().default("01"),
  /** FWL estimate parameters for Work Permit holders (MOM sector, tier, skill). */
  fwlSector: text("fwl_sector"),
  fwlTier: text("fwl_tier"),
  fwlSkill: text("fwl_skill"),
  /** Organisation's debit account for the bank payment file (account number SecretBox-encrypted). */
  debitBankBic: text("debit_bank_bic"),
  debitAccountEnc: text("debit_account_enc"),
  debitAccountLast4: text("debit_account_last4"),
  debitAccountName: text("debit_account_name"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** CPF and pro-ration treatment of an allowance type (default when absent: CPF-liable OW, pro-rated). */
export const payrollAllowanceSettings = pgTable(
  "payroll_allowance_settings",
  {
    orgId: orgId(),
    allowanceTypeId: uuid("allowance_type_id").notNull(),
    cpfLiable: boolean("cpf_liable").notNull().default(true),
    prorate: boolean("prorate").notNull().default(true),
    /** EA daily gross rate: null requires classification before holiday pay can be approved. */
    grossRateIncluded: boolean("gross_rate_included"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ name: "payroll_allowance_settings_pk", columns: [t.orgId, t.allowanceTypeId] }),
    foreignKey({
      name: "payroll_allowance_settings_type_fk",
      columns: [t.orgId, t.allowanceTypeId],
      foreignColumns: [allowanceTypes.orgId, allowanceTypes.id],
    }).onDelete("cascade"),
  ],
);

export type PayrollRunKind = "regular" | "off_cycle" | "adjustment";
export type PayrollRunStatus = "draft" | "in_review" | "approved" | "paid";
export type OffCycleReason = "final_pay" | "bonus";

export interface RunTotals {
  headcount: number;
  grossCents: number;
  netCents: number;
  netPayableCents: number;
  reimbursementsCents: number;
  cpfEmployeeCents: number;
  cpfEmployerCents: number;
  /** Employee share of AW top-ups borne by the employer (not statutory employer CPF). */
  cpfEmployeeShareAbsorbedCents?: number;
  /** Employee share of AW top-ups recovered from pay (CPF Act s 7(9)). */
  cpfAwRecoveredCents?: number;
  cpfTotalChargedCents: number;
  shgCents: number;
  shgChargedByFund: Record<string, number>;
  shgDonors: Record<string, number>;
  sdlChargedCents: number;
  sdlMonthCents: number;
  fwlCents: number;
  employerCostCents: number;
  blocking: number;
  warnings: number;
}

export const payrollRuns = pgTable(
  "payroll_runs",
  {
    id: uuid("id").primaryKey(),
    orgId: orgId(),
    kind: text("kind").$type<PayrollRunKind>().notNull(),
    offCycleReason: text("off_cycle_reason").$type<OffCycleReason>(),
    /** Calendar month `YYYY-MM`; the period is that month. */
    month: text("month").notNull(),
    periodStart: date("period_start").notNull(),
    periodEnd: date("period_end").notNull(),
    payDate: date("pay_date").notNull(),
    status: text("status").$type<PayrollRunStatus>().notNull().default("draft"),
    /** Employees in an off-cycle run; null = everyone eligible (regular runs). */
    employeeIds: jsonb("employee_ids").$type<string[] | null>(),
    adjustsRunId: uuid("adjusts_run_id"),
    supersededByRunId: uuid("superseded_by_run_id"),
    reopenReason: text("reopen_reason"),
    approvalRequestId: text("approval_request_id"),
    /** CPF EZPay advice code, allocated on the first CPF file and kept (distinct per month). */
    cpfAdviceCode: text("cpf_advice_code"),
    submittedBy: uuid("submitted_by"),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    decidedBy: uuid("decided_by"),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    decisionComment: text("decision_comment"),
    selfApproved: boolean("self_approved").notNull().default(false),
    computedAt: timestamp("computed_at", { withTimezone: true }),
    /** Last change to the run's inputs (items, pay date); later than `computed_at` = recompute needed. */
    inputsChangedAt: timestamp("inputs_changed_at", { withTimezone: true }),
    /** SHA-256 over the employees' input hashes (sorted by employee id). */
    inputHash: text("input_hash"),
    resultHash: text("result_hash"),
    totals: jsonb("totals").$type<RunTotals | null>(),
    /** Run-level issues (pay date, company profile); employee issues live on payslips. */
    issues: jsonb("issues").$type<PayIssue[]>().notNull().default([]),
    releasedAt: timestamp("released_at", { withTimezone: true }),
    releasedBy: uuid("released_by"),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    paidBy: uuid("paid_by"),
    createdBy: uuid("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("payroll_runs_org_id_id_unique").on(t.orgId, t.id),
    foreignKey({
      name: "payroll_runs_adjusts_fk",
      columns: [t.orgId, t.adjustsRunId],
      foreignColumns: [t.orgId, t.id],
    }),
    foreignKey({
      name: "payroll_runs_superseded_by_fk",
      columns: [t.orgId, t.supersededByRunId],
      foreignColumns: [t.orgId, t.id],
    }),
    uniqueIndex("payroll_runs_one_regular_per_month").on(t.orgId, t.month).where(sql`${t.kind} = 'regular'`),
    uniqueIndex("payroll_runs_one_open_adjustment")
      .on(t.orgId, t.adjustsRunId)
      .where(sql`${t.kind} = 'adjustment' and ${t.status} in ('draft', 'in_review')`),
    index("payroll_runs_month").on(t.orgId, t.month),
  ],
);

export const payrollRunItems = pgTable(
  "payroll_run_items",
  {
    id: uuid("id").primaryKey(),
    orgId: orgId(),
    runId: uuid("run_id").notNull(),
    employeeId: uuid("employee_id").notNull(),
    kind: text("kind").$type<RunItemKind>().notNull(),
    label: text("label").notNull(),
    amountCents: cents("amount_cents"),
    wageClass: text("wage_class").$type<WageClass>(),
    cpfLiable: boolean("cpf_liable").notNull().default(true),
    awPayableDate: date("aw_payable_date"),
    minutes: integer("minutes"),
    /** No-pay leave in half days (MOM counts half days). */
    halfDays: integer("half_days"),
    itemDate: date("item_date"),
    periodStart: date("period_start"),
    periodEnd: date("period_end"),
    deductionCategory: text("deduction_category").$type<DeductionCategory>(),
    source: text("source").$type<"manual" | "attendance">().notNull().default("manual"),
    /** Item this one was copied from (reopen → adjustment). */
    copiedFromItemId: uuid("copied_from_item_id"),
    /** Contractual amount overriding one approved attendance OT claim. */
    overtimeSourceId: uuid("overtime_source_id"),
    /** Explicit daily gross pay for an off-day holiday (e.g. hourly or rostered staff). */
    holidayDate: date("holiday_date"),
    createdBy: uuid("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("payroll_run_items_org_id_id_unique").on(t.orgId, t.id),
    foreignKey({
      name: "payroll_run_items_run_fk",
      columns: [t.orgId, t.runId],
      foreignColumns: [payrollRuns.orgId, payrollRuns.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "payroll_run_items_employee_fk",
      columns: [t.orgId, t.employeeId],
      foreignColumns: [employees.orgId, employees.id],
    }),
    index("payroll_run_items_run").on(t.orgId, t.runId, t.employeeId),
    unique("payroll_run_items_ot_source_unique").on(t.orgId, t.runId, t.overtimeSourceId),
    unique("payroll_run_items_holiday_unique").on(t.orgId, t.runId, t.employeeId, t.holidayDate),
  ],
);

/** A payee's bank account at compute time. `accountNumberHmac` is the blind index (not reversible). */
export interface PayeeSnapshot {
  bankAccountId: string;
  bankCode: string;
  holderName: string;
  accountLast4: string;
  accountNumberHmac: string;
}

/** One employee's computed pay in one run. Becomes the employee's payslip once released. */
export const payrollPayslips = pgTable(
  "payroll_payslips",
  {
    id: uuid("id").primaryKey(),
    orgId: orgId(),
    runId: uuid("run_id").notNull(),
    employeeId: uuid("employee_id").notNull(),
    employeeNumber: text("employee_number").notNull(),
    employeeName: text("employee_name").notNull(),
    input: jsonb("input").$type<PayInput>().notNull(),
    inputHash: text("input_hash").notNull(),
    result: jsonb("result").$type<PayResult>().notNull(),
    resultHash: text("result_hash").notNull(),
    grossCents: cents("gross_cents").notNull(),
    netCents: cents("net_cents").notNull(),
    netPayableCents: cents("net_payable_cents").notNull(),
    cpfEmployeeCents: cents("cpf_employee_cents").notNull(),
    cpfEmployerCents: cents("cpf_employer_cents").notNull(),
    blockingCount: integer("blocking_count").notNull(),
    warningCount: integer("warning_count").notNull(),
    /**
     * The bank account the employee was to be paid into, as at the pay date when the run was
     * computed (finding #10). The bank file pays this account only while it is still the current
     * one; a later change makes the run stale until it is recomputed and approved again.
     */
    payee: jsonb("payee").$type<PayeeSnapshot | null>(),
    releasedAt: timestamp("released_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("payroll_payslips_org_id_id_unique").on(t.orgId, t.id),
    unique("payroll_payslips_run_employee_unique").on(t.orgId, t.runId, t.employeeId),
    foreignKey({
      name: "payroll_payslips_run_fk",
      columns: [t.orgId, t.runId],
      foreignColumns: [payrollRuns.orgId, payrollRuns.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "payroll_payslips_employee_fk",
      columns: [t.orgId, t.employeeId],
      foreignColumns: [employees.orgId, employees.id],
    }),
    index("payroll_payslips_employee").on(t.orgId, t.employeeId, t.releasedAt),
  ],
);

/**
 * Back pay owed after a retroactive compensation change (people's `PayrollPort.notifyBackPay`).
 * Open notices show as a warning on the employee in later runs until an approved run pays back pay.
 */
export const payrollBackpayNotices = pgTable(
  "payroll_backpay_notices",
  {
    id: uuid("id").primaryKey(),
    orgId: orgId(),
    employeeId: uuid("employee_id").notNull(),
    compensationRecordId: uuid("compensation_record_id").notNull(),
    effectiveFrom: date("effective_from").notNull(),
    previousAmountCents: cents("previous_amount_cents"),
    newAmountCents: cents("new_amount_cents").notNull(),
    resolvedRunId: uuid("resolved_run_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("payroll_backpay_notices_org_id_id_unique").on(t.orgId, t.id),
    foreignKey({
      name: "payroll_backpay_notices_employee_fk",
      columns: [t.orgId, t.employeeId],
      foreignColumns: [employees.orgId, employees.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "payroll_backpay_notices_run_fk",
      columns: [t.orgId, t.resolvedRunId],
      foreignColumns: [payrollRuns.orgId, payrollRuns.id],
    }),
    index("payroll_backpay_notices_open").on(t.orgId, t.employeeId),
  ],
);

export type PayrollSettings = typeof payrollSettings.$inferSelect;
export type PayrollRun = typeof payrollRuns.$inferSelect;
export type PayrollRunItem = typeof payrollRunItems.$inferSelect;
export type PayrollPayslip = typeof payrollPayslips.$inferSelect;

/** Unique reservations prevent an attendance or holiday earning being paid by two runs. */
export const payrollFeedReservations = pgTable(
  "payroll_feed_reservations",
  {
    orgId: orgId(),
    sourceId: text("source_id").notNull(),
    employeeId: uuid("employee_id").notNull(),
    runId: uuid("run_id").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.sourceId] }),
    foreignKey({ columns: [t.orgId, t.runId], foreignColumns: [payrollRuns.orgId, payrollRuns.id] }).onDelete(
      "cascade",
    ),
    foreignKey({ columns: [t.orgId, t.employeeId], foreignColumns: [employees.orgId, employees.id] }),
  ],
);
