import { Hono } from "hono";
import type { AppEnv } from "./context.ts";
import type { AppDeps } from "./deps.ts";
import { AppError, errorResponse, handleError } from "./errors.ts";
import { requestContext } from "./http/request-context.ts";
import { healthRoutes } from "./modules/health/routes.ts";

/**
 * Builds the Crow HR API. Runtime-agnostic: the same app runs under
 * @hono/node-server (apps/server), in Vitest, and in the browser demo.
 *
 * Only `/api/*` is handled here. Hosts may register more routes on the
 * returned app (e.g. static files); `/api/*` that matches nothing always gets
 * the JSON 404 envelope, never a host fallback.
 *
 * Adding a module: create `src/modules/<name>/routes.ts` exporting a
 * `new Hono<AppEnv>()` and mount it below with `api.route("/<name>", ...)`.
 */
export function createApp(deps: AppDeps) {
  const api = new Hono<AppEnv>().route("/health", healthRoutes);

  const app = new Hono<AppEnv>();
  app.use("*", requestContext(deps));
  app.onError(handleError);
  app.route("/api", api);
  app.all("/api/*", (c) => {
    throw new AppError("not_found", `No API endpoint at ${c.req.method} ${c.req.path}.`);
  });
  app.notFound((c) => errorResponse(c, "not_found", "Not found."));
  return app;
}

export type App = ReturnType<typeof createApp>;
