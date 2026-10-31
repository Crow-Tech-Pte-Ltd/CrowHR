import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, createTestDeps, seedOrg, type TestDb } from "../../testing/index.ts";
import { auditEvents } from "../db/schema/audit.ts";
import { diffFields, recordAudit, systemAuditContext, verifyChain } from "./audit.ts";

describe("audit log", () => {
  let t: TestDb;
  let deps: ReturnType<typeof createTestDeps>;
  let orgId: string;
  beforeEach(async () => {
    t = await createTestDb();
    deps = createTestDeps(t.db);
    orgId = (await seedOrg(deps)).id;
  });
  afterEach(() => t.close());

  const ctx = () => ({
    ...systemAuditContext(orgId, "system", "test"),
    actorType: "member" as const,
    actorMembershipId: deps.ids.newId(),
    requestId: "req-12345678",
    ip: "203.0.113.9",
    userAgent: "vitest",
  });

  it("records the full event shape", async () => {
    const c = ctx();
    await recordAudit(deps.db, deps, c, { action: "member.invited", targetType: "membership", targetId: "m-1" });
    const [row] = await deps.db.select().from(auditEvents);
    expect(row).toMatchObject({
      orgId,
      seq: 1,
      actorType: "member",
      actorMembershipId: c.actorMembershipId,
      action: "member.invited",
      targetType: "membership",
      targetId: "m-1",
      requestId: "req-12345678",
      ip: "203.0.113.9",
      userAgent: "vitest",
      prevHash: "0".repeat(64),
    });
    expect(row?.at.toISOString()).toBe("2026-10-31T01:00:00.000Z");
    expect(row?.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("records only the names of changed sensitive fields", async () => {
    const diff = diffFields(
      { basicPayCents: 400_000, jobTitle: "Barista" },
      { basicPayCents: 450_000, jobTitle: "Senior barista" },
      { sensitive: ["basicPayCents"] },
    );
    expect(diff).toEqual({ basicPayCents: { changed: true }, jobTitle: { from: "Barista", to: "Senior barista" } });
    await recordAudit(deps.db, deps, ctx(), { action: "compensation.updated", targetType: "employee", diff });
    const [row] = await deps.db.select().from(auditEvents);
    expect(JSON.stringify(row?.diff)).not.toContain("450000");
  });

  it("never stores secrets in diff or meta", async () => {
    await recordAudit(deps.db, deps, ctx(), {
      action: "auth.password_changed",
      targetType: "user",
      diff: { password: { from: "old-secret-pw", to: "new-secret-pw" }, passwordHash: { from: "a", to: "b" } },
      meta: { reason: "user", token: "tok-abc", totpCode: "otp-424242-zz", nested: { clientSecret: "s3cr3t", ok: 1 } },
    });
    const [row] = await deps.db.select().from(auditEvents);
    const text = JSON.stringify(row);
    for (const secret of ["old-secret-pw", "new-secret-pw", "tok-abc", "otp-424242-zz", "s3cr3t"])
      expect(text).not.toContain(secret);
    expect(row?.diff).toEqual({ password: { changed: true }, passwordHash: { changed: true } });
    expect(row?.meta).toEqual({ reason: "user", nested: { ok: 1 } });
  });

  it("links each event to the previous one in the same organisation", async () => {
    const other = (await seedOrg(deps)).id;
    const a = await recordAudit(deps.db, deps, ctx(), { action: "x.one", targetType: "t" });
    await recordAudit(deps.db, deps, systemAuditContext(other, "system", "job"), {
      action: "x.other",
      targetType: "t",
    });
    const b = await recordAudit(deps.db, deps, ctx(), { action: "x.two", targetType: "t" });
    const rows = await deps.db.select().from(auditEvents).where(eq(auditEvents.orgId, orgId));
    expect(rows.map((r) => r.seq).sort()).toEqual([1, 2]);
    expect(rows.find((r) => r.id === b.id)?.prevHash).toBe(a.hash);
    expect(await verifyChain(deps.db, orgId)).toEqual({ ok: true, count: 2 });
    expect(await verifyChain(deps.db, other)).toEqual({ ok: true, count: 1 });
  });

  it("rejects UPDATE, DELETE and TRUNCATE at the database", async () => {
    await recordAudit(deps.db, deps, ctx(), { action: "x.one", targetType: "t" });
    await expect(t.pglite.query("update audit_events set action = 'x.forged'")).rejects.toThrow(/append-only/);
    await expect(t.pglite.query("delete from audit_events")).rejects.toThrow(/append-only/);
    await expect(t.pglite.query("truncate audit_events")).rejects.toThrow(/append-only/);
    expect(await deps.db.select().from(auditEvents)).toHaveLength(1);
  });

  it("reports the first event whose hash no longer matches after superuser tampering", async () => {
    await recordAudit(deps.db, deps, ctx(), { action: "x.one", targetType: "t" });
    const second = await recordAudit(deps.db, deps, ctx(), { action: "x.two", targetType: "t" });
    await recordAudit(deps.db, deps, ctx(), { action: "x.three", targetType: "t" });
    await t.pglite.exec(`
      alter table audit_events disable trigger audit_events_immutable;
      update audit_events set action = 'x.forged' where id = '${second.id}';
      alter table audit_events enable trigger audit_events_immutable;
    `);
    expect(await verifyChain(deps.db, orgId)).toEqual({
      ok: false,
      count: 3,
      brokenEventId: second.id,
      seq: 2,
      reason: "hash_mismatch",
    });
  });

  it("rolls the event back with the surrounding transaction", async () => {
    await expect(
      deps.db.transaction(async (tx) => {
        await recordAudit(tx, deps, ctx(), { action: "x.one", targetType: "t" });
        throw new Error("domain change failed");
      }),
    ).rejects.toThrow("domain change failed");
    expect(await deps.db.select().from(auditEvents)).toHaveLength(0);
  });
});
