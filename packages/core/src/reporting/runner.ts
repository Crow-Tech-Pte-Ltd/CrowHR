import { authorize, type Grant } from "../access/authorize.ts";
import { SENSITIVITY_PERMISSION } from "../access/redact.ts";
import { effectiveRoles, singaporeDate } from "../access/scope.ts";
import type { SensitivityClass } from "../access/sensitivity.ts";
import { auditContext, recordAudit } from "../audit/audit.ts";
import type { AppContext } from "../context.ts";
import type { AppDeps } from "../deps.ts";
import { AppError } from "../errors.ts";
import type { CellValue } from "../export/cells.ts";
import { CSV_CONTENT_TYPE, csvStream } from "../export/csv.ts";
import { writeXlsxWorkbook, XLSX_CONTENT_TYPE } from "../export/xlsx.ts";
import { findReport, reportDefinitions } from "./registry.ts";
import type { AnyReportDefinition, ReportColumn, ReportContext, ReportRow, ReportSummaryItem } from "./types.ts";

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
export const MAX_EXPORT_ROWS = 50_000;
/** Rows the runner will hold while sorting; beyond the export limit nothing is shown either. */
const MAX_ROWS = MAX_EXPORT_ROWS;

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
  return { def, ctx, params, columns, redactedColumns };
}

/** Pulls every scoped row (refusing more than the limit), keeping only the visible columns. */
async function collect(p: Prepared): Promise<ReportRow[]> {
  const rows: ReportRow[] = [];
  // Redacted columns and optional columns nobody asked for never leave the runner.
  const visible = new Set(p.columns.map((c) => c.key));
  const hidden = new Set(
    p.def
      .columns(p.params)
      .map((c) => c.key)
      .filter((k) => !visible.has(k)),
  );
  for await (const batch of p.def.run(p.ctx, p.params)) {
    for (const row of batch) {
      if (rows.length >= MAX_ROWS) {
        throw new AppError(
          "too_many_rows",
          `This report has more than ${MAX_EXPORT_ROWS.toLocaleString("en-SG")} rows. Narrow the dates or pick a smaller group, then try again.`,
          { maxRows: MAX_EXPORT_ROWS },
        );
      }
      if (hidden.size) {
        const copy: ReportRow = { ...row };
        for (const k of hidden) delete copy[k];
        rows.push(copy);
      } else rows.push(row);
    }
  }
  return rows;
}

function compare(a: CellValue, b: CellValue): number {
  const an = a === null || a === undefined || a === "";
  const bn = b === null || b === undefined || b === "";
  if (an || bn) return an === bn ? 0 : an ? 1 : -1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  if (typeof a === "boolean" && typeof b === "boolean") return Number(a) - Number(b);
  return String(a).localeCompare(String(b), "en-SG", { numeric: true });
}

export function sortRows(rows: ReportRow[], key: string, dir: "asc" | "desc"): ReportRow[] {
  const sign = dir === "desc" ? -1 : 1;
  return rows
    .map((row, i) => ({ row, i }))
    .sort((x, y) => sign * compare(x.row[key], y.row[key]) || x.i - y.i)
    .map((x) => x.row);
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
  const all = await collect(p);
  const sort = sortOf(p, query);
  const sorted = sortRows(all, sort.key, sort.dir);
  const pageCount = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const page = Math.min(Math.max(1, Math.trunc(Number(query.page ?? 1)) || 1), pageCount);
  const summary = p.def.summary ? await p.def.summary(all, p.ctx, p.params) : [];
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
    rows: sorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    totals: sorted.length ? totalsOf(p.columns, sorted) : null,
    summary,
    page,
    pageSize: PAGE_SIZE,
    totalRows: sorted.length,
    sort,
    redactedColumns: p.redactedColumns,
    emptyMessage: sorted.length ? null : p.def.emptyMessage(p.params),
    notes: [...(p.def.notes ?? [])],
    chart,
    canExport: (await grantFor(c, p.def, p.def.export)) !== null,
  };
}

function paramText(v: unknown): string {
  return v === null || v === undefined ? "" : String(v);
}

/**
 * Export of the full result (not the page) with the same columns and redactions. The CSV body is
 * streamed in 500-row chunks; the XLSX is encoded batch by batch. Audited with the report ID,
 * parameters, row count and redacted columns.
 */
export async function exportReport(c: AppContext, id: string, query: ReportQuery, format: "csv" | "xlsx") {
  const deps: AppDeps = c.var.deps;
  const p = await prepare(c, id, query, "export");
  const sort = sortOf(p, query);
  const rows = sortRows(await collect(p), sort.key, sort.dir);
  const totals = rows.length ? totalsOf(p.columns, rows) : null;
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
  async function* batches() {
    for (let i = 0; i < rows.length; i += 500) yield rows.slice(i, i + 500);
  }
  if (format === "csv") {
    return new Response(csvStream(p.columns, batches()), { headers: { ...headers, "content-type": CSV_CONTENT_TYPE } });
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
