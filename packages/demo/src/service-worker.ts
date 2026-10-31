/**
 * The demo's service worker (`/demo-sw.js`). The page already routes its own `fetch('/api/…')`
 * calls straight to the demo worker; this catches the API requests a page cannot patch —
 * `<img src="/api/…">` receipt previews, `<a href="/api/…pdf" download>` payslips and exports,
 * and an API URL opened in a new tab — and hands them to an open demo tab, which answers from
 * its in-browser API. Nothing is cached and nothing goes to the network.
 *
 * Self-contained on purpose (no imports), so the built file is a classic script that every
 * browser with service workers can register.
 */
declare const self: ServiceWorkerGlobalScope;

interface Wire {
  method: string;
  url: string;
  headers: [string, string][];
  body: ArrayBuffer | null;
}
interface WireRes {
  status: number;
  statusText: string;
  headers: [string, string][];
  body: ArrayBuffer;
}

self.addEventListener("install", () => {
  void self.skipWaiting();
});
self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || !url.pathname.startsWith("/api/")) return;
  event.respondWith(forward(event));
});

function ask(client: Client, wire: Wire, timeoutMs: number): Promise<WireRes | null> {
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    const timer = setTimeout(() => resolve(null), timeoutMs);
    channel.port1.onmessage = (e: MessageEvent<{ ok: boolean; res?: WireRes }>) => {
      clearTimeout(timer);
      resolve(e.data.ok && e.data.res ? e.data.res : null);
    };
    client.postMessage({ type: "crowhr-demo-request", wire }, [channel.port2]);
  });
}

async function forward(event: FetchEvent): Promise<Response> {
  const req = event.request;
  const url = new URL(req.url);
  const body = req.method === "GET" || req.method === "HEAD" ? null : await req.arrayBuffer();
  const wire: Wire = { method: req.method, url: url.pathname + url.search, headers: [...req.headers], body };
  const candidates: Client[] = [];
  const own = event.clientId ? await self.clients.get(event.clientId) : undefined;
  if (own) candidates.push(own);
  for (const c of await self.clients.matchAll({ type: "window" })) if (c.id !== own?.id) candidates.push(c);
  for (const client of candidates) {
    const res = await ask(client, wire, 20_000);
    if (res) {
      const nullBody = res.status === 204 || res.status === 304;
      return new Response(nullBody ? null : res.body, {
        status: res.status,
        statusText: res.statusText,
        headers: res.headers,
      });
    }
  }
  return new Response(
    JSON.stringify({
      error: {
        code: "unavailable",
        message: "The demo isn't running in any tab. Open the demo, then try this link again.",
        requestId: "demo-sw",
      },
    }),
    { status: 503, headers: { "content-type": "application/json" } },
  );
}
