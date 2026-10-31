import { z } from "zod";
import { DEDUCTION_CATEGORY_KEYS } from "./rules.ts";

/**
 * Wire schemas of the payroll API. Every payroll response is readable only by holders of
 * `payroll:read` (owner, payroll_admin, who also hold `compensation:read` for everyone) or, for
 * payslips, by the employee themself, so salary fields need no per-field redaction here.
 */

const isoDate = z.iso.date();
const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Use a month as YYYY-MM, e.g. 2026-10.");
const cents = z.number().int();
const shgRecord = z.record(z.string(), z.number().int());

export const issueSchema = z.object({
  code: z.string(),
  severity: z.enum(["info", "warning", "blocking"]),
  message: z.string(),
  source: z.string().nullable(),
});

export const totalsSchema = z.object({
  headcount: z.number().int(),
  grossCents: cents,
  netCents: cents,
  netPayableCents: cents,
  reimbursementsCents: cents,
  cpfEmployeeCents: cents,
  cpfEmployerCents: cents,
  cpfTotalChargedCents: cents,
  shgCents: cents,
  shgChargedByFund: shgRecord,
  shgDonors: shgRecord,
  sdlChargedCents: cents,
  sdlMonthCents: cents,
  fwlCents: cents,
  employerCostCents: cents,
  blocking: z.number().int(),
  warnings: z.number().int(),
});

export const runSchema = z.object({
  id: z.uuid(),
  kind: z.enum(["regular", "off_cycle", "adjustment"]),
  offCycleReason: z.enum(["final_pay", "bonus"]).nullable(),
  month,
  periodStart: isoDate,
  periodEnd: isoDate,
  payDate: isoDate,
  status: z.enum(["draft", "in_review", "approved", "paid"]),
  employeeIds: z.array(z.uuid()).nullable(),
  adjustsRunId: z.uuid().nullable(),
  supersededByRunId: z.uuid().nullable(),
  reopenReason: z.string().nullable(),
  approvalRequestId: z.string().nullable(),
  submittedBy: z.uuid().nullable(),
  submittedAt: z.string().nullable(),
  decidedBy: z.uuid().nullable(),
  decidedAt: z.string().nullable(),
  decisionComment: z.string().nullable(),
  selfApproved: z.boolean(),
  computedAt: z.string().nullable(),
  inputHash: z.string().nullable(),
  resultHash: z.string().nullable(),
  totals: totalsSchema.nullable(),
  releasedAt: z.string().nullable(),
  paidAt: z.string().nullable(),
  createdAt: z.string(),
});

export const runSummarySchema = runSchema.pick({
  id: true,
  kind: true,
  offCycleReason: true,
  month: true,
  payDate: true,
  status: true,
  supersededByRunId: true,
  adjustsRunId: true,
  releasedAt: true,
  totals: true,
  computedAt: true,
});

export const rowSchema = z.object({
  payslipId: z.uuid(),
  employeeId: z.uuid(),
  employeeNumber: z.string(),
  name: z.string(),
  department: z.string().nullable(),
  basicCents: cents,
  allowancesCents: cents,
  overtimeCents: cents,
  additionalCents: cents,
  nplCents: cents,
  grossCents: cents,
  cpfEmployeeCents: cents,
  shgCents: cents,
  otherDeductionsCents: cents,
  reimbursementsCents: cents,
  netCents: cents,
  netPayableCents: cents,
  cpfEmployerCents: cents,
  blocking: z.number().int(),
  warnings: z.number().int(),
  flags: z.array(z.string()),
});

export const overviewSchema = z.object({
  run: runSchema,
  rows: z.array(rowSchema),
  issues: z.array(issueSchema.extend({ employeeId: z.uuid().nullable(), employeeName: z.string().nullable() })),
  changes: z.object({
    comparedWith: z.object({ runId: z.uuid(), month }).nullable(),
    headline: z.string(),
    items: z.array(
      z.object({
        kind: z.enum(["joined", "left", "basic_changed", "new_item", "net_changed", "not_in_run", "residency"]),
        employeeId: z.uuid(),
        name: z.string(),
        text: z.string(),
      }),
    ),
  }),
  adjustment: z.object({ ofRunId: z.uuid(), ofMonth: month }).nullable(),
  supersededBy: z.uuid().nullable(),
});

const lineSchema = z.object({
  code: z.string(),
  kind: z.enum(["earning", "deduction", "reimbursement", "employer"]),
  category: z.string(),
  label: z.string(),
  amountCents: cents,
  wageClass: z.enum(["OW", "AW"]).nullable(),
  cpfLiable: z.boolean(),
  detail: z.string().nullable(),
  itemId: z.string().nullable(),
});

const chargedSchema = z.object({
  cpfTotalCents: cents,
  cpfEmployeeCents: cents,
  cpfEmployerCents: cents,
  shgCents: shgRecord,
  sdlUnits1e4Cent: z.number().int(),
});

const awPaymentSchema = z.object({
  payableMonth: month,
  owCents: cents,
  awPayableCents: cents,
  awSubjectCents: cents,
  residency: z.record(z.string(), z.unknown()).optional(),
});

export const payResultSchema = z.object({
  engineVersion: z.number().int(),
  lines: z.array(lineSchema),
  totals: z.record(z.string(), z.number()),
  month: z.object({
    owCpfCents: cents,
    awCpfCents: cents,
    totalWagesCents: cents,
    cpfTotalCents: cents,
    cpfEmployeeCents: cents,
    cpfEmployerCents: cents,
    shgCents: shgRecord,
    sdlUnits1e4Cent: z.number().int(),
  }),
  charged: chargedSchema,
  cpf: z
    .object({
      residencyCategory: z.string(),
      ageBand: z.string().nullable(),
      ageBandLabel: z.string().nullable(),
      rateTableId: z.string().nullable(),
      wageBand: z.string().nullable(),
      owSubjectCents: cents,
      awSubjectCents: cents,
      awNotSubjectCents: cents,
      awCeiling: z
        .object({
          basis: z.string(),
          annualOwSubjectCents: cents,
          annualAwCeilingCents: cents,
          headroomBeforeCents: cents,
          headroomAfterCents: cents,
        })
        .nullable(),
      priorAwShortfallCents: cents,
      priorAwExcessCents: cents,
      exactTotal: z.string(),
      exactEmployee: z.string(),
    })
    .nullable(),
  shgFunds: z.array(z.string()),
  overtime: z
    .object({ minutes: z.number().int(), periodStart: isoDate.nullable(), periodEnd: isoDate.nullable() })
    .nullable(),
  hourly: z.object({ rateCents: cents, minutes: z.number().int() }).nullable(),
  rules: z.array(
    z.object({
      family: z.string(),
      id: z.string(),
      effectiveFrom: isoDate,
      effectiveTo: isoDate.nullable(),
      source: z.string(),
    }),
  ),
  working: z.array(z.object({ section: z.string(), code: z.string(), text: z.string() })),
  issues: z.array(issueSchema),
  stateAfter: z.object({ owSubjectCents: cents, awPayments: z.array(awPaymentSchema) }),
});

export const itemKinds = [
  "bonus",
  "commission",
  "backpay",
  "other_earning",
  "overtime",
  "unpaid_leave",
  "hours",
  "deduction",
] as const;

export const itemSchema = z.object({
  id: z.uuid(),
  employeeId: z.uuid(),
  kind: z.enum(itemKinds),
  label: z.string(),
  amountCents: cents.nullable(),
  wageClass: z.enum(["OW", "AW"]).nullable(),
  cpfLiable: z.boolean(),
  awPayableDate: isoDate.nullable(),
  minutes: z.number().int().nullable(),
  days: z.number().nullable(),
  date: isoDate.nullable(),
  periodStart: isoDate.nullable(),
  periodEnd: isoDate.nullable(),
  deductionCategory: z.enum(DEDUCTION_CATEGORY_KEYS).nullable(),
  source: z.enum(["manual", "attendance"]),
  copiedFromItemId: z.uuid().nullable(),
});

export const itemInputSchema = z.object({
  employeeId: z.uuid(),
  kind: z.enum(itemKinds),
  label: z.string().trim().min(1, "Give the item a label the employee will understand, e.g. 'Year-end bonus'.").max(80),
  amountCents: z.number().int().safe().nonnegative().nullable().optional(),
  wageClass: z.enum(["OW", "AW"]).nullable().optional(),
  cpfLiable: z.boolean().optional(),
  awPayableDate: isoDate.nullable().optional(),
  minutes: z
    .number()
    .int()
    .positive()
    .max(744 * 60)
    .nullable()
    .optional(),
  days: z.number().positive().max(31).nullable().optional(),
  date: isoDate.nullable().optional(),
  periodStart: isoDate.nullable().optional(),
  periodEnd: isoDate.nullable().optional(),
  deductionCategory: z.enum(DEDUCTION_CATEGORY_KEYS).nullable().optional(),
});

export const employeeDetailSchema = z.object({
  run: runSummarySchema,
  employeeId: z.uuid(),
  payslipId: z.uuid().nullable(),
  employeeName: z.string().nullable(),
  input: z.record(z.string(), z.unknown()).nullable(),
  inputHash: z.string().nullable(),
  result: payResultSchema.nullable(),
  resultHash: z.string().nullable(),
  items: z.array(itemSchema),
});

const slipLine = z.object({ label: z.string(), amountCents: cents, detail: z.string().nullable() });

export const payslipViewSchema = z.object({
  id: z.uuid(),
  runId: z.uuid(),
  runKind: z.enum(["regular", "off_cycle", "adjustment"]),
  offCycleReason: z.enum(["final_pay", "bonus"]).nullable(),
  title: z.string(),
  revision: z.object({ ofRunId: z.uuid(), previouslyPaidCents: cents }).nullable(),
  releasedAt: z.string().nullable(),
  employer: z.object({ legalName: z.string() }),
  employee: z.object({
    name: z.string(),
    employeeNumber: z.string(),
    idMasked: z.string(),
    jobTitle: z.string().nullable(),
    department: z.string().nullable(),
  }),
  payDate: isoDate,
  periodStart: isoDate,
  periodEnd: isoDate,
  basic: z
    .object({
      amountCents: cents,
      detail: z.string().nullable(),
      hourly: z.object({ rateCents: cents, hours: z.number() }).nullable(),
    })
    .nullable(),
  allowances: z.array(slipLine),
  additional: z.array(slipLine),
  overtime: z
    .object({
      hours: z.number(),
      payCents: cents,
      periodStart: isoDate.nullable(),
      periodEnd: isoDate.nullable(),
      differsFromSalaryPeriod: z.boolean(),
    })
    .nullable(),
  deductions: z.array(slipLine.extend({ type: z.enum(["fixed", "ad_hoc"]) })),
  reimbursements: z.array(slipLine),
  grossCents: cents,
  totalDeductionsCents: cents,
  netCents: cents,
  netPayableCents: cents,
  employerCpfCents: cents,
  cpf: z
    .object({
      rateTableId: z.string().nullable(),
      rateTableLabel: z.string().nullable(),
      ageBand: z.string().nullable(),
      residency: z.string(),
      owSubjectCents: cents,
      awSubjectCents: cents,
    })
    .nullable(),
  shgFunds: z.array(z.string()),
  ytd: z.object({ year: z.string(), awSubjectCents: cents, owSubjectCents: cents }),
});

export const payslipSummarySchema = z.object({
  id: z.uuid(),
  runId: z.uuid(),
  title: z.string(),
  month,
  payDate: isoDate,
  netCents: cents,
  netPayableCents: cents,
  runKind: z.enum(["regular", "off_cycle", "adjustment"]),
  releasedAt: z.string(),
  revised: z.boolean(),
});

export const settingsSchema = z.object({
  payDay: z.number().int().nullable(),
  autoRelease: z.boolean(),
  cpfAdviceCode: z.string(),
  fwlSector: z.string().nullable(),
  fwlTier: z.string().nullable(),
  fwlSkill: z.string().nullable(),
  debitBankBic: z.string().nullable(),
  debitAccountMasked: z.string().nullable(),
  debitAccountName: z.string().nullable(),
});

export const settingsInputSchema = z.object({
  payDay: z
    .number()
    .int()
    .min(1, "Pay day is a day of the month from 1 to 31.")
    .max(31, "Pay day is a day of the month from 1 to 31.")
    .nullable()
    .optional(),
  autoRelease: z.boolean().optional(),
  cpfAdviceCode: z
    .string()
    .regex(/^(0[1-9]|[1-9][0-9])$/, "The CPF advice code is two digits from 01 to 99.")
    .optional(),
  fwlSector: z.string().max(40).nullable().optional(),
  fwlTier: z.string().max(40).nullable().optional(),
  fwlSkill: z.string().max(40).nullable().optional(),
  debitBankBic: z
    .string()
    .regex(/^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$/, "Use the bank's 8 or 11 character SWIFT/BIC code, e.g. DBSSSGSG.")
    .nullable()
    .optional(),
  debitAccountNumber: z
    .string()
    .regex(/^[0-9 -]{6,34}$/, "Enter the account number using digits only.")
    .nullable()
    .optional(),
  debitAccountName: z.string().max(70).nullable().optional(),
});

export const createRunSchema = z.object({
  kind: z.enum(["regular", "off_cycle"]),
  month,
  payDate: isoDate.nullable().optional(),
  offCycleReason: z.enum(["final_pay", "bonus"]).nullable().optional(),
  employeeIds: z.array(z.uuid()).max(500).nullable().optional(),
});
