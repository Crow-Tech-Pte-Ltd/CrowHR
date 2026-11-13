import { z } from "zod";
import type { Permission } from "../access/matrix.ts";
import { ERROR_STATUS, type ErrorCode } from "../errors.ts";
import {
  type AnyRoute,
  type ApiModule,
  describeRoute,
  fullPath,
  type RawResponseSpec,
  type ResponseSpec,
} from "../http/route.ts";

/**
 * Builds the OpenAPI 3.1 document for `/api/v1` from the same zod schemas `defineRoute` uses
 * to validate requests and serialise responses. Uses zod 4's built-in JSON Schema output
 * (draft 2020-12, which OpenAPI 3.1 adopts), so no extra dependency and nothing runtime-specific.
 */

type JsonSchema = Record<string, unknown>;

export const SUPPORTED_API_VERSIONS = ["v1"] as const;

const errorEnvelopeSchema = z.object({
  error: z.object({
    code: z.string().meta({ description: "Stable machine-readable code. Switch on this, never on the message." }),
    message: z.string().meta({ description: "Says what went wrong and how to fix it." }),
    requestId: z.string(),
    details: z.unknown().optional(),
  }),
});

function toSchema(schema: z.ZodType, io: "input" | "output"): JsonSchema {
  const json = z.toJSONSchema(schema, { target: "draft-2020-12", io, unrepresentable: "any" }) as JsonSchema;
  delete json.$schema;
  return json;
}

function isRaw(spec: ResponseSpec): spec is RawResponseSpec {
  return typeof spec === "object" && spec !== null && "description" in spec && !("_zod" in spec);
}

function objectShape(schema: z.ZodType | undefined): Record<string, z.ZodType> {
  return ((schema as unknown as { shape?: Record<string, z.ZodType> } | undefined)?.shape ?? {}) as Record<
    string,
    z.ZodType
  >;
}

function parameters(route: AnyRoute): JsonSchema[] {
  const out: JsonSchema[] = [];
  for (const [name, schema] of Object.entries(objectShape(route.request?.params))) {
    out.push({ name, in: "path", required: true, schema: toSchema(schema, "input") });
  }
  for (const [name, schema] of Object.entries(objectShape(route.request?.query))) {
    const s = toSchema(schema, "input");
    const description = typeof s.description === "string" ? s.description : undefined;
    out.push({
      name,
      in: "query",
      required: !schema.safeParse(undefined).success,
      ...(description ? { description } : {}),
      schema: s,
    });
  }
  return out;
}

function toOpenApiPath(path: string): string {
  return path.replace(/:([A-Za-z0-9_]+)/g, "{$1}");
}

function operationId(module: ApiModule, route: AnyRoute): string {
  if (route.operationId) return route.operationId;
  const words = route.path
    .split("/")
    .filter(Boolean)
    .map((seg) =>
      seg.startsWith(":")
        ? `By${cap(seg.slice(1))}`
        : cap(seg.replace(/[^A-Za-z0-9]+(.)?/g, (_, ch: string) => (ch ? ch.toUpperCase() : ""))),
    );
  return `${module.name}.${route.method}${words.join("")}`;
}

function cap(s: string): string {
  return s ? s[0]?.toUpperCase() + s.slice(1) : s;
}

/** Error codes a route can answer with: declared ones plus those implied by access and input. */
export function routeErrorCodes(route: AnyRoute): ErrorCode[] {
  const codes = new Set<ErrorCode>(route.errors ?? []);
  if (route.request?.params || route.request?.query || route.request?.body) codes.add("validation_failed");
  if (route.access !== "public") {
    codes.add("unauthenticated");
    codes.add("session_expired");
    codes.add("session_revoked");
  }
  if (typeof route.access === "object") codes.add("forbidden");
  if (route.recentAuth) codes.add("reauth_required");
  if (route.refusedInDemoCompany) codes.add("disabled_in_demo");
  if (route.method !== "get" && route.access !== "public") codes.add("csrf_rejected");
  if (route.access !== "public" && !route.allowDuringMfaEnrolment) codes.add("mfa_enrolment_required");
  return [...codes].sort();
}

function operation(module: ApiModule, route: AnyRoute): JsonSchema {
  const responses: Record<string, JsonSchema> = {};
  for (const [status, spec] of Object.entries(route.responses as Record<string, ResponseSpec>)) {
    if (spec === null) responses[status] = { description: "No content." };
    else if (isRaw(spec)) {
      responses[status] = {
        description: spec.description,
        ...(spec.contentType ? { content: { [spec.contentType]: {} } } : {}),
      };
    } else {
      const schema = toSchema(spec, "output");
      responses[status] = {
        description: typeof schema.description === "string" ? schema.description : "Success.",
        content: { "application/json": { schema } },
      };
    }
  }
  const byStatus = new Map<number, ErrorCode[]>();
  for (const code of routeErrorCodes(route)) {
    const status = ERROR_STATUS[code];
    byStatus.set(status, [...(byStatus.get(status) ?? []), code]);
  }
  for (const [status, codes] of byStatus) {
    responses[String(status)] = {
      description: `Error: ${codes.join(", ")}.`,
      "x-error-codes": codes,
      content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorEnvelope" } } },
    };
  }

  const permission: Permission | undefined = typeof route.access === "object" ? route.access.permission : undefined;
  const op: JsonSchema = {
    operationId: operationId(module, route),
    summary: route.summary,
    ...(route.description ? { description: route.description } : {}),
    tags: [module.tag ?? module.name],
    security: route.access === "public" ? [] : [{ cookieSession: [] }, { bearerToken: [] }],
    ...(permission ? { "x-permission": permission } : {}),
    ...(route.recentAuth ? { "x-recent-auth": true } : {}),
    parameters: parameters(route),
    responses,
  };
  if (route.request?.body) {
    op.requestBody = {
      required: true,
      content: {
        "application/json": {
          schema: toSchema(route.request.body, "input"),
          ...(route.example?.body !== undefined ? { example: route.example.body } : {}),
        },
      },
    };
  }
  if (route.deprecated) {
    op.deprecated = true;
    op["x-sunset"] = route.deprecated.sunset;
  }
  return op;
}

export interface OpenApiDocument {
  openapi: "3.1.0";
  info: { title: string; version: string; description: string; license: { name: string; identifier: string } };
  servers: { url: string }[];
  paths: Record<string, Record<string, JsonSchema>>;
  components: JsonSchema;
}

/**
 * `info.version` is the API contract version (`1.<minor>`), not the server version, so the
 * committed snapshot only changes when the contract does.
 */
export function buildOpenApiDocument(modules: readonly ApiModule[]): OpenApiDocument {
  const paths: OpenApiDocument["paths"] = {};
  const operationIds = new Map<string, string>();
  for (const module of modules) {
    for (const route of module.routes) {
      const path = toOpenApiPath(fullPath(module, route));
      const op = operation(module, route);
      const id = op.operationId as string;
      const clash = operationIds.get(id);
      if (clash) throw new Error(`operationId ${id} is used by both ${clash} and ${describeRoute(module, route)}.`);
      operationIds.set(id, describeRoute(module, route));
      paths[path] = { ...(paths[path] ?? {}), [route.method]: op };
    }
  }
  const sorted = Object.fromEntries(Object.entries(paths).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
  return {
    openapi: "3.1.0",
    info: {
      title: "Crow HR API",
      version: API_CONTRACT_VERSION,
      description:
        "Versioned REST API used by the Crow HR web app and native apps. Within v1, changes are additive only; see docs/api.md.",
      license: { name: "MIT", identifier: "MIT" },
    },
    servers: [{ url: "/" }],
    paths: sorted,
    components: {
      securitySchemes: {
        cookieSession: {
          type: "apiKey",
          in: "cookie",
          name: "__Host-crowhr_session",
          description: "Browser session. Named `crowhr_session` when PUBLIC_URL is plain http.",
        },
        bearerToken: { type: "http", scheme: "bearer", description: "Native app access token (15 minutes)." },
      },
      schemas: { ErrorEnvelope: toSchema(errorEnvelopeSchema, "output") },
    },
  };
}

/** Bump the minor when the contract gains something; v1 never loses anything. */
export const API_CONTRACT_VERSION = "1.1";
