import { authorize, type Grant } from "../access/authorize.ts";
import { SENSITIVITY_PERMISSION } from "../access/redact.ts";
import { effectiveRoles, singaporeDate } from "../access/scope.ts";
import type { SensitivityClass } from "../access/sensitivity.ts";
import { auditContext, recordAudit } from "../audit/audit.ts";
import { requireRecentAuth } from "../auth/guards.ts";
import type { AppContext } from "../context.ts";
import type { AppDeps } from "../deps.ts";
import { AppError } from "../errors.ts";
import type { CellValue } from "../export/cells.ts";
import { CSV_CONTENT_TYPE, csvStream } from "../export/csv.ts";
import { writeXlsxWorkbook, XLSX_CONTENT_TYPE } from "../export/xlsx.ts";
import { getCompanyBranding } from "../organisation/profile.ts";
import { dateLabel, monthLabel } from "../payroll/engine/dates.ts";
import { findReport, reportDefinitions } from "./registry.ts";
import {
  type AnyReportDefinition,
  MAX_REPORT_ROWS,
  type ReportColumn,
  type ReportContext,
  type ReportRow,
  type ReportSummaryItem,
  reportPageNumber,
} from "./types.ts";

/**
 * Runs report definitions for a request (add-reporting specs "Permission and sensitivity
 * enforcement", "On-screen presentation", "CSV and XLSX export"):
 * 1. the reader needs the report's permission at `all` or `team` scope (403 otherwise; 404 for a
 *    report whose module is not installed);
 * 2. `run` gets the scope (null = whole org, or the team's employee IDs) and must apply it — the
 *    conformance test runs every definition as a manager and as another org's owner;
 * 3. columns of a sensitivity class the reader can't see for every employee in scope are dropped
 *    from screen and export and listed in `redactedColumns`;
 * 4. totals and summaries are computed here over every scoped row, never only the page.
 */

export const PAGE_SIZE = 50;
export const MAX_EXPORT_ROWS = MAX_REPORT_ROWS;

export const REPORT_EXPORT_FORMATS = ["csv", "xlsx", "json", "pdf"] as const;

export interface ReportQuery {
  page?: number;
  sort?: string;
  dir?: "asc" | "desc";
  /** Optional columns requested, comma-separated keys. */
  columns?: string;
  [param: string]: unknown;
}

const CONTROL_KEYS = new Set(["page", "sort", "dir", "columns", "format"]);

/** The grant for `def`, or null when the reader may not run it at a supported scope. */
async function grantFor(c: AppContext, def: AnyReportDefinition, permission = def.read): Promise<Grant | null> {
  let grant: Grant;
  try {
    grant = await authorize(c, permission);
  } catch (err) {
    if (err instanceof AppError && err.code === "forbidden") return null;
    throw err;
  }
  const allowed = def.scopes ?? ["all", "team"];
  if (grant.all) return allowed.includes("all") ? grant : null;
  if (grant.scopes.has("team") && allowed.includes("team")) return grant;
  return null;
}

async function canSeeClass(c: AppContext, cls: SensitivityClass, scope: ReadonlySet<string> | null): Promise<boolean> {
  if (cls === "medical") {
    const roles = await effectiveRoles(c);
    return roles.has("owner") || roles.has("hr_admin");
  }
  try {
    const g = await authorize(c, SENSITIVITY_PERMISSION[cls]);
    if (g.all) return true;
    if (scope === null) return false;
    const ids = await g.employeeIds();
    return [...scope].every((id) => ids.has(id));
  } catch (err) {
    if (err instanceof AppError && err.code === "forbidden") return false;
    throw err;
  }
}

export interface CatalogueEntry {
  id: string;
  module: string;
  title: string;
  description: string;
  scope: "all" | "team";
  canExport: boolean;
}

/** Reports the member may run, in registry order (grouped by module by the client). */
export async function catalogue(c: AppContext): Promise<CatalogueEntry[]> {
  const out: CatalogueEntry[] = [];
  for (const def of reportDefinitions(c.var.deps)) {
    const grant = await grantFor(c, def);
    if (!grant) continue;
    out.push({
      id: def.id,
      module: def.module,
      title: def.title,
      description: def.description,
      scope: grant.all ? "all" : "team",
      canExport: (await grantFor(c, def, def.export)) !== null,
    });
  }
  return out;
}

interface Prepared {
  def: AnyReportDefinition;
  ctx: ReportContext;
  params: Record<string, unknown>;
  columns: ReportColumn[];
  redactedColumns: string[];
}

async function prepare(c: AppContext, id: string, query: ReportQuery, purpose: "read" | "export"): Promise<Prepared> {
  const deps = c.var.deps;
  const def = findReport(deps, id);
  if (!def) throw new AppError("not_found", `There is no report "${id}" on this server.`);
  const grant = await grantFor(c, def, purpose === "read" ? def.read : def.export);
  if (!grant) {
    throw new AppError("forbidden", "You don't have permission to run this report. Ask an owner if you need access.", {
      report: def.id,
    });
  }
  const now = deps.clock.now();
  const today = singaporeDate(now);
  const raw: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(query)) if (!CONTROL_KEYS.has(k) && v !== undefined && v !== "") raw[k] = v;
  const parsed = def.params({ today }).safeParse(raw);
  if (!parsed.success) {
    throw new AppError("validation_failed", "Some report parameters need fixing.", {
      issues: parsed.error.issues.map((i) => ({ path: i.path.join(".") || "params", message: i.message })),
    });
  }
  const params = parsed.data as Record<string, unknown>;
  const auth = c.var.auth;
  if (!auth) throw new AppError("unauthenticated", "Sign in to run reports.");
  const employeeIds = grant.all ? null : await grant.employeeIds();
  const ctx: ReportContext = { db: deps.db, deps, orgId: auth.orgId, today, now, employeeIds, grant };
  const requested = new Set(
    String(query.columns ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  );
  const columns: ReportColumn[] = [];
  const redactedColumns: string[] = [];
  for (const col of def.columns(params)) {
    if (col.optional && !requested.has(col.key)) continue;
    if (col.sensitivity && !(await canSeeClass(c, col.sensitivity, employeeIds))) {
      redactedColumns.push(col.key);
      continue;
    }
    columns.push(col);
  }
  ctx.visibleColumns = new Set(columns.map((column) => column.key));
  return { def, ctx, params, columns, redactedColumns };
}

function checkRowLimit(count: number) {
  if (count <= MAX_REPORT_ROWS) return;
  throw new AppError(
    "too_many_rows",
    `This report has more than ${MAX_EXPORT_ROWS.toLocaleString("en-SG")} rows. Narrow the dates or pick a smaller group, then try again.`,
    { maxRows: MAX_EXPORT_ROWS },
  );
}

function visibleRows(p: Prepared) {
  const visible = p.ctx.visibleColumns;
  const hidden = p.def.columns(p.params).filter((c) => !visible?.has(c.key));
  return (row: ReportRow) => {
    if (!hidden.length) return row;
    const copy: ReportRow = { ...row };
    for (const column of hidden) delete copy[column.key];
    return copy;
  };
}

/** Pulls every scoped row (refusing more than the limit), keeping only the visible columns. */
async function collect(p: Prepared): Promise<ReportRow[]> {
  const rows: ReportRow[] = [];
  const project = visibleRows(p);
  for await (const batch of p.def.run(p.ctx, p.params)) {
    checkRowLimit(rows.length + batch.length);
    for (const row of batch) rows.push(project(row));
  }
  return rows;
}

const compareText = new Intl.Collator("en-SG", { numeric: true }).compare;

function compare(a: CellValue, b: CellValue): number {
  const an = a === null || a === undefined || a === "";
  const bn = b === null || b === undefined || b === "";
  if (an || bn) return an === bn ? 0 : an ? 1 : -1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  if (typeof a === "boolean" && typeof b === "boolean") return Number(a) - Number(b);
  return compareText(String(a), String(b));
}

export function sortRows(rows: ReportRow[], key: string, dir: "asc" | "desc"): ReportRow[] {
  const sign = dir === "desc" ? -1 : 1;
  return [...rows].sort((a, b) => sign * compare(a[key], b[key]));
}

/** Column totals over every row; the first text column says "Total". */
export function totalsOf(columns: readonly ReportColumn[], rows: readonly ReportRow[]): ReportRow | null {
  const summed = columns.filter((c) => c.total === "sum");
  if (!summed.length) return null;
  const out: ReportRow = {};
  for (const col of summed) {
    let sum = 0;
    for (const r of rows) {
      const v = r[col.key];
      if (typeof v === "number") sum += v;
    }
    if (col.type !== "decimal" && !Number.isSafeInteger(sum)) {
      throw new AppError("internal", `Total for ${col.title} is out of range.`);
    }
    out[col.key] = col.type === "decimal" ? Math.round(sum * 100) / 100 : sum;
  }
  const label = columns.find((c) => c.total !== "sum" && c.type === "text");
  if (label) out[label.key] = "Total";
  return out;
}

export interface ReportResult {
  report: { id: string; module: string; title: string; description: string };
  params: Record<string, unknown>;
  fields: AnyReportDefinition["fields"];
  columns: { key: string; title: string; type: ReportColumn["type"]; total: boolean; optional: boolean }[];
  optionalColumns: { key: string; title: string }[];
  rows: ReportRow[];
  totals: ReportRow | null;
  summary: ReportSummaryItem[];
  page: number;
  pageSize: number;
  totalRows: number;
  sort: { key: string; dir: "asc" | "desc" };
  redactedColumns: string[];
  emptyMessage: string | null;
  notes: string[];
  chart: { label: string; value: string } | null;
  canExport: boolean;
}

function sortOf(p: Prepared, query: ReportQuery) {
  const key =
    typeof query.sort === "string" && p.columns.some((c) => c.key === query.sort) ? query.sort : p.def.defaultSort.key;
  const dir = query.dir === "asc" || query.dir === "desc" ? query.dir : p.def.defaultSort.dir;
  return { key, dir } as const;
}

export async function runReport(c: AppContext, id: string, query: ReportQuery): Promise<ReportResult> {
  const p = await prepare(c, id, query, "read");
  const sort = sortOf(p, query);
  const requestedPage = Math.trunc(Number(query.page ?? 1)) || 1;
  const pageResult =
    !p.def.summary && !p.columns.some((col) => col.total === "sum")
      ? await p.def.readPage?.(p.ctx, p.params, {
          sort,
          page: requestedPage,
          pageSize: PAGE_SIZE,
          maxRows: MAX_REPORT_ROWS,
        })
      : null;
  let rows: ReportRow[];
  let totals: ReportRow | null = null;
  let summary: ReportSummaryItem[] = [];
  let totalRows: number;
  let page: number;
  if (pageResult) {
    totalRows = pageResult.totalRows;
    checkRowLimit(totalRows);
    page = reportPageNumber(requestedPage, totalRows, PAGE_SIZE);
    rows = pageResult.rows.map(visibleRows(p));
  } else {
    const all = await collect(p);
    const sorted = sortRows(all, sort.key, sort.dir);
    totalRows = sorted.length;
    page = reportPageNumber(requestedPage, totalRows, PAGE_SIZE);
    rows = sorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
    totals = totalRows ? totalsOf(p.columns, sorted) : null;
    summary = (await p.def.summary?.(all, p.ctx, p.params)) ?? [];
  }
  const visible = new Set(p.columns.map((col) => col.key));
  const chart = p.def.chart && visible.has(p.def.chart.label) && visible.has(p.def.chart.value) ? p.def.chart : null;
  if (p.columns.some((col) => col.sensitivity)) {
    // Design decision 6: screen views are audited only when sensitive columns are shown.
    await p.ctx.db.transaction(async (tx) => {
      await recordAudit(tx, c.var.deps, auditContext(c), {
        action: "report.viewed",
        targetType: "report",
        targetId: null,
        meta: {
          report: p.def.id,
          params: p.params,
          sensitiveColumns: p.columns.filter((x) => x.sensitivity).map((x) => x.key),
        },
      });
    });
  }
  return {
    report: { id: p.def.id, module: p.def.module, title: p.def.title, description: p.def.description },
    params: p.params,
    fields: p.def.fields,
    columns: p.columns.map((col) => ({
      key: col.key,
      title: col.title,
      type: col.type,
      total: col.total === "sum",
      optional: !!col.optional,
    })),
    optionalColumns: p.def
      .columns(p.params)
      .filter((col) => col.optional && !p.redactedColumns.includes(col.key))
      .map((col) => ({ key: col.key, title: col.title })),
    rows,
    totals,
    summary,
    page,
    pageSize: PAGE_SIZE,
    totalRows,
    sort,
    redactedColumns: p.redactedColumns,
    emptyMessage: totalRows ? null : p.def.emptyMessage(p.params),
    notes: [...(p.def.notes ?? [])],
    chart,
    canExport: (await grantFor(c, p.def, p.def.export)) !== null,
  };
}

function paramText(v: unknown): string {
  return v === null || v === undefined ? "" : String(v);
}

async function exportPdf(p: Prepared, rows: ReportRow[], totals: ReportRow | null) {
  const { renderReportPdf } = await import("./pdf.ts");
  const branding = await getCompanyBranding(p.ctx.deps, p.ctx.orgId);
  const fields = new Map(p.def.fields.map((field) => [field.key, field]));
  const parameters = Object.entries(p.params).flatMap(([key, param]) => {
    const value = paramText(param);
    if (!value) return [];
    const field = fields.get(key);
    const selected = field?.options?.find((option) => option.value === value)?.label ?? value;
    const formatted =
      field?.kind === "date" ? dateLabel(value) : field?.kind === "month" ? monthLabel(value) : selected;
    const label = field?.label ?? (key === "runId" ? "Payroll run ID" : key);
    return [`${label}: ${formatted}`];
  });
  parameters.push(`${rows.length.toLocaleString("en-SG")} ${rows.length === 1 ? "row" : "rows"}`);
  const notes = [...(p.def.notes ?? [])];
  if (p.redactedColumns.length) {
    const titles = p.def
      .columns(p.params)
      .filter((col) => p.redactedColumns.includes(col.key))
      .map((col) => col.title);
    notes.unshift(`Columns left out: ${titles.join(", ")}.`);
  }
  return renderReportPdf({
    ...branding,
    title: p.def.title,
    generatedAt: p.ctx.now,
    columns: p.columns,
    parameters,
    rows,
    totals,
    summary: (await p.def.summary?.(rows, p.ctx, p.params)) ?? [],
    emptyMessage: rows.length ? null : p.def.emptyMessage(p.params),
    notes,
  });
}

/**
 * Export of the full result (not the page) with the same columns and redactions. The CSV body is
 * streamed in 500-row chunks; the XLSX is encoded batch by batch. Audited with the report ID,
 * parameters, row count and redacted columns.
 */
export async function exportReport(
  c: AppContext,
  id: string,
  query: ReportQuery,
  format: (typeof REPORT_EXPORT_FORMATS)[number],
) {
  const deps: AppDeps = c.var.deps;
  const p = await prepare(c, id, query, "export");
  if (p.columns.some((col) => col.sensitivity === "salary")) requireRecentAuth(c);
  const sort = sortOf(p, query);
  const rows = sortRows(await collect(p), sort.key, sort.dir);
  const totals = rows.length ? totalsOf(p.columns, rows) : null;
  const pdf = format === "pdf" ? await exportPdf(p, rows, totals) : null;
  await deps.db.transaction(async (tx) => {
    await recordAudit(tx, deps, auditContext(c), {
      action: "report.exported",
      targetType: "report",
      targetId: null,
      meta: { report: p.def.id, format, params: p.params, rowCount: rows.length, redactedColumns: p.redactedColumns },
    });
  });
  const stamp = p.ctx.today;
  const base = `${p.def.id.replace(/[^a-z0-9]+/gi, "-")}-${stamp}`;
  const headers = {
    "content-disposition": `attachment; filename="${base}.${format}"`,
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "x-report-rows": String(rows.length),
  };
  if (pdf) {
    return new Response(pdf as BodyInit, {
      headers: { ...headers, "content-type": "application/pdf", "content-length": String(pdf.length) },
    });
  }
  async function* batches() {
    for (let i = 0; i < rows.length; i += 500) yield rows.slice(i, i + 500);
  }
  if (format === "csv") {
    return new Response(csvStream(p.columns, batches()), { headers: { ...headers, "content-type": CSV_CONTENT_TYPE } });
  }
  if (format === "json") {
    const columns = p.columns.map(({ key, title, type }) => ({ key, title, type }));
    return Response.json(
      {
        report: { id: p.def.id, title: p.def.title },
        generatedAt: p.ctx.now.toISOString(),
        params: p.params,
        columns,
        rows: rows.map((row) => Object.fromEntries(columns.map(({ key }) => [key, row[key] ?? null]))),
        totals,
        redactedColumns: p.redactedColumns,
      },
      { headers },
    );
  }
  const auth = c.var.auth;
  const parameters: [string, string][] = [
    ["Report", p.def.title],
    ...p.def.fields.map((f): [string, string] => [f.label, paramText(p.params[f.key])]),
    ["Rows", String(rows.length)],
    ["Columns left out", p.redactedColumns.join(", ") || "None"],
    ["Generated by", `Crow HR, for ${auth?.user.displayName || auth?.user.email || "a member"}`],
    [
      "Generated at",
      `${new Date(p.ctx.now.getTime() + 8 * 3600_000).toISOString().slice(0, 16).replace("T", " ")} (Singapore time)`,
    ],
  ];
  const { bytes } = await writeXlsxWorkbook({
    sheet: p.def.title,
    columns: p.columns,
    batches: batches(),
    parameters,
    totals,
  });
  return new Response(bytes as BodyInit, {
    headers: { ...headers, "content-type": XLSX_CONTENT_TYPE, "content-length": String(bytes.length) },
  });
}
