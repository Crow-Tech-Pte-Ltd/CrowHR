/**
 * Messages between the page and the demo worker. Requests and responses cross `postMessage` as
 * plain data (structured clone); bodies are ArrayBuffers and are transferred, not copied.
 */
export interface WireRequest {
  method: string;
  /** Path and query, e.g. `/api/v1/me`. Always same-origin. */
  url: string;
  headers: [string, string][];
  body: ArrayBuffer | null;
}

export interface WireResponse {
  status: number;
  statusText: string;
  headers: [string, string][];
  body: ArrayBuffer;
}

export interface OutboxMessage {
  id: number;
  sentAt: string;
  to: string;
  subject: string;
  text: string;
  html: string | null;
}

export interface BootTimings {
  /** ms spent in each stage, in order. */
  stages: { stage: BootStage; ms: number }[];
  totalMs: number;
  /** True when the database was created and seeded on this load (first visit or after a reset). */
  seeded: boolean;
  /** Fresh copy restored from the build snapshot (false for browser seeding and later opens). */
  restored?: boolean;
}

export type BootStage = "wasm" | "open" | "migrate" | "seed" | "app";

export interface DemoInfo {
  dataVersion: string;
  orgSlug: string;
  /** The demo's "today" (Asia/Singapore), from the anchored demo clock. */
  today: string;
  seededAt: string;
}

/** RPC calls the page makes; each answers with `{ id, result }` or `{ id, error }`. */
export type RpcCall =
  | { method: "boot"; params: { origin: string; dataVersion: string } }
  | { method: "fetch"; params: WireRequest }
  | { method: "reset"; params: Record<string, never> }
  | { method: "outbox"; params: Record<string, never> }
  | { method: "tick"; params: Record<string, never> };

export type RpcResult<M extends RpcCall["method"]> = M extends "boot"
  ? { timings: BootTimings; info: DemoInfo }
  : M extends "fetch"
    ? WireResponse
    : M extends "reset"
      ? { reset: true }
      : M extends "outbox"
        ? OutboxMessage[]
        : M extends "tick"
          ? { ran: boolean }
          : never;

export type ToWorker = { id: number } & RpcCall;

export type FromWorker =
  | { id: number; result: unknown }
  | { id: number; error: { message: string } }
  | { event: "progress"; stage: BootStage; label: string }
  | { event: "outbox"; count: number };

export async function toWireRequest(request: Request): Promise<WireRequest> {
  const body = request.method === "GET" || request.method === "HEAD" ? null : await request.arrayBuffer();
  const url = new URL(request.url);
  return {
    method: request.method,
    url: `${url.pathname}${url.search}`,
    headers: [...request.headers],
    body: body?.byteLength ? body : null,
  };
}

export function fromWireResponse(wire: WireResponse): Response {
  const nullBody = wire.status === 204 || wire.status === 304;
  return new Response(nullBody ? null : wire.body, {
    status: wire.status,
    statusText: wire.statusText,
    headers: wire.headers,
  });
}
