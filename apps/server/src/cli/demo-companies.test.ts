import { createMemoryFileStore, noopLogger, schema } from "@crowhr/core";
import { createTestDb, createTestDeps, seedOrg, type TestDb } from "@crowhr/core/testing";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { demoCompaniesPurgeCommand } from "./admin.ts";

/** `crowhr demo-companies purge` (add-demo-companies "Migration Plan": rollback). */
describe("crowhr demo-companies purge", () => {
  let t: TestDb;
  beforeEach(async () => {
    t = await createTestDb();
  });
  afterEach(() => t.close());

  async function seed() {
    const deps = createTestDeps(t.db);
    const real = await seedOrg(deps, { slug: "real-co" });
    const now = new Date();
    const demo = (slug: string, expiresAt: Date) =>
      t.db.insert(schema.organisations).values({
        id: deps.ids.newId(),
        name: "Kopi Kaki",
        slug,
        demoExpiresAt: expiresAt,
        demoClaimedAt: now,
      });
    await demo("demo-aaaaaaaaaaaa", new Date(now.getTime() + 3_600_000));
    await demo("demo-bbbbbbbbbbbb", new Date(now.getTime() - 3_600_000));
    return real;
  }
  const slugs = async () =>
    (await t.db.select({ slug: schema.organisations.slug }).from(schema.organisations)).map((o) => o.slug).sort();
  const deps = () => ({ db: t.db, fileStore: createMemoryFileStore(), logger: noopLogger });

  it("deletes only expired demo companies with --expired", async () => {
    await seed();
    expect(await demoCompaniesPurgeCommand(deps(), { expiredOnly: true })).toEqual({
      ok: true,
      lines: ["Deleted 1 expired demo company. Real organisations were not touched."],
    });
    expect(await slugs()).toEqual(["demo-aaaaaaaaaaaa", "real-co"]);
  });

  it("ends and deletes every demo company without it, and never a real organisation", async () => {
    await seed();
    expect(await demoCompaniesPurgeCommand(deps(), { expiredOnly: false })).toEqual({
      ok: true,
      lines: ["Deleted 2 demo companies. Real organisations were not touched."],
    });
    expect(await slugs()).toEqual(["real-co"]);
  });
});
