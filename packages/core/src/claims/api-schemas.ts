import { z } from "zod";
import { sensitive } from "../access/sensitivity.ts";
import { CAP_PERIODS, CLAIM_CATEGORIES, CLAIM_STATUSES, PAYOUT_METHODS, RECEIPT_RULES } from "../db/schema/claims.ts";
import { FILE_SCAN_STATUSES } from "../db/schema/files.ts";

const cents = z.int().min(0).max(Number.MAX_SAFE_INTEGER);
const isoDate = z.iso.date({ error: "Use a date in the form YYYY-MM-DD." });
const employmentType = z.enum(["full_time", "part_time", "contract", "intern"]);

export const claimTypeInputSchema = z.object({
  code: z.string().trim().min(2).max(32),
  name: z.string().trim().min(1, "Enter a name for the claim type.").max(80),
  category: z.enum(CLAIM_CATEGORIES),
  receiptRule: z.enum(RECEIPT_RULES),
  receiptAboveCents: cents.nullable().optional(),
  capCents: z.int().min(1).max(Number.MAX_SAFE_INTEGER).nullable().optional(),
  capPeriod: z.enum(CAP_PERIODS),
  eligibleEmploymentTypes: z.array(employmentType).max(4).optional(),
  availableDuringProbation: z.boolean().optional(),
  defaultPayout: z.enum(PAYOUT_METHODS).optional(),
  gstApplicable: z.boolean().optional(),
  taxable: z.boolean().optional(),
  glCode: z.string().trim().max(40).nullable().optional(),
});

export const claimTypeSchema = z.object({
  id: z.uuid(),
  code: z.string(),
  name: z.string(),
  category: z.enum(CLAIM_CATEGORIES),
  receiptRule: z.enum(RECEIPT_RULES),
  receiptAboveCents: cents.nullable(),
  capCents: cents.nullable(),
  capPeriod: z.enum(CAP_PERIODS),
  eligibleEmploymentTypes: z.array(employmentType),
  availableDuringProbation: z.boolean(),
  defaultPayout: z.enum(PAYOUT_METHODS),
  gstApplicable: z.boolean(),
  taxable: z.boolean(),
  glCode: z.string().nullable(),
  archived: z.boolean(),
  inUse: z.boolean(),
});

const capUsageSchema = z.object({
  typeId: z.uuid(),
  typeCode: z.string(),
  typeName: z.string(),
  period: z.enum(["per_claim", "monthly", "yearly"]),
  periodLabel: z.string(),
  capCents: cents,
  usedCents: cents,
  pendingCents: cents,
  remainingCents: cents,
});

export const eligibleTypeSchema = z.object({
  id: z.uuid(),
  code: z.string(),
  name: z.string(),
  category: z.enum(CLAIM_CATEGORIES),
  receiptRule: z.enum(RECEIPT_RULES),
  receiptAboveCents: cents.nullable(),
  receiptHint: z.string(),
  gstApplicable: z.boolean(),
  cap: capUsageSchema.nullable(),
});

export const fileSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  mime: z.string(),
  sizeBytes: z.int(),
  scanStatus: z.enum(FILE_SCAN_STATUSES),
  removed: z.boolean(),
  previewable: z.boolean().meta({ description: "Images browsers can show (not HEIC or PDF)." }),
  url: z.string(),
  uploadedAt: z.string(),
});

const lineInputSchema = z.object({
  claimTypeId: z.uuid({ error: "Pick a claim type." }),
  expenseDate: isoDate,
  merchant: z.string().max(100, "Keep the merchant to 100 characters."),
  description: z.string().max(200, "Keep the description to 200 characters."),
  currency: z
    .string()
    .trim()
    .regex(/^[A-Za-z]{3}$/, "Use a 3-letter currency code such as SGD or MYR.")
    .default("SGD"),
  amountMinor: z
    .int({ error: "Enter the amount in the currency's smallest unit (cents for SGD)." })
    .min(1, "Enter an amount above zero.")
    .max(Number.MAX_SAFE_INTEGER),
  rate: z.string().trim().max(20).nullable().optional(),
  gstCents: cents.nullable().optional(),
  receiptIds: z.array(z.uuid()).max(5, "Attach at most 5 receipts per line.").default([]),
});

export const claimInputSchema = z.object({
  employeeId: z.uuid().nullable().optional(),
  title: z.string().trim().max(100).nullable().optional(),
  lines: z.array(lineInputSchema).min(1, "Add at least one line.").max(30, "A claim has at most 30 lines."),
});

export const createClaimSchema = claimInputSchema.extend({
  submit: z
    .boolean()
    .optional()
    .meta({ description: "Submit at once; when submission fails the draft is kept (details.draftId)." }),
});

const claimLineSchema = z.object({
  id: z.uuid(),
  position: z.int(),
  claimTypeId: z.uuid(),
  typeCode: z.string(),
  typeName: z.string(),
  category: z.enum(CLAIM_CATEGORIES),
  expenseDate: z.string(),
  merchant: sensitive(z.string().optional(), "medical"),
  description: sensitive(z.string().optional(), "medical"),
  receipts: sensitive(z.array(fileSchema).optional(), "medical"),
  receiptCount: z.int(),
  currency: z.string(),
  amountMinor: z.int(),
  rate: z.string().nullable(),
  sgdCents: cents,
  gstCents: cents.nullable(),
  receiptRequired: z.boolean(),
  duplicates: z.array(z.object({ fileId: z.uuid(), claimId: z.uuid(), claimNumber: z.string().nullable() })),
  redactedFields: z.array(z.string()).optional(),
});

const employeeRef = z.object({
  id: z.uuid(),
  name: z.string(),
  employeeNumber: z.string(),
  departmentName: z.string().nullable(),
});

export const claimSchema = z.object({
  id: z.uuid(),
  claimNumber: z.string().nullable(),
  status: z.enum(CLAIM_STATUSES),
  title: z.string().nullable(),
  employee: employeeRef,
  totalCents: cents,
  gstCents: cents,
  payoutMethod: z.enum(PAYOUT_METHODS).nullable(),
  approvalRequestId: z.uuid().nullable(),
  submittedAt: z.string().nullable(),
  decidedAt: z.string().nullable(),
  approvedOn: z.string().nullable(),
  decisionComment: z.string().nullable(),
  reservedByPayrollRun: z.boolean(),
  paidVia: z.enum(PAYOUT_METHODS).nullable(),
  paidOn: z.string().nullable(),
  paidReference: z.string().nullable(),
  copiedFromClaimId: z.uuid().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  lines: z.array(claimLineSchema),
  capUsage: z.array(capUsageSchema.extend({ claimCents: cents })),
  actions: z.object({
    edit: z.boolean(),
    submit: z.boolean(),
    delete: z.boolean(),
    withdraw: z.boolean(),
    copy: z.boolean(),
  }),
});

export const claimRowSchema = z.object({
  id: z.uuid(),
  claimNumber: z.string().nullable(),
  status: z.enum(CLAIM_STATUSES),
  title: z.string().nullable(),
  employee: employeeRef,
  totalCents: cents,
  gstCents: cents,
  lineCount: z.int(),
  typeNames: z.array(z.string()),
  expenseFrom: z.string().nullable(),
  expenseTo: z.string().nullable(),
  submittedAt: z.string().nullable(),
  daysWaiting: z.int().nullable(),
  approvedOn: z.string().nullable(),
  payoutMethod: z.enum(PAYOUT_METHODS).nullable(),
  reservedByPayrollRun: z.boolean(),
  paidVia: z.enum(PAYOUT_METHODS).nullable(),
  paidOn: z.string().nullable(),
  paidReference: z.string().nullable(),
  approverTask: z.boolean(),
});

export const markPaidSchema = z.object({
  claimIds: z.array(z.uuid()).min(1, "Select at least one claim.").max(200, "Mark at most 200 claims at once."),
  paidOn: isoDate,
  reference: z.string().trim().min(1, "Enter the payment reference.").max(100, "Keep the reference to 100 characters."),
});

export const summaryRowSchema = z.object({
  key: z.string(),
  label: z.string(),
  status: z.enum(CLAIM_STATUSES),
  claimCount: z.int(),
  lineCount: z.int(),
  totalCents: cents,
  gstCents: cents,
});

export const reportRangeShape = { from: isoDate, to: isoDate };
