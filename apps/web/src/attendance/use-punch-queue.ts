import type { ErrorEnvelope } from "@crowhr/core";
import { useQueryClient } from "@tanstack/react-query";
import * as React from "react";
import { attKeys, type Punch } from "./api.ts";
import {
  drain,
  enqueue,
  localStore,
  newKey,
  type QueuedPunch,
  type QueueState,
  type SendResult,
} from "./punch-queue.ts";

const store = localStore();
let draining: Promise<void> | null = null;
const listeners = new Set<(s: QueueState) => void>();

const OFFLINE = "You're offline. It will send by itself when you're back online.";

async function sendPunch(p: QueuedPunch, meta: { sentAt: string; queued: boolean }): Promise<SendResult> {
  let res: Response;
  try {
    res = await fetch("/api/v1/attendance/punches", {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({
        kind: p.kind,
        idempotencyKey: p.idempotencyKey,
        deviceTime: p.deviceTime,
        sentAt: meta.sentAt,
        queued: meta.queued,
        source: window.matchMedia?.("(max-width: 767px)").matches ? "mobile_web" : "web",
        location: p.location,
      }),
    });
  } catch {
    return { ok: false, retry: true, message: OFFLINE };
  }
  const body = (await res.json().catch(() => null)) as (Punch & { replayed: boolean }) | ErrorEnvelope | null;
  if (res.ok && body && "id" in body) {
    return {
      ok: true,
      punch: { status: body.status, flags: body.flags, recordedAt: body.recordedAt },
      replayed: body.replayed,
    };
  }
  const message = body && "error" in body ? body.error.message : `The server answered ${res.status}.`;
  if (res.status === 401) return { ok: false, retry: true, message: "Sign in again to send it." };
  if (res.status >= 500 || res.status === 408 || res.status === 429 || res.status === 0) {
    return { ok: false, retry: true, message: "The server didn't answer. It will try again shortly." };
  }
  return { ok: false, retry: false, message };
}

function publish(s: QueueState) {
  for (const l of listeners) l(s);
}

/** Sends whatever is queued (one drain at a time across the page). */
export function flushQueue(): Promise<void> {
  if (draining) return draining;
  draining = (async () => {
    const next = await drain(store.load(), sendPunch);
    store.save(next);
    publish(next);
  })().finally(() => {
    draining = null;
  });
  return draining;
}

/** The punch queue as React state: taps go in, drains run on load, on `online`, after each tap and every 30 s. */
export function usePunchQueue() {
  const qc = useQueryClient();
  const [state, setState] = React.useState<QueueState>(() => store.load());
  React.useEffect(() => {
    const onChange = (s: QueueState) => {
      setState(s);
      void qc.invalidateQueries({ queryKey: attKeys.all });
    };
    listeners.add(onChange);
    const onOnline = () => void flushQueue();
    window.addEventListener("online", onOnline);
    void flushQueue();
    const id = window.setInterval(() => {
      if (store.load().pending.length) void flushQueue();
    }, 30_000);
    return () => {
      listeners.delete(onChange);
      window.removeEventListener("online", onOnline);
      window.clearInterval(id);
    };
  }, [qc]);
  const tap = React.useCallback((kind: "in" | "out", location: QueuedPunch["location"]) => {
    const next = enqueue(store.load(), {
      idempotencyKey: newKey(),
      kind,
      deviceTime: new Date().toISOString(),
      location,
    });
    store.save(next);
    publish(next);
    return flushQueue();
  }, []);
  const dismiss = React.useCallback((key: string) => {
    const cur = store.load();
    const next = { ...cur, history: cur.history.filter((h) => h.idempotencyKey !== key) };
    store.save(next);
    publish(next);
  }, []);
  return { state, tap, flush: flushQueue, dismiss };
}
