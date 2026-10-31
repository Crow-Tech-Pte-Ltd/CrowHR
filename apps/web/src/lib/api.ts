import type { ErrorEnvelope, HealthResponse } from "@crowhr/core";

/** Thrown for any non-2xx API response; carries the server's error envelope. */
export class ApiError extends Error {
  readonly status: number;
  readonly envelope: ErrorEnvelope | null;
  constructor(status: number, envelope: ErrorEnvelope | null) {
    super(envelope?.error.message ?? `Request failed with status ${status}.`);
    this.status = status;
    this.envelope = envelope;
  }
  get code(): string | undefined {
    return this.envelope?.error.code;
  }
  /** Per-field messages from a 400 validation_failed, keyed by dotted path. */
  get fieldErrors(): Record<string, string> {
    const issues = (this.envelope?.error.details as { issues?: { path: string; message: string }[] } | undefined)
      ?.issues;
    return Object.fromEntries((issues ?? []).map((i) => [i.path, i.message]));
  }
}

type ApiPath = `/api/${string}`;

/** JSON fetch against same-origin `/api`. Cookies are sent; CSRF is covered by same-origin + Origin checks. */
export async function api<T>(path: ApiPath, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("accept", "application/json");
  let body = init.body;
  if (init.json !== undefined) {
    headers.set("content-type", "application/json");
    body = JSON.stringify(init.json);
  }
  const res = await fetch(path, { ...init, body, headers, credentials: "same-origin" });
  if (res.status === 204) return undefined as T;
  const parsed = (await res.json().catch(() => null)) as unknown;
  if (!res.ok) throw new ApiError(res.status, (parsed as ErrorEnvelope | null) ?? null);
  return parsed as T;
}

export const apiGet = <T>(path: ApiPath, init?: RequestInit) => api<T>(path, init);
export const apiPost = <T>(path: ApiPath, json?: unknown) => api<T>(path, { method: "POST", json: json ?? {} });
export const apiPatch = <T>(path: ApiPath, json: unknown) => api<T>(path, { method: "PATCH", json });
export const apiPut = <T>(path: ApiPath, json: unknown) => api<T>(path, { method: "PUT", json });
export const apiDelete = <T = void>(path: ApiPath) => api<T>(path, { method: "DELETE" });

export const healthQuery = {
  queryKey: ["health"] as const,
  queryFn: () => apiGet<HealthResponse>("/api/health"),
  refetchInterval: 60_000,
};
