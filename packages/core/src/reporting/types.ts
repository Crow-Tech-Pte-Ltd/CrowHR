import type { z } from "zod";
import type { Grant } from "../access/authorize.ts";
import type { Permission } from "../access/matrix.ts";
import type { SensitivityClass } from "../access/sensitivity.ts";
import type { Db } from "../db/types.ts";
import type { AppDeps } from "../deps.ts";
import type { CellValue, ExportColumn } from "../export/cells.ts";

/**
 * The report contract (add-reporting design decision 1). A module defines its reports next to its
 * own data and hands them to reporting as a `ReportSource`; reporting owns the catalogue, the
 * parameter checks, permission and sensitivity enforcement, sorting, paging, totals and exports, and
 * never queries a module's tables itself.
 *
 *   export const leaveReportSource: ReportSource = { module: "leave", reports: [leaveTaken, leaveBalances] };
 *
 * then one line in `CORE_REPORT_SOURCES` (reporting/registry.ts).
 */

export type ReportRow = Record<string, CellValue>;

export interface ReportColumn extends ExportColumn {
  /** Dropped for readers who may not see this class for every row in scope (listed in `redactedColumns`). */
  sensitivity?: SensitivityClass;
  /** `sum`: the runner totals it over every scoped row (not just the page). */
  total?: "sum";
  /** Only included when the reader asks for it (`columns=`), e.g. headcount's basic pay. */
  optional?: boolean;
}

export interface ReportParamField {
  key: string;
  label: string;
  kind: "date" | "month" | "select";
  options?: readonly { value: string; label: string }[];
  /** One line under the field, e.g. "Departments as at the end of each month". */
  hint?: string;
}

/** What `run` receives. It must restrict rows to `employeeIds` when that is not null. */
export interface ReportContext {
  db: Db;
  deps: AppDeps;
  orgId: string;
  /** Today in Asia/Singapore (YYYY-MM-DD). */
  today: string;
  now: Date;
  /** null = the whole organisation; otherwise only rows about these employees (a manager's team). */
  employeeIds: ReadonlySet<string> | null;
  /** The reader's grant for the report's read permission. */
  grant: Grant;
}

export interface ReportSummaryItem {
  label: string;
  /** Raw value in the unit of `type` (cents, tenths of a percent…), or null for "n/a". */
  value: CellValue;
  type: ExportColumn["type"];
  hint?: string;
}

export interface ReportDefinition<P extends Record<string, unknown> = Record<string, unknown>> {
  /** `<module>.<name>`, e.g. `people.headcount`. Stable: it is in URLs and audit events. */
  id: string;
  module: string;
  title: string;
  description: string;
  read: Permission;
  export: Permission;
  /**
   * Scopes the report may run at. Default `["all", "team"]`; reports never run at `own` scope
   * (an employee's own data is on their own pages).
   */
  scopes?: readonly ("all" | "team")[];
  /**
   * Parses the query string (all values arrive as strings) and fills defaults, which may depend on
   * today's date. Messages say how to fix the input.
   */
  params(defaults: { today: string }): z.ZodType<P>;
  fields: readonly ReportParamField[];
  columns(params: P): readonly ReportColumn[];
  defaultSort: { key: string; dir: "asc" | "desc" };
  /** Yields rows in batches (about 500 at a time). */
  run(ctx: ReportContext, params: P): AsyncIterable<readonly ReportRow[]>;
  /** Figures computed over every scoped row, e.g. the turnover rate. */
  summary?(
    rows: readonly ReportRow[],
    ctx: ReportContext,
    params: P,
  ): Promise<ReportSummaryItem[]> | ReportSummaryItem[];
  /** "No claims with expense dates in Jan 2026": says which parameters produced no rows. */
  emptyMessage(params: P): string;
  /** Rules shown under the table, e.g. "Departments are as at the end of each month." */
  notes?: readonly string[];
  /** A simple bar chart of one value column by one label column, shown under the table. */
  chart?: { label: string; value: string };
}

// biome-ignore lint/suspicious/noExplicitAny: definitions are stored erased and re-typed by their own params schema.
export type AnyReportDefinition = ReportDefinition<any>;

export interface ReportSource {
  module: string;
  reports: readonly AnyReportDefinition[];
}

/** Batches an array (sources that load everything in one query). */
export async function* inBatches<T>(rows: readonly T[], size = 500): AsyncIterable<readonly T[]> {
  for (let i = 0; i < rows.length; i += size) yield rows.slice(i, i + size);
}
