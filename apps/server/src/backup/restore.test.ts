import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { gunzipSync, gzipSync } from "node:zlib";
import { createMemoryLogger, createUuidV7Generator, type Db, schema, systemClock } from "@crowhr/core";
import { migrationsFolder } from "@crowhr/core/migrations-folder";
import { createTestDb, type TestDb } from "@crowhr/core/testing";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import tar from "tar-stream";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createPgAdvisoryLock } from "../db.ts";
import { createDiskFileStore } from "../disk-file-store.ts";
import { readBundledMigrations, runMigrations } from "../migrate/runner.ts";
import { resolveSecretKey } from "../secrets/key.ts";
import { runBackup } from "./backup.ts";
import { maintenanceFile } from "./maintenance.ts";
import { createPgDumper, type DbDumper } from "./pg-tools.ts";
import { RestoreError, restoreBackup } from "./restore.ts";
import { fakeDumper } from "./test-helpers.ts";

const ids = createUuidV7Generator(systemClock);
const bundledTags = readBundledMigrations(migrationsFolder).map((m) => m.tag);
const latestTag = bundledTags.at(-1) ?? null;

/** Rewrites one entry of a .tar.gz archive (to simulate corruption that keeps gzip valid). */
async function tamper(src: string, dst: string, name: string, data: string) {
  const extract = tar.extract();
  const pack = tar.pack();
  const out: Buffer[] = [];
  pack.on("data", (c: Buffer) => out.push(c));
  const packed = new Promise((r) => pack.on("end", r));
  extract.on("entry", (header, stream, next) => {
    const chunks: Buffer[] = [];
    stream.on("data", (c: Buffer) => chunks.push(c));
    stream.on("end", () => {
      const body = header.name === name ? Buffer.from(data) : Buffer.concat(chunks);
      pack.entry({ ...header, size: body.length }, body, next);
    });
  });
  await pipeline(Readable.from([gunzipSync(await readFile(src))]), extract);
  pack.finalize();
  await packed;
  await writeFile(dst, gzipSync(Buffer.concat(out)));
}

describe("crowhr restore", () => {
  let dir: string;
  let source: TestDb;
  let target: TestDb;
  const key = new Uint8Array(32).fill(7);

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "crowhr-restore-"));
    source = await createTestDb();
    target = await createTestDb();
  });
  afterEach(async () => {
    await source.close();
    await target.close();
    await rm(dir, { recursive: true, force: true });
  });

  const paths = (name: string) => ({
    dataDir: join(dir, name),
    filesDir: join(dir, name, "files"),
    keyFile: join(dir, name, "secrets", "crowhr.key"),
  });

  /** A populated "old host": an organisation, the key check, and one uploaded receipt. */
  async function makeBackup(passphrase: string | null = null) {
    const src = paths("old");
    const resolved = await resolveSecretKey({
      envKey: key,
      keyFile: src.keyFile,
      db: source.db,
      logger: createMemoryLogger(),
    });
    await source.db.insert(schema.organisations).values({ id: ids.newId(), name: "Kampong Kopi Pte. Ltd." });
    await createDiskFileStore(src.filesDir).put(
      "receipts/2026/10/r-001.pdf",
      new TextEncoder().encode("%PDF receipt"),
      {
        contentType: "application/pdf",
      },
    );
    return runBackup({
      db: source.db,
      dumper: fakeDumper(source.db),
      backupDir: join(dir, "backups"),
      filesDir: src.filesDir,
      key: resolved.bytes,
      passphrase,
      trigger: "manual",
      schemaTag: latestTag,
      newId: () => ids.newId(),
    });
  }

  const restore = (archive: string, overrides: Partial<Parameters<typeof restoreBackup>[0]> = {}) => {
    const dst = paths("new");
    return restoreBackup({
      archive,
      passphrase: null,
      db: target.db,
      dumper: fakeDumper(target.db),
      backupDir: join(dir, "backups"),
      ...dst,
      envKey: null,
      bundledTags,
      force: false,
      secretsOnly: false,
      migrate: async () => undefined,
      ...overrides,
    });
  };

  it("restores onto a fresh install: data, files, key; encrypted fields and downloads work after", async () => {
    const backup = await makeBackup();
    let migrated = 0;
    const result = await restore(backup.path, { migrate: async () => (migrated += 1) });
    expect(result.restored).toEqual({ database: true, files: 2, key: true });
    expect(migrated).toBe(1);
    const orgs = await target.db.select().from(schema.organisations);
    expect(orgs.map((o) => o.name)).toEqual(["Kampong Kopi Pte. Ltd."]);
    const dst = paths("new");
    const file = await createDiskFileStore(dst.filesDir).get("receipts/2026/10/r-001.pdf");
    expect(new TextDecoder().decode(file?.data)).toBe("%PDF receipt");
    expect((await stat(dst.keyFile)).mode & 0o777).toBe(0o600);
    // The restored key matches the restored database's key check, so the app starts and
    // SecretBox ciphertexts (NRIC, bank) decrypt with the same key.
    const resolved = await resolveSecretKey({
      envKey: null,
      keyFile: dst.keyFile,
      db: target.db,
      logger: createMemoryLogger(),
    });
    expect(resolved).toMatchObject({ source: "file" });
    expect(Buffer.from(resolved.bytes)).toEqual(Buffer.from(key));
    expect(JSON.parse(await readFile(maintenanceFile(dst.dataDir), "utf8"))).toMatchObject({ state: "restored" });
  });

  it("round-trips an encrypted archive and explains a missing or wrong passphrase", async () => {
    const backup = await makeBackup("correct horse battery staple");
    await expect(restore(backup.path)).rejects.toThrow(/This backup is encrypted\. Pass its passphrase/);
    await expect(restore(backup.path, { passphrase: "wrong passphrase!!" })).rejects.toThrow(
      /Cannot decrypt the backup/,
    );
    const result = await restore(backup.path, { passphrase: "correct horse battery staple" });
    expect(result.restored.database).toBe(true);
  });

  it("a corrupt archive aborts before touching the database and names the corrupt part", async () => {
    const backup = await makeBackup();
    const bad = join(dir, "backups", "crowhr-backup-20261031T000000Z.tar.gz");
    await tamper(backup.path, bad, "files/blobs/receipts/2026/10/r-001.pdf", "%PDF tampered");
    const dumper = fakeDumper(target.db);
    let restores = 0;
    dumper.restore = async () => {
      restores += 1;
    };
    const err = await restore(bad, { dumper }).catch((e) => e);
    expect(err).toBeInstanceOf(RestoreError);
    expect(err.message).toBe(
      "The backup is corrupt: files/blobs/receipts/2026/10/r-001.pdf does not match its checksum. Nothing was changed.",
    );
    expect(restores).toBe(0);
    await expect(stat(maintenanceFile(paths("new").dataDir))).rejects.toThrow();
    await expect(stat(paths("new").filesDir)).rejects.toThrow();

    const truncated = join(dir, "truncated.tar.gz");
    await writeFile(truncated, (await readFile(backup.path)).subarray(0, 200));
    await expect(restore(truncated)).rejects.toThrow(/damaged and cannot be read.*Nothing was changed/);
  });

  it("refuses a backup whose schema is newer than the image", async () => {
    const backup = await makeBackup();
    const err = await restore(backup.path, { bundledTags: bundledTags.slice(0, 1) }).catch((e) => e);
    expect(err.message).toMatch(/whose database schema \(.+\) is newer than this image/);
    expect(await target.db.select().from(schema.organisations)).toEqual([]);
  });

  it("will not overwrite a database with data unless --force", async () => {
    const backup = await makeBackup();
    await target.db.insert(schema.organisations).values({ id: ids.newId(), name: "Fresh Co" });
    await expect(restore(backup.path)).rejects.toThrow(/already has data.*--force/);
    expect((await target.db.select().from(schema.organisations)).map((o) => o.name)).toEqual(["Fresh Co"]);
    await restore(backup.path, { force: true });
    expect((await target.db.select().from(schema.organisations)).map((o) => o.name)).toEqual([
      "Kampong Kopi Pte. Ltd.",
    ]);
  });

  it("is in maintenance mode while the database is restored", async () => {
    const backup = await makeBackup();
    const dumper = fakeDumper(target.db);
    const inner = dumper.restore;
    let during: string | null = null;
    dumper.restore = async (f) => {
      during = JSON.parse(await readFile(maintenanceFile(paths("new").dataDir), "utf8")).state;
      await inner(f);
    };
    await restore(backup.path, { dumper });
    expect(during).toBe("restoring");
  });

  it("a failed database restore leaves database, files and maintenance as they were", async () => {
    const backup = await makeBackup();
    const dst = paths("new");
    await createDiskFileStore(dst.filesDir).put("keep.txt", new TextEncoder().encode("keep"), {
      contentType: "text/plain",
    });
    await target.db.insert(schema.organisations).values({ id: ids.newId(), name: "Fresh Co" });
    const err = await restore(backup.path, { force: true, dumper: fakeDumper(target.db, { failRestore: true }) }).catch(
      (e) => e,
    );
    expect(err.message).toMatch(/^Restoring the database failed; it was left exactly as it was/);
    expect((await target.db.select().from(schema.organisations)).map((o) => o.name)).toEqual(["Fresh Co"]);
    expect(await createDiskFileStore(dst.filesDir).get("keep.txt")).not.toBeNull();
    await expect(stat(maintenanceFile(dst.dataDir))).rejects.toThrow();
  });

  it("--secrets-only restores just the key, and only if it matches this database", async () => {
    const backup = await makeBackup();
    const dst = paths("new");
    // The old host's database kept its key check, but its data volume (key file) was wiped.
    const result = await restore(backup.path, { secretsOnly: true, db: source.db });
    expect(result.restored).toEqual({ database: false, files: 0, key: true });
    expect(Buffer.from((await readFile(dst.keyFile, "utf8")).trim(), "base64")).toEqual(Buffer.from(key));
    await resolveSecretKey({
      envKey: new Uint8Array(32).fill(1),
      keyFile: join(dir, "other.key"),
      db: target.db,
      logger: createMemoryLogger(),
    });
    await expect(restore(backup.path, { secretsOnly: true })).rejects.toThrow(/does not match this database either/);
  });
});

/** Real pg_dump/pg_restore/psql. Runs when CROWHR_TEST_POSTGRES_URL points at a disposable database. */
describe.skipIf(!process.env.CROWHR_TEST_POSTGRES_URL)("crowhr backup + restore with real PostgreSQL", () => {
  it("round-trips the database exactly, atomically replacing newer data", async () => {
    const url = process.env.CROWHR_TEST_POSTGRES_URL as string;
    const pool = new pg.Pool({ connectionString: url, max: 3 });
    const db = drizzle({ client: pool, schema }) as unknown as Db;
    const dir = await mkdtemp(join(tmpdir(), "crowhr-pg-restore-"));
    const reset = () =>
      pool.query("drop schema if exists drizzle cascade; drop schema public cascade; create schema public;");
    try {
      await reset();
      const migrate = () => runMigrations({ db, lock: createPgAdvisoryLock(pool), migrationsFolder });
      await migrate();
      await db
        .insert(schema.organisations)
        .values({ id: ids.newId(), name: "Before Backup Pte. Ltd.", uen: "202612345K" });
      const dumper: DbDumper = createPgDumper(url);
      const backup = await runBackup({
        db,
        dumper,
        backupDir: join(dir, "backups"),
        filesDir: join(dir, "files"),
        key: new Uint8Array(32).fill(3),
        passphrase: null,
        trigger: "manual",
        schemaTag: latestTag,
        newId: () => ids.newId(),
      });

      await db.insert(schema.organisations).values({ id: ids.newId(), name: "After Backup Pte. Ltd." });
      await pool.query("create table stray (id int)");
      const result = await restoreBackup({
        archive: backup.path,
        passphrase: null,
        db,
        dumper,
        backupDir: join(dir, "backups"),
        dataDir: join(dir, "data"),
        filesDir: join(dir, "data", "files"),
        keyFile: join(dir, "data", "secrets", "crowhr.key"),
        envKey: null,
        bundledTags,
        force: true,
        secretsOnly: false,
        migrate,
      });
      expect(result.restored.database).toBe(true);
      const orgs = await pool.query("select name, uen from organisations order by name");
      expect(orgs.rows).toEqual([{ name: "Before Backup Pte. Ltd.", uen: "202612345K" }]);
      const stray = await pool.query("select to_regclass('public.stray') as t");
      expect(stray.rows[0].t).toBeNull();
      const runs = await pool.query("select status from backup_runs");
      expect(runs.rows).toEqual([{ status: "running" }]); // the dump was taken while its own run was in progress

      // A dump that fails part-way changes nothing.
      const bad = join(dir, "bad.dump");
      await writeFile(bad, "PGDMP garbage");
      await expect(dumper.restore(bad)).rejects.toThrow();
      expect((await pool.query("select count(*)::int as n from organisations")).rows[0].n).toBe(1);
    } finally {
      await reset();
      await pool.end();
      await rm(dir, { recursive: true, force: true });
    }
  });
});
