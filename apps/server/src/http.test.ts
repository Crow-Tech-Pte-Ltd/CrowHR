import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ErrorEnvelope } from "@crowhr/core";
import { createTestDb, createTestDeps, type TestDb } from "@crowhr/core/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fileResponseHeaders } from "../../../packages/core/src/files/uploads.ts";
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

  it("preserves the sandbox CSP on file responses", async () => {
    const fileApp = createServerApp(createTestDeps(testDb.db), {
      webDistDir: dist,
      modules: [
        {
          name: "file-test",
          basePath: "/file-test",
          routes: [
            {
              method: "get",
              path: "/",
              summary: "Test file",
              access: "public",
              responses: { 200: { description: "PDF" } },
              handler: () =>
                new Response("%PDF-1.4", {
                  headers: fileResponseHeaders(
                    { mime: "application/pdf", originalName: "mc.pdf", sizeBytes: 8 },
                    { inline: true },
                  ),
                }),
            },
          ],
        },
      ],
    });
    const res = await fileApp.request("/api/v1/file-test");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-security-policy")).toBe(
      "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
    );
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("sets security headers", async () => {
    const res = await app.request("/");
    expect(res.headers.get("content-security-policy")).toContain("default-src 'self'");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("cache-control")).toBe("no-cache");
  });
});

describe("official Singpass logo (deployer-supplied)", () => {
  let dir: string;
  let testDb: TestDb;
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "crowhr-branding-"));
    testDb = await createTestDb();
  });
  afterAll(async () => {
    await testDb.close();
    await rm(dir, { recursive: true, force: true });
  });

  it("serves branding/singpass-logo.svg from the data directory, sandboxed, and is 404 without it", async () => {
    const app = createServerApp(createTestDeps(testDb.db), { webDistDir: dir, brandingDir: join(dir, "branding") });
    expect((await app.request("/branding/singpass-logo")).status).toBe(404);
    await mkdir(join(dir, "branding"));
    await writeFile(join(dir, "branding", "singpass-logo.svg"), '<svg xmlns="http://www.w3.org/2000/svg"/>');
    const res = await app.request("/branding/singpass-logo");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/svg+xml");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("content-security-policy")).toContain("sandbox");
    expect(res.headers.get("content-security-policy")).toContain("default-src 'none'");
    expect(await res.text()).toContain("<svg");
  });

  it("refuses a logo over 200 KB", async () => {
    const big = await mkdtemp(join(tmpdir(), "crowhr-branding-big-"));
    try {
      await writeFile(join(big, "singpass-logo.png"), Buffer.alloc(201 * 1024));
      const app = createServerApp(createTestDeps(testDb.db), { webDistDir: dir, brandingDir: big });
      expect((await app.request("/branding/singpass-logo")).status).toBe(404);
    } finally {
      await rm(big, { recursive: true, force: true });
    }
  });
});

describe("client IP", () => {
  it("drops a client-supplied x-crowhr-client-ip header", async () => {
    const testDb = await createTestDb();
    try {
      const deps = createTestDeps(testDb.db);
      const app = createServerApp(deps, { webDistDir: "/nonexistent" });
      app.get("/echo-ip", (c) => c.text(c.req.header("x-crowhr-client-ip") ?? "none"));
      const res = await app.request("/echo-ip", { headers: { "x-crowhr-client-ip": "1.2.3.4" } });
      expect(await res.text()).toBe("none");
    } finally {
      await testDb.close();
    }
  });
});
