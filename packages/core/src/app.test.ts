import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { createTestDeps } from "../testing/index.ts";
import { createApp } from "./app.ts";
import { type AppEnv, requireAuth } from "./context.ts";
import type { Db } from "./db/types.ts";
import { AppError, type ErrorEnvelope } from "./errors.ts";

// These tests never touch the database.
const deps = () => createTestDeps({} as Db);

describe("error envelope", () => {
  it("returns a JSON 404 envelope for unknown API paths", async () => {
    const res = await createApp(deps()).request("/api/nope");
    expect(res.status).toBe(404);
    const body = (await res.json()) as ErrorEnvelope;
    expect(body.error.code).toBe("not_found");
    expect(body.error.message).toContain("/api/nope");
    expect(body.error.requestId).toBe(res.headers.get("x-request-id"));
  });

  it("hides unexpected exception details and logs them with the request id", async () => {
    const d = deps();
    const app = createApp(d);
    app.get("/boom", () => {
      throw new Error("secret connection string postgres://u:p@h/db");
    });
    const res = await app.request("/boom");
    expect(res.status).toBe(500);
    const text = await res.text();
    expect(text).not.toContain("secret");
    const body = JSON.parse(text) as ErrorEnvelope;
    expect(body.error.code).toBe("internal");
    const logged = d.logger.entries.find((e) => e.level === "error");
    expect(logged?.requestId).toBe(body.error.requestId);
  });

  it("answers database reference and duplicate errors as 404/409 that say how to fix them, never 500", async () => {
    const d = deps();
    const app = createApp(d);
    const pg = (code: string, message: string) =>
      Object.assign(new Error("Failed query: insert into …"), {
        cause: Object.assign(new Error(message), { code, constraint: "x_fk", table: "x" }),
      });
    app.get("/missing", () => {
      throw pg("23503", 'insert or update on table "claims" violates foreign key constraint "claims_employee_fk"');
    });
    app.get("/in-use", () => {
      throw pg("23503", 'update or delete on table "shift_templates" violates foreign key constraint "x_fk"');
    });
    app.get("/duplicate", () => {
      throw pg("23505", 'duplicate key value violates unique constraint "x_unique"');
    });
    const err = async (path: string) => {
      const res = await app.request(path);
      return { status: res.status, ...((await res.json()) as ErrorEnvelope).error };
    };
    expect(await err("/missing")).toMatchObject({
      status: 404,
      code: "not_found",
      message: expect.stringMatching(/Reload/),
    });
    expect(await err("/in-use")).toMatchObject({
      status: 409,
      code: "conflict",
      message: expect.stringMatching(/still used/),
    });
    expect(await err("/duplicate")).toMatchObject({
      status: 409,
      code: "conflict",
      message: expect.stringMatching(/try again/),
    });
    expect(d.logger.entries.some((e) => e.level === "error")).toBe(false);
    expect(d.logger.entries.filter((e) => e.level === "warn").length).toBe(3);
  });

  it("maps AppError codes to statuses and keeps details", async () => {
    const app = createApp(deps());
    app.get("/conflict", () => {
      throw new AppError("conflict", "That UEN is already registered.", { field: "uen" });
    });
    const res = await app.request("/conflict");
    expect(res.status).toBe(409);
    expect(((await res.json()) as ErrorEnvelope).error).toMatchObject({
      code: "conflict",
      message: "That UEN is already registered.",
      details: { field: "uen" },
    });
  });
});

describe("request id", () => {
  it("reuses a well-formed incoming x-request-id", async () => {
    const res = await createApp(deps()).request("/api/nope", { headers: { "x-request-id": "edge-abc12345" } });
    expect(res.headers.get("x-request-id")).toBe("edge-abc12345");
  });

  it("replaces a malformed incoming x-request-id", async () => {
    const res = await createApp(deps()).request("/api/nope", { headers: { "x-request-id": "<script>" } });
    expect(res.headers.get("x-request-id")).not.toBe("<script>");
  });
});

describe("requireAuth", () => {
  it("fails closed with 401 while no auth middleware exists", async () => {
    const app = createApp(deps());
    const protectedRoutes = new Hono<AppEnv>().get("/", (c) => c.json(requireAuth(c)));
    // Mounted outside /api: the /api/* catch-all registered by createApp shadows later /api routes.
    app.route("/protected", protectedRoutes);
    const res = await app.request("/protected");
    expect(res.status).toBe(401);
    expect(((await res.json()) as ErrorEnvelope).error.code).toBe("unauthenticated");
  });
});
