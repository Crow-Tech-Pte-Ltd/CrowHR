import { recordAudit, systemAuditContext } from "@crowhr/core";
import { createTestDb, createTestDeps, seedOrg, type TestDb } from "@crowhr/core/testing";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { verifyAuditCommand } from "./admin.ts";

describe("crowhr admin verify-audit", () => {
  let t: TestDb;
  beforeEach(async () => {
    t = await createTestDb();
  });
  afterEach(() => t.close());

  it("reports an intact chain and then the first tampered event", async () => {
    const deps = createTestDeps(t.db);
    const org = await seedOrg(deps, { slug: "kopi" });
    const ctx = systemAuditContext(org.id, "system", "test");
    await recordAudit(deps.db, deps, ctx, { action: "a.one", targetType: "t" });
    const bad = await recordAudit(deps.db, deps, ctx, { action: "a.two", targetType: "t" });
    expect(await verifyAuditCommand(t.db)).toEqual({ ok: true, lines: ["kopi: OK, 2 events, chain intact."] });
    await t.pglite.exec(`alter table audit_events disable trigger audit_events_immutable;
      update audit_events set target_id = 'x' where id = '${bad.id}';
      alter table audit_events enable trigger audit_events_immutable;`);
    const result = await verifyAuditCommand(t.db, "kopi");
    expect(result.ok).toBe(false);
    expect(result.lines[0]).toContain(`BROKEN at event ${bad.id} (seq 2, hash mismatch)`);
  });

  it("names an unknown organisation", async () => {
    expect((await verifyAuditCommand(t.db, "nope")).lines).toEqual(['No organisation with slug "nope".']);
  });
});
