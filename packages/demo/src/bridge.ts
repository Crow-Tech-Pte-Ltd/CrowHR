import { Hono } from "hono";
import type { CookieJar } from "./cookie-jar.ts";
import type { WireRequest, WireResponse } from "./protocol.ts";

/**
 * Turns the real core app into a `WireRequest → WireResponse` function for the demo worker.
 *
 * Cookie semantics are preserved without touching core: browsers drop a script-set `Cookie`
 * request header and a script-read `Set-Cookie` response header (forbidden names), so
 * - inbound, the jar's cookies go into a stand-alone `Headers` (no guard) that shadows the
 *   Request's own headers — Hono reads cookies through `c.req.raw.headers`;
 * - outbound, `Set-Cookie` is captured where Hono's cookie helper writes it (`c.header`), in a
 *   wrapper app mounted in front of core, and applied to the jar.
 * Core therefore sees an ordinary same-origin browser with cookie sessions, CSRF Origin checks
 * and all — the same code path as the self-hosted server, no bearer-token special case.
 */
export interface BridgeOptions {
  /** The page origin; the demo's PUBLIC_URL. */
  origin: string;
  jar: CookieJar;
  /** Demo time in epoch ms (cookie expiry follows the same clock as sessions). */
  now: () => number;
  /** Called after any response that changed the jar (persist it). */
  onCookiesChanged?: () => Promise<void> | void;
  /** Called after a state-changing request, before its response is returned (make it durable). */
  afterWrite?: () => Promise<void>;
  /**
   * The browser's user agent (the worker's `navigator.userAgent`). A request built in the page
   * carries none, so without it core lists the visitor's own session as "Unknown device".
   */
  userAgent?: string;
}

const SAFE = new Set(["GET", "HEAD", "OPTIONS"]);
/** Headers a browser sets itself; never trust copies from the page. */
const BROWSER_OWNED = [
  "cookie",
  "origin",
  "sec-fetch-site",
  "sec-fetch-mode",
  "host",
  "content-length",
  "transfer-encoding",
  "user-agent",
];

// biome-ignore lint/suspicious/noExplicitAny: any Hono app (core's env type is irrelevant here).
type AnyHono = Hono<any, any, any>;

export function createApiBridge(app: AnyHono, options: BridgeOptions) {
  const captured = new WeakMap<Request, string[]>();

  const wrapper = new Hono();
  wrapper.use("*", async (c, next) => {
    const cookies: string[] = [];
    captured.set(c.req.raw, cookies);
    const original = c.header.bind(c) as (name: string, value?: string, opts?: { append?: boolean }) => void;
    (c as unknown as { header: typeof original }).header = (name, value, opts) => {
      if (value !== undefined && name.toLowerCase() === "set-cookie") cookies.push(value);
      original(name, value, opts);
    };
    await next();
  });
  wrapper.route("/", app);

  return async function handle(wire: WireRequest): Promise<WireResponse> {
    const url = new URL(wire.url, options.origin);
    if (url.origin !== options.origin || !url.pathname.startsWith("/api/")) {
      return text(404, "The demo API only answers same-origin /api/ requests.");
    }
    const headers = new Headers(wire.headers);
    for (const h of BROWSER_OWNED) headers.delete(h);
    const cookie = options.jar.header(url.pathname, options.now());
    if (cookie) headers.set("cookie", cookie);
    if (options.userAgent) headers.set("user-agent", options.userAgent);
    if (!SAFE.has(wire.method)) {
      // What a browser sends on a same-origin fetch; core's CSRF check reads these.
      headers.set("origin", options.origin);
      headers.set("sec-fetch-site", "same-origin");
      // The wire body is already buffered. Its exact size lets core's body limiter avoid
      // cloning the Request (a browser clone would drop the worker-only Cookie shadow).
      headers.set("content-length", String(wire.body?.byteLength ?? 0));
    }
    const request = new Request(url, {
      method: wire.method,
      // Do not let the native Request adopt the unguarded Headers list.
      headers: [...headers],
      body: SAFE.has(wire.method) ? null : wire.body,
    });
    // Browsers strip Cookie and Content-Length. Core receives the trusted, unguarded copy.
    Object.defineProperty(request, "headers", { value: headers });
    const response = await wrapper.fetch(request);
    const setCookies = captured.get(request) ?? [];
    if (setCookies.length) {
      const now = options.now();
      for (const sc of setCookies) options.jar.set(sc, now);
      await options.onCookiesChanged?.();
    }
    const body = await response.arrayBuffer();
    if (!SAFE.has(wire.method) || setCookies.length) await options.afterWrite?.();
    const out: [string, string][] = [];
    response.headers.forEach((value, name) => {
      if (name !== "set-cookie") out.push([name, value]);
    });
    return {
      status: response.status,
      statusText: response.statusText,
      headers: out,
      body,
    };
  };
}

function text(status: number, message: string): WireResponse {
  return {
    status,
    statusText: "",
    headers: [["content-type", "application/json"]],
    body: new TextEncoder().encode(JSON.stringify({ error: { code: "not_found", message, requestId: "demo" } }))
      .buffer as ArrayBuffer,
  };
}

export type ApiBridge = ReturnType<typeof createApiBridge>;
