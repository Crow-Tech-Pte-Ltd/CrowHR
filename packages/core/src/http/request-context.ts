import { createMiddleware } from "hono/factory";
import type { AppEnv } from "../context.ts";
import type { AppDeps } from "../deps.ts";

const INCOMING_ID = /^[A-Za-z0-9._-]{8,128}$/;

/**
 * First middleware on every request: binds deps, a request id (reusing a sane
 * incoming `x-request-id` from a proxy), a request-scoped logger and an empty
 * auth slot, and echoes the id back in the response header.
 */
export function requestContext(deps: AppDeps) {
  return createMiddleware<AppEnv>(async (c, next) => {
    const incoming = c.req.header("x-request-id");
    const requestId = incoming && INCOMING_ID.test(incoming) ? incoming : deps.ids.newId();
    c.set("deps", deps);
    c.set("requestId", requestId);
    c.set("logger", deps.logger.child({ requestId }));
    c.set("auth", null);
    c.set("memo", new Map());
    c.set("authFailure", null);
    c.header("x-request-id", requestId);
    await next();
  });
}
