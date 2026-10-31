import { readFile, writeFile } from "node:fs/promises";
import { type Db, schema } from "@crowhr/core";
import type { DbDumper } from "./pg-tools.ts";

/**
 * Stand-in for pg_dump/pg_restore on PGlite (which has no pg_dump binary): serialises the
 * organisations, system_settings and secret_key_checks tables. Exercises the archive and restore orchestration;
 * the real tools are covered by the Postgres round-trip test and the compose smoke test.
 */
export function fakeDumper(db: Db, options: { failRestore?: boolean } = {}): DbDumper & { dumps: number } {
  const d = {
    kind: "fake",
    dumps: 0,
    async dump(outFile: string) {
      d.dumps += 1;
      const organisations = await db.select().from(schema.organisations);
      const settings = await db.select().from(schema.systemSettings);
      const keyChecks = await db.select().from(schema.secretKeyChecks);
      await writeFile(outFile, JSON.stringify({ organisations, settings, keyChecks }));
    },
    async restore(dumpFile: string) {
      const data = JSON.parse(await readFile(dumpFile, "utf8"));
      await db.transaction(async (tx) => {
        await tx.delete(schema.organisations);
        await tx.delete(schema.systemSettings);
        await tx.delete(schema.secretKeyChecks);
        for (const o of data.organisations) {
          await tx
            .insert(schema.organisations)
            .values({ ...o, createdAt: new Date(o.createdAt), updatedAt: new Date(o.updatedAt) });
        }
        for (const s of data.settings)
          await tx.insert(schema.systemSettings).values({ ...s, updatedAt: new Date(s.updatedAt) });
        for (const k of data.keyChecks ?? [])
          await tx.insert(schema.secretKeyChecks).values({ ...k, createdAt: new Date(k.createdAt) });
        if (options.failRestore) throw new Error("simulated pg_restore failure");
      });
    },
  };
  return d;
}
