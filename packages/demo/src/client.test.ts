import { describe, expect, it, vi } from "vitest";
import { createDemoClient, interceptFetch, isApiUrl, type WorkerPort } from "./client.ts";
import type { FromWorker, ToWorker, WireResponse } from "./protocol.ts";

/** An in-process stand-in for the demo worker: answers the RPC like worker.ts does. */
function fakeWorker(answer: (msg: ToWorker) => unknown | Promise<unknown>) {
  const target = new EventTarget();
  const sent: { msg: ToWorker; transfer: Transferable[] }[] = [];
  const emit = (data: FromWorker) => target.dispatchEvent(new MessageEvent("message", { data }));
  const port: WorkerPort = {
    postMessage(message, transfer = []) {
      const msg = message as ToWorker;
      sent.push({ msg, transfer });
      queueMicrotask(async () => {
        try {
          emit({ id: msg.id, result: await answer(msg) });
        } catch (err) {
          emit({ id: msg.id, error: { message: (err as Error).message } });
        }
      });
    },
    addEventListener: (type, listener) => target.addEventListener(type, listener as EventListener),
  };
  return { port, sent, emit };
}

const okResponse = (status: number, body: unknown): WireResponse => ({
  status,
  statusText: "",
  headers: [["content-type", "application/json"]],
  body: new TextEncoder().encode(JSON.stringify(body)).buffer as ArrayBuffer,
});

const BOOT = {
  timings: { stages: [], totalMs: 1, seeded: true },
  info: { dataVersion: "v", orgSlug: "kopi-kaki", today: "2026-10-31", seededAt: "x" },
};

describe("demo client (page side of the worker bridge)", () => {
  it("boots once and round-trips a request as wire data, transferring the body", async () => {
    const w = fakeWorker((msg) => {
      if (msg.method === "boot") return BOOT;
      if (msg.method === "fetch") {
        const p = msg.params;
        const body = p.body ? JSON.parse(new TextDecoder().decode(p.body)) : null;
        return okResponse(201, {
          method: p.method,
          url: p.url,
          body,
          type: new Headers(p.headers).get("content-type"),
        });
      }
      return null;
    });
    const client = createDemoClient(w.port);
    await expect(client.send({ method: "GET", url: "/api/v1/me", headers: [], body: null })).rejects.toThrow(/boot/);
    const boot = client.boot("https://hr.crow.sg", "v");
    expect(client.boot("https://hr.crow.sg", "v")).toBe(boot);
    expect((await boot).info.orgSlug).toBe("kopi-kaki");

    const res = await client.fetch(
      new Request("https://hr.crow.sg/api/v1/claims?mine=true", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: "Taxi" }),
      }),
    );
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({
      method: "POST",
      url: "/api/v1/claims?mine=true",
      body: { title: "Taxi" },
      type: "application/json",
    });
    const fetchCall = w.sent.find((s) => s.msg.method === "fetch");
    expect(fetchCall?.transfer).toHaveLength(1); // the request body moved, not copied
    expect(w.sent.filter((s) => s.msg.method === "boot")).toHaveLength(1);
  });

  it("turns worker errors into rejections and forwards progress and outbox events", async () => {
    const onProgress = vi.fn();
    const onOutbox = vi.fn();
    const w = fakeWorker((msg) => {
      if (msg.method === "boot") return BOOT;
      throw new Error("The demo is still starting.");
    });
    const client = createDemoClient(w.port, { onProgress, onOutbox });
    w.emit({ event: "progress", stage: "seed", label: "Seeding" });
    w.emit({ event: "outbox", count: 3 });
    expect(onProgress).toHaveBeenCalledWith("seed", "Seeding");
    expect(onOutbox).toHaveBeenCalledWith(3);
    await client.boot("https://hr.crow.sg", "v");
    await expect(client.tick()).rejects.toThrow("The demo is still starting.");
  });

  it("returns a null body for 204 responses", async () => {
    const w = fakeWorker((msg) =>
      msg.method === "boot" ? BOOT : { status: 204, statusText: "", headers: [], body: new ArrayBuffer(0) },
    );
    const client = createDemoClient(w.port);
    await client.boot("https://hr.crow.sg", "v");
    const res = await client.fetch(new Request("https://hr.crow.sg/api/v1/auth/sign-out", { method: "POST" }));
    expect(res.status).toBe(204);
    expect(res.body).toBeNull();
  });

  it("intercepts only same-origin /api/ fetches", async () => {
    const origin = "https://hr.crow.sg";
    expect(isApiUrl("/api/v1/me", origin)).toBe(true);
    expect(isApiUrl("https://hr.crow.sg/api/health", origin)).toBe(true);
    expect(isApiUrl("/assets/app.js", origin)).toBe(false);
    expect(isApiUrl("https://evil.example/api/v1/me", origin)).toBe(false);

    const network = vi.fn(async () => new Response("from network"));
    const target = { fetch: network as unknown as typeof fetch };
    const w = fakeWorker((msg) => (msg.method === "boot" ? BOOT : okResponse(200, { from: "worker" })));
    const client = createDemoClient(w.port);
    await client.boot(origin, "v");
    interceptFetch(client, target, origin);
    expect(await (await target.fetch("/api/v1/me")).json()).toEqual({ from: "worker" });
    expect(await (await target.fetch(new Request(`${origin}/api/v1/me`), { method: "GET" })).json()).toEqual({
      from: "worker",
    });
    expect(await (await target.fetch("/fonts/a.woff2")).text()).toBe("from network");
    expect(network).toHaveBeenCalledTimes(1);
  });
});
