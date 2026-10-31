import { Hono } from "hono";
import { membersModule } from "./access/members-routes.ts";
import { auditModule } from "./audit/routes.ts";
import { csrfProtection } from "./auth/csrf.ts";
import { AUTH_ROUTE_GUARDS } from "./auth/guards.ts";
import { meModule } from "./auth/me-routes.ts";
import { nativeModule } from "./auth/native/routes.ts";
import { authModule } from "./auth/routes.ts";
import { securityModule } from "./auth/security-routes.ts";
import { authenticate } from "./auth/sessions.ts";
import type { AppEnv } from "./context.ts";
import type { AppDeps } from "./deps.ts";
import { AppError, errorResponse, handleError } from "./errors.ts";
import { requestContext } from "./http/request-context.ts";
import { type ApiModule, buildModuleRouter, type RouteGuard } from "./http/route.ts";
import { createMetaModule } from "./meta/routes.ts";
import { healthRoutes } from "./modules/health/routes.ts";
import { buildOpenApiDocument, SUPPORTED_API_VERSIONS } from "./openapi/generate.ts";

/**
 * Every module served under `/api/v1`, in mount order. Adding a module = one line here
 * (see docs/architecture.md "How to add a module"). Keep the list sorted by name.
 */
export const V1_MODULES: readonly ApiModule[] = [
  auditModule,
  authModule,
  meModule,
  membersModule,
  nativeModule,
  securityModule,
];

/** Every v1 module including `meta`, whose feature list is derived from the others. */
export function allV1Modules(extra: readonly ApiModule[] = []): ApiModule[] {
  const modules = [...V1_MODULES, ...extra];
  const features = modules.flatMap((m) => (m.feature ? [m.feature] : []));
  return [...modules, createMetaModule(() => features)];
}

export interface CreateAppOptions {
  /** Extra modules mounted under `/api/v1` after the built-in ones. Tests use this for stub routes. */
  modules?: readonly ApiModule[];
}

/** Hooks run by every route after authentication, before the permission check (order matters). */
const ROUTE_GUARDS: readonly RouteGuard[] = [...AUTH_ROUTE_GUARDS];

/**
 * Builds the Crow HR API. Runtime-agnostic: the same app runs under
 * @hono/node-server (apps/server), in Vitest, and in the browser demo.
 *
 * - `/api/health` — unversioned liveness check.
 * - `/api/v1/*` — every module, declared with `defineModule` / `defineRoute`.
 * - `/api/v1/openapi.json` — generated from the same route declarations.
 * - `/api/v<n>/*` for any other n — 404 naming the supported versions.
 *
 * Hosts may register more routes on the returned app (e.g. static files); `/api/*` that
 * matches nothing always gets the JSON 404 envelope, never a host fallback.
 */
export function createApp(deps: AppDeps, options: CreateAppOptions = {}) {
  const modules = allV1Modules(options.modules);
  let openApi: ReturnType<typeof buildOpenApiDocument> | undefined;

  const v1 = buildModuleRouter(modules, ROUTE_GUARDS);
  v1.get("/openapi.json", (c) => {
    openApi ??= buildOpenApiDocument(modules);
    c.header("cache-control", "public, max-age=60");
    return c.json(openApi);
  });

  const api = new Hono<AppEnv>().route("/health", healthRoutes).route("/v1", v1);
  api.all("/:version{v[0-9]+}/*", (c) => {
    const version = c.req.param("version");
    if ((SUPPORTED_API_VERSIONS as readonly string[]).includes(version)) {
      throw new AppError("not_found", `No API endpoint at ${c.req.method} ${c.req.path}.`);
    }
    throw new AppError("not_found", `API version ${version} is not supported by this server. Use /api/v1.`, {
      supportedVersions: SUPPORTED_API_VERSIONS,
    });
  });

  const app = new Hono<AppEnv>();
  app.use("*", requestContext(deps));
  app.use("/api/v1/*", authenticate(), csrfProtection());
  app.onError(handleError);
  app.route("/api", api);
  app.all("/api/*", (c) => {
    throw new AppError("not_found", `No API endpoint at ${c.req.method} ${c.req.path}.`);
  });
  app.notFound((c) => errorResponse(c, "not_found", "Not found."));
  return app;
}

export type App = ReturnType<typeof createApp>;
