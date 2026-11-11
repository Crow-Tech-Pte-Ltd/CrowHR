/**
 * The offline-tolerant punch queue (add-attendance design decision 7). Pure functions over a
 * plain state object, so the logic is unit-tested without a browser; `localStore` persists it in
 * localStorage under `crowhr.punchQueue.v1`.
 *
 * - FIFO: punches are sent in the order they were tapped.
 * - Each punch keeps its idempotency key and tap time (`deviceTime`) across retries; `sentAt` is
 *   the device time of each send attempt, so the server can measure the device clock offset.
 * - A network failure keeps the punch (and everything after it) queued with the last error.
 * - A rejection by the server moves the punch to `history` with the reason: never dropped silently.
 * - At most 200 punches wait; a 201st tap is refused with a message instead of losing an old one.
 */

import { appNow } from "@crowhr/ui/clock";
export const QUEUE_KEY = "crowhr.punchQueue.v1";
export const MAX_QUEUE = 200;
export const MAX_HISTORY = 50;

export interface QueuedPunch {
  idempotencyKey: string;
  kind: "in" | "out";
  /** Device time of the tap (ISO). */
  deviceTime: string;
  location: { latitude: number; longitude: number; accuracyMetres?: number } | null;
  attempts: number;
  lastError: string | null;
}

export interface PunchOutcome {
  idempotencyKey: string;
  kind: "in" | "out";
  deviceTime: string;
  outcome: "accepted" | "flagged" | "rejected";
  message: string | null;
  flags: string[];
  recordedAt: string | null;
  /** True when the server had already stored this punch (a retry). */
  replayed: boolean;
  at: string;
}

export interface QueueState {
  pending: QueuedPunch[];
  history: PunchOutcome[];
}

export const emptyQueue = (): QueueState => ({ pending: [], history: [] });

export type SendResult =
  | {
      ok: true;
      punch: { status: "accepted" | "flagged"; flags: string[]; recordedAt: string };
      replayed: boolean;
    }
  /** Offline, timeout, 5xx, signed out: keep it queued. */
  | { ok: false; retry: true; message: string }
  /** The server refused this punch (4xx): record it, move on. */
  | { ok: false; retry: false; message: string };

export class QueueFullError extends Error {
  constructor() {
    super(
      `${MAX_QUEUE} punches are already waiting to send. Connect to the internet to send them before clocking again.`,
    );
  }
}

export function enqueue(state: QueueState, punch: Omit<QueuedPunch, "attempts" | "lastError">): QueueState {
  if (state.pending.length >= MAX_QUEUE) throw new QueueFullError();
  if (state.pending.some((p) => p.idempotencyKey === punch.idempotencyKey)) return state;
  return { ...state, pending: [...state.pending, { ...punch, attempts: 0, lastError: null }] };
}

/** The kind of the next tap: the opposite of the last queued punch, else of the server's state. */
export function nextKind(state: QueueState, serverClockedIn: boolean): "in" | "out" {
  const last = state.pending.at(-1);
  if (last) return last.kind === "in" ? "out" : "in";
  return serverClockedIn ? "out" : "in";
}

/**
 * Sends queued punches in order until one fails to reach the server. `send` receives the punch,
 * whether it waited in the queue (`queued`), and the send attempt's device time.
 */
export async function drain(
  state: QueueState,
  send: (p: QueuedPunch, meta: { sentAt: string; queued: boolean }) => Promise<SendResult>,
  now: () => Date = appNow,
): Promise<QueueState> {
  let pending = [...state.pending];
  let history = [...state.history];
  while (pending.length) {
    const head = pending[0] as QueuedPunch;
    const queued = head.attempts > 0 || now().getTime() - new Date(head.deviceTime).getTime() > 15_000;
    const result = await send(head, { sentAt: now().toISOString(), queued });
    if (!result.ok && result.retry) {
      pending = [{ ...head, attempts: head.attempts + 1, lastError: result.message }, ...pending.slice(1)];
      break;
    }
    pending = pending.slice(1);
    const outcome: PunchOutcome = {
      idempotencyKey: head.idempotencyKey,
      kind: head.kind,
      deviceTime: head.deviceTime,
      outcome: result.ok ? result.punch.status : "rejected",
      message: result.ok ? null : result.message,
      flags: result.ok ? result.punch.flags : [],
      recordedAt: result.ok ? result.punch.recordedAt : null,
      replayed: result.ok ? result.replayed : false,
      at: now().toISOString(),
    };
    history = [outcome, ...history].slice(0, MAX_HISTORY);
  }
  return { pending, history };
}

export interface QueueStore {
  load(): QueueState;
  save(state: QueueState): void;
}

/** localStorage persistence (falls back to memory when storage is unavailable). */
export function localStore(key = QUEUE_KEY): QueueStore {
  let memory = emptyQueue();
  return {
    load() {
      try {
        const raw = localStorage.getItem(key);
        if (!raw) return memory;
        const parsed = JSON.parse(raw) as Partial<QueueState>;
        return { pending: parsed.pending ?? [], history: parsed.history ?? [] };
      } catch {
        return memory;
      }
    },
    save(state) {
      memory = state;
      try {
        localStorage.setItem(key, JSON.stringify(state));
      } catch {
        // Storage full or blocked: the in-memory copy still sends while the page is open.
      }
    },
  };
}

/** A unique, server-valid idempotency key. */
export function newKey(): string {
  const c = globalThis.crypto;
  return c?.randomUUID ? c.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}
