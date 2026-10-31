import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createTestDeps } from "../../testing/index.ts";
import { createApp } from "../app.ts";
import type { Db } from "../db/types.ts";
import type { ErrorEnvelope } from "../errors.ts";
import { type AnyRoute, defineModule, defineRoute, reply } from "./route.ts";

const widget = z.object({ id: z.string(), name: z.string() });

const widgets = defineModule({
  name: "widgets",
  basePath: "/widgets",
  routes: [
    defineRoute({
      method: "get",
      path: "/:id",
      summary: "Get a widget",
      access: "public",
      request: {
        params: z.object({ id: z.string().min(3) }),
        query: z.object({ extra: z.enum(["yes", "no"]).optional() }),
      },
      responses: { 200: widget },
      errors: ["not_found"],
      handler: ({ params, query }) => {
        if (params.id === "missing") throw new Error("never");
        // Simulates a handler that leaks a column the contract does not declare.
        return query.extra === "yes"
          ? ({ id: params.id, name: "Kopi", secret: "x" } as never)
          : { id: params.id, name: "Kopi" };
      },
    }),
    defineRoute({
      method: "post",
      path: "/",
      summary: "Create a widget",
      access: "public",
      request: { body: z.object({ name: z.string().min(1, "Enter a name.") }) },
      responses: { 201: widget, 202: z.object({ queued: z.boolean() }) },
      handler: ({ body }) => (body.name === "later" ? reply(202, { queued: true }) : { id: "w-1", name: body.name }),
    }),
    defineRoute({
      method: "delete",
      path: "/:id",
      summary: "Delete a widget",
      access: "authenticated",
      request: { params: z.object({ id: z.string() }) },
      responses: { 204: null },
      handler: () => undefined,
    }),
    defineRoute({
      method: "get",
      path: "/",
      summary: "List widgets",
      access: { permission: "members:read" },
      responses: { 200: z.object({ items: z.array(widget) }) },
      handler: () => ({ items: [] }),
    }),
  ],
});

const app = (responseValidation: "strict" | "strip" = "strict") =>
  createApp(createTestDeps({} as Db, { responseValidation }), { modules: [widgets] });

describe("defineRoute", () => {
  it("validates params and passes typed input to the handler", async () => {
    const res = await app().request("/api/v1/widgets/abc");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: "abc", name: "Kopi" });
  });

  it("rejects invalid params, query and body with validation_failed", async () => {
    const short = await app().request("/api/v1/widgets/ab");
    expect(short.status).toBe(400);
    expect(((await short.json()) as ErrorEnvelope).error.details).toMatchObject({ target: "param" });

    const badQuery = await app().request("/api/v1/widgets/abc?extra=maybe");
    expect(((await badQuery.json()) as ErrorEnvelope).error.details).toMatchObject({
      target: "query",
      issues: [{ path: "extra", message: "Choose one of: yes, no." }],
    });

    const badBody = await app().request("/api/v1/widgets", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "" }),
    });
    expect(badBody.status).toBe(400);
    expect(((await badBody.json()) as ErrorEnvelope).error.details).toMatchObject({
      target: "json",
      issues: [{ path: "name", message: "Enter a name." }],
    });
  });

  it("refuses non-JSON and malformed JSON bodies with a message saying how to fix them", async () => {
    const form = await app().request("/api/v1/widgets", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "name=x",
    });
    expect(((await form.json()) as ErrorEnvelope).error.message).toContain("Content-Type: application/json");
    const broken = await app().request("/api/v1/widgets", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{",
    });
    expect(broken.status).toBe(400);
  });

  it("uses the lowest declared 2xx by default and reply() for another declared status", async () => {
    const post = (name: string) =>
      app().request("/api/v1/widgets", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name }),
      });
    expect((await post("Teh")).status).toBe(201);
    const later = await post("later");
    expect(later.status).toBe(202);
    expect(await later.json()).toEqual({ queued: true });
  });

  it("fails undocumented response fields in strict (test) mode", async () => {
    const res = await app("strict").request("/api/v1/widgets/abc?extra=yes");
    expect(res.status).toBe(500);
    expect(await res.text()).not.toContain("secret");
  });

  it("strips undocumented response fields in production mode", async () => {
    const res = await app("strip").request("/api/v1/widgets/abc?extra=yes");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: "abc", name: "Kopi" });
  });

  it("runs the access check before the handler (fail-closed without a session)", async () => {
    const del = await app().request("/api/v1/widgets/abc", { method: "DELETE" });
    expect(del.status).toBe(401);
    const list = await app().request("/api/v1/widgets");
    expect(list.status).toBe(401);
    expect(((await list.json()) as ErrorEnvelope).error.code).toBe("unauthenticated");
  });

  it("refuses to register a route without response schemas, naming the route", () => {
    expect(() =>
      defineModule({
        name: "broken",
        basePath: "/broken",
        routes: [
          {
            method: "get",
            path: "/",
            summary: "No responses",
            access: "public",
            responses: {},
            handler: () => ({}),
          } as unknown as AnyRoute,
        ],
      }),
    ).toThrow("Route GET /api/v1/broken declares no response schemas");
  });

  it("refuses path parameters without a params schema", () => {
    expect(() =>
      defineModule({
        name: "broken",
        basePath: "/broken",
        routes: [
          defineRoute({
            method: "get",
            path: "/:id",
            summary: "No params",
            access: "public",
            responses: { 200: widget },
            handler: () => ({ id: "x", name: "y" }),
          }),
        ],
      }),
    ).toThrow("Route GET /api/v1/broken/:id has path parameters (id) but no `request.params`");
  });

  it("refuses duplicate routes", () => {
    const r = defineRoute({
      method: "get",
      path: "/",
      summary: "x",
      access: "public",
      responses: { 204: null },
      handler: () => undefined,
    });
    expect(() => defineModule({ name: "dup", basePath: "/dup", routes: [r, r] })).toThrow("defined twice");
  });
});
