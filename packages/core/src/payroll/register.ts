import { and, eq, gte, inArray, lte } from "drizzle-orm";
import { z } from "zod";
import { orgScope } from "../access/org-scope.ts";
import { payrollPayslips, payrollRuns } from "../db/schema/payroll.ts";
import { inBatches, type ReportColumn, type ReportContext, type ReportDefinition } from "../reporting/types.ts";

const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Use a month in YYYY-MM format.");

const params = ({ today }: { today: string }) =>
  z
    .object({
      from: month.default(`${today.slice(0, 4)}-01`),
      to: month.default(today.slice(0, 7)),
      state: z.enum(["finalised", "all"]).default("finalised"),
      runId: z.uuid().optional(),
    })
    .refine((p) => p.from <= p.to, { message: "Pick a start month on or before the end month.", path: ["from"] });

type RegisterParams = z.output<ReturnType<typeof params>>;

async function loadRegister({ db, orgId, employeeIds }: ReportContext, p: RegisterParams) {
  if (employeeIds?.size === 0) return [];
  return db
    .select({
      id: payrollRuns.id,
      month: payrollRuns.month,
      payDate: payrollRuns.payDate,
      kind: payrollRuns.kind,
      status: payrollRuns.status,
      reason: payrollRuns.offCycleReason,
      supersededBy: payrollRuns.supersededByRunId,
      name: payrollPayslips.employeeName,
      number: payrollPayslips.employeeNumber,
      result: payrollPayslips.result,
      input: payrollPayslips.input,
    })
    .from(payrollPayslips)
    .innerJoin(
      payrollRuns,
      and(eq(payrollRuns.orgId, payrollPayslips.orgId), eq(payrollRuns.id, payrollPayslips.runId)),
    )
    .where(
      orgScope(db, orgId).where(
        payrollPayslips,
        gte(payrollRuns.month, p.from),
        lte(payrollRuns.month, p.to),
        p.runId ? eq(payrollRuns.id, p.runId) : undefined,
        p.state === "finalised" ? inArray(payrollRuns.status, ["approved", "paid"]) : undefined,
        employeeIds ? inArray(payrollPayslips.employeeId, [...employeeIds]) : undefined,
      ),
    );
}

function runFields(row: Awaited<ReturnType<typeof loadRegister>>[number]) {
  return {
    month: row.month,
    payDate: row.payDate,
    runId: row.id,
    runType: row.reason ?? row.kind,
    state: row.status,
    supersededBy: row.supersededBy,
    employeeNumber: row.number,
    name: row.name,
    department: row.input.employment.department,
  };
}

const identityColumns: ReportColumn[] = [
  { key: "month", title: "Month", type: "text" },
  { key: "payDate", title: "Pay date", type: "date" },
  { key: "runId", title: "Run ID", type: "text" },
  { key: "runType", title: "Run type", type: "text" },
  { key: "state", title: "Run status", type: "text" },
  { key: "supersededBy", title: "Replacement run ID", type: "text" },
  { key: "employeeNumber", title: "Employee number", type: "text" },
  { key: "name", title: "Employee", type: "text" },
  { key: "department", title: "Department", type: "text" },
];

const amount = (key: string, title: string): ReportColumn => ({
  key,
  title,
  type: "money_cents",
  sensitivity: "salary",
});

const registerSettings = {
  module: "payroll",
  read: "reports_payroll_cost:read",
  export: "reports_payroll_cost:export",
  scopes: ["all"],
  params,
  fields: [
    { key: "from", label: "From month", kind: "month" },
    { key: "to", label: "To month", kind: "month" },
    {
      key: "state",
      label: "Runs",
      kind: "select",
      options: [
        { value: "finalised", label: "Approved and paid" },
        { value: "all", label: "All computed runs" },
      ],
    },
  ],
  defaultSort: { key: "payDate", dir: "desc" },
  emptyMessage: () => "No computed payroll in this selection. Choose another month or compute the run.",
  notes: [
    "Original runs and their adjustments have separate IDs. Net payable shows the amount for the selected run.",
    "Do not add original and revised gross amounts together.",
  ],
} as const;

export const payrollRegisterReport: ReportDefinition<RegisterParams> = {
  ...registerSettings,
  id: "payroll.register",
  title: "Payroll register",
  description: "Employee earnings, deductions, CPF, reimbursements and net pay by payroll run.",
  columns: () => [
    ...identityColumns,
    amount("basic", "Basic pay (S$)"),
    amount("allowances", "Allowances (S$)"),
    amount("overtime", "Overtime (S$)"),
    amount("additional", "Additional earnings (S$)"),
    amount("gross", "Gross pay (S$)"),
    amount("employeeCpf", "Employee CPF (S$)"),
    amount("employerCpf", "Employer CPF (S$)"),
    amount("shg", "SHG (S$)"),
    amount("deductions", "Employee deductions (S$)"),
    amount("reimbursements", "Reimbursements (S$)"),
    amount("net", "Net pay (S$)"),
    amount("netPayable", "Net payable on this run (S$)"),
  ],
  async *run(ctx, p) {
    yield* inBatches(
      (await loadRegister(ctx, p)).map((row) => {
        const t = row.result.totals;
        return {
          ...runFields(row),
          basic: t.basicCents,
          allowances: t.allowancesCents,
          overtime: t.overtimeCents,
          additional: t.additionalCents,
          gross: t.grossCents,
          employeeCpf: t.cpfEmployeeCents,
          employerCpf: t.cpfEmployerCents,
          shg: t.shgCents,
          deductions: t.employeeDeductionsCents,
          reimbursements: t.reimbursementsCents,
          net: t.netCents,
          netPayable: t.netPayableCents,
        };
      }),
    );
  },
};

export const payrollLinesReport: ReportDefinition<RegisterParams> = {
  ...registerSettings,
  id: "payroll.line_items",
  title: "Payroll line items",
  description: "Itemised earnings, deductions, reimbursements and employer contributions from computed pay.",
  columns: () => [
    ...identityColumns,
    { key: "kind", title: "Category", type: "text" },
    { key: "label", title: "Item", type: "text" },
    amount("amount", "Amount (S$)"),
  ],
  async *run(ctx, p) {
    for (const row of await loadRegister(ctx, p)) {
      yield row.result.lines.map((line) => ({
        ...runFields(row),
        kind: line.kind,
        label: line.label,
        amount: line.amountCents,
      }));
    }
  },
};
