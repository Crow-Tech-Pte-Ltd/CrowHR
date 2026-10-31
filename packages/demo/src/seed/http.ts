import type { Hono } from "hono";
import { createApiBridge } from "../bridge.ts";
import { createCookieJar } from "../cookie-jar.ts";

/**
 * The seed acts through the public API, signed in as the fictional people who would really do
 * each step (the payroll admin creates the run, the owner approves it, an employee files a claim).
 * Every request takes the same path as a visitor's click: bridge → cookie session → CSRF →
 * permissions → service. A failed step throws with the server's message.
 *
 * Each member keeps one browser-like client (its own cookie jar). The seed clock jumps days at a
 * time, so a session that has expired meanwhile is signed in again, as a person would.
 */
export class SeedRequestError extends Error {}

// biome-ignore lint/suspicious/noExplicitAny: any Hono app.
export function seedHttp(app: Hono<any, any, any>, origin: string, now: () => number) {
  const clients = new Map<string, ReturnType<typeof clientFor>>();

  function clientFor(membershipId: string) {
    const jar = createCookieJar();
    const handle = createApiBridge(app, { origin, jar, now });
    let signedIn = false;
    const send = async (method: string, path: string, json?: unknown, raw?: { body: Uint8Array; type: string }) => {
      const headers: [string, string][] = [["accept", "application/json"]];
      let body: ArrayBuffer | null = null;
      if (raw) {
        headers.push(["content-type", raw.type]);
        body = raw.body.slice().buffer as ArrayBuffer;
      } else if (json !== undefined) {
        headers.push(["content-type", "application/json"]);
        body = new TextEncoder().encode(JSON.stringify(json)).buffer as ArrayBuffer;
      }
      const res = await handle({ method, url: path, headers, body });
      return { status: res.status, text: new TextDecoder().decode(res.body) };
    };
    const signIn = async () => {
      jar.clear();
      const res = await send("POST", "/api/v1/auth/demo/sign-in", { membershipId });
      if (res.status !== 204) throw new SeedRequestError(`Demo sign-in failed: ${res.status} ${res.text}`);
      signedIn = true;
    };
    const call = async <T>(method: string, path: string, json?: unknown, raw?: { body: Uint8Array; type: string }) => {
      if (!signedIn) await signIn();
      let res = await send(method, path, json, raw);
      if (res.status === 401) {
        await signIn();
        res = await send(method, path, json, raw);
      }
      if (res.status >= 400) throw new SeedRequestError(`${method} ${path} → ${res.status}: ${res.text.slice(0, 600)}`);
      return (res.text ? JSON.parse(res.text) : undefined) as T;
    };
    return {
      get: <T>(path: string) => call<T>("GET", path),
      post: <T>(path: string, json: unknown = {}) => call<T>("POST", path, json),
      put: <T>(path: string, json: unknown) => call<T>("PUT", path, json),
      patch: <T>(path: string, json: unknown) => call<T>("PATCH", path, json),
      upload: <T>(path: string, body: Uint8Array, type: string) => call<T>("POST", path, undefined, { body, type }),
    };
  }

  return {
    async as(membershipId: string) {
      let c = clients.get(membershipId);
      if (!c) {
        c = clientFor(membershipId);
        clients.set(membershipId, c);
      }
      return c;
    },
  };
}

export type SeedClient = Awaited<ReturnType<ReturnType<typeof seedHttp>["as"]>>;
