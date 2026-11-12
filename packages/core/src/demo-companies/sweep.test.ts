import { eq, getTableColumns, is } from "drizzle-orm";
import { getTableConfig, PgTable } from "drizzle-orm/pg-core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createTestDb,
  createTestDeps,
  movableClock,
  seedMember,
  seedOrg,
  type TestDb,
  testClient,
  testDemoCompanies,
} from "../../testing/index.ts";
import { createApp } from "../app.ts";
import { recordAudit, systemAuditContext } from "../audit/audit.ts";
import { memberships } from "../db/schema/access.ts";
import { auditEvents } from "../db/schema/audit.ts";
import { deviceSessions, recoveryCodes, sessions } from "../db/schema/auth.ts";
import { files } from "../db/schema/files.ts";
import * as schema from "../db/schema/index.ts";
import { organisations } from "../db/schema/organisations.ts";
import { users } from "../db/schema/users.ts";
import type { Db } from "../db/types.ts";
import { tick } from "../jobs/tick.ts";
import { purgeDemoCompany } from "./purge.ts";
import { endAllDemoCompanies } from "./service.ts";

/**
 * Expiry (demo-companies "Expiry", design decision 8): the sweep deletes every row and file of
 * an expired demo company, its memberships and the users who belong nowhere else, and never
 * anything of an organisation without a demo expiry.
 */
const HOUR = 3_600_000;
// The audit trigger compares expiries with the database clock (real time), so expiries here are in
// the real past.
const START = "2026-09-01T02:15:00.000Z";

/** Every row of every table that belongs to `orgId` (tenant tables and the org row), as JSON. */
async function snapshot(db: Db, orgId: string) {
  const out: Record<string, string[]> = {};
  for (const value of Object.values(schema)) {
    if (!is(value, PgTable)) continue;
    const name = getTableConfig(value).name;
    const cols = getTableColumns(value) as Record<string, unknown>;
    // biome-ignore lint/suspicious/noExplicitAny: any table's columns.
    const col = (k: string) => cols[k] as any;
    let rows: unknown[] = [];
    if (name === "organisations")
      rows = await db
        .select()
        .from(value)
        .where(eq(col("id"), orgId));
    else if (cols.orgId)
      rows = await db
        .select()
        .from(value)
        .where(eq(col("orgId"), orgId));
    else continue;
    if (rows.length) out[name] = rows.map((r) => JSON.stringify(r)).sort();
  }
  return out;
}

describe("demo companies: expiry sweep", () => {
  let t: TestDb;
  const clock = movableClock(START);
  let deps: ReturnType<typeof createTestDeps>;
  let app: ReturnType<typeof createApp>;
  let real: { id: string; slug: string };

  beforeEach(async () => {
    clock.set(START);
    t = await createTestDb();
    deps = createTestDeps(t.db, { clock });
    deps = createTestDeps(t.db, { clock, demoCompanies: testDemoCompanies(() => deps) });
    app = createApp(deps);
    real = await seedOrg(deps, { slug: "real-co" });
    await seedMember(deps, real.id, {
      roles: ["owner"],
      email: "owner@real.example",
      password: "correct horse battery",
    });
    await recordAudit(deps.db, deps, systemAuditContext(real.id, "system", "test"), {
      action: "test.real",
      targetType: "organisation",
    });
    await deps.fileStore.put(`org/${real.id}/files/keep.png`, new Uint8Array([1, 2, 3]), { contentType: "image/png" });
  });
  afterEach(() => t.close());

  async function startOne(ip = "203.0.113.7") {
    const res = await testClient(app, deps, { ip }).post("/api/v1/demo-companies", {});
    const { slug } = (await res.json()) as { slug: string };
    const [org] = await t.db.select().from(organisations).where(eq(organisations.slug, slug));
    return { slug, id: org?.id as string };
  }

  it("deletes an expired demo company with everything in it, and nothing else", async () => {
    const expiring = await startOne("203.0.113.1");
    clock.advance(HOUR);
    const live = await startOne("203.0.113.2");
    // Use the company: sign in, so it has sessions and sign-in audit events too.
    const personas = (await (await app.request(`/api/v1/auth/demo/personas?org=${expiring.slug}`)).json()) as {
      items: { membershipId: string }[];
    };
    await testClient(app, deps).post("/api/v1/auth/demo/sign-in", {
      membershipId: personas.items[0]?.membershipId,
      org: expiring.slug,
    });
    // An app signed in on a phone, and a recovery code, so device sessions and user rows are covered.
    const [m] = await t.db.select().from(memberships).where(eq(memberships.orgId, expiring.id)).limit(1);
    const at = clock.now();
    await t.db.insert(deviceSessions).values({
      id: deps.ids.newId(),
      orgId: expiring.id,
      userId: m?.userId as string,
      membershipId: m?.id as string,
      authMethod: "password",
      platform: "android",
      deviceName: "Android phone",
      appVersion: "1.0.0",
      accessHash: "a".repeat(64),
      accessExpiresAt: at,
      refreshFamilyId: deps.ids.newId(),
      currentRefreshHash: "b".repeat(64),
      createdAt: at,
      lastUsedAt: at,
      lastIp: "203.0.113.1",
      idleExpiresAt: at,
      absoluteExpiresAt: at,
      authenticatedAt: at,
      mfaSatisfied: true,
    });
    await t.db
      .insert(recoveryCodes)
      .values({ id: deps.ids.newId(), userId: m?.userId as string, codeHash: "c".repeat(64), createdAt: at });
    expect(await t.db.select().from(deviceSessions).where(eq(deviceSessions.orgId, expiring.id))).toHaveLength(1);
    expect(await t.db.select().from(sessions).where(eq(sessions.orgId, expiring.id))).toHaveLength(1);
    const [file] = await t.db.select().from(files).where(eq(files.orgId, expiring.id));
    expect(await deps.fileStore.get(file?.storageKey as string)).not.toBeNull();
    const userIds = (
      await t.db.select({ id: memberships.userId }).from(memberships).where(eq(memberships.orgId, expiring.id))
    ).map((r) => r.id);
    expect(userIds).toHaveLength(4);
    const realBefore = await snapshot(t.db, real.id);
    const liveBefore = await snapshot(t.db, live.id);

    clock.set(new Date(Date.parse(START) + 72 * HOUR + 60_000));
    const report = await tick(deps, clock.now());
    expect(report.errors).toEqual([]);
    expect(report.demoCompanies.purged).toBe(1);

    expect(await snapshot(t.db, expiring.id)).toEqual({});
    expect(await t.db.select().from(deviceSessions).where(eq(deviceSessions.orgId, expiring.id))).toEqual([]);
    expect(await t.db.select().from(sessions).where(eq(sessions.orgId, expiring.id))).toEqual([]);
    expect(
      await t.db
        .select()
        .from(recoveryCodes)
        .where(eq(recoveryCodes.userId, m?.userId as string)),
    ).toEqual([]);
    const leftUsers = await t.db.select().from(users);
    expect(leftUsers.some((u) => userIds.includes(u.id))).toBe(false);
    expect(await deps.fileStore.get(file?.storageKey as string)).toBeNull();
    expect(await t.db.select().from(auditEvents).where(eq(auditEvents.orgId, expiring.id))).toEqual([]);
    // Everyone else is exactly as before.
    expect(await snapshot(t.db, real.id)).toEqual(realBefore);
    expect(await snapshot(t.db, live.id)).toEqual(liveBefore);
    expect(await deps.fileStore.get(`org/${real.id}/files/keep.png`)).not.toBeNull();
    expect(leftUsers.some((u) => u.email === "owner@real.example")).toBe(true);
  });

  it("keeps a user who also belongs to another organisation", async () => {
    const expiring = await startOne();
    const [m] = await t.db.select().from(memberships).where(eq(memberships.orgId, expiring.id)).limit(1);
    // Not possible through the app (invitations are refused in demo companies); the rule holds anyway.
    await t.db.insert(memberships).values({
      id: deps.ids.newId(),
      orgId: real.id,
      userId: m?.userId as string,
      status: "active",
    });
    clock.advance(73 * HOUR);
    await tick(deps, clock.now());
    expect(await t.db.select().from(organisations).where(eq(organisations.id, expiring.id))).toEqual([]);
    expect(
      (
        await t.db
          .select()
          .from(users)
          .where(eq(users.id, m?.userId as string))
      ).length,
    ).toBe(1);
  });

  it("never deletes an organisation without a demo expiry, even when asked to directly", async () => {
    const before = await snapshot(t.db, real.id);
    expect(await purgeDemoCompany(deps, real.id, new Date("2100-01-01T00:00:00Z"))).toBeNull();
    clock.set("2100-01-01T00:00:00Z");
    await tick(deps, clock.now());
    expect(await snapshot(t.db, real.id)).toEqual(before);
  });

  it("refuses to purge a live demo company directly", async () => {
    const live = await startOne();
    expect(await purgeDemoCompany(deps, live.id, clock.now())).toBeNull();
    expect((await t.db.select().from(organisations).where(eq(organisations.id, live.id))).length).toBe(1);
  });

  it("deletes expired demo companies even after the mode is turned off", async () => {
    const expiring = await startOne();
    const off = createTestDeps(t.db, { clock, fileStore: deps.fileStore });
    clock.advance(73 * HOUR);
    const report = await tick(off, clock.now());
    expect(report.demoCompanies.purged).toBe(1);
    expect(await t.db.select().from(organisations).where(eq(organisations.id, expiring.id))).toEqual([]);
  });

  it("replaces pool copies nobody claimed within a day", async () => {
    const pooled = createTestDeps(t.db, { clock, demoCompanies: testDemoCompanies(() => pooled, { poolSize: 1 }) });
    await tick(pooled, clock.now());
    const first = (pooled.demoCompanies as ReturnType<typeof testDemoCompanies>).calls[0];
    clock.advance(25 * HOUR);
    const report = await tick(pooled, clock.now());
    expect(report.demoCompanies).toEqual({ purged: 1, seeded: 1 });
    expect(
      await t.db
        .select()
        .from(organisations)
        .where(eq(organisations.slug, first?.slug as string)),
    ).toEqual([]);
  });

  it("ends and deletes every demo company for `crowhr demo-companies purge`, leaving real ones", async () => {
    await startOne("203.0.113.1");
    await startOne("203.0.113.2");
    const before = await snapshot(t.db, real.id);
    expect(await endAllDemoCompanies(deps, clock.now())).toBe(2);
    const left = await t.db.select({ id: organisations.id }).from(organisations);
    expect(left.map((o) => o.id)).toEqual([real.id]);
    expect(await snapshot(t.db, real.id)).toEqual(before);
    expect(await t.db.select().from(auditEvents)).toHaveLength(1);
  });
});
