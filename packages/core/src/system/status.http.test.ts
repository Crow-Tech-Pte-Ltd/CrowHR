import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, createTestDeps, TEST_NOW, type TestDb } from "../../testing/index.ts";
import { createApp } from "../app.ts";
import type { AuthContext, ClientInfo } from "../context.ts";
import { backupRuns } from "../db/schema/system.ts";
import { AppError } from "../errors.ts";
import { VERSION } from "../version.ts";
import type { SystemHost } from "./host.ts";
import { SYSTEM_KEYS, setSystemSetting } from "./settings.ts";
import { getSystemStatus } from "./status.ts";

const auth = (roles: AuthContext["roles"]): AuthContext => ({
  user: { id: "u1", email: "o@acme.sg", displayName: "Owner" },
  orgId: "org1",
  membershipId: "m1",
  membershipStatus: "active",
  employeeId: null,
  roles,
  authMethod: "password",
  identity: null,
  session: { id: "s1", kind: "browser", authenticatedAt: new Date(TEST_NOW), mfaSatisfied: true },
});

const client: ClientInfo = {
  ip: "203.0.113.9",
  peerIp: "172.18.0.5",
  scheme: "https",
  host: "hr.acme.sg",
  viaTrustedProxy: true,
};

const host: SystemHost = {
  describe: async () => ({
    publicUrl: "https://hr.acme.sg",
    secureCookies: true,
    trustedProxies: ["172.16.0.0/12"],
    database: { driver: "pglite" },
    backups: {
      directory: "/backups",
      encrypted: false,
      schedule: "02:00 Asia/Singapore",
      keep: 14,
      beforeMigrate: true,
    },
    disk: [{ label: "Data", path: "/data", freeBytes: 5e9, totalBytes: 2e10 }],
    migrations: { bundled: 2, latestBundledTag: "0001_self_hosting" },
  }),
};

describe("GET /api/v1/system/status", () => {
  let testDb: TestDb;
  beforeEach(async () => {
    testDb = await createTestDb();
  });
  afterEach(() => testDb.close());

  it("requires sign-in", async () => {
    const res = await createApp(createTestDeps(testDb.db)).request("/api/v1/system/status");
    expect(res.status).toBe(401);
  });

  it("is owner only", async () => {
    const deps = createTestDeps(testDb.db, { systemHost: host });
    for (const roles of [[], ["hr_admin"], ["payroll_admin", "hr_admin"]] as const) {
      await expect(getSystemStatus(deps, auth(roles), client)).rejects.toMatchObject({ code: "forbidden" });
    }
    await expect(getSystemStatus(deps, auth(["owner"]), client)).resolves.toBeTruthy();
    await expect(getSystemStatus(deps, auth([]), client)).rejects.toBeInstanceOf(AppError);
  });

  it("echoes client IP, scheme, proxy trust, version, schema version and last backup", async () => {
    const deps = createTestDeps(testDb.db, { systemHost: host });
    const now = new Date(TEST_NOW);
    await setSystemSetting(
      testDb.db,
      SYSTEM_KEYS.schemaVersion,
      { tag: "0001_self_hosting", appVersion: "1.2.0", migratedAt: TEST_NOW },
      now,
    );
    await testDb.db.insert(backupRuns).values([
      {
        id: "0190f000-0000-7000-8000-000000000001",
        trigger: "scheduled",
        status: "succeeded",
        startedAt: new Date(now.getTime() - 26 * 3600_000),
        finishedAt: new Date(now.getTime() - 26 * 3600_000 + 5000),
        fileName: "crowhr-backup-a.tar.gz",
        sizeBytes: 12345,
      },
      {
        id: "0190f000-0000-7000-8000-000000000002",
        trigger: "manual",
        status: "failed",
        startedAt: new Date(now.getTime() - 3600_000),
        error: "pg_dump: connection refused",
      },
    ]);
    const status = await getSystemStatus(deps, auth(["owner"]), client);
    expect(status).toMatchObject({
      version: VERSION,
      publicUrl: "https://hr.acme.sg",
      secureCookies: true,
      database: { status: "ok", driver: "pglite" },
      schema: { tag: "0001_self_hosting", migratedByVersion: "1.2.0", bundledMigrations: 2 },
      backups: {
        last: { status: "failed", error: "pg_dump: connection refused" },
        lastSuccessful: { fileName: "crowhr-backup-a.tar.gz", sizeBytes: 12345 },
        encrypted: false,
        schedule: "02:00 Asia/Singapore",
        stale: false,
      },
      request: { clientIp: "203.0.113.9", peerIp: "172.18.0.5", scheme: "https", viaTrustedProxy: true },
      trustedProxies: ["172.16.0.0/12"],
    });
    expect(status.database.serverVersion).toMatch(/^\d+/);
    expect(status.schema.appliedMigrations).toBeGreaterThanOrEqual(1);
  });

  it("flags backups as stale after 48 hours or when there are none", async () => {
    const deps = createTestDeps(testDb.db);
    expect((await getSystemStatus(deps, auth(["owner"]), client)).backups.stale).toBe(true);
    await testDb.db.insert(backupRuns).values({
      id: "0190f000-0000-7000-8000-000000000003",
      trigger: "scheduled",
      status: "succeeded",
      startedAt: new Date(new Date(TEST_NOW).getTime() - 49 * 3600_000),
    });
    const status = await getSystemStatus(deps, auth(["owner"]), client);
    expect(status.backups.stale).toBe(true);
    expect(status.publicUrl).toBeNull();
    expect(status.disk).toEqual([]);
  });
});
