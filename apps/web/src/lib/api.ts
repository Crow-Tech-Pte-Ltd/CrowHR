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
}

/** Minimal JSON fetch against same-origin `/api`. */
export async function apiGet<T>(path: `/api/${string}`, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { ...init, headers: { accept: "application/json", ...init?.headers } });
  const body = (await res.json().catch(() => null)) as unknown;
  if (!res.ok) throw new ApiError(res.status, (body as ErrorEnvelope | null) ?? null);
  return body as T;
}

export const healthQuery = {
  queryKey: ["health"] as const,
  queryFn: () => apiGet<HealthResponse>("/api/health"),
  refetchInterval: 60_000,
};
