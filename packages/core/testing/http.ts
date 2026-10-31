import type { App } from "../src/app.ts";
import { sessionCookie } from "../src/auth/settings.ts";
import { newToken, sha256Hex } from "../src/crypto/tokens.ts";
import { sessions } from "../src/db/schema/auth.ts";
import type { AppDeps } from "../src/deps.ts";
import type { SeededMember } from "./fixtures.ts";

/**
 * A tiny cookie-keeping HTTP client over `app.request`, sending same-origin headers like the SPA.
 *   const http = testClient(app, deps);
 *   await http.post("/api/v1/auth/sign-in", { org, email, password });
 *   const me = await http.get("/api/v1/me");
 */
export interface TestClient {
  cookies: Map<string, string>;
  request(path: string, init?: RequestInit & { json?: unknown }): Promise<Response>;
  get(path: string, init?: RequestInit): Promise<Response>;
  post(path: string, json?: unknown, init?: RequestInit): Promise<Response>;
  put(path: string, json?: unknown, init?: RequestInit): Promise<Response>;
  patch(path: string, json?: unknown, init?: RequestInit): Promise<Response>;
  delete(path: string, init?: RequestInit): Promise<Response>;
  sessionToken(): string | undefined;
}

export function testClient(
  app: App,
  deps: Pick<AppDeps, "publicUrl">,
  base: { ip?: string; userAgent?: string } = {},
): TestClient {
  const cookies = new Map<string, string>();
  const origin = new URL(deps.publicUrl).origin;
  const request = async (path: string, init: RequestInit & { json?: unknown } = {}) => {
    const headers = new Headers(init.headers);
    if (cookies.size && !headers.has("cookie"))
      headers.set("cookie", [...cookies].map(([k, v]) => `${k}=${v}`).join("; "));
    if (!headers.has("origin") && init.method && init.method !== "GET") headers.set("origin", origin);
    if (base.ip && !headers.has("x-crowhr-client-ip")) headers.set("x-crowhr-client-ip", base.ip);
    headers.set(
      "user-agent",
      headers.get("user-agent") ??
        base.userAgent ??
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) Chrome/130.0 Safari/537.36",
    );
    let body = init.body;
    if (init.json !== undefined) {
      headers.set("content-type", "application/json");
      body = JSON.stringify(init.json);
    }
    const res = await app.request(`${origin}${path}`, { ...init, headers, body });
    for (const raw of res.headers.getSetCookie()) {
      const [pair] = raw.split(";");
      const idx = pair?.indexOf("=") ?? -1;
      if (!pair || idx < 0) continue;
      const name = pair.slice(0, idx).trim();
      const value = pair.slice(idx + 1).trim();
      if (!value || /max-age=0/i.test(raw)) cookies.delete(name);
      else cookies.set(name, value);
    }
    return res;
  };
  const name = sessionCookie(deps.publicUrl).name;
  return {
    cookies,
    request,
    get: (p, i) => request(p, { ...i, method: "GET" }),
    post: (p, json, i) => request(p, { ...i, method: "POST", json }),
    put: (p, json, i) => request(p, { ...i, method: "PUT", json }),
    patch: (p, json, i) => request(p, { ...i, method: "PATCH", json }),
    delete: (p, i) => request(p, { ...i, method: "DELETE" }),
    sessionToken: () => cookies.get(name),
  };
}

/**
 * Inserts a browser session for a seeded member directly (fast path for permission tests) and
 * returns a client carrying its cookie.
 */
export async function clientAs(
  app: App,
  deps: AppDeps,
  member: SeededMember,
  options: { authenticatedAt?: Date; authMethod?: string } = {},
): Promise<TestClient> {
  const token = newToken();
  const now = deps.clock.now();
  await deps.db.insert(sessions).values({
    id: await sha256Hex(token),
    orgId: member.orgId,
    userId: member.userId,
    membershipId: member.membershipId,
    authMethod: options.authMethod ?? "password",
    createdAt: now,
    lastSeenAt: now,
    authenticatedAt: options.authenticatedAt ?? now,
    absoluteExpiresAt: new Date(now.getTime() + 12 * 3600_000),
    mfaSatisfied: true,
  });
  const client = testClient(app, deps);
  client.cookies.set(sessionCookie(deps.publicUrl).name, token);
  return client;
}

/** A clock whose time tests can move. */
export function movableClock(start: string | Date) {
  let now = new Date(start).getTime();
  return {
    now: () => new Date(now),
    advance(ms: number) {
      now += ms;
    },
    set(at: string | Date) {
      now = new Date(at).getTime();
    },
  };
}
