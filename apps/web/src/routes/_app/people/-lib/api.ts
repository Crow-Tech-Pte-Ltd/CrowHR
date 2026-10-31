import type {
  ChangeRequestDto,
  ChecklistDto,
  CompanyProfileView,
  DirectoryRowDto,
  EmployeeDetailDto,
  ErrorEnvelope,
  ImportPreviewDto,
  SetupChecklist,
  StructureItem,
  StructureKind,
  WorkScheduleView,
} from "@crowhr/core";
import { type QueryClient, queryOptions } from "@tanstack/react-query";
import { ApiError } from "../../../../lib/api.ts";

/** JSON call against `/api/v1`. Throws ApiError carrying the server's error envelope. */
export async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api/v1${path}`, {
    method,
    credentials: "same-origin",
    headers: { accept: "application/json", ...(body === undefined ? {} : { "content-type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 204) return undefined as T;
  const json = (await res.json().catch(() => null)) as unknown;
  if (!res.ok) throw new ApiError(res.status, (json as ErrorEnvelope | null) ?? null);
  return json as T;
}

/** Field path → message from a validation error (e.g. `person.idNumber`). */
export function fieldErrors(err: unknown): Record<string, string> {
  if (!(err instanceof ApiError)) return {};
  const details = err.envelope?.error.details as { issues?: { path: string; message: string }[] } | undefined;
  const out: Record<string, string> = {};
  for (const i of details?.issues ?? []) if (!out[i.path]) out[i.path] = i.message;
  return out;
}

export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.envelope?.error.message ?? `Request failed (${err.status}).`;
  return err instanceof Error ? err.message : "Something went wrong.";
}

/** The API error code (`duplicate_id_number`, `in_use`, …), or undefined for other failures. */
export function errorCode(err: unknown): string | undefined {
  return err instanceof ApiError ? err.code : undefined;
}

export function errorDetails<T = Record<string, unknown>>(err: unknown): T | null {
  return err instanceof ApiError ? ((err.envelope?.error.details as T | undefined) ?? null) : null;
}

export interface Reference {
  banks: { code: string; name: string }[];
  workPassTypes: { code: string; label: string }[];
  races: string[];
  religions: string[];
  genders: string[];
  employmentTypes: string[];
  terminationReasons: string[];
  exportColumns: { key: string; label: string }[];
}

export interface DirectoryQuery {
  q?: string;
  departmentId?: string;
  locationId?: string;
  status?: string;
  scope?: "team";
}

const qs = (o: Record<string, string | undefined>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) if (v) p.set(k, v);
  const s = p.toString();
  return s ? `?${s}` : "";
};

export const peopleKeys = {
  all: ["people"] as const,
  reference: ["people", "reference"] as const,
  directory: (q: DirectoryQuery) => ["people", "directory", q] as const,
  employee: (id: string) => ["people", "employee", id] as const,
  checklists: (id: string) => ["people", "checklists", id] as const,
  me: ["people", "me"] as const,
  structure: (kind: StructureKind) => ["org", "structure", kind] as const,
  schedules: ["org", "schedules"] as const,
  profile: ["org", "profile"] as const,
  setup: ["org", "setup"] as const,
};

export const referenceQuery = queryOptions({
  queryKey: peopleKeys.reference,
  queryFn: () => api<Reference>("GET", "/people/reference"),
  staleTime: Number.POSITIVE_INFINITY,
});

export const directoryQuery = (q: DirectoryQuery) =>
  queryOptions({
    queryKey: peopleKeys.directory(q),
    queryFn: () =>
      api<{ items: DirectoryRowDto[]; total: number }>(
        "GET",
        `/employees${qs({ ...q, pageSize: "200", sort: "name" })}`,
      ),
  });

export const employeeQuery = (id: string) =>
  queryOptions({ queryKey: peopleKeys.employee(id), queryFn: () => api<EmployeeDetailDto>("GET", `/employees/${id}`) });

export const checklistsQuery = (id: string) =>
  queryOptions({
    queryKey: peopleKeys.checklists(id),
    queryFn: () => api<{ items: ChecklistDto[] }>("GET", `/employees/${id}/checklists`),
  });

export const meQuery = queryOptions({
  queryKey: peopleKeys.me,
  queryFn: () => api<{ employee: EmployeeDetailDto; changeRequests: ChangeRequestDto[] }>("GET", "/people/me/profile"),
});

export const structureQuery = (kind: StructureKind) =>
  queryOptions({
    queryKey: peopleKeys.structure(kind),
    queryFn: () => api<{ items: StructureItem[] }>("GET", `/organisation/structure/${kind}`),
  });

export const schedulesQuery = queryOptions({
  queryKey: peopleKeys.schedules,
  queryFn: () => api<{ items: WorkScheduleView[] }>("GET", "/organisation/work-schedules"),
});

export const companyQuery = queryOptions({
  queryKey: peopleKeys.profile,
  queryFn: () => api<{ profile: CompanyProfileView | null }>("GET", "/organisation/profile"),
});

export const setupQuery = queryOptions({
  queryKey: peopleKeys.setup,
  queryFn: () => api<SetupChecklist>("GET", "/organisation/setup-checklist"),
});

export function invalidatePeople(qc: QueryClient) {
  return Promise.all([qc.invalidateQueries({ queryKey: peopleKeys.all }), qc.invalidateQueries({ queryKey: ["org"] })]);
}

export type { ImportPreviewDto };
