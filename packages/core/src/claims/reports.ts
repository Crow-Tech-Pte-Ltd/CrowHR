import { sql } from "drizzle-orm";
import { recordAudit } from "../audit/audit.ts";
import type { Db } from "../db/types.ts";
import type { AppDeps } from "../deps.ts";
import { toCsv } from "../employees/import/parse.ts";
import { writeXlsx } from "../employees/xlsx.ts";
import type { ClaimsActor } from "./access.ts";
import { formatRateMicros } from "./money.ts";

/**
 * Claim reports (spec "Claim reports"): totals by type, department, employee or month over an
 * expense-date range, the line register and the payout register, as JSON or CSV/XLSX through the
 * people module's export helpers. Readers are owners, hr_admins and payroll_admins
 * (`reports_claims:*`). Medical amounts count in every total; medical merchants and descriptions
 * are left out for readers without medical access (payroll_admin without owner/hr_admin).
 *
 * Departments are taken from the employment record in force on each line's expense date.
 */

export type SummaryBy = "type" | "department" | "employee" | "month";

export function rowsOf<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  return ((result as { rows?: T[] }).rows ?? []) as T[];
}

const DEPT = sql`(select d.name from employment_records er join departments d on d.org_id = er.org_id and d.id = er.department_id
                   where er.org_id = l.org_id and er.employee_id = c.employee_id and er.effective_from <= l.expense_date
                   order by er.effective_from desc limit 1)`;

export interface SummaryRow {
  key: string;
  label: string;
  status: string;
  claimCount: number;
  lineCount: number;
  totalCents: number;
  gstCents: number;
}

export async function claimsSummary(
  db: Db,
  orgId: string,
  input: { from: string; to: string; by: SummaryBy },
): Promise<SummaryRow[]> {
  const group =
    input.by === "type"
      ? { key: sql`t.code`, label: sql`t.name` }
      : input.by === "employee"
        ? { key: sql`e.employee_number`, label: sql`e.legal_name` }
        : input.by === "month"
          ? { key: sql`to_char(l.expense_date, 'YYYY-MM')`, label: sql`to_char(l.expense_date, 'Mon YYYY')` }
          : { key: sql`coalesce(${DEPT}, '')`, label: sql`coalesce(${DEPT}, 'No department')` };
  const result = await db.execute<{
    key: string;
    label: string;
    status: string;
    claims: string;
    lines: string;
    total: string;
    gst: string;
  }>(sql`
    select ${group.key} as key, ${group.label} as label, c.status,
           count(distinct c.id)::text as claims, count(*)::text as lines,
           sum(l.sgd_cents)::text as total, coalesce(sum(l.gst_cents), 0)::text as gst
      from claim_lines l
      join claims c on c.org_id = l.org_id and c.id = l.claim_id
      join claim_types t on t.org_id = l.org_id and t.id = l.claim_type_id
      join employees e on e.org_id = c.org_id and e.id = c.employee_id
     where l.org_id = ${orgId} and c.status <> 'draft'
       and l.expense_date >= ${input.from} and l.expense_date <= ${input.to}
     group by 1, 2, 3
     order by ${input.by === "month" ? sql`1` : sql`2`}, 3
  `);
  return rowsOf<{
    key: string;
    label: string;
    status: string;
    claims: string;
    lines: string;
    total: string;
    gst: string;
  }>(result).map((r) => ({
    key: r.key,
    label: r.label,
    status: r.status,
    claimCount: Number(r.claims),
    lineCount: Number(r.lines),
    totalCents: Number(r.total),
    gstCents: Number(r.gst),
  }));
}

export interface LineReportRow {
  claimNumber: string | null;
  status: string;
  employeeNumber: string;
  employeeName: string;
  department: string | null;
  typeCode: string;
  typeName: string;
  category: string;
  taxable: boolean;
  expenseDate: string;
  merchant: string | null;
  description: string | null;
  currency: string;
  amountMinor: number;
  currencyExponent: number;
  rateMicros: number | null;
  sgdCents: number;
  gstCents: number | null;
  payoutMethod: string | null;
  approvedOn: string | null;
  paidVia: string | null;
  paidOn: string | null;
  paidReference: string | null;
}

export async function claimLinesReport(
  db: Db,
  orgId: string,
  input: { from: string; to: string; medical: boolean },
): Promise<LineReportRow[]> {
  const result = await db.execute<Record<string, unknown>>(sql`
    select c.claim_number, c.status, e.employee_number, e.legal_name as employee_name,
           ${DEPT} as department, t.code as type_code, t.name as type_name, t.category, t.taxable,
           l.expense_date::text as expense_date, l.merchant, l.description, l.currency, l.amount_minor::text as amount_minor,
           l.currency_exponent, l.rate_micros::text as rate_micros, l.sgd_cents::text as sgd_cents, l.gst_cents::text as gst_cents,
           c.payout_method, c.approved_on::text as approved_on, c.paid_via, c.paid_on::text as paid_on, c.paid_reference
      from claim_lines l
      join claims c on c.org_id = l.org_id and c.id = l.claim_id
      join claim_types t on t.org_id = l.org_id and t.id = l.claim_type_id
      join employees e on e.org_id = c.org_id and e.id = c.employee_id
     where l.org_id = ${orgId} and c.status <> 'draft'
       and l.expense_date >= ${input.from} and l.expense_date <= ${input.to}
     order by l.expense_date, length(c.claim_number), c.claim_number, l.position
  `);
  return rowsOf<Record<string, unknown>>(result).map((r) => {
    const hidden = r.category === "medical" && !input.medical;
    const n = (v: unknown) => (v === null || v === undefined ? null : Number(v));
    return {
      claimNumber: (r.claim_number as string | null) ?? null,
      status: r.status as string,
      employeeNumber: r.employee_number as string,
      employeeName: r.employee_name as string,
      department: (r.department as string | null) ?? null,
      typeCode: r.type_code as string,
      typeName: r.type_name as string,
      category: r.category as string,
      taxable: r.taxable === true || r.taxable === "t",
      expenseDate: r.expense_date as string,
      merchant: hidden ? null : (r.merchant as string),
      description: hidden ? null : (r.description as string),
      currency: r.currency as string,
      amountMinor: Number(r.amount_minor),
      currencyExponent: Number(r.currency_exponent),
      rateMicros: n(r.rate_micros),
      sgdCents: Number(r.sgd_cents),
      gstCents: n(r.gst_cents),
      payoutMethod: (r.payout_method as string | null) ?? null,
      approvedOn: (r.approved_on as string | null) ?? null,
      paidVia: (r.paid_via as string | null) ?? null,
      paidOn: (r.paid_on as string | null) ?? null,
      paidReference: (r.paid_reference as string | null) ?? null,
    };
  });
}

export interface PayoutRow {
  claimNumber: string | null;
  employeeNumber: string;
  employeeName: string;
  totalCents: number;
  paidVia: string;
  paidOn: string;
  paidReference: string | null;
}

export async function payoutRegister(db: Db, orgId: string, input: { from: string; to: string }): Promise<PayoutRow[]> {
  const result = await db.execute<Record<string, unknown>>(sql`
    select c.claim_number, e.employee_number, e.legal_name as employee_name,
           c.total_cents::text as total_cents, c.paid_via, c.paid_on::text as paid_on, c.paid_reference
      from claims c
      join employees e on e.org_id = c.org_id and e.id = c.employee_id
     where c.org_id = ${orgId} and c.status = 'paid' and c.paid_on >= ${input.from} and c.paid_on <= ${input.to}
     order by c.paid_on, length(c.claim_number), c.claim_number
  `);
  return rowsOf<Record<string, unknown>>(result).map((r) => ({
    claimNumber: (r.claim_number as string | null) ?? null,
    employeeNumber: r.employee_number as string,
    employeeName: r.employee_name as string,
    totalCents: Number(r.total_cents),
    paidVia: r.paid_via as string,
    paidOn: r.paid_on as string,
    paidReference: (r.paid_reference as string | null) ?? null,
  }));
}

/** "37.80" — dollars with two decimals, from integer cents (no float arithmetic). */
function dollars(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${sign}${Math.trunc(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

function minor(amount: number, exp: number): string {
  if (exp === 0) return String(amount);
  const div = 10 ** exp;
  return `${Math.trunc(amount / div)}.${String(amount % div).padStart(exp, "0")}`;
}

export type ClaimsExportReport = "summary" | "lines" | "payouts";

/**
 * Builds the export file. Money columns are decimal strings in CSV ("37.80"); in XLSX they are
 * numeric cells so a spreadsheet can sum them (cents ÷ 100, display only, never read back).
 */
export async function exportClaims(
  deps: AppDeps,
  actor: ClaimsActor,
  input: { report: ClaimsExportReport; by: SummaryBy; from: string; to: string; format: "csv" | "xlsx" },
) {
  const medical = actor.roles.has("owner") || actor.roles.has("hr_admin");
  const money = (cents: number | null) =>
    cents === null ? null : input.format === "xlsx" ? cents / 100 : dollars(cents);
  let headers: string[];
  let rows: (string | number | null)[][];
  if (input.report === "summary") {
    const data = await claimsSummary(deps.db, actor.orgId, input);
    headers = [
      input.by === "type"
        ? "Claim type"
        : input.by === "employee"
          ? "Employee"
          : input.by === "month"
            ? "Month"
            : "Department",
      "Status",
      "Claims",
      "Lines",
      "Total (SGD)",
      "GST (SGD)",
    ];
    rows = data.map((r) => [r.label, r.status, r.claimCount, r.lineCount, money(r.totalCents), money(r.gstCents)]);
  } else if (input.report === "payouts") {
    const data = await payoutRegister(deps.db, actor.orgId, input);
    headers = ["Claim", "Employee no.", "Employee", "Amount (SGD)", "Paid via", "Paid on", "Reference"];
    rows = data.map((r) => [
      r.claimNumber,
      r.employeeNumber,
      r.employeeName,
      money(r.totalCents),
      r.paidVia,
      r.paidOn,
      r.paidReference,
    ]);
  } else {
    const data = await claimLinesReport(deps.db, actor.orgId, { from: input.from, to: input.to, medical });
    headers = [
      "Claim",
      "Status",
      "Employee no.",
      "Employee",
      "Department",
      "Type code",
      "Type",
      "Taxable",
      "Expense date",
      "Merchant",
      "Description",
      "Currency",
      "Amount",
      "Rate (SGD per unit)",
      "SGD",
      "GST (SGD)",
      "Payout",
      "Approved on",
      "Paid via",
      "Paid on",
      "Reference",
    ];
    rows = data.map((r) => [
      r.claimNumber,
      r.status,
      r.employeeNumber,
      r.employeeName,
      r.department,
      r.typeCode,
      r.typeName,
      r.taxable ? "Yes" : "No",
      r.expenseDate,
      r.merchant ?? (r.category === "medical" ? "(medical, hidden)" : null),
      r.description ?? (r.category === "medical" ? "(medical, hidden)" : null),
      r.currency,
      minor(r.amountMinor, r.currencyExponent),
      r.rateMicros === null ? null : formatRateMicros(r.rateMicros),
      money(r.sgdCents),
      money(r.gstCents),
      r.payoutMethod,
      r.approvedOn,
      r.paidVia,
      r.paidOn,
      r.paidReference,
    ]);
  }
  await deps.db.transaction(async (tx) => {
    await recordAudit(tx, deps, actor.auditCtx, {
      action: "claims.exported",
      targetType: "organisation",
      targetId: actor.orgId,
      meta: {
        report: input.report,
        by: input.by,
        from: input.from,
        to: input.to,
        format: input.format,
        rows: rows.length,
      },
    });
  });
  const name = `claims-${input.report}-${input.from}-to-${input.to}`;
  return input.format === "xlsx"
    ? {
        body: writeXlsx("Claims", headers, rows),
        contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        fileName: `${name}.xlsx`,
      }
    : { body: toCsv(headers, rows), contentType: "text/csv; charset=utf-8", fileName: `${name}.csv` };
}
