import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ErrorEnvelope } from "@crowhr/core";
import { createTestDb, createTestDeps, type TestDb } from "@crowhr/core/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServerApp } from "./http.ts";

describe("server HTTP surface", () => {
  let dist: string;
  let testDb: TestDb;
  let app: ReturnType<typeof createServerApp>;

  beforeAll(async () => {
    dist = await mkdtemp(join(tmpdir(), "crowhr-dist-"));
    await mkdir(join(dist, "assets"));
    await writeFile(join(dist, "index.html"), "<!doctype html><title>Crow HR</title>");
    await writeFile(join(dist, "assets", "app-abc123.js"), "console.log(1)");
    testDb = await createTestDb();
    app = createServerApp(createTestDeps(testDb.db), { webDistDir: dist });
  });
  afterAll(async () => {
    await testDb.close();
    await rm(dist, { recursive: true, force: true });
  });

  it("serves the API", async () => {
    const res = await app.request("/api/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: "ok" });
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("x-request-id")).toBeTruthy();
  });

  it("serves index.html for client-side routes (deep link reload)", async () => {
    const res = await app.request("/payroll");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(res.headers.get("cache-control")).toBe("no-cache");
    expect(await res.text()).toContain("<title>Crow HR</title>");
  });

  it("serves fingerprinted assets with a long cache", async () => {
    const res = await app.request("/assets/app-abc123.js");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toContain("immutable");
  });

  it("never falls back to the SPA for unknown API paths", async () => {
    const res = await app.request("/api/does-not-exist");
    expect(res.status).toBe(404);
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(((await res.json()) as ErrorEnvelope).error.code).toBe("not_found");
  });

  it("keeps core's error envelope for API exceptions", async () => {
    const res = await app.request("/api/health", { method: "DELETE" });
    expect(res.status).toBe(404);
    expect(((await res.json()) as ErrorEnvelope).error.requestId).toBe(res.headers.get("x-request-id"));
  });

  it("sets security headers", async () => {
    const res = await app.request("/");
    expect(res.headers.get("content-security-policy")).toContain("default-src 'self'");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("cache-control")).toBe("no-cache");
  });
});
