import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApiBridge } from "./bridge.ts";
import { createCookieJar } from "./cookie-jar.ts";
import type { WireRequest } from "./protocol.ts";

const ORIGIN = "https://hr.crow.sg";
const NOW = Date.parse("2026-10-31T01:00:00Z");

function stubApp() {
  const app = new Hono();
  app.post("/api/v1/login", (c) => {
    setCookie(c, "__Host-crowhr_session", "tok", { path: "/", maxAge: 600, httpOnly: true, secure: true });
    return c.body(null, 204);
  });
  app.post("/api/v1/logout", (c) => {
    deleteCookie(c, "__Host-crowhr_session", { path: "/", secure: true });
    return c.body(null, 204);
  });
  app.get("/api/v1/whoami", (c) =>
    c.json({ session: getCookie(c, "__Host-crowhr_session") ?? null, origin: c.req.header("origin") ?? null }),
  );
  app.post("/api/v1/echo", async (c) =>
    c.json({ origin: c.req.header("origin"), site: c.req.header("sec-fetch-site"), body: await c.req.json() }),
  );
  return app;
}

const wire = (method: string, url: string, json?: unknown, headers: [string, string][] = []): WireRequest => ({
  method,
  url,
  headers: json === undefined ? headers : [...headers, ["content-type", "application/json"]],
  body: json === undefined ? null : (new TextEncoder().encode(JSON.stringify(json)).buffer as ArrayBuffer),
});
const json = (body: ArrayBuffer) => JSON.parse(new TextDecoder().decode(body));

function setup() {
  const jar = createCookieJar();
  const onCookiesChanged = vi.fn();
  const afterWrite = vi.fn(async () => {});
  const handle = createApiBridge(stubApp(), { origin: ORIGIN, jar, now: () => NOW, onCookiesChanged, afterWrite });
  return { jar, handle, onCookiesChanged, afterWrite };
}

describe("api bridge", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("keeps the session cookie in the worker's jar, never in the response", async () => {
    const { jar, handle, onCookiesChanged, afterWrite } = setup();
    const login = await handle(wire("POST", "/api/v1/login", {}));
    expect(login.status).toBe(204);
    expect(login.headers.find(([n]) => n === "set-cookie")).toBeUndefined();
    expect(jar.get("__Host-crowhr_session")).toBe("tok");
    expect(onCookiesChanged).toHaveBeenCalledTimes(1);
    expect(afterWrite).toHaveBeenCalledTimes(1);

    const me = await handle(wire("GET", "/api/v1/whoami"));
    expect(json(me.body)).toEqual({ session: "tok", origin: null });
    expect(afterWrite).toHaveBeenCalledTimes(1); // reads are not flushed

    await handle(wire("POST", "/api/v1/logout", {}));
    expect(jar.header("/api/v1/whoami", NOW)).toBeNull();
    expect(json((await handle(wire("GET", "/api/v1/whoami"))).body).session).toBeNull();
  });

  it("sends what a same-origin browser would and ignores page-supplied browser headers", async () => {
    const { handle } = setup();
    await handle(wire("POST", "/api/v1/login", {}));
    const forged: [string, string][] = [
      ["cookie", "__Host-crowhr_session=stolen"],
      ["origin", "https://evil.example"],
      ["sec-fetch-site", "cross-site"],
    ];
    const echo = await handle(wire("POST", "/api/v1/echo", { a: 1 }, forged));
    expect(json(echo.body)).toEqual({ origin: ORIGIN, site: "same-origin", body: { a: 1 } });
    const me = await handle(wire("GET", "/api/v1/whoami", undefined, forged));
    expect(json(me.body)).toEqual({ session: "tok", origin: null });
  });

  it("answers only same-origin /api/ requests", async () => {
    const { handle } = setup();
    expect((await handle(wire("GET", "/assets/app.js"))).status).toBe(404);
    expect((await handle(wire("GET", "https://evil.example/api/v1/whoami"))).status).toBe(404);
  });

  it("keeps the unguarded cookie headers independent of the native Request", async () => {
    const NativeRequest = Request;
    vi.stubGlobal(
      "Request",
      class extends NativeRequest {
        constructor(input: RequestInfo | URL, init?: RequestInit) {
          const guarded = new Headers(init?.headers);
          guarded.delete("cookie");
          super(input, { ...init, headers: guarded });
          // Some browser request implementations adopt the supplied Headers' guard/list.
          if (init?.headers instanceof Headers) init.headers.delete("cookie");
        }
      },
    );
    const { handle } = setup();
    await handle(wire("POST", "/api/v1/login", {}));
    expect(json((await handle(wire("GET", "/api/v1/whoami"))).body).session).toBe("tok");
  });

  it("preserves sessions on buffered writes through core's body-limit middleware", async () => {
    const NativeRequest = Request;
    vi.stubGlobal(
      "Request",
      class extends NativeRequest {
        constructor(input: RequestInfo | URL, init?: RequestInit) {
          const headers = new Headers(init?.headers ?? (input instanceof NativeRequest ? input.headers : undefined));
          headers.delete("cookie");
          headers.delete("content-length");
          super(input, { ...init, headers });
        }
      },
    );
    const app = stubApp();
    // A separate app puts bodyLimit ahead of the routes, exactly as createApp does.
    const limited = new Hono();
    limited.use("*", bodyLimit({ maxSize: 1024 }));
    limited.route("/", app);
    limited.post("/api/v1/save", (c) => c.json({ session: getCookie(c, "__Host-crowhr_session") ?? null }));
    const handle = createApiBridge(limited, { origin: ORIGIN, jar: createCookieJar(), now: () => NOW });
    await handle(wire("POST", "/api/v1/login", {}));
    const saved = await handle(wire("POST", "/api/v1/save", { text: "saved" }));
    expect(saved.status).toBe(200);
    expect(json(saved.body).session).toBe("tok");
  });

  it("works with browser fetch semantics (Cookie and Set-Cookie are forbidden headers)", async () => {
    // Browsers drop a script-set Cookie request header and a Set-Cookie response header.
    const NativeRequest = Request;
    const NativeResponse = Response;
    const strip = (init: RequestInit | ResponseInit | undefined, name: string) => {
      const headers = new Headers(init?.headers);
      headers.delete(name);
      return { ...init, headers };
    };
    vi.stubGlobal(
      "Request",
      class extends NativeRequest {
        constructor(input: RequestInfo | URL, init?: RequestInit) {
          super(input, strip(init, "cookie"));
        }
      },
    );
    vi.stubGlobal(
      "Response",
      class extends NativeResponse {
        constructor(body?: BodyInit | null, init?: ResponseInit) {
          super(body, strip(init, "set-cookie"));
        }
      },
    );
    const { jar, handle } = setup();
    await handle(wire("POST", "/api/v1/login", {}));
    expect(jar.get("__Host-crowhr_session")).toBe("tok");
    expect(json((await handle(wire("GET", "/api/v1/whoami"))).body).session).toBe("tok");
  });
});
