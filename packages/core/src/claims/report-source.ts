import { z } from "zod";
import { displayDate, isIsoDate } from "../employees/dates.ts";
import { inBatches, type ReportDefinition, type ReportSource } from "../reporting/types.ts";
import { claimsSummary } from "./reports.ts";

/**
 * Claims by type, department or month (add-claims "Claim reports", served through reporting).
 * Readers: owner, hr_admin, payroll_admin at organisation scope (`reports_claims:*`). Medical
 * amounts count in every total; merchant and description never appear in this summary.
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

export const claimsReportSource: ReportSource = { module: "claims", reports: [claimsByReport] };
