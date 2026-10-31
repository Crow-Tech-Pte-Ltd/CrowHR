import { formatDate, formatMoney } from "@crowhr/ui";
import { queryOptions } from "@tanstack/react-query";
import { apiGet } from "../lib/api.ts";

/** Wire shapes of `/api/v1/reports` (mirror packages/core/src/reporting/routes.ts). */
export type ColumnType =
  | "text"
  | "integer"
  | "decimal"
  | "money_cents"
  | "percent"
  | "hours"
  | "date"
  | "datetime"
  | "boolean";
export type Cell = string | number | boolean | null;

export interface CatalogueEntry {
  id: string;
  module: string;
  title: string;
  description: string;
  scope: "all" | "team";
  canExport: boolean;
}

export interface ReportField {
  key: string;
  label: string;
  kind: "date" | "month" | "select";
  options?: { value: string; label: string }[];
  hint?: string;
}

export interface ReportResult {
  report: { id: string; module: string; title: string; description: string };
  params: Record<string, unknown>;
  fields: ReportField[];
  columns: { key: string; title: string; type: ColumnType; total: boolean; optional: boolean }[];
  optionalColumns: { key: string; title: string }[];
  rows: Record<string, Cell>[];
  totals: Record<string, Cell> | null;
  summary: { label: string; value: Cell; type: ColumnType; hint?: string }[];
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

export const catalogueQuery = queryOptions({
  queryKey: ["reports"],
  queryFn: () => apiGet<{ items: CatalogueEntry[] }>("/api/v1/reports"),
});

export function reportQuery(id: string, query: Record<string, string>) {
  const qs = new URLSearchParams(query).toString();
  return queryOptions({
    queryKey: ["reports", id, qs],
    queryFn: () => apiGet<ReportResult>(`/api/v1/reports/${encodeURIComponent(id)}?${qs}` as `/api/${string}`),
    placeholderData: (prev) => prev,
  });
}

export function exportHref(id: string, query: Record<string, string>, format: "csv" | "xlsx") {
  return `/api/v1/reports/${encodeURIComponent(id)}/export?${new URLSearchParams({ ...query, format })}`;
}

export const MODULE_LABEL: Record<string, string> = {
  employees: "People",
  leave: "Leave",
  attendance: "Attendance",
  claims: "Claims",
  payroll: "Payroll",
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Display a cell the Singapore way: S$1,234.56, 31 Oct 2026, 14.3%. */
export function formatCell(value: Cell | undefined, type: ColumnType, key?: string): string {
  if (value === null || value === undefined || value === "") return "—";
  switch (type) {
    case "money_cents":
      return formatMoney(Number(value));
    case "percent":
      return `${(Number(value) / 10).toFixed(1)}%`;
    case "hours": {
      const m = Number(value);
      return `${(Math.round((m * 100) / 60) / 100).toFixed(2)} h`;
    }
    case "integer":
      return Number(value).toLocaleString("en-SG");
    case "decimal":
      return Number(value).toLocaleString("en-SG", { maximumFractionDigits: 2 });
    case "date":
      return formatDate(String(value));
    case "datetime":
      return new Date(String(value)).toLocaleString("en-SG", {
        timeZone: "Asia/Singapore",
        dateStyle: "medium",
        timeStyle: "short",
      });
    case "boolean":
      return value ? "Yes" : "No";
    default: {
      const s = String(value);
      // Month keys (`2026-10`) read as "Oct 2026".
      if (key === "month" && /^\d{4}-\d{2}$/.test(s)) return `${MONTHS[Number(s.slice(5)) - 1]} ${s.slice(0, 4)}`;
      return s;
    }
  }
}

export const isNumeric = (t: ColumnType) => t !== "text" && t !== "boolean" && t !== "date" && t !== "datetime";
