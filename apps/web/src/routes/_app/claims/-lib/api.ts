import type {
  ClaimDto,
  ClaimFileDto,
  ClaimRowDto,
  ClaimStatus,
  ClaimSummaryRowDto,
  ClaimTypeDto,
  ClaimTypeInputDto,
  EligibleClaimTypeDto,
  ErrorEnvelope,
} from "@crowhr/core";
import { queryOptions } from "@tanstack/react-query";
import { ApiError } from "../../../../lib/api.ts";
import { api } from "../../people/-lib/api.ts";

export { errorCode, errorDetails, errorMessage, fieldErrors } from "../../people/-lib/api.ts";
export type {
  ClaimDto,
  ClaimFileDto,
  ClaimRowDto,
  ClaimStatus,
  ClaimSummaryRowDto,
  ClaimTypeDto,
  ClaimTypeInputDto,
  EligibleClaimTypeDto,
};
export { api };

export interface Page<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}

const qs = (o: Record<string, string | number | boolean | undefined | null>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== null && v !== "") p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : "";
};

export interface ClaimListParams {
  mine?: boolean;
  status?: string;
  q?: string;
  employeeId?: string;
  claimTypeId?: string;
  expenseFrom?: string;
  expenseTo?: string;
  sort?: string;
  page?: number;
  pageSize?: number;
}

export const claimKeys = {
  all: ["claims"] as const,
  list: (p: ClaimListParams) => ["claims", "list", p] as const,
  detail: (id: string) => ["claims", "detail", id] as const,
  eligible: (employeeId: string | undefined, date: string, exclude?: string) =>
    ["claims", "eligible", employeeId ?? "me", date, exclude ?? ""] as const,
  types: (archived: boolean) => ["claims", "types", archived] as const,
  starter: ["claims", "types", "starter"] as const,
  settings: ["claims", "settings"] as const,
  totals: ["claims", "totals"] as const,
  summary: (by: string, from: string, to: string) => ["claims", "summary", by, from, to] as const,
};

export const claimListQuery = (p: ClaimListParams) =>
  queryOptions({
    queryKey: claimKeys.list(p),
    queryFn: () =>
      api<Page<ClaimRowDto>>(
        "GET",
        `/claims${qs({ ...p, mine: p.mine ? "true" : undefined, pageSize: p.pageSize ?? 100 })}`,
      ),
  });

export const claimQuery = (id: string) =>
  queryOptions({ queryKey: claimKeys.detail(id), queryFn: () => api<ClaimDto>("GET", `/claims/${id}`) });

export const eligibleTypesQuery = (date: string, opts: { employeeId?: string; excludeClaimId?: string } = {}) =>
  queryOptions({
    queryKey: claimKeys.eligible(opts.employeeId, date, opts.excludeClaimId),
    queryFn: () =>
      api<{ items: EligibleClaimTypeDto[] }>(
        "GET",
        `/claims/eligible-types${qs({ date, employeeId: opts.employeeId, excludeClaimId: opts.excludeClaimId })}`,
      ),
  });

export const claimTypesQuery = (includeArchived = true) =>
  queryOptions({
    queryKey: claimKeys.types(includeArchived),
    queryFn: () =>
      api<{ items: ClaimTypeDto[] }>("GET", `/claims/types${includeArchived ? "?includeArchived=true" : ""}`),
  });

export const starterTypesQuery = queryOptions({
  queryKey: claimKeys.starter,
  queryFn: () => api<{ items: ClaimTypeInputDto[] }>("GET", "/claims/types/starter"),
});

export const claimSettingsQuery = queryOptions({
  queryKey: claimKeys.settings,
  queryFn: () => api<{ submissionWindowDays: number; scanning?: boolean }>("GET", "/claims/settings"),
});

export const myTotalsQuery = queryOptions({
  queryKey: claimKeys.totals,
  queryFn: () =>
    api<{ submittedCents: number; approvedCents: number; paidThisYearCents: number }>("GET", "/claims/me/totals"),
});

export const summaryQuery = (by: string, from: string, to: string) =>
  queryOptions({
    queryKey: claimKeys.summary(by, from, to),
    queryFn: () => api<{ items: ClaimSummaryRowDto[] }>("GET", `/claims/reports/summary${qs({ by, from, to })}`),
  });

export const exportHref = (p: { report: string; by?: string; from: string; to: string; format: "csv" | "xlsx" }) =>
  `/api/v1/claims/reports/export${qs(p)}`;

/** Uploads a receipt as the raw request body; the server detects the type from the bytes. */
export async function uploadReceipt(file: File, employeeId?: string): Promise<ClaimFileDto> {
  const res = await fetch(`/api/v1/claims/receipts${qs({ fileName: file.name, employeeId })}`, {
    method: "POST",
    credentials: "same-origin",
    headers: { accept: "application/json", "content-type": "application/octet-stream" },
    body: file,
  });
  const json = (await res.json().catch(() => null)) as unknown;
  if (!res.ok) throw new ApiError(res.status, (json as ErrorEnvelope | null) ?? null);
  return json as ClaimFileDto;
}

export interface LineDraft {
  claimTypeId: string;
  expenseDate: string;
  merchant: string;
  description: string;
  currency: string;
  amountMinor: number;
  rate: string | null;
  gstCents: number | null;
  receiptIds: string[];
}

export const STATUS_LABEL: Record<ClaimStatus, string> = {
  draft: "Draft",
  submitted: "Waiting for approval",
  approved: "Approved, to be paid",
  rejected: "Rejected",
  withdrawn: "Withdrawn",
  paid: "Paid",
};

export const STATUS_TONE: Record<ClaimStatus, "neutral" | "info" | "success" | "warning" | "danger"> = {
  draft: "neutral",
  submitted: "warning",
  approved: "success",
  rejected: "danger",
  withdrawn: "neutral",
  paid: "neutral",
};
