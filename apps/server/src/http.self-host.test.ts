import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createMemoryLogger, schema } from "@crowhr/core";
import { createTestDb, createTestDeps, type TestDb } from "@crowhr/core/testing";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { clearMaintenance, createMaintenanceProbe, setMaintenance } from "./backup/maintenance.ts";
import { createServerApp, createStartingApp } from "./http.ts";
import { createClientResolver, readObservation } from "./proxy/client.ts";
import { parseTrustedProxies } from "./proxy/trust.ts";
import { createSetupGate } from "./setup/gate.ts";

const trusted = (raw: string) => {
  const p = parseTrustedProxies(raw);
  if (!p.ok) throw new Error("bad");
  return p.value;
};

/** What @hono/node-server passes as `env`: the Node request with its socket. */
const fromPeer = (remoteAddress: string) => ({ incoming: { socket: { remoteAddress } } });

describe("server: self-hosting HTTP behaviour", () => {
  let dir: string;
  let testDb: TestDb;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "crowhr-http-"));
    await mkdir(join(dir, "dist", "assets"), { recursive: true });
    await writeFile(join(dir, "dist", "index.html"), "<!doctype html><title>Crow HR</title>");
    await writeFile(join(dir, "dist", "assets", "app.js"), "1");
    testDb = await createTestDb();
  });
  afterEach(async () => {
    await testDb.close();
    await rm(dir, { recursive: true, force: true });
  });

  it("health says `starting` (503) while migrations run", async () => {
    const app = createStartingApp();
    const res = await app.request("/api/health");
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ status: "starting" });
    expect((await app.request("/payroll")).status).toBe(503);
  });

  it("setup mode: pages redirect to /setup, the API answers setup_required, setup itself works", async () => {
    const app = createServerApp(createTestDeps(testDb.db), {
      webDistDir: join(dir, "dist"),
      setupGate: createSetupGate(testDb.db),
    });
    const home = await app.request("/");
    expect(home.status).toBe(302);
    expect(home.headers.get("location")).toBe("/setup");
    expect((await app.request("/payroll")).headers.get("location")).toBe("/setup");
    expect((await app.request("/setup")).status).toBe(200);
    expect((await app.request("/assets/app.js")).status).toBe(200);
    expect((await app.request("/api/health")).status).toBe(200);
    expect((await app.request("/api/v1/setup")).status).toBe(200);
    const api = await app.request("/api/v1/system/status");
    expect(api.status).toBe(409);
    expect((await api.json()).error.code).toBe("setup_required");

    await testDb.db.insert(schema.organisations).values({ id: "0190f000-0000-7000-8000-0000000000c1", name: "Acme" });
    expect((await app.request("/")).status).toBe(200);
    expect((await app.request("/api/v1/setup")).status).toBe(404);
    expect((await app.request("/api/v1/system/status")).status).toBe(401);
  });

  it("maintenance: 503 everywhere while a restore runs", async () => {
    const app = createServerApp(createTestDeps(testDb.db), {
      webDistDir: join(dir, "dist"),
      maintenance: createMaintenanceProbe(dir, 0),
    });
    await setMaintenance(dir, "restoring");
    const health = await app.request("/api/health");
    expect(health.status).toBe(503);
    expect(await health.json()).toMatchObject({ status: "maintenance" });
    const api = await app.request("/api/v1/setup");
    expect(api.status).toBe(503);
    expect((await api.json()).error.code).toBe("service_unavailable");
    const page = await app.request("/");
    expect(page.status).toBe(503);
    expect(await page.text()).toContain("restoring a backup");
    await clearMaintenance(dir);
    expect((await app.request("/api/health")).status).toBe(200);
  });

  it("uses the TCP peer, not spoofed X-Forwarded-For, and tells the operator once", async () => {
    const logger = createMemoryLogger();
    const deps = createTestDeps(testDb.db, {
      resolveClient: createClientResolver({ trusted: trusted(""), logger, dataDir: dir }),
    });
    const app = createServerApp(deps, { webDistDir: join(dir, "dist") });
    const headers = { "x-forwarded-for": "1.2.3.4", "x-forwarded-proto": "https" };
    await app.fetch(new Request("http://hr.acme.sg/api/health", { headers }), fromPeer("::ffff:172.18.0.5"));
    await app.fetch(new Request("http://hr.acme.sg/api/health", { headers }), fromPeer("::ffff:172.18.0.5"));
    const seen = readObservation(dir);
    expect(seen).toMatchObject({
      clientIp: "172.18.0.5",
      scheme: "http",
      viaTrustedProxy: false,
      ignoredForwardedHeaders: true,
    });
    const warnings = logger.entries.filter((e) => e.level === "warn");
    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.message).toContain("set TRUSTED_PROXIES=172.18.0.5");
  });

  it("behind a trusted proxy the real client and scheme reach core (setup rate limit is per client)", async () => {
    const deps = createTestDeps(testDb.db, {
      resolveClient: createClientResolver({
        trusted: trusted("172.16.0.0/12"),
        logger: createMemoryLogger(),
        dataDir: dir,
      }),
    });
    const app = createServerApp(deps, { webDistDir: join(dir, "dist") });
    const verify = (client: string) =>
      app.fetch(
        new Request("http://hr.acme.sg/api/v1/setup/verify", {
          method: "POST",
          headers: { "x-forwarded-for": client, "x-forwarded-proto": "https", "x-setup-code": "WRONG" },
        }),
        fromPeer("172.18.0.5"),
      );
    for (let i = 0; i < 5; i++) expect((await verify("203.0.113.9")).status).toBe(401);
    expect((await verify("203.0.113.9")).status).toBe(429);
    // A different client behind the same proxy is not blocked.
    expect((await verify("198.51.100.20")).status).toBe(401);
    expect(readObservation(dir)).toMatchObject({ clientIp: "203.0.113.9", scheme: "https", viaTrustedProxy: true });
  });
});
