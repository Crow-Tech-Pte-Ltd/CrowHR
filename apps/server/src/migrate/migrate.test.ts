import { rm } from "node:fs/promises";
import { createMemoryLogger, type Db, getSystemSetting, SYSTEM_KEYS, setSystemSetting } from "@crowhr/core";
import { migrationsFolder } from "@crowhr/core/migrations-folder";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { afterEach, describe, expect, it } from "vitest";
import { createPgAdvisoryLock } from "../db.ts";
import { StartupError } from "../startup-error.ts";
import { readBundledMigrations, runMigrations } from "./runner.ts";
import { freshPglite, makeMigrationsFolder, memoryLock } from "./test-helpers.ts";

const rows = <T>(r: unknown) => ((r as { rows?: T[] }).rows ?? r) as T[];
const tracked = async (db: Db) =>
  rows<{ n: number }>(await db.execute(sql`select count(*)::int as n from drizzle.__drizzle_migrations`))[0]?.n;
const tableExists = async (db: Db, name: string) =>
  rows<{ t: string | null }>(await db.execute(sql`select to_regclass(${`public.${name}`})::text as t`))[0]?.t !== null;

describe("migrations on start (PGlite)", () => {
  const cleanup: (() => Promise<unknown>)[] = [];
  afterEach(async () => {
    while (cleanup.length) await cleanup.pop()?.();
  });
  const pglite = () => {
    const p = freshPglite();
    cleanup.push(p.close);
    return p.db as Db;
  };
  const folder = async (options: Parameters<typeof makeMigrationsFolder>[0]) => {
    const dir = await makeMigrationsFolder(options);
    cleanup.push(() => rm(dir, { recursive: true, force: true }));
    return dir;
  };

  it("applies every bundled migration on a fresh database and records the schema version", async () => {
    const db = pglite();
    const result = await runMigrations({ db, lock: memoryLock(), migrationsFolder, appVersion: "1.0.0" });
    const bundled = readBundledMigrations(migrationsFolder);
    expect(result.applied).toEqual(bundled.map((m) => m.tag));
    expect(await tracked(db)).toBe(bundled.length);
    expect(await getSystemSetting(db, SYSTEM_KEYS.schemaVersion)).toMatchObject({
      tag: bundled.at(-1)?.tag,
      appVersion: "1.0.0",
    });
    // Second start: nothing pending.
    expect((await runMigrations({ db, lock: memoryLock(), migrationsFolder })).applied).toEqual([]);
  });

  it("a failing migration exits non-zero naming it, with earlier migrations intact and none of it applied", async () => {
    const db = pglite();
    const dir = await folder({
      extra: {
        "0041_ok": ["create table ok_table (id int)"],
        "0042_leave_ledger": ["create table leave_ledger (id int)", "select * from no_such_table"],
      },
    });
    const err = await runMigrations({ db, lock: memoryLock(), migrationsFolder: dir }).catch((e) => e);
    expect(err).toBeInstanceOf(StartupError);
    expect(err.message).toMatch(/^Database migration 0042_leave_ledger failed: .*no_such_table/);
    expect(err.message).toContain("Nothing from 0042_leave_ledger was applied");
    expect(err.message).toContain("Your data is intact");
    expect(await tableExists(db, "ok_table")).toBe(true);
    expect(await tableExists(db, "leave_ledger")).toBe(false);
    expect(await tracked(db)).toBe(readBundledMigrations(dir).length - 1);
  });

  it("names the pre-migration backup when a migration fails", async () => {
    const db = pglite();
    await runMigrations({ db, lock: memoryLock(), migrationsFolder });
    await db.execute(sql`insert into organisations (id, name) values (gen_random_uuid(), 'Acme')`);
    const dir = await folder({ extra: { "0042_leave_ledger": ["select * from nope"] } });
    const err = await runMigrations({
      db,
      lock: memoryLock(),
      migrationsFolder: dir,
      beforeMigrate: async () => "/backups/crowhr-backup-20261031T010000Z-pre-migrate.tar.gz",
    }).catch((e) => e);
    expect(err.message).toContain(
      "A backup taken just before this upgrade is at /backups/crowhr-backup-20261031T010000Z",
    );
  });

  it("refuses a database whose schema is newer than the image", async () => {
    const db = pglite();
    const newer = await folder({ extra: { "0099_future": ["create table future (id int)"] } });
    await runMigrations({ db, lock: memoryLock(), migrationsFolder: newer, appVersion: "1.5.0" });
    const err = await runMigrations({ db, lock: memoryLock(), migrationsFolder, appVersion: "1.3.0" }).catch((e) => e);
    expect(err).toBeInstanceOf(StartupError);
    expect(err.message).toMatch(/^This database was upgraded by Crow HR 1\.5\.0\. Run 1\.5\.0 or newer/);
    expect(await getSystemSetting(db, SYSTEM_KEYS.schemaVersion)).toMatchObject({ appVersion: "1.5.0" });
  });

  it("the lock serialises two runners: one applies, the other waits and finds nothing pending", async () => {
    const db = pglite();
    const lock = memoryLock();
    const logger = createMemoryLogger();
    const [a, b] = await Promise.all([
      runMigrations({ db, lock, migrationsFolder, logger }),
      runMigrations({ db, lock, migrationsFolder, logger }),
    ]);
    expect(lock.maxHolders).toBe(1);
    expect([a.applied.length, b.applied.length].sort()).toEqual([0, readBundledMigrations(migrationsFolder).length]);
    expect(logger.entries.some((e) => e.message.startsWith("Waiting for another Crow HR instance"))).toBe(true);
  });

  it("gives up with a clear message when the lock is held too long", async () => {
    const db = pglite();
    const lock = memoryLock();
    const release = await lock.acquire("x", { timeoutMs: 1000 });
    const err = await runMigrations({ db, lock, migrationsFolder, lockTimeoutMs: 50 }).catch((e) => e);
    expect(err).toBeInstanceOf(StartupError);
    expect(err.message).toMatch(/Another Crow HR instance has held the migration lock/);
    await release?.();
  });

  it("does not rewrite the schema version when nothing changed", async () => {
    const db = pglite();
    await runMigrations({ db, lock: memoryLock(), migrationsFolder, appVersion: "1.0.0" });
    await setSystemSetting(
      db,
      SYSTEM_KEYS.schemaVersion,
      { tag: readBundledMigrations(migrationsFolder).at(-1)?.tag, appVersion: "1.0.0", migratedAt: "x" },
      new Date(),
    );
    await runMigrations({ db, lock: memoryLock(), migrationsFolder, appVersion: "1.0.0" });
    expect(await getSystemSetting(db, SYSTEM_KEYS.schemaVersion)).toMatchObject({ migratedAt: "x" });
  });
});

/**
 * The real advisory lock needs two Postgres sessions, which PGlite cannot provide. Runs when
 * CROWHR_TEST_POSTGRES_URL points at a disposable database (the self-host smoke test sets it).
 */
describe.skipIf(!process.env.CROWHR_TEST_POSTGRES_URL)("migrations on start (real Postgres advisory lock)", () => {
  it("two app instances starting together apply each migration exactly once", async () => {
    const url = process.env.CROWHR_TEST_POSTGRES_URL as string;
    const admin = new pg.Pool({ connectionString: url, max: 1 });
    await admin.query("drop schema if exists drizzle cascade; drop schema public cascade; create schema public;");
    const pools = [new pg.Pool({ connectionString: url, max: 3 }), new pg.Pool({ connectionString: url, max: 3 })];
    try {
      const logger = createMemoryLogger();
      const runs = pools.map((pool) =>
        runMigrations({
          db: drizzle({ client: pool }) as unknown as Db,
          lock: createPgAdvisoryLock(pool),
          migrationsFolder,
          logger,
        }),
      );
      const results = await Promise.all(runs);
      const total = readBundledMigrations(migrationsFolder).length;
      expect(results.map((r) => r.applied.length).sort()).toEqual([0, total]);
      const count = await admin.query("select count(*)::int as n from drizzle.__drizzle_migrations");
      expect(count.rows[0].n).toBe(total);
    } finally {
      await Promise.all(pools.map((p) => p.end()));
      await admin.query("drop schema if exists drizzle cascade; drop schema public cascade; create schema public;");
      await admin.end();
    }
  });
});
