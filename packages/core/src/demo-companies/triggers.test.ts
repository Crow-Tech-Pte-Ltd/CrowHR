import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, createTestDeps, seedOrg, type TestDb } from "../../testing/index.ts";
import { recordAudit, systemAuditContext } from "../audit/audit.ts";
import { auditEvents } from "../db/schema/audit.ts";
import { organisations } from "../db/schema/organisations.ts";

/**
 * Database rules behind demo companies (access-control "Audit log immutability", demo-companies
 * design decisions 2 and 8). These hold for any SQL, not just the app's code paths:
 * - the demo flag (`demo_expires_at`) is set only when an organisation is inserted;
 * - audit events stay append-only, except that the expiry sweep may delete the events of an
 *   expired demo company inside a transaction that names that organisation.
 */
describe("demo company database rules", () => {
  let t: TestDb;
  let deps: ReturnType<typeof createTestDeps>;
  let realOrg: string;
  beforeEach(async () => {
    t = await createTestDb();
    deps = createTestDeps(t.db);
    realOrg = (await seedOrg(deps, { slug: "real-co" })).id;
    await recordAudit(deps.db, deps, systemAuditContext(realOrg, "system", "test"), {
      action: "test.real_event",
      targetType: "organisation",
    });
  });
  afterEach(() => t.close());

  /** A demo company inserted with its flag; `expiresAt` is compared with the database's clock. */
  async function demoOrg(slug: string, expiresAt: string) {
    const id = deps.ids.newId();
    await deps.db.insert(organisations).values({ id, name: "Demo", slug, demoExpiresAt: new Date(expiresAt) });
    await recordAudit(deps.db, deps, systemAuditContext(id, "system", "test"), {
      action: "test.demo_event",
      targetType: "organisation",
    });
    return id;
  }

  /** Runs `statement` in a transaction that sets `crowhr.purge_demo_org` like the sweep. */
  async function inPurge(orgId: string, statement: string) {
    await t.pglite.transaction(async (tx) => {
      await tx.query("select set_config('crowhr.purge_demo_org', $1, true)", [orgId]);
      await tx.query(statement);
    });
  }

  const auditCount = async (orgId: string) =>
    (await deps.db.select().from(auditEvents).where(eq(auditEvents.orgId, orgId))).length;

  it("adds the two demo columns, empty for existing organisations", async () => {
    const [row] = await deps.db.select().from(organisations).where(eq(organisations.id, realOrg));
    expect(row?.demoExpiresAt).toBeNull();
    expect(row?.demoClaimedAt).toBeNull();
  });

  it("refuses to turn an existing organisation into a demo company", async () => {
    await expect(
      t.pglite.query("update organisations set demo_expires_at = now() - interval '1 day' where id = $1", [realOrg]),
    ).rejects.toThrow(/demo_expires_at/);
    const [row] = await deps.db.select().from(organisations).where(eq(organisations.id, realOrg));
    expect(row?.demoExpiresAt).toBeNull();
  });

  it("refuses to clear a demo company's flag, but lets its expiry move", async () => {
    const id = await demoOrg("demo-aaaaaaaaaaaa", "2099-01-01T00:00:00Z");
    await expect(t.pglite.query("update organisations set demo_expires_at = null where id = $1", [id])).rejects.toThrow(
      /demo_expires_at/,
    );
    await t.pglite.query(
      "update organisations set demo_expires_at = '2099-02-01T00:00:00Z', name = 'x' where id = $1",
      [id],
    );
    const [row] = await deps.db.select().from(organisations).where(eq(organisations.id, id));
    expect(row?.demoExpiresAt?.toISOString()).toBe("2099-02-01T00:00:00.000Z");
  });

  it("refuses to delete a real organisation's audit events, even inside a purge transaction naming it", async () => {
    await expect(inPurge(realOrg, `delete from audit_events where org_id = '${realOrg}'`)).rejects.toThrow(
      /append-only/,
    );
    await expect(t.pglite.query(`delete from audit_events where org_id = '${realOrg}'`)).rejects.toThrow(/append-only/);
    expect(await auditCount(realOrg)).toBe(1);
  });

  it("refuses a purge transaction that names a different organisation", async () => {
    const expired = await demoOrg("demo-bbbbbbbbbbbb", "2020-01-01T00:00:00Z");
    // The setting names the expired demo company, the statement also reaches the real one.
    await expect(inPurge(expired, "delete from audit_events")).rejects.toThrow(/append-only/);
    expect(await auditCount(realOrg)).toBe(1);
    expect(await auditCount(expired)).toBe(1);
  });

  it("refuses to delete a live demo company's audit events", async () => {
    const live = await demoOrg("demo-cccccccccccc", "2099-01-01T00:00:00Z");
    await expect(inPurge(live, `delete from audit_events where org_id = '${live}'`)).rejects.toThrow(/append-only/);
    expect(await auditCount(live)).toBe(1);
  });

  it("refuses to delete an expired demo company's audit events outside a purge transaction", async () => {
    const expired = await demoOrg("demo-dddddddddddd", "2020-01-01T00:00:00Z");
    await expect(t.pglite.query(`delete from audit_events where org_id = '${expired}'`)).rejects.toThrow(/append-only/);
    expect(await auditCount(expired)).toBe(1);
  });

  it("lets the purge delete an expired demo company's audit events, and only those", async () => {
    const expired = await demoOrg("demo-eeeeeeeeeeee", "2020-01-01T00:00:00Z");
    await inPurge(expired, `delete from audit_events where org_id = '${expired}'`);
    expect(await auditCount(expired)).toBe(0);
    expect(await auditCount(realOrg)).toBe(1);
  });

  it("keeps UPDATE and TRUNCATE refused for everyone, demo companies included", async () => {
    const expired = await demoOrg("demo-ffffffffffff", "2020-01-01T00:00:00Z");
    await expect(
      inPurge(expired, `update audit_events set action = 'x.forged' where org_id = '${expired}'`),
    ).rejects.toThrow(/append-only/);
    await expect(inPurge(expired, "truncate audit_events")).rejects.toThrow(/append-only/);
    expect(await auditCount(expired)).toBe(1);
  });

  it("refuses to delete a real organisation that has audit events (they reference it)", async () => {
    await expect(inPurge(realOrg, `delete from organisations where id = '${realOrg}'`)).rejects.toThrow();
    expect(await auditCount(realOrg)).toBe(1);
  });
});
