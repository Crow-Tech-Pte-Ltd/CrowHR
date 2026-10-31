import {
  type BootStage,
  type FromWorker,
  fromWireResponse,
  type RpcCall,
  type RpcResult,
  type ToWorker,
  toWireRequest,
  type WireRequest,
  type WireResponse,
} from "./protocol.ts";

/**
 * Page side of the demo: starts the worker, forwards `/api/*` requests to it and exposes reset,
 * the outbox and the scheduler tick. `createDemoClient` takes any Worker-like port, so it is
 * unit-tested without a browser (client.test.ts).
 */
export interface WorkerPort {
  postMessage(message: unknown, transfer?: Transferable[]): void;
  addEventListener(type: "message", listener: (event: MessageEvent) => void): void;
  terminate?(): void;
}

export interface DemoClientEvents {
  onProgress?: (stage: BootStage, label: string) => void;
  onOutbox?: (count: number) => void;
}

export function createDemoClient(worker: WorkerPort, events: DemoClientEvents = {}) {
  let nextId = 1;
  const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  worker.addEventListener("message", (event: MessageEvent<FromWorker>) => {
    const msg = event.data;
    if ("event" in msg) {
      if (msg.event === "progress") events.onProgress?.(msg.stage, msg.label);
      else if (msg.event === "outbox") events.onOutbox?.(msg.count);
      return;
    }
    const waiter = pending.get(msg.id);
    if (!waiter) return;
    pending.delete(msg.id);
    if ("error" in msg) waiter.reject(new Error(msg.error.message));
    else waiter.resolve(msg.result);
  });

  function call<M extends RpcCall["method"]>(
    method: M,
    params: Extract<RpcCall, { method: M }>["params"],
    transfer: Transferable[] = [],
  ): Promise<RpcResult<M>> {
    const id = nextId++;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
      worker.postMessage({ id, method, params } as ToWorker, transfer);
    });
  }

  let ready: Promise<RpcResult<"boot">> | null = null;
  return {
    boot(origin: string, dataVersion: string) {
      ready ??= call("boot", { origin, dataVersion });
      return ready;
    },
    /** Sends one request to the in-browser API. Waits for boot. */
    async send(wire: WireRequest): Promise<WireResponse> {
      if (!ready) throw new Error("Call boot() before sending requests.");
      await ready;
      return call("fetch", wire, wire.body ? [wire.body] : []);
    },
    async fetch(request: Request): Promise<Response> {
      return fromWireResponse(await this.send(await toWireRequest(request)));
    },
    async reset() {
      ready = call("reset", {});
      return ready;
    },
    outbox: () => call("outbox", {}),
    tick: () => call("tick", {}),
  };
}

export type DemoClient = ReturnType<typeof createDemoClient>;

/** True for a same-origin `/api/` URL (the only requests the demo intercepts). */
export function isApiUrl(url: string | URL, origin: string): boolean {
  const u = new URL(url, origin);
  return u.origin === origin && u.pathname.startsWith("/api/");
}

/**
 * Routes the page's `fetch('/api/…')` calls to the demo worker; everything else (assets, fonts)
 * still goes to the network. Returns the original fetch.
 */
export function interceptFetch(
  client: DemoClient,
  target: { fetch: typeof fetch } = globalThis,
  origin = location.origin,
) {
  const original = target.fetch.bind(target);
  target.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);
    if (!isApiUrl(url, origin)) return original(input, init);
    const request = input instanceof Request ? new Request(input, init) : new Request(new URL(url, origin), init);
    return client.fetch(request);
  }) as typeof fetch;
  return original;
}
