import { z } from "zod";
import { defineModule, defineRoute } from "../http/route.ts";
import { catalogue, exportReport, type ReportQuery, runReport } from "./runner.ts";

const cell = z.union([z.string(), z.number(), z.boolean(), z.null()]);
const columnType = z.enum([
  "text",
  "integer",
  "decimal",
  "money_cents",
  "percent",
  "hours",
  "date",
  "datetime",
  "boolean",
]);

const catalogueEntry = z.object({
  id: z.string(),
  module: z.string(),
  title: z.string(),
  description: z.string(),
  scope: z.enum(["all", "team"]).meta({ description: "`team`: rows are limited to the reader's reports." }),
  canExport: z.boolean(),
});

const field = z.object({
  key: z.string(),
  label: z.string(),
  kind: z.enum(["date", "month", "select"]),
  options: z.array(z.object({ value: z.string(), label: z.string() })).optional(),
  hint: z.string().optional(),
});

const reportResult = z.object({
  report: z.object({ id: z.string(), module: z.string(), title: z.string(), description: z.string() }),
  params: z.record(z.string(), z.unknown()),
  fields: z.array(field),
  columns: z.array(
    z.object({ key: z.string(), title: z.string(), type: columnType, total: z.boolean(), optional: z.boolean() }),
  ),
  optionalColumns: z.array(z.object({ key: z.string(), title: z.string() })),
  rows: z.array(z.record(z.string(), cell)).meta({
    description:
      "One page (50 rows). Money is integer cents, percentages integer tenths of a percent (143 = 14.3%), hours integer minutes.",
  }),
  totals: z.record(z.string(), cell).nullable(),
  summary: z.array(z.object({ label: z.string(), value: cell, type: columnType, hint: z.string().optional() })),
  page: z.int(),
  pageSize: z.int(),
  totalRows: z.int(),
  sort: z.object({ key: z.string(), dir: z.enum(["asc", "desc"]) }),
  redactedColumns: z
    .array(z.string())
    .meta({ description: "Sensitive columns left out because the reader may not see them for every row." }),
  emptyMessage: z.string().nullable(),
  notes: z.array(z.string()),
  chart: z.object({ label: z.string(), value: z.string() }).nullable(),
  canExport: z.boolean(),
});

const runQuery = z
  .object({
    page: z.coerce.number().int().min(1).optional(),
    sort: z.string().max(64).optional(),
    dir: z.enum(["asc", "desc"]).optional(),
    columns: z.string().max(500).optional().meta({ description: "Optional columns to include, comma-separated." }),
  })
  .catchall(z.string().max(200))
  .meta({ description: "Report parameters (e.g. `asAt`, `from`, `to`, `by`) are passed as further query fields." });

const reportId = z.object({ id: z.string().regex(/^[a-z_]+\.[a-z_]+$/, "Use a report ID such as people.headcount.") });

/** Reports (openspec/changes/add-reporting): the catalogue, one report, and its CSV/XLSX export. */
export const reportsModule = defineModule({
  name: "reports",
  basePath: "/reports",
  tag: "Reports",
  routes: [
    defineRoute({
      method: "get",
      path: "/",
      summary: "Reports the member may run, with the module each reads",
      access: "authenticated",
      responses: { 200: z.object({ items: z.array(catalogueEntry) }) },
      handler: async ({ c }) => ({ items: await catalogue(c) }),
    }),
    defineRoute({
      method: "get",
      path: "/:id",
      summary: "Run a report: one page of rows, totals over every row in scope, redacted columns",
      description:
        "403 when the member may not run the report, 404 when its module isn't installed. Rows are limited to the member's scope (all, or their team).",
      access: "authenticated",
      request: { params: reportId, query: runQuery },
      responses: { 200: reportResult },
      errors: ["forbidden", "not_found", "too_many_rows"],
      crossOrgExempt: "The path holds a report ID, not a record ID; rows are always the caller's organisation.",
      handler: async ({ c, params, query }) => runReport(c, params.id, query as ReportQuery) as never,
    }),
    defineRoute({
      method: "get",
      path: "/:id/export",
      summary: "Export the full report as CSV (UTF-8 with BOM) or XLSX, audit-logged",
      access: "authenticated",
      request: {
        params: reportId,
        query: runQuery.extend({ format: z.enum(["csv", "xlsx"]).default("csv") }),
      },
      responses: { 200: { description: "CSV or XLSX file", contentType: "text/csv" } },
      errors: ["forbidden", "not_found", "too_many_rows"],
      crossOrgExempt: "The path holds a report ID, not a record ID; rows are always the caller's organisation.",
      handler: async ({ c, params, query }) => {
        const { format, ...rest } = query as ReportQuery & { format: "csv" | "xlsx" };
        return exportReport(c, params.id, rest, format);
      },
    }),
  ],
});
