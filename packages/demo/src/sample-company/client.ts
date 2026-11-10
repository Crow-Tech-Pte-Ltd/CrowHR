import type { Hono } from "hono";
import { createApiBridge } from "../bridge.ts";
import { createCookieJar } from "../cookie-jar.ts";

/**
 * A browser-like API client for one member of the sample company, signed in through the demo
 * persona route of the seed's own in-process app (never of a real server, where that route is a
 * 404). Each call takes the same path as a click: cookie session, CSRF origin, permissions,
 * service. A failed call throws with the server's message.
 */
export class SampleRequestError extends Error {
  override name = "SampleRequestError";
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

// biome-ignore lint/suspicious/noExplicitAny: any Hono app.
export function memberClient(app: Hono<any, any, any>, origin: string, now: () => number, membershipId: string) {
  const jar = createCookieJar();
  const handle = createApiBridge(app, { origin, jar, now });
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
  let signedIn = false;
  const signIn = async () => {
    jar.clear();
    const res = await send("POST", "/api/v1/auth/demo/sign-in", { membershipId });
    if (res.status !== 204) throw new SampleRequestError(res.status, `Seed sign-in failed: ${res.status} ${res.text}`);
    signedIn = true;
  };
  const call = async <T>(method: string, path: string, json?: unknown, raw?: { body: Uint8Array; type: string }) => {
    if (!signedIn) await signIn();
    let res = await send(method, path, json, raw);
    if (res.status === 401) {
      // The seed clock jumps days at a time: an expired session signs in again, as a person would.
      await signIn();
      res = await send(method, path, json, raw);
    }
    if (res.status >= 400) {
      throw new SampleRequestError(res.status, `${method} ${path} → ${res.status}: ${res.text.slice(0, 600)}`);
    }
    return (res.text ? JSON.parse(res.text) : undefined) as T;
  };
  return {
    get: <T>(path: string) => call<T>("GET", path),
    post: <T>(path: string, json: unknown = {}) => call<T>("POST", path, json),
    put: <T>(path: string, json: unknown) => call<T>("PUT", path, json),
    patch: <T>(path: string, json: unknown) => call<T>("PATCH", path, json),
    del: <T>(path: string) => call<T>("DELETE", path),
    upload: <T>(path: string, body: Uint8Array, type: string) => call<T>("POST", path, undefined, { body, type }),
    /** Ends this client's session (no-op when it never signed in). */
    async signOut() {
      if (!signedIn) return;
      await call("POST", "/api/v1/auth/sign-out", {});
      signedIn = false;
    },
  };
}

export type MemberClient = ReturnType<typeof memberClient>;
