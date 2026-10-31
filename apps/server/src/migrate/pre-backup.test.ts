import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createMemoryLogger, type Db, schema } from "@crowhr/core";
import { migrationsFolder } from "@crowhr/core/migrations-folder";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fakeDumper } from "../backup/test-helpers.ts";
import { StartupError } from "../startup-error.ts";
import { runMigrations } from "./runner.ts";
import { migrateOnStart } from "./start.ts";
import { freshPglite, makeMigrationsFolder, memoryLock } from "./test-helpers.ts";

describe("pre-migration backup", () => {
  let dir: string;
  let close: () => Promise<void>;
  let db: Db;
  let upgraded: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "crowhr-premigrate-"));
    const p = freshPglite();
    db = p.db as Db;
    close = p.close;
    upgraded = await makeMigrationsFolder({ extra: { "0050_next_release": ["create table next_release (id int)"] } });
  });
  afterEach(async () => {
    await close();
    await rm(dir, { recursive: true, force: true });
    await rm(upgraded, { recursive: true, force: true });
  });

  const config = (overrides: Record<string, unknown> = {}) => ({
    BACKUP_BEFORE_MIGRATE: true,
    BACKUP_DIR: join(dir, "backups"),
    FILE_STORAGE_DIR: join(dir, "files"),
    BACKUP_PASSPHRASE: null,
    CROWHR_SECRET_KEY: new Uint8Array(32).fill(5),
    SECRET_KEY_FILE: join(dir, "key"),
    DATABASE_URL: "pglite:memory",
    MIGRATE_LOCK_TIMEOUT_SECONDS: 5,
    ...overrides,
  });
  const start = (overrides: Record<string, unknown> = {}, folder = upgraded) => {
    const dumper = fakeDumper(db);
    return {
      dumper,
      run: () =>
        migrateOnStart({
          config: config(overrides) as never,
          database: { db, lock: memoryLock(), driver: "postgres" },
          logger: createMemoryLogger(),
          migrationsFolder: folder,
          dumper,
        }),
    };
  };
  const backups = async () => readdir(join(dir, "backups")).catch(() => [] as string[]);

  it("backs up only when migrations are pending and an organisation exists", async () => {
    // Fresh install: pending migrations but no data → no backup.
    const first = start({}, migrationsFolder);
    await first.run();
    expect(first.dumper.dumps).toBe(0);
    // Nothing pending → no backup.
    await db.insert(schema.organisations).values({ id: "0190f000-0000-7000-8000-0000000000b1", name: "Acme" });
    const idle = start({}, migrationsFolder);
    await idle.run();
    expect(idle.dumper.dumps).toBe(0);
    // Upgrade with data → backup first.
    const upgrade = start();
    const result = await upgrade.run();
    expect(upgrade.dumper.dumps).toBe(1);
    expect(result.backupPath).toMatch(/crowhr-backup-\d{8}T\d{6}Z-pre-migrate\.tar\.gz$/);
    expect(await backups()).toHaveLength(1);
    const [run] = await db.select().from(schema.backupRuns);
    expect(run).toMatchObject({ trigger: "pre_migrate", status: "succeeded" });
  });

  it("BACKUP_BEFORE_MIGRATE=false skips it", async () => {
    await runMigrations({ db, lock: memoryLock(), migrationsFolder });
    await db.insert(schema.organisations).values({ id: "0190f000-0000-7000-8000-0000000000b2", name: "Acme" });
    const upgrade = start({ BACKUP_BEFORE_MIGRATE: false });
    const result = await upgrade.run();
    expect(result.applied).toEqual(["0050_next_release"]);
    expect(upgrade.dumper.dumps).toBe(0);
    expect(await backups()).toEqual([]);
  });

  it("prints the backup path when the migration then fails", async () => {
    await runMigrations({ db, lock: memoryLock(), migrationsFolder });
    await db.insert(schema.organisations).values({ id: "0190f000-0000-7000-8000-0000000000b3", name: "Acme" });
    const broken = await makeMigrationsFolder({ extra: { "0051_broken": ["select * from missing_table"] } });
    try {
      const err = await start({}, broken)
        .run()
        .catch((e) => e);
      expect(err).toBeInstanceOf(StartupError);
      const [name] = await backups();
      expect(err.message).toContain(
        `A backup taken just before this upgrade is at ${join(dir, "backups", name ?? "")}`,
      );
    } finally {
      await rm(broken, { recursive: true, force: true });
    }
  });

  it("stops the upgrade, changing nothing, when the backup itself fails", async () => {
    await runMigrations({ db, lock: memoryLock(), migrationsFolder });
    await db.insert(schema.organisations).values({ id: "0190f000-0000-7000-8000-0000000000b4", name: "Acme" });
    const upgrade = start();
    upgrade.dumper.dump = async () => {
      throw new Error("No space left on device");
    };
    const err = await upgrade.run().catch((e) => e);
    expect(err.message).toMatch(/^Could not take the backup that runs before database migrations: No space left/);
    expect(err.message).toContain("BACKUP_BEFORE_MIGRATE=false");
    const tables = await db.execute(`select to_regclass('public.next_release')::text as t` as never);
    expect((tables as unknown as { rows: { t: string | null }[] }).rows[0]?.t).toBeNull();
  });
});
