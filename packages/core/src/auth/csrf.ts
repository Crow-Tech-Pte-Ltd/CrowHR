import { getCookie } from "hono/cookie";
import { createMiddleware } from "hono/factory";
import type { AppEnv } from "../context.ts";
import { AppError } from "../errors.ts";
import { sessionCookie } from "./settings.ts";

const SAFE = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * CSRF protection for cookie-authenticated requests (auth spec "CSRF protection", design
 * decision 4): every state-changing request is rejected with 403 `csrf_rejected` when `Origin`
 * is present and differs from PUBLIC_URL's origin, or when `Sec-Fetch-Site: cross-site`.
 * Requests that carry a bearer token and no session cookie are exempt (native apps); the
 * cookie+bearer case is rejected earlier as `ambiguous_credentials`. This also covers the
 * unauthenticated sign-in POST (login CSRF).
 */
export function csrfProtection() {
  return createMiddleware<AppEnv>(async (c, next) => {
    if (SAFE.has(c.req.method)) return next();
    const { publicUrl } = c.var.deps;
    const hasCookie = !!getCookie(c, sessionCookie(publicUrl).name);
    const hasBearer = /^Bearer\s/i.test(c.req.header("authorization") ?? "");
    if (hasBearer && !hasCookie) return next();
    const origin = c.req.header("origin");
    const expected = new URL(publicUrl).origin;
    const site = c.req.header("sec-fetch-site");
    if ((origin && origin !== expected) || site === "cross-site") {
      throw new AppError(
        "csrf_rejected",
        "This request came from another website, so it was blocked. Open Crow HR directly and try again.",
      );
    }
    return next();
  });
}
