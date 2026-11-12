import { formatDate } from "@crowhr/ui";
import { queryOptions } from "@tanstack/react-query";
import { ApiError, apiGet } from "../lib/api.ts";

/** Wire shapes of `/api/v1/documents` (mirror packages/core/src/documents/routes.ts). */
export interface DocCategory {
  id: string;
  systemKey: string | null;
  name: string;
  sensitivity: "normal" | "medical";
  employeeVisible: boolean;
  managerVisible: boolean;
  payrollVisible: boolean;
  employeeUploadable: boolean;
  expiryRequired: boolean;
  auditViews: boolean;
  retentionMonthsAfterExit: number | null;
  position: number;
  documentCount: number;
}

export interface DocVersion {
  id: string;
  version: number;
  fileName: string | null;
  mime: string | null;
  sizeBytes: number | null;
  sha256: string;
  expiresOn: string | null;
  source: "upload" | "generated";
  templateId: string | null;
  templateVersion: number | null;
  asAt: string | null;
  createdAt: string;
  superseded: boolean;
}

export interface Doc {
  id: string;
  employeeId: string;
  employeeName: string;
  employeeNumber: string;
  category: { id: string; name: string; sensitivity: "normal" | "medical" };
  title: string;
  notes: string | null;
  expiresOn: string | null;
  expiry: "valid" | "expiring" | "expired" | null;
  source: "upload" | "generated";
  current: DocVersion | null;
  previousVersions: DocVersion[];
  acknowledgement: {
    id: string;
    status: "requested" | "acknowledged";
    requestedAt: string;
    acknowledgedAt: string | null;
    fileSha256: string | null;
    current: boolean;
  } | null;
  viewed: boolean;
  createdAt: string;
  deletedAt: string | null;
  canManage: boolean;
}

export interface LetterTemplate {
  id: string;
  kind: string;
  name: string;
  bodyMd: string;
  version: number;
  active: boolean;
  targetCategoryId: string;
  fields: string[];
  usesSalary: boolean;
  updatedAt: string;
}

export interface MergeField {
  id: string;
  label: string;
  group: string;
  sensitivity?: string;
  where: string;
  perDocument?: boolean;
}

export interface AckRow {
  id: string;
  documentId: string;
  documentTitle: string;
  employeeId: string;
  employeeName: string;
  employeeNumber: string;
  version: number;
  requestedAt: string;
  acknowledgedAt: string | null;
  fileSha256: string | null;
  ip: string | null;
}

export interface RetentionRow {
  id: string;
  documentId: string;
  documentTitle: string;
  category: string;
  employeeId: string;
  employeeName: string;
  reason: string;
  reviewFrom: string;
  flaggedAt: string;
}

export type Inline =
  | { t: "text"; text: string }
  | { t: "bold" | "italic"; children: Inline[] }
  | { t: "field"; id: string }
  | { t: "link"; href: string; children: Inline[] };
export type Block =
  | { t: "heading"; level: 1 | 2 | 3; children: Inline[] }
  | { t: "paragraph"; children: Inline[] }
  | { t: "list"; ordered: boolean; items: Inline[][] }
  | { t: "table"; header: Inline[][]; rows: Inline[][][] }
  | { t: "pagebreak" }
  | { t: "anchor"; id: string };

export const LETTER_KIND_LABEL: Record<string, string> = {
  offer: "Offer letter",
  ket: "Key Employment Terms",
  confirmation: "Confirmation",
  promotion: "Promotion",
  salary_adjustment: "Salary adjustment",
  resignation_acceptance: "Resignation acceptance",
  employment_certificate: "Employment certificate",
  custom: "Custom letter",
};

export const categoriesQuery = queryOptions({
  queryKey: ["documents", "categories"],
  queryFn: () => apiGet<{ items: DocCategory[] }>("/api/v1/documents/categories"),
});

/** Documents per page in the web app's lists. */
export const DOCUMENTS_PAGE_SIZE = 25;

export interface DocList {
  items: Doc[];
  total: number;
  page?: number;
  pageSize?: number;
}

/** A document list; pass `page` to get one page of `DOCUMENTS_PAGE_SIZE`. */
export function documentsQuery(filter: Record<string, string>, page?: number) {
  const qs = new URLSearchParams(
    page ? { ...filter, page: String(page), pageSize: String(DOCUMENTS_PAGE_SIZE) } : filter,
  ).toString();
  return queryOptions({
    queryKey: ["documents", "list", qs],
    queryFn: () => apiGet<DocList>(`/api/v1/documents?${qs}` as `/api/${string}`),
    placeholderData: (previous) => previous,
  });
}

export const documentQuery = (id: string) =>
  queryOptions({
    queryKey: ["documents", "one", id],
    queryFn: () => apiGet<Doc>(`/api/v1/documents/${id}` as `/api/${string}`),
  });

export const templatesQuery = queryOptions({
  queryKey: ["documents", "templates"],
  queryFn: () => apiGet<{ items: LetterTemplate[] }>("/api/v1/documents/templates"),
});

export const fieldsQuery = queryOptions({
  queryKey: ["documents", "fields"],
  queryFn: () => apiGet<{ items: MergeField[] }>("/api/v1/documents/fields"),
  staleTime: Number.POSITIVE_INFINITY,
});

export const acknowledgementsQuery = (status: "outstanding" | "completed") =>
  queryOptions({
    queryKey: ["documents", "acks", status],
    queryFn: () => apiGet<{ items: AckRow[] }>(`/api/v1/documents/acknowledgements?status=${status}`),
  });

export const retentionQuery = queryOptions({
  queryKey: ["documents", "retention"],
  queryFn: () => apiGet<{ items: RetentionRow[] }>("/api/v1/documents/retention"),
});

export const requestsQuery = queryOptions({
  queryKey: ["documents", "requests"],
  queryFn: () =>
    apiGet<{
      items: {
        id: string;
        kind: string;
        purpose: string | null;
        status: string;
        documentId: string | null;
        createdAt: string;
      }[];
    }>("/api/v1/documents/requests"),
});

export const fileHref = (id: string, opts: { version?: string; inline?: boolean } = {}) => {
  const p = new URLSearchParams();
  if (opts.version) p.set("version", opts.version);
  if (opts.inline) p.set("inline", "1");
  const qs = p.toString();
  return `/api/v1/documents/${id}/file${qs ? `?${qs}` : ""}`;
};

/** Raw-body upload (the server detects the type from the bytes). */
export async function uploadFile(path: string, file: File, query: Record<string, string>) {
  const qs = new URLSearchParams({ ...query, fileName: file.name });
  const res = await fetch(`${path}?${qs}`, {
    method: "POST",
    body: file,
    headers: { "content-type": "application/octet-stream", accept: "application/json" },
    credentials: "same-origin",
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, body);
  return body as Doc;
}

export function errorText(err: unknown): string {
  if (err instanceof ApiError) {
    const issues = Object.values(err.fieldErrors);
    return issues.length ? `${err.message} ${issues.join(" ")}` : err.message;
  }
  return err instanceof Error ? err.message : "Something went wrong. Try again.";
}

const sizes = ["B", "KB", "MB"];
export function fileSize(n: number | null): string {
  if (!n) return "";
  let i = 0;
  let v = n;
  while (v >= 1024 && i < 2) {
    v /= 1024;
    i++;
  }
  return `${i ? v.toFixed(1) : v} ${sizes[i]}`;
}

/** An instant shown as its Singapore calendar day ("1 Nov 2026"). */
export function sgDay(iso: string): string {
  return formatDate(new Date(Date.parse(iso) + 8 * 3_600_000).toISOString().slice(0, 10));
}
