import { describe, expect, it } from "vitest";
import {
  drain,
  emptyQueue,
  enqueue,
  MAX_QUEUE,
  nextKind,
  type QueuedPunch,
  QueueFullError,
  type SendResult,
} from "./punch-queue.ts";

const tap = (n: number, kind: "in" | "out" = "in") => ({
  idempotencyKey: `key-${n}`,
  kind,
  deviceTime: new Date(Date.UTC(2026, 10, 12, 0, n)).toISOString(),
  location: null,
});
const ok = (): SendResult => ({
  ok: true,
  punch: { status: "accepted", flags: [], recordedAt: "2026-11-12T00:58:00.000Z" },
  replayed: false,
});

describe("punch queue", () => {
  it("sends in tap order and records each outcome", async () => {
    let s = enqueue(enqueue(emptyQueue(), tap(1, "in")), tap(2, "out"));
    const sent: string[] = [];
    s = await drain(s, async (p) => {
      sent.push(p.idempotencyKey);
      return ok();
    });
    expect(sent).toEqual(["key-1", "key-2"]);
    expect(s.pending).toEqual([]);
    expect(s.history.map((h) => h.idempotencyKey)).toEqual(["key-2", "key-1"]);
  });

  it("keeps the punch and everything after it when the network fails, with the same key and tap time", async () => {
    let s = enqueue(enqueue(emptyQueue(), tap(1)), tap(2, "out"));
    s = await drain(s, async () => ({ ok: false, retry: true, message: "You're offline." }));
    expect(s.pending.map((p) => [p.idempotencyKey, p.attempts, p.lastError])).toEqual([
      ["key-1", 1, "You're offline."],
      ["key-2", 0, null],
    ]);
    const seen: { p: QueuedPunch; queued: boolean; sentAt: string }[] = [];
    s = await drain(
      s,
      async (p, meta) => {
        seen.push({ p, ...meta });
        return ok();
      },
      () => new Date("2026-11-12T01:20:00.000Z"),
    );
    expect(seen[0]?.p.idempotencyKey).toBe("key-1");
    expect(seen[0]?.p.deviceTime).toBe(tap(1).deviceTime);
    expect(seen[0]?.queued).toBe(true);
    expect(seen[0]?.sentAt).toBe("2026-11-12T01:20:00.000Z");
    expect(s.pending).toEqual([]);
  });

  it("a rejected punch moves to history with the reason and the queue continues", async () => {
    let s = enqueue(enqueue(emptyQueue(), tap(1)), tap(2, "out"));
    s = await drain(s, async (p) =>
      p.idempotencyKey === "key-1" ? { ok: false, retry: false, message: "Outside the office." } : ok(),
    );
    expect(s.pending).toEqual([]);
    expect(s.history.find((h) => h.idempotencyKey === "key-1")).toMatchObject({
      outcome: "rejected",
      message: "Outside the office.",
    });
  });

  it("caps the queue at 200 without dropping a waiting punch", () => {
    let s = emptyQueue();
    for (let i = 0; i < MAX_QUEUE; i++) s = enqueue(s, tap(i));
    expect(() => enqueue(s, tap(999))).toThrow(QueueFullError);
    expect(s.pending).toHaveLength(MAX_QUEUE);
    expect(s.pending[0]?.idempotencyKey).toBe("key-0");
  });

  it("re-enqueueing the same key is a no-op (idempotent), and the next kind alternates", () => {
    const s = enqueue(emptyQueue(), tap(1, "in"));
    expect(enqueue(s, tap(1, "in"))).toBe(s);
    expect(nextKind(s, false)).toBe("out");
    expect(nextKind(emptyQueue(), true)).toBe("out");
    expect(nextKind(emptyQueue(), false)).toBe("in");
  });
});
