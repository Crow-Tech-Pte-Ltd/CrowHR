import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { organisations, users } from "../src/db/schema/index.ts";
import { fixedClock } from "../src/deps.ts";
import { createUuidV7Generator } from "../src/ids.ts";
import { createTestDb, type TestDb } from "./index.ts";

describe("createTestDb", () => {
  let testDb: TestDb | undefined;
  afterEach(async () => {
    await testDb?.close();
  });

  it("applies every migration to an in-memory database", async () => {
    testDb = await createTestDb();
    const result = await testDb.pglite.query<{ table_name: string }>(
      "select table_name from information_schema.tables where table_schema = 'public' order by table_name",
    );
    expect(result.rows.map((r) => r.table_name)).toEqual(
      expect.arrayContaining(["organisations", "users", "memberships", "audit_events"]),
    );
  });

  it("inserts and reads back an organisation", async () => {
    testDb = await createTestDb();
    const id = createUuidV7Generator(fixedClock("2026-10-31T01:00:00Z")).newId();
    await testDb.db.insert(organisations).values({ id, name: "Kopi Tiam Pte. Ltd.", uen: "202612345K" });
    const [row] = await testDb.db.select().from(organisations).where(eq(organisations.id, id));
    expect(row).toMatchObject({ id, name: "Kopi Tiam Pte. Ltd.", uen: "202612345K" });
    expect(row?.createdAt).toBeInstanceOf(Date);
  });

  it("enforces unique emails", async () => {
    testDb = await createTestDb();
    const ids = createUuidV7Generator(fixedClock("2026-10-31T01:00:00Z"));
    await testDb.db.insert(users).values({ id: ids.newId(), email: "a@example.sg", displayName: "A" });
    await expect(
      testDb.db.insert(users).values({ id: ids.newId(), email: "a@example.sg", displayName: "B" }),
    ).rejects.toThrow();
  });

  it("gives each test database its own isolated state", async () => {
    const first = await createTestDb();
    const second = await createTestDb();
    try {
      await first.db
        .insert(organisations)
        .values({ id: "0192e0b4-0000-7000-8000-000000000001", name: "Only in first" });
      expect(await second.db.select().from(organisations)).toEqual([]);
    } finally {
      await first.close();
      await second.close();
    }
  });
});
