import type { PayrollPayslip, PayrollRun } from "../db/schema/payroll.ts";
import { dateLabel } from "./engine/dates.ts";
import type { PayInput, PayLine, PayResult } from "./engine/types.ts";

/**
 * Payslip view model: MOM's itemised payslip items (research/sg-regulatory.md §7, MOM "Itemised
 * payslips") in a fixed structure that the web page and the PDF both render.
 */

export interface PayslipLine {
  label: string;
  amountCents: number;
  detail: string | null;
}

export interface PayslipView {
  id: string;
  runId: string;
  runKind: PayrollRun["kind"];
  offCycleReason: PayrollRun["offCycleReason"];
  title: string;
  /** Set on an adjustment's payslip: it revises the payslip of the run it replaces. */
  revision: { ofRunId: string; previouslyPaidCents: number } | null;
  releasedAt: string | null;
  employer: { legalName: string };
  employee: {
    name: string;
    employeeNumber: string;
    idMasked: string;
    jobTitle: string | null;
    department: string | null;
  };
  payDate: string;
  periodStart: string;
  periodEnd: string;
  basic: { amountCents: number; detail: string | null; hourly: { rateCents: number; hours: number } | null } | null;
  allowances: PayslipLine[];
  additional: PayslipLine[];
  overtime: {
    hours: number;
    payCents: number;
    periodStart: string | null;
    periodEnd: string | null;
    differsFromSalaryPeriod: boolean;
  } | null;
  deductions: (PayslipLine & { type: "fixed" | "ad_hoc" })[];
  reimbursements: PayslipLine[];
  grossCents: number;
  totalDeductionsCents: number;
  netCents: number;
  netPayableCents: number;
  employerCpfCents: number;
  cpf: {
    rateTableId: string | null;
    ageBand: string | null;
    residency: string;
    owSubjectCents: number;
    awSubjectCents: number;
  } | null;
  shgFunds: string[];
  ytd: { year: string; awSubjectCents: number; owSubjectCents: number };
}

const toLine = (l: PayLine): PayslipLine => ({ label: l.label, amountCents: l.amountCents, detail: l.detail });

export function payslipTitle(run: Pick<PayrollRun, "kind" | "offCycleReason" | "month">, monthText: string): string {
  if (run.kind === "adjustment") return `Revised payslip, ${monthText}`;
  if (run.kind === "off_cycle")
    return `${run.offCycleReason === "final_pay" ? "Final pay" : "Bonus"} payslip, ${monthText}`;
  return `Payslip, ${monthText}`;
}

export function buildPayslipView(
  slip: Pick<PayrollPayslip, "id" | "runId" | "input" | "result" | "releasedAt">,
  run: Pick<PayrollRun, "kind" | "offCycleReason" | "adjustsRunId" | "month">,
  monthText: string,
): PayslipView {
  const input = slip.input as PayInput;
  const r = slip.result as PayResult;
  const of = (cat: PayLine["category"]) => r.lines.filter((l) => l.category === cat);
  const basicLine = of("basic")[0];
  const ot = of("overtime");
  const otPay = ot.reduce((s, l) => s + l.amountCents, 0);
  const deductions: PayslipView["deductions"] = [
    ...r.lines.filter((l) => l.category === "cpf_employee").map((l) => ({ ...toLine(l), type: "fixed" as const })),
    ...of("shg").map((l) => ({ ...toLine(l), type: "fixed" as const })),
    ...of("npl").map((l) => ({ ...toLine(l), type: "ad_hoc" as const })),
    ...of("deduction").map((l) => ({ ...toLine(l), type: "ad_hoc" as const })),
  ];
  const year = input.run.month.slice(0, 4);
  return {
    id: slip.id,
    runId: slip.runId,
    runKind: run.kind,
    offCycleReason: run.offCycleReason,
    title: payslipTitle(run, monthText),
    revision:
      run.kind === "adjustment" && run.adjustsRunId
        ? { ofRunId: run.adjustsRunId, previouslyPaidCents: r.totals.netCents - r.totals.netPayableCents }
        : null,
    releasedAt: slip.releasedAt ? slip.releasedAt.toISOString() : null,
    employer: { legalName: input.employer.legalName ?? "" },
    employee: {
      name: input.employee.legalName,
      employeeNumber: input.employee.employeeNumber,
      idMasked: input.employee.idMasked,
      jobTitle: input.employment.jobTitle,
      department: input.employment.department,
    },
    payDate: input.run.payDate,
    periodStart: input.run.periodStart,
    periodEnd: input.run.periodEnd,
    basic: basicLine
      ? {
          amountCents: basicLine.amountCents,
          detail: basicLine.detail,
          hourly: r.hourly ? { rateCents: r.hourly.rateCents, hours: r.hourly.minutes / 60 } : null,
        }
      : null,
    allowances: of("allowance").map(toLine),
    additional: of("additional").map(toLine),
    overtime: r.overtime
      ? {
          hours: r.overtime.minutes / 60,
          payCents: otPay,
          periodStart: r.overtime.periodStart,
          periodEnd: r.overtime.periodEnd,
          differsFromSalaryPeriod:
            (r.overtime.periodStart !== null && r.overtime.periodStart !== input.run.periodStart) ||
            (r.overtime.periodEnd !== null && r.overtime.periodEnd !== input.run.periodEnd),
        }
      : null,
    deductions,
    reimbursements: of("claim").map(toLine),
    grossCents: r.totals.grossCents + r.totals.nplCents,
    totalDeductionsCents: r.totals.employeeDeductionsCents + r.totals.nplCents,
    netCents: r.totals.netCents,
    netPayableCents: r.totals.netPayableCents,
    employerCpfCents: r.totals.cpfEmployerCents,
    cpf: r.cpf
      ? {
          rateTableId: r.cpf.rateTableId,
          ageBand: r.cpf.ageBandLabel,
          residency: r.cpf.residencyCategory,
          owSubjectCents: r.cpf.owSubjectCents,
          awSubjectCents: r.cpf.awSubjectCents,
        }
      : null,
    shgFunds: r.shgFunds,
    ytd: {
      year,
      owSubjectCents: r.stateAfter.owSubjectCents,
      awSubjectCents: r.stateAfter.awPayments.reduce((s, p) => s + p.awSubjectCents, 0),
    },
  };
}

/**
 * MOM mandatory payslip items that cannot be shown for this payslip. Allowances, additional payments,
 * deductions and overtime are mandatory only when they exist, so they are never "missing".
 */
export function missingPayslipItems(input: PayInput, result: PayResult): string[] {
  const missing: string[] = [];
  if (!input.employer.legalName?.trim()) missing.push("Employer's full name");
  if (!input.employee.legalName.trim()) missing.push("Employee's full name");
  if (!input.run.payDate) missing.push("Date of payment");
  if (!input.run.periodStart || !input.run.periodEnd) missing.push("Start and end date of the salary period");
  const bonusOnly = input.run.kind === "off_cycle" && input.run.offCycleReason === "bonus";
  if (!bonusOnly && !result.lines.some((l) => l.category === "basic")) missing.push("Basic salary");
  if (result.overtime && result.overtime.minutes <= 0 && result.totals.overtimeCents > 0)
    missing.push("Overtime hours worked");
  return missing;
}

/** The 12 MOM items, for the payslip footer and tests. */
export const MOM_PAYSLIP_ITEMS = [
  "Employer's full name",
  "Employee's full name",
  "Date(s) of payment",
  "Basic salary (rate and units for hourly staff)",
  "Start and end date of the salary period",
  "Allowances, fixed and ad hoc",
  "Other additional payments",
  "Deductions, fixed and ad hoc",
  "Overtime hours worked",
  "Overtime pay",
  "Overtime period, if different from the salary period",
  "Net salary",
] as const;

export { dateLabel };
