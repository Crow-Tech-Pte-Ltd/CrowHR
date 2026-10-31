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
