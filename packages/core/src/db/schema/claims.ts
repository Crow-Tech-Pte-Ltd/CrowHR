import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { memberships } from "./access.ts";
import { type EmploymentType, employees } from "./employees.ts";
import { files } from "./files.ts";
import { organisations } from "./organisations.ts";

/**
 * Claims and expenses (openspec/changes/add-claims). Money is integer cents (`bigint` in
 * number mode, asserted safe in the service); foreign amounts are integer minor units with the
 * currency's ISO 4217 exponent and a manual rate in millionths of SGD (see `claims/money.ts`).
 * Every table has `org_id`; references between tenant tables are composite `(org_id, id)` FKs.
 */

export const CLAIM_CATEGORIES = [
  "medical",
  "dental",
  "transport",
  "meals",
  "entertainment",
  "travel",
  "phone",
  "training",
  "other",
] as const;
export type ClaimCategory = (typeof CLAIM_CATEGORIES)[number];
export const RECEIPT_RULES = ["always", "never", "above"] as const;
export type ReceiptRule = (typeof RECEIPT_RULES)[number];
export const CAP_PERIODS = ["none", "per_claim", "monthly", "yearly"] as const;
export type CapPeriod = (typeof CAP_PERIODS)[number];
export const PAYOUT_METHODS = ["payroll", "outside"] as const;
export type PayoutMethod = (typeof PAYOUT_METHODS)[number];
export const CLAIM_STATUSES = ["draft", "submitted", "approved", "rejected", "withdrawn", "paid"] as const;
export type ClaimStatus = (typeof CLAIM_STATUSES)[number];

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
};

export const claimTypes = pgTable(
  "claim_types",
  {
    id: uuid("id").primaryKey(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organisations.id),
    code: text("code").notNull(),
    name: text("name").notNull(),
    category: text("category").$type<ClaimCategory>().notNull(),
    receiptRule: text("receipt_rule").$type<ReceiptRule>().notNull(),
    /** With `receipt_rule = 'above'`: a receipt is required when a line is above this many cents. */
    receiptAboveCents: bigint("receipt_above_cents", { mode: "number" }),
    capCents: bigint("cap_cents", { mode: "number" }),
    capPeriod: text("cap_period").$type<CapPeriod>().notNull().default("none"),
    /** Empty = every employment type. */
    eligibleEmploymentTypes: text("eligible_employment_types").array().$type<EmploymentType[]>().notNull().default([]),
    availableDuringProbation: boolean("available_during_probation").notNull().default(true),
    defaultPayout: text("default_payout").$type<PayoutMethod>().notNull().default("payroll"),
    /** Whether lines of this type may carry a GST amount (an SGD tax invoice). */
    gstApplicable: boolean("gst_applicable").notNull().default(true),
    /** Input for the later IR8A treatment (payroll/IR8A change decides); claims only carries it. */
    taxable: boolean("taxable").notNull().default(false),
    glCode: text("gl_code"),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    unique("claim_types_org_id_unique").on(t.orgId, t.id),
    unique("claim_types_org_code_unique").on(t.orgId, t.code),
    check(
      "claim_types_cap_check",
      sql`(${t.capPeriod} = 'none' and ${t.capCents} is null) or (${t.capPeriod} <> 'none' and ${t.capCents} > 0)`,
    ),
    check("claim_types_receipt_check", sql`(${t.receiptRule} = 'above') = (${t.receiptAboveCents} is not null)`),
  ],
);

/** Organisation claim settings (one row per org, created on first write). */
export const claimSettings = pgTable("claim_settings", {
  orgId: uuid("org_id")
    .primaryKey()
    .references(() => organisations.id),
  /** Expenses older than this many days (by expense date, SGT) cannot be claimed. */
  submissionWindowDays: integer("submission_window_days").notNull().default(90),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const claims = pgTable(
  "claims",
  {
    id: uuid("id").primaryKey(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organisations.id),
    employeeId: uuid("employee_id").notNull(),
    /** `C-0001`…, assigned on first submission. Drafts have none. */
    claimNumber: text("claim_number"),
    status: text("status").$type<ClaimStatus>().notNull(),
    title: text("title"),
    totalCents: bigint("total_cents", { mode: "number" }).notNull().default(0),
    payoutMethod: text("payout_method").$type<PayoutMethod>(),
    approvalRequestId: uuid("approval_request_id"),
    createdByMembershipId: uuid("created_by_membership_id").notNull(),
    submittedByMembershipId: uuid("submitted_by_membership_id"),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    /** Asia/Singapore date of final approval: the payroll cutoff compares against it. */
    approvedOn: date("approved_on"),
    decisionComment: text("decision_comment"),
    /** Reserved by this payroll run (no FK: payroll owns its table). */
    payrollRunId: uuid("payroll_run_id"),
    reservedAt: timestamp("reserved_at", { withTimezone: true }),
    paidVia: text("paid_via").$type<PayoutMethod>(),
    paidOn: date("paid_on"),
    paidReference: text("paid_reference"),
    paidByMembershipId: uuid("paid_by_membership_id"),
    copiedFromClaimId: uuid("copied_from_claim_id"),
    ...timestamps,
  },
  (t) => [
    unique("claims_org_id_unique").on(t.orgId, t.id),
    unique("claims_org_number_unique").on(t.orgId, t.claimNumber),
    index("claims_employee_idx").on(t.orgId, t.employeeId, t.status),
    index("claims_payable_idx").on(t.orgId, t.status, t.approvedOn),
    index("claims_run_idx").on(t.orgId, t.payrollRunId),
    foreignKey({
      name: "claims_employee_fk",
      columns: [t.orgId, t.employeeId],
      foreignColumns: [employees.orgId, employees.id],
    }),
    foreignKey({
      name: "claims_created_by_fk",
      columns: [t.orgId, t.createdByMembershipId],
      foreignColumns: [memberships.orgId, memberships.id],
    }),
    check(
      "claims_status_check",
      sql`${t.status} in ('draft', 'submitted', 'approved', 'rejected', 'withdrawn', 'paid')`,
    ),
    // A claim is paid once, with a date; a reservation only ever holds an approved claim.
    check("claims_paid_check", sql`(${t.status} = 'paid') = (${t.paidOn} is not null)`),
    check("claims_reserved_check", sql`${t.payrollRunId} is null or ${t.status} in ('approved', 'paid')`),
    check("claims_total_check", sql`${t.totalCents} >= 0`),
  ],
);

export const claimLines = pgTable(
  "claim_lines",
  {
    id: uuid("id").primaryKey(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organisations.id),
    claimId: uuid("claim_id").notNull(),
    position: integer("position").notNull(),
    claimTypeId: uuid("claim_type_id").notNull(),
    expenseDate: date("expense_date").notNull(),
    merchant: text("merchant").notNull(),
    description: text("description").notNull(),
    /** ISO 4217 alpha code. */
    currency: text("currency").notNull(),
    currencyExponent: integer("currency_exponent").notNull(),
    amountMinor: bigint("amount_minor", { mode: "number" }).notNull(),
    /** SGD per 1 unit of `currency`, in millionths. Null for SGD lines. */
    rateMicros: bigint("rate_micros", { mode: "number" }),
    sgdCents: bigint("sgd_cents", { mode: "number" }).notNull(),
    /** GST included in `sgd_cents` (SGD lines only). */
    gstCents: bigint("gst_cents", { mode: "number" }),
  },
  (t) => [
    unique("claim_lines_org_id_unique").on(t.orgId, t.id),
    unique("claim_lines_position_unique").on(t.claimId, t.position),
    index("claim_lines_type_date_idx").on(t.orgId, t.claimTypeId, t.expenseDate),
    foreignKey({
      name: "claim_lines_claim_fk",
      columns: [t.orgId, t.claimId],
      foreignColumns: [claims.orgId, claims.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "claim_lines_type_fk",
      columns: [t.orgId, t.claimTypeId],
      foreignColumns: [claimTypes.orgId, claimTypes.id],
    }),
    check("claim_lines_amount_check", sql`${t.amountMinor} > 0 and ${t.sgdCents} >= 0`),
    check(
      "claim_lines_gst_check",
      sql`${t.gstCents} is null or (${t.gstCents} >= 0 and ${t.gstCents} <= ${t.sgdCents})`,
    ),
    check("claim_lines_rate_check", sql`(${t.currency} = 'SGD') = (${t.rateMicros} is null)`),
  ],
);

export const claimLineFiles = pgTable(
  "claim_line_files",
  {
    orgId: uuid("org_id")
      .notNull()
      .references(() => organisations.id),
    claimLineId: uuid("claim_line_id").notNull(),
    fileId: uuid("file_id").notNull(),
    position: integer("position").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.claimLineId, t.fileId] }),
    index("claim_line_files_file_idx").on(t.orgId, t.fileId),
    foreignKey({
      name: "claim_line_files_line_fk",
      columns: [t.orgId, t.claimLineId],
      foreignColumns: [claimLines.orgId, claimLines.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "claim_line_files_file_fk",
      columns: [t.orgId, t.fileId],
      foreignColumns: [files.orgId, files.id],
    }),
  ],
);
