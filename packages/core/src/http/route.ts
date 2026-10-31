import { Hono } from "hono";
import type { ContentfulStatusCode, StatusCode } from "hono/utils/http-status";
import type { z } from "zod";
import { authorize, type Grant } from "../access/authorize.ts";
import type { Permission } from "../access/matrix.ts";
import { type AppContext, type AppEnv, type AuthContext, requireAuth } from "../context.ts";
import type { AppDeps } from "../deps.ts";
import { AppError, type ErrorCode } from "../errors.ts";
import { friendlyIssueMessage, toValidationIssues } from "./validate.ts";

/**
 * The route contract (api-platform spec "Generated OpenAPI document"). A route declares its
 * request and response schemas, its access rule and its error codes in one place; the same
 * declaration validates input, checks permissions, serialises output and generates
 * `/api/v1/openapi.json`. See docs/architecture.md "How to add a module".
 */

export type HttpMethod = "get" | "post" | "put" | "patch" | "delete";

/**
 * - `public`: no session needed (sign-in, meta, invitation lookup).
 * - `authenticated`: any signed-in member; the handler limits itself to the caller's own data.
 * - `{ permission }`: checked against the permission matrix before the handler runs.
 */
export type RouteAccess = "public" | "authenticated" | { permission: Permission };

/** A non-JSON response (redirect, CSV, HTML). The handler must return a `Response`. */
export interface RawResponseSpec {
  description: string;
  /** Omit for bodiless responses such as redirects. */
  contentType?: string;
}

/** `null` = no body (e.g. 204). */
export type ResponseSpec = z.ZodType | null | RawResponseSpec;

export interface RouteRequest {
  params?: z.ZodType;
  query?: z.ZodType;
  body?: z.ZodType;
}

type Infer<T> = T extends z.ZodType ? z.output<T> : undefined;
// biome-ignore lint/suspicious/noConfusingVoidType: lets a 204 handler simply not return.
type BodyOf<S> = S extends z.ZodType ? z.input<S> : S extends null ? undefined | null | void : Response;

type DefaultStatus<Res> = 200 extends keyof Res
  ? 200
  : 201 extends keyof Res
    ? 201
    : 202 extends keyof Res
      ? 202
      : 204 extends keyof Res
        ? 204
        : never;

const REPLY = Symbol("reply");

/** Returned by `reply()` to answer with a declared status other than the default one. */
export interface Reply {
  [REPLY]: true;
  status: number;
  body: unknown;
}

/** Answer with a specific declared status, e.g. `return reply(202, { accepted: true })`. */
export function reply(status: number, body?: unknown): Reply {
  return { [REPLY]: true, status, body };
}

export interface HandlerInput<Req extends RouteRequest, Acc extends RouteAccess> {
  c: AppContext;
  deps: AppDeps;
  params: Infer<Req["params"]>;
  query: Infer<Req["query"]>;
  body: Infer<Req["body"]>;
  auth: Acc extends "public" ? AuthContext | null : AuthContext;
  /** The caller's grant for the route permission (scope narrowing); null without a permission. */
  grant: Acc extends { permission: Permission } ? Grant : null;
}

export interface RouteDefinition<
  Req extends RouteRequest = RouteRequest,
  Res extends Record<number, ResponseSpec> = Record<number, ResponseSpec>,
  Acc extends RouteAccess = RouteAccess,
> {
  method: HttpMethod;
  /** Hono-style path relative to the module, e.g. `/` or `/:id/roles`. */
  path: string;
  summary: string;
  description?: string;
  /** Defaults to `<module>.<method><Path>`. Must be unique and stable: clients may generate code from it. */
  operationId?: string;
  access: Acc;
  request?: Req;
  responses: Res;
  /** Error codes this route can answer with, beyond the ones implied by `access` and `request`. */
  errors?: readonly ErrorCode[];
  /** Marks the route deprecated: sends `Deprecation` and `Sunset` headers (RFC 9745, RFC 8594). */
  deprecated?: { since: string; sunset: string };
  /** Sensitive actions (spec "Recent re-authentication"): requires authentication within 10 minutes. */
  recentAuth?: boolean;
  /** Reachable while the member must still enrol in MFA (enrolment and sign-out only). */
  allowDuringMfaEnrolment?: boolean;
  handler: (
    input: HandlerInput<Req, Acc>,
  ) => Promise<BodyOf<Res[DefaultStatus<Res>]> | Reply | Response> | BodyOf<Res[DefaultStatus<Res>]> | Reply | Response;
}

// biome-ignore lint/suspicious/noExplicitAny: erased route type stored in module registries.
export type AnyRoute = RouteDefinition<any, any, any>;

/** Declares one route. Purely a typing helper: the module validates and mounts it. */
export function defineRoute<
  const Req extends RouteRequest,
  const Res extends Record<number, ResponseSpec>,
  const Acc extends RouteAccess,
>(def: RouteDefinition<Req, Res, Acc>): RouteDefinition<Req, Res, Acc> {
  return def;
}

export interface ApiModule {
  /** Machine name, also the default OpenAPI tag. */
  name: string;
  /** Mount path under `/api/v1`, e.g. `/members`. Use `""` to mount at the root. */
  basePath: string;
  /** Human tag for the OpenAPI document. */
  tag?: string;
  /** Feature advertised by `GET /api/v1/meta` when this module is mounted (e.g. `leave`). */
  feature?: string;
  routes: readonly AnyRoute[];
}

/** Hook used by the auth module (session freshness, MFA enrolment gate). Registered by `createApp`. */
export type RouteGuard = (c: AppContext, route: AnyRoute) => Promise<void> | void;

/**
 * Declares a module and validates every route at definition time, so an undocumented route
 * fails at startup (and in tests) with a message naming it.
 */
export function defineModule(module: ApiModule): ApiModule {
  for (const route of module.routes) assertDocumented(module, route);
  const seen = new Set<string>();
  for (const route of module.routes) {
    const key = `${route.method} ${route.path}`;
    if (seen.has(key)) throw new Error(`Route ${describeRoute(module, route)} is defined twice.`);
    seen.add(key);
  }
  return module;
}

export function fullPath(module: ApiModule, route: AnyRoute): string {
  const joined = `/api/v1${module.basePath}${route.path === "/" ? "" : route.path}`;
  return joined === "/api/v1" ? "/api/v1/" : joined;
}

export function describeRoute(module: ApiModule, route: AnyRoute): string {
  return `${route.method.toUpperCase()} ${fullPath(module, route)}`;
}

export function pathParamNames(path: string): string[] {
  return [...path.matchAll(/:([A-Za-z0-9_]+)/g)].map((m) => m[1] as string);
}

function shapeKeys(schema: z.ZodType | undefined): string[] | null {
  const shape = (schema as unknown as { shape?: Record<string, unknown> } | undefined)?.shape;
  return shape ? Object.keys(shape) : null;
}

function isRaw(spec: ResponseSpec | undefined): spec is RawResponseSpec {
  return typeof spec === "object" && spec !== null && "description" in spec && !("_zod" in spec);
}

function assertDocumented(module: ApiModule, route: AnyRoute) {
  const name = describeRoute(module, route);
  if (!route.summary?.trim()) throw new Error(`Route ${name} has no summary. Describe what it does.`);
  const statuses = Object.keys(route.responses ?? {}).map(Number);
  if (statuses.length === 0) {
    throw new Error(`Route ${name} declares no response schemas. Add \`responses: { 200: schema }\`.`);
  }
  if (!statuses.some((s) => s >= 200 && s < 400)) {
    throw new Error(`Route ${name} declares no success (2xx/3xx) response.`);
  }
  const names = pathParamNames(route.path);
  if (names.length) {
    const keys = shapeKeys(route.request?.params);
    if (!keys)
      throw new Error(
        `Route ${name} has path parameters (${names.join(", ")}) but no \`request.params\` object schema.`,
      );
    const missing = names.filter((n) => !keys.includes(n));
    if (missing.length) throw new Error(`Route ${name}: \`request.params\` does not declare ${missing.join(", ")}.`);
  }
  if (route.request?.query && !shapeKeys(route.request.query)) {
    throw new Error(`Route ${name}: \`request.query\` must be an object schema.`);
  }
  if ((route.method === "get" || route.method === "delete") && route.request?.body) {
    throw new Error(`Route ${name}: ${route.method.toUpperCase()} routes must not take a body.`);
  }
  if (
    route.deprecated &&
    (Number.isNaN(Date.parse(route.deprecated.sunset)) || Number.isNaN(Date.parse(route.deprecated.since)))
  ) {
    throw new Error(`Route ${name}: \`deprecated.since\` and \`deprecated.sunset\` must be ISO dates.`);
  }
}

async function parseInput(schema: z.ZodType, value: unknown, target: "param" | "query" | "json"): Promise<unknown> {
  const result = await schema.safeParseAsync(value, { error: friendlyIssueMessage });
  if (!result.success) {
    throw new AppError("validation_failed", "Some fields need attention.", {
      target,
      issues: toValidationIssues(result.error),
    });
  }
  return result.data;
}

async function readJsonBody(c: AppContext): Promise<unknown> {
  const type = c.req.header("content-type") ?? "";
  const text = await c.req.text();
  if (text === "") return {};
  if (!/^application\/(.+\+)?json\b/i.test(type)) {
    throw new AppError(
      "validation_failed",
      "Send the request body as JSON with the header Content-Type: application/json.",
    );
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new AppError("validation_failed", "The request body is not valid JSON. Check for a missing quote or comma.");
  }
}

/** Paths of keys present in `input` that the schema dropped from `output`. */
export function strippedKeys(input: unknown, output: unknown, path = ""): string[] {
  if (Array.isArray(input) && Array.isArray(output)) {
    return input.flatMap((item, i) => strippedKeys(item, output[i], `${path}${path ? "." : ""}${i}`));
  }
  if (isPlainObject(input) && isPlainObject(output)) {
    return Object.entries(input).flatMap(([key, value]) => {
      const at = `${path}${path ? "." : ""}${key}`;
      if (value === undefined) return [];
      if (!(key in output)) return [at];
      return strippedKeys(value, output[key], at);
    });
  }
  return [];
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && Object.getPrototypeOf(v) === Object.prototype;
}

function defaultStatus(route: AnyRoute): number {
  const statuses = Object.keys(route.responses)
    .map(Number)
    .filter((s) => s >= 200 && s < 400)
    .sort((a, b) => a - b);
  return statuses[0] as number;
}

function serialize(c: AppContext, module: ApiModule, route: AnyRoute, out: unknown): Response {
  if (out instanceof Response) return out;
  let status = defaultStatus(route);
  let body = out;
  if (typeof out === "object" && out !== null && REPLY in out) {
    status = (out as Reply).status;
    body = (out as Reply).body;
  }
  const spec = (route.responses as Record<number, ResponseSpec>)[status];
  const name = describeRoute(module, route);
  if (spec === undefined) throw new Error(`Route ${name} answered ${status}, which it does not declare.`);
  if (spec === null) return c.body(null, status as StatusCode);
  if (isRaw(spec)) throw new Error(`Route ${name} must return a Response for its ${status} ${spec.description}.`);
  const parsed = spec.safeParse(body);
  if (!parsed.success) {
    throw new Error(
      `Route ${name} produced a ${status} body that does not match its schema: ${toValidationIssues(parsed.error)
        .map((i) => `${i.path || "(root)"}: ${i.message}`)
        .join("; ")}`,
    );
  }
  if (c.var.deps.responseValidation === "strict") {
    const extra = strippedKeys(body, parsed.data);
    if (extra.length) throw new Error(`Route ${name} returned undocumented field(s): ${extra.join(", ")}.`);
  }
  return c.json(parsed.data as object, status as ContentfulStatusCode);
}

function epochSeconds(iso: string): number {
  return Math.floor(Date.parse(iso) / 1000);
}

/** Builds the Hono router for a set of modules (mounted at `/api/v1` by `createApp`). */
export function buildModuleRouter(modules: readonly ApiModule[], guards: readonly RouteGuard[] = []): Hono<AppEnv> {
  const router = new Hono<AppEnv>();
  for (const module of modules) {
    for (const route of module.routes) {
      const path = `${module.basePath}${route.path === "/" && module.basePath ? "" : route.path}` || "/";
      router.on(route.method.toUpperCase(), path, async (c) => {
        if (route.deprecated) {
          c.header("Deprecation", `@${epochSeconds(route.deprecated.since)}`);
          c.header("Sunset", new Date(route.deprecated.sunset).toUTCString());
        }
        let auth: AuthContext | null = c.get("auth");
        let grant: Grant | null = null;
        if (route.access !== "public") auth = requireAuth(c);
        for (const guard of guards) await guard(c, route);
        if (typeof route.access === "object") grant = await authorize(c, route.access.permission);

        const req = route.request ?? {};
        const params = req.params ? await parseInput(req.params, c.req.param(), "param") : undefined;
        const query = req.query ? await parseInput(req.query, c.req.query(), "query") : undefined;
        const body = req.body ? await parseInput(req.body, await readJsonBody(c), "json") : undefined;

        const out = await route.handler({ c, deps: c.var.deps, params, query, body, auth, grant });
        return serialize(c, module, route, out);
      });
    }
  }
  return router;
}
