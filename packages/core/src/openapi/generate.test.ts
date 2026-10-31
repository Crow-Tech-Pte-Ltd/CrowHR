import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createTestDeps } from "../../testing/index.ts";
import { sensitive } from "../access/sensitivity.ts";
import { createApp, V1_MODULES } from "../app.ts";
import type { Db } from "../db/types.ts";
import { listQuery, pageOf } from "../http/list.ts";
import { defineModule, defineRoute, fullPath } from "../http/route.ts";
import { buildOpenApiDocument, type OpenApiDocument } from "./generate.ts";

const employee = z.object({
  id: z.uuid(),
  name: z.string(),
  nricMasked: sensitive(z.string().optional(), "nric"),
  basicPayCents: sensitive(z.number().int().optional(), "salary"),
});

const people = defineModule({
  name: "people",
  basePath: "/people",
  tag: "People",
  routes: [
    defineRoute({
      method: "get",
      path: "/",
      summary: "List people",
      access: { permission: "directory:read" },
      request: { query: listQuery({ sort: ["name"], defaultSort: "name" }) },
      responses: { 200: pageOf(employee) },
      handler: () => ({ items: [], page: 1, pageSize: 50, total: 0 }),
    }),
    defineRoute({
      method: "patch",
      path: "/:id",
      summary: "Update a person",
      access: { permission: "employment:update" },
      recentAuth: true,
      request: { params: z.object({ id: z.uuid() }), body: z.object({ name: z.string().optional() }) },
      responses: { 200: employee },
      errors: ["not_found", "conflict"],
      handler: () => {
        throw new Error("not called");
      },
    }),
    defineRoute({
      method: "get",
      path: "/public-thing",
      summary: "Public",
      access: "public",
      responses: { 204: null },
      handler: () => undefined,
    }),
  ],
});

describe("OpenAPI document", () => {
  const doc = buildOpenApiDocument([people]);
  // biome-ignore lint/suspicious/noExplicitAny: walking generated JSON.
  const op = (path: string, method: string): any => doc.paths[path]?.[method] ?? {};

  it("is OpenAPI 3.1 with every registered route", () => {
    expect(doc.openapi).toBe("3.1.0");
    expect(Object.keys(doc.paths)).toEqual(["/api/v1/people", "/api/v1/people/public-thing", "/api/v1/people/{id}"]);
    expect(doc.paths["/api/v1/people/{id}"]?.patch?.operationId).toBe("people.patchById");
  });

  it("documents parameters, request body, security and permission", () => {
    const list = doc.paths["/api/v1/people"]?.get as Record<string, unknown>;
    expect(list.security).toEqual([{ cookieSession: [] }, { bearerToken: [] }]);
    expect(list["x-permission"]).toBe("directory:read");
    const params = list.parameters as { name: string; in: string; required: boolean }[];
    expect(params.map((p) => [p.name, p.in, p.required])).toEqual([
      ["page", "query", false],
      ["pageSize", "query", false],
      ["sort", "query", false],
    ]);
    const patch = doc.paths["/api/v1/people/{id}"]?.patch as Record<string, unknown>;
    expect(patch.requestBody).toBeDefined();
    expect(patch["x-recent-auth"]).toBe(true);
    expect(op("/api/v1/people/public-thing", "get").security).toEqual([]);
  });

  it("lists error codes grouped by status", () => {
    const responses = op("/api/v1/people/{id}", "patch").responses;
    expect(responses["404"]?.["x-error-codes"]).toEqual(["not_found"]);
    expect(responses["409"]?.["x-error-codes"]).toEqual(["conflict"]);
    expect(responses["403"]?.["x-error-codes"]).toEqual(
      expect.arrayContaining(["forbidden", "reauth_required", "csrf_rejected", "mfa_enrolment_required"]),
    );
    expect(responses["400"]?.["x-error-codes"]).toEqual(["validation_failed"]);
  });

  it("marks sensitive fields with x-sensitivity", () => {
    const schema = op("/api/v1/people/{id}", "patch").responses[200].content["application/json"].schema;
    expect(schema.properties.nricMasked?.["x-sensitivity"]).toBe("nric");
    expect(schema.properties.basicPayCents?.["x-sensitivity"]).toBe("salary");
    expect(schema.properties.name?.["x-sensitivity"]).toBeUndefined();
  });

  it("is served at /api/v1/openapi.json, cacheable", async () => {
    const res = await createApp(createTestDeps({} as Db), { modules: [people] }).request("/api/v1/openapi.json");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("public, max-age=60");
    const served = (await res.json()) as OpenApiDocument;
    expect(Object.keys(served.paths)).toContain("/api/v1/people/{id}");
  });

  it("covers every built-in v1 route", () => {
    const built = buildOpenApiDocument(V1_MODULES);
    for (const module of V1_MODULES) {
      for (const route of module.routes) {
        const path = fullPath(module, route).replace(/:([A-Za-z0-9_]+)/g, "{$1}");
        expect(built.paths[path]?.[route.method], `${route.method} ${path}`).toBeDefined();
      }
    }
  });
});
