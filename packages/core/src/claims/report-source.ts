import { type SQL, sql } from "drizzle-orm";
import { z } from "zod";
import { singaporeDate } from "../access/scope.ts";
import { displayDate, displayMonth, isIsoDate } from "../employees/dates.ts";
import { inBatches, type ReportContext, type ReportDefinition, type ReportSource } from "../reporting/types.ts";
import { periodOf } from "./caps.ts";
import { claimsSummary, rowsOf } from "./reports.ts";

/**
 * Claim reports (add-claims "Claim reports", task 4.1), served through reporting:
 * - `claims.summary`: by type, department or month (count, SGD total, GST total) per status;
 * - `claims.ageing`: waiting claims with their age (submitted more than 7 days ago flagged);
 * - `claims.cap_usage`: per-employee cap usage for a month (monthly and yearly caps);
 * - `claims.payouts`: the payout register (paid claims with method, date and reference);
 * - `claims.lines`: the line register.
 * Readers: owner, hr_admin, payroll_admin at organisation scope (`reports_claims:*`). Medical
 * amounts count in every total. Merchants, descriptions and receipt counts of medical lines are
 * left out, row by row, for readers without medical access (only owners and hr_admins have it).
 */

const isoDate = z.string().refine(isIsoDate, { message: "Use the date format YYYY-MM-DD, like 2026-10-31." });

const STATUS_LABEL: Record<string, string> = {
  submitted: "Waiting for approval",
  approved: "Approved, not paid",
  paid: "Paid",
  rejected: "Rejected",
  withdrawn: "Withdrawn",
};

const params = ({ today }: { today: string }) =>
  z
    .object({
      from: isoDate.default(`${today.slice(0, 4)}-01-01`),
      to: isoDate.default(today),
      by: z.enum(["type", "department", "month"]).default("type"),
    })
    .refine((p) => p.from <= p.to, { message: "Pick a start date on or before the end date.", path: ["from"] });

const BY_TITLE = { type: "Claim type", department: "Department", month: "Month" } as const;

export const claimsByReport: ReportDefinition<z.output<ReturnType<typeof params>>> = {
  id: "claims.summary",
  module: "claims",
  title: "Claims by type, department or month",
  description: "Claim amounts by expense date, per status, grouped by claim type, department or month.",
  read: "reports_claims:read",
  export: "reports_claims:export",
  scopes: ["all"],
  params,
  fields: [
    { key: "from", label: "Expenses from", kind: "date" },
    { key: "to", label: "Expenses to", kind: "date" },
    {
      key: "by",
      label: "Group by",
      kind: "select",
      options: [
        { value: "type", label: "Claim type" },
        { value: "department", label: "Department" },
        { value: "month", label: "Month" },
      ],
    },
  ],
  columns: (p) => [
    { key: "group", title: BY_TITLE[p.by], type: "text" },
    { key: "status", title: "Status", type: "text" },
    { key: "claims", title: "Claims", type: "integer", total: "sum" },
    { key: "lines", title: "Lines", type: "integer", total: "sum" },
    { key: "totalCents", title: "Amount (S$)", type: "money_cents", total: "sum" },
    { key: "gstCents", title: "GST (S$)", type: "money_cents", total: "sum" },
  ],
  defaultSort: { key: "totalCents", dir: "desc" },
  async *run(ctx, p) {
    if (ctx.employeeIds) return; // organisation scope only (scopes: ["all"])
    const rows = await claimsSummary(ctx.db, ctx.orgId, p);
    yield* inBatches(
      rows.map((r) => ({
        group: p.by === "month" ? r.key : r.label,
        status: STATUS_LABEL[r.status] ?? r.status,
        claims: r.claimCount,
        lines: r.lineCount,
        totalCents: r.totalCents,
        gstCents: r.gstCents,
      })),
    );
  },
  emptyMessage: (p) =>
    `No claims with expense dates between ${displayDate(p.from)} and ${displayDate(p.to)}. Widen the dates.`,
  notes: ["Drafts are left out. Departments are as on each expense date. Medical claims are counted in every total."],
  chart: { label: "group", value: "totalCents" },
};

/** `and c.employee_id in (…)` for a scoped run; null when the scope is empty (no rows). */
function scopeSql(ctx: ReportContext): SQL | null {
  if (!ctx.employeeIds) return sql``;
  if (ctx.employeeIds.size === 0) return null;
  return sql`and c.employee_id in (${sql.join(
    [...ctx.employeeIds].map((id) => sql`${id}`),
    sql`, `,
  )})`;
}

/** The claimant's department on `on` (a date expression), from their employment records. */
const deptOn = (on: SQL) => sql`(select d.name from employment_records er
   join departments d on d.org_id = er.org_id and d.id = er.department_id
  where er.org_id = c.org_id and er.employee_id = c.employee_id and er.effective_from <= ${on}
  order by er.effective_from desc limit 1)`;

/** Owners and HR admins see medical details; payroll admins see medical amounts only. */
const medicalAccess = (ctx: ReportContext) => ctx.grant.roles.has("owner") || ctx.grant.roles.has("hr_admin");

const MEDICAL_HIDDEN = "Medical, hidden";

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

const PAID_VIA: Record<string, string> = { payroll: "Payroll", outside: "Outside payroll" };

const dateRange =
  (fromDefault: (today: string) => string) =>
  ({ today }: { today: string }) =>
    z
      .object({ from: isoDate.default(fromDefault(today)), to: isoDate.default(today) })
      .refine((p) => p.from <= p.to, { message: "Pick a start date on or before the end date.", path: ["from"] });

// ---------------------------------------------------------------- status ageing

const AGE_FLAG_DAYS = 7;

const ageingParams = () => z.object({});

export const claimsAgeingReport: ReportDefinition<z.output<ReturnType<typeof ageingParams>>> = {
  id: "claims.ageing",
  module: "claims",
  title: "Claims waiting, by age",
  description: "Claims waiting for approval or for payment, with how long each has waited.",
  read: "reports_claims:read",
  export: "reports_claims:export",
  scopes: ["all"],
  params: ageingParams,
  fields: [],
  columns: () => [
    { key: "claim", title: "Claim", type: "text" },
    { key: "employee", title: "Employee", type: "text" },
    { key: "employeeNumber", title: "Employee no.", type: "text" },
    { key: "department", title: "Department", type: "text" },
    { key: "status", title: "Status", type: "text" },
    { key: "submittedOn", title: "Submitted", type: "date" },
    { key: "approvedOn", title: "Approved", type: "date" },
    { key: "daysWaiting", title: "Days waiting", type: "integer" },
    { key: "overSevenDays", title: `Over ${AGE_FLAG_DAYS} days`, type: "boolean" },
    { key: "totalCents", title: "Amount (S$)", type: "money_cents", total: "sum" },
  ],
  defaultSort: { key: "daysWaiting", dir: "desc" },
  async *run(ctx) {
    const scope = scopeSql(ctx);
    if (!scope) return;
    const result = await ctx.db.execute(sql`
      select c.claim_number, c.status, c.submitted_at, c.approved_on::text as approved_on, c.total_cents::text as total,
             e.employee_number, e.legal_name, ${deptOn(sql`${ctx.today}::date`)} as department
        from claims c
        join employees e on e.org_id = c.org_id and e.id = c.employee_id
       where c.org_id = ${ctx.orgId} and c.status in ('submitted', 'approved') ${scope}
       order by c.submitted_at
    `);
    const nowMs = ctx.now.getTime();
    yield* inBatches(
      rowsOf<Record<string, unknown>>(result).map((r) => {
        const submittedAt = r.submitted_at ? new Date(r.submitted_at as string | Date) : null;
        const approvedOn = (r.approved_on as string | null) ?? null;
        const waiting = r.status === "submitted";
        // Whole days since submission, as on the claims list; approved claims count from approval.
        let days: number | null = null;
        if (waiting && submittedAt) days = Math.floor((nowMs - submittedAt.getTime()) / 86_400_000);
        else if (!waiting && approvedOn) days = daysBetween(approvedOn, ctx.today);
        return {
          claim: (r.claim_number as string | null) ?? null,
          employee: r.legal_name as string,
          employeeNumber: r.employee_number as string,
          department: (r.department as string | null) ?? null,
          status: STATUS_LABEL[r.status as string] ?? (r.status as string),
          submittedOn: submittedAt ? singaporeDate(submittedAt) : null,
          approvedOn,
          daysWaiting: days,
          overSevenDays: waiting && days !== null && days > AGE_FLAG_DAYS,
          totalCents: Number(r.total),
        };
      }),
    );
  },
  summary(rows) {
    const waiting = rows.filter((r) => r.status === STATUS_LABEL.submitted);
    return [
      { label: "Waiting for approval", value: waiting.length, type: "integer" },
      {
        label: `Waiting more than ${AGE_FLAG_DAYS} days`,
        value: waiting.filter((r) => r.overSevenDays === true).length,
        type: "integer",
      },
      {
        label: "Approved, not paid",
        value: rows.filter((r) => r.status === STATUS_LABEL.approved).length,
        type: "integer",
      },
      {
        label: "Amount waiting",
        value: rows.reduce((acc, r) => acc + Number(r.totalCents ?? 0), 0),
        type: "money_cents",
      },
    ];
  },
  emptyMessage: () => "No claims are waiting for approval or payment.",
  notes: [
    `Claims waiting for approval more than ${AGE_FLAG_DAYS} days are flagged. Days count from submission, or from approval for claims waiting to be paid.`,
  ],
};

// ---------------------------------------------------------------- cap usage

const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Use the month format YYYY-MM, like 2026-10.");
const capParams = ({ today }: { today: string }) => z.object({ month: month.default(today.slice(0, 7)) });

export const claimsCapUsageReport: ReportDefinition<z.output<ReturnType<typeof capParams>>> = {
  id: "claims.cap_usage",
  module: "claims",
  title: "Cap usage by employee",
  description: "For each employee and capped claim type: the cap, what is used and pending, and what remains.",
  read: "reports_claims:read",
  export: "reports_claims:export",
  scopes: ["all"],
  params: capParams,
  fields: [{ key: "month", label: "Month", kind: "month", hint: "Yearly caps use the year of this month." }],
  columns: () => [
    { key: "employee", title: "Employee", type: "text" },
    { key: "employeeNumber", title: "Employee no.", type: "text" },
    { key: "department", title: "Department", type: "text" },
    { key: "type", title: "Claim type", type: "text" },
    { key: "period", title: "Cap period", type: "text" },
    { key: "capCents", title: "Cap (S$)", type: "money_cents" },
    { key: "usedCents", title: "Used (S$)", type: "money_cents", total: "sum" },
    { key: "pendingCents", title: "Pending (S$)", type: "money_cents", total: "sum" },
    { key: "remainingCents", title: "Remaining (S$)", type: "money_cents" },
    { key: "usedPercent", title: "Taken up", type: "percent" },
  ],
  defaultSort: { key: "employee", dir: "asc" },
  async *run(ctx, p) {
    const scope = scopeSql(ctx);
    if (!scope) return;
    const first = `${p.month}-01`;
    const m = periodOf("monthly", first);
    const y = periodOf("yearly", first);
    const result = await ctx.db.execute(sql`
      select e.employee_number, e.legal_name, t.name as type_name, t.cap_period, t.cap_cents::text as cap,
             ${deptOn(sql`least(${ctx.today}::date, ${m.to}::date - 1)`)} as department,
             coalesce(sum(l.sgd_cents) filter (where c.status in ('approved', 'paid')), 0)::text as used,
             coalesce(sum(l.sgd_cents) filter (where c.status = 'submitted'), 0)::text as pending
        from claim_lines l
        join claims c on c.org_id = l.org_id and c.id = l.claim_id
        join claim_types t on t.org_id = l.org_id and t.id = l.claim_type_id
        join employees e on e.org_id = c.org_id and e.id = c.employee_id
       where l.org_id = ${ctx.orgId} and t.cap_cents is not null and t.cap_period in ('monthly', 'yearly')
         and c.status in ('submitted', 'approved', 'paid')
         and l.expense_date >= (case when t.cap_period = 'monthly' then ${m.from}::date else ${y.from}::date end)
         and l.expense_date < (case when t.cap_period = 'monthly' then ${m.to}::date else ${y.to}::date end)
         ${scope}
       group by c.org_id, c.employee_id, e.employee_number, e.legal_name, t.id, t.name, t.cap_period, t.cap_cents
       order by e.legal_name, t.name
    `);
    yield* inBatches(
      rowsOf<Record<string, unknown>>(result).map((r) => {
        const cap = Number(r.cap);
        const used = Number(r.used);
        const pending = Number(r.pending);
        return {
          employee: r.legal_name as string,
          employeeNumber: r.employee_number as string,
          department: (r.department as string | null) ?? null,
          type: r.type_name as string,
          period: r.cap_period === "monthly" ? m.label : y.label,
          capCents: cap,
          usedCents: used,
          pendingCents: pending,
          remainingCents: Math.max(0, cap - used - pending),
          // Tenths of a percent of the cap taken by used and pending claims (not money).
          usedPercent: Math.round(((used + pending) * 1000) / cap),
        };
      }),
    );
  },
  emptyMessage: (p) =>
    `No claims against monthly caps in ${displayMonth(Number(p.month.slice(0, 4)), Number(p.month.slice(5, 7)))} or yearly caps in ${p.month.slice(0, 4)}. Pick another month.`,
  notes: [
    "Used counts approved and paid claims; pending counts claims waiting for approval; both by expense date. Only employees with claims against a capped type are listed. Per-claim caps are checked on each claim and are not listed here.",
  ],
};

// ---------------------------------------------------------------- payout register

const payoutParams = dateRange((today) => `${today.slice(0, 7)}-01`);

export const claimsPayoutsReport: ReportDefinition<z.output<ReturnType<typeof payoutParams>>> = {
  id: "claims.payouts",
  module: "claims",
  title: "Claims payout register",
  description: "Paid claims with how and when they were paid, and the payment reference.",
  read: "reports_claims:read",
  export: "reports_claims:export",
  scopes: ["all"],
  params: payoutParams,
  fields: [
    { key: "from", label: "Paid from", kind: "date" },
    { key: "to", label: "Paid to", kind: "date" },
  ],
  columns: () => [
    { key: "claim", title: "Claim", type: "text" },
    { key: "employee", title: "Employee", type: "text" },
    { key: "employeeNumber", title: "Employee no.", type: "text" },
    { key: "paidOn", title: "Paid on", type: "date" },
    { key: "paidVia", title: "Paid via", type: "text" },
    { key: "reference", title: "Reference", type: "text" },
    { key: "totalCents", title: "Amount (S$)", type: "money_cents", total: "sum" },
  ],
  defaultSort: { key: "paidOn", dir: "asc" },
  async *run(ctx, p) {
    const scope = scopeSql(ctx);
    if (!scope) return;
    const result = await ctx.db.execute(sql`
      select c.claim_number, e.employee_number, e.legal_name, c.total_cents::text as total,
             c.paid_via, c.paid_on::text as paid_on, c.paid_reference
        from claims c
        join employees e on e.org_id = c.org_id and e.id = c.employee_id
       where c.org_id = ${ctx.orgId} and c.status = 'paid' and c.paid_on >= ${p.from} and c.paid_on <= ${p.to} ${scope}
       order by c.paid_on, c.claim_number
    `);
    yield* inBatches(
      rowsOf<Record<string, unknown>>(result).map((r) => ({
        claim: (r.claim_number as string | null) ?? null,
        employee: r.legal_name as string,
        employeeNumber: r.employee_number as string,
        paidOn: r.paid_on as string,
        paidVia: PAID_VIA[r.paid_via as string] ?? (r.paid_via as string),
        reference: (r.paid_reference as string | null) ?? null,
        totalCents: Number(r.total),
      })),
    );
  },
  emptyMessage: (p) => `No claims paid between ${displayDate(p.from)} and ${displayDate(p.to)}. Widen the dates.`,
  notes: [
    "Paid on is the payroll payment date for claims paid through payroll, or the date entered for claims paid outside payroll.",
  ],
};

// ---------------------------------------------------------------- line register

const lineParams = dateRange((today) => `${today.slice(0, 7)}-01`);

function minorAmount(amount: number, exp: number): string {
  if (exp === 0) return String(amount);
  const div = 10 ** exp;
  return `${Math.trunc(amount / div)}.${String(amount % div).padStart(exp, "0")}`;
}

export const claimsLinesReport: ReportDefinition<z.output<ReturnType<typeof lineParams>>> = {
  id: "claims.lines",
  module: "claims",
  title: "Claim lines register",
  description: "Every submitted claim line by expense date, with merchant, amount, GST and receipts.",
  read: "reports_claims:read",
  export: "reports_claims:export",
  scopes: ["all"],
  params: lineParams,
  fields: [
    { key: "from", label: "Expenses from", kind: "date" },
    { key: "to", label: "Expenses to", kind: "date" },
  ],
  columns: () => [
    { key: "claim", title: "Claim", type: "text" },
    { key: "status", title: "Status", type: "text" },
    { key: "employee", title: "Employee", type: "text" },
    { key: "department", title: "Department", type: "text" },
    { key: "type", title: "Claim type", type: "text" },
    { key: "expenseDate", title: "Expense date", type: "date" },
    { key: "merchant", title: "Merchant", type: "text" },
    { key: "description", title: "Description", type: "text" },
    { key: "amount", title: "Amount", type: "text" },
    { key: "sgdCents", title: "SGD (S$)", type: "money_cents", total: "sum" },
    { key: "gstCents", title: "GST (S$)", type: "money_cents", total: "sum" },
    { key: "receipts", title: "Receipts", type: "integer" },
  ],
  defaultSort: { key: "expenseDate", dir: "asc" },
  async *run(ctx, p) {
    const scope = scopeSql(ctx);
    if (!scope) return;
    const medical = medicalAccess(ctx);
    const result = await ctx.db.execute(sql`
      select c.claim_number, c.status, e.legal_name, ${deptOn(sql`l.expense_date`)} as department,
             t.name as type_name, t.category, l.expense_date::text as expense_date, l.merchant, l.description,
             l.currency, l.amount_minor::text as amount_minor, l.currency_exponent,
             l.sgd_cents::text as sgd, l.gst_cents::text as gst,
             (select count(*) from claim_line_files f where f.org_id = l.org_id and f.claim_line_id = l.id)::text as receipts
        from claim_lines l
        join claims c on c.org_id = l.org_id and c.id = l.claim_id
        join claim_types t on t.org_id = l.org_id and t.id = l.claim_type_id
        join employees e on e.org_id = c.org_id and e.id = c.employee_id
       where l.org_id = ${ctx.orgId} and c.status <> 'draft'
         and l.expense_date >= ${p.from} and l.expense_date <= ${p.to} ${scope}
       order by l.expense_date, c.claim_number, l.position
    `);
    yield* inBatches(
      rowsOf<Record<string, unknown>>(result).map((r) => {
        const hidden = r.category === "medical" && !medical;
        return {
          claim: (r.claim_number as string | null) ?? null,
          status: STATUS_LABEL[r.status as string] ?? (r.status as string),
          employee: r.legal_name as string,
          department: (r.department as string | null) ?? null,
          type: r.type_name as string,
          expenseDate: r.expense_date as string,
          merchant: hidden ? null : (r.merchant as string),
          description: hidden ? MEDICAL_HIDDEN : (r.description as string),
          amount: `${minorAmount(Number(r.amount_minor), Number(r.currency_exponent))} ${r.currency as string}`,
          sgdCents: Number(r.sgd),
          gstCents: r.gst === null || r.gst === undefined ? null : Number(r.gst),
          receipts: hidden ? null : Number(r.receipts),
        };
      }),
    );
  },
  emptyMessage: (p) =>
    `No claim lines with expense dates between ${displayDate(p.from)} and ${displayDate(p.to)}. Widen the dates.`,
  notes: [
    "Drafts are left out. Departments are as on each expense date.",
    "Merchants, descriptions and receipts of medical lines are shown only to owners and HR admins; medical amounts count in every total.",
  ],
};

export const claimsReportSource: ReportSource = {
  module: "claims",
  reports: [claimsByReport, claimsAgeingReport, claimsCapUsageReport, claimsPayoutsReport, claimsLinesReport],
};
