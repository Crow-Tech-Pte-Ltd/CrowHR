import { PGlite } from "@electric-sql/pglite";
import { expect, it } from "vitest";
import { createSqlFileStore, ensureLocalTables, type SqlClient } from "./local-store.ts";

it("stores a generated file inside a transaction without deadlocking, then persists and reloads it", async () => {
  const pglite = new PGlite();
  try {
    const sql = pglite as unknown as SqlClient;
    await ensureLocalTables(sql);
    const files = await createSqlFileStore(sql);
    const key = "org/test/files/letter.pdf";
    await pglite.transaction(async () => {
      await files.put(key, new Uint8Array([1, 2, 3]), { contentType: "application/pdf" });
      expect((await files.get(key))?.data).toEqual(new Uint8Array([1, 2, 3]));
    });
    await files.flush();
    const reloaded = await createSqlFileStore(sql);
    expect(await reloaded.get(key)).toMatchObject({ contentType: "application/pdf", size: 3 });
    await reloaded.delete(key);
    await reloaded.flush();
    expect(await (await createSqlFileStore(sql)).get(key)).toBeNull();
  } finally {
    await pglite.close();
  }
}, 10_000);
