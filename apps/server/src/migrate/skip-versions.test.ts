import { rm } from "node:fs/promises";
import type { Db } from "@crowhr/core";
import { sql } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { readBundledMigrations, runMigrations } from "./runner.ts";
import { freshPglite, makeMigrationsFolder, memoryLock } from "./test-helpers.ts";

describe("upgrading across skipped versions", () => {
  const cleanup: (() => Promise<unknown>)[] = [];
  afterEach(async () => {
    while (cleanup.length) await cleanup.pop()?.();
  });

  it("a database at an older migration tag applies every later migration, in order, in one start", async () => {
    const p = freshPglite();
    cleanup.push(p.close);
    const db = p.db as Db;
    // "1.1.0": only the first bundled migration.
    const old = await makeMigrationsFolder({ take: 1 });
    // "1.6.2": everything bundled plus three releases' worth of later migrations.
    const latest = await makeMigrationsFolder({
      extra: {
        "0090_v1_2": ["create table v12 (id int primary key)"],
        "0091_v1_4": ["alter table v12 add column note text"],
        "0092_v1_6": ["insert into v12 (id, note) values (1, 'from 1.6')"],
      },
    });
    cleanup.push(
      () => rm(old, { recursive: true }),
      () => rm(latest, { recursive: true }),
    );

    await runMigrations({ db, lock: memoryLock(), migrationsFolder: old, appVersion: "1.1.0" });
    await db.execute(sql`insert into organisations (id, name) values (gen_random_uuid(), 'Acme')`);

    const backups: string[][] = [];
    const result = await runMigrations({
      db,
      lock: memoryLock(),
      migrationsFolder: latest,
      appVersion: "1.6.2",
      beforeMigrate: async (pending) => {
        backups.push(pending.map((m) => m.tag));
        return "/backups/pre.tar.gz";
      },
    });
    const all = readBundledMigrations(latest).map((m) => m.tag);
    expect(result.applied).toEqual(all.slice(1));
    expect(backups).toEqual([all.slice(1)]);
    const rows = await db.execute(sql`select note from v12`);
    expect((rows as unknown as { rows: { note: string }[] }).rows).toEqual([{ note: "from 1.6" }]);
  });
});
