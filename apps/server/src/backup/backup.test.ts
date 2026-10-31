import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import { createGunzip } from "node:zlib";
import { createMemoryLogger, createUuidV7Generator, schema, systemClock } from "@crowhr/core";

const { backupRuns } = schema;

import { createTestDb, type TestDb } from "@crowhr/core/testing";
import tar from "tar-stream";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isEncryptedArchive } from "./archive.ts";
import { applyRetention, backupFileName, runBackup, UNENCRYPTED_KEY_WARNING } from "./backup.ts";
import { fakeDumper } from "./test-helpers.ts";

async function listArchive(path: string): Promise<Map<string, Buffer>> {
  const out = new Map<string, Buffer>();
  const extract = tar.extract();
  extract.on("entry", (header, stream, next) => {
    const chunks: Buffer[] = [];
    stream.on("data", (c: Buffer) => chunks.push(c));
    stream.on("end", () => {
      out.set(header.name, Buffer.concat(chunks));
      next();
    });
  });
  await pipeline(createReadStream(path), createGunzip(), extract);
  return out;
}

describe("crowhr backup", () => {
  let dir: string;
  let testDb: TestDb;
  const ids = createUuidV7Generator(systemClock);
  const key = new Uint8Array(32).fill(42);

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "crowhr-backup-"));
    await mkdir(join(dir, "files", "blobs", "receipts"), { recursive: true });
    await writeFile(join(dir, "files", "blobs", "receipts", "r1.pdf"), "%PDF-1.7 receipt");
    await writeFile(join(dir, "files", "blobs", "photo.jpg"), Buffer.alloc(70_000, 1));
    testDb = await createTestDb();
  });
  afterEach(async () => {
    await testDb.close();
    await rm(dir, { recursive: true, force: true });
  });

  const backup = (overrides: Partial<Parameters<typeof runBackup>[0]> = {}) =>
    runBackup({
      db: testDb.db,
      dumper: fakeDumper(testDb.db),
      backupDir: join(dir, "backups"),
      filesDir: join(dir, "files"),
      key,
      passphrase: null,
      trigger: "manual",
      schemaTag: "0001_self_hosting",
      appVersion: "1.2.3",
      newId: () => ids.newId(),
      now: () => new Date("2026-10-31T02:00:00.123Z"),
      ...overrides,
    });

  it("archive contains manifest, dump, files and key, with checksums", async () => {
    const result = await backup();
    expect(result.fileName).toBe("crowhr-backup-20261031T020000Z.tar.gz");
    expect((await stat(result.path)).mode & 0o777).toBe(0o600);
    const entries = await listArchive(result.path);
    expect([...entries.keys()]).toEqual([
      "manifest.json",
      "db.dump",
      "secrets/crowhr.key",
      "files/blobs/photo.jpg",
      "files/blobs/receipts/r1.pdf",
    ]);
    const manifest = JSON.parse((entries.get("manifest.json") as Buffer).toString());
    expect(manifest).toMatchObject({
      format: "crowhr-backup",
      formatVersion: 1,
      appVersion: "1.2.3",
      schema: { tag: "0001_self_hosting" },
      createdAt: "2026-10-31T02:00:00.123Z",
      includesKey: true,
    });
    const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");
    for (const part of [manifest.database, manifest.secrets, ...manifest.files]) {
      expect(sha(entries.get(part.path) as Buffer)).toBe(part.sha256);
    }
    expect(Buffer.from((entries.get("secrets/crowhr.key") as Buffer).toString().trim(), "base64")).toEqual(
      Buffer.from(key),
    );
    // No staging leftovers.
    expect(await readdir(join(dir, "backups"))).toEqual([result.fileName]);
  });

  it("records the run and warns loudly when the key is included unencrypted", async () => {
    const logger = createMemoryLogger();
    const result = await backup({ logger });
    const [run] = await testDb.db.select().from(backupRuns);
    expect(run).toMatchObject({
      status: "succeeded",
      trigger: "manual",
      fileName: result.fileName,
      sizeBytes: result.sizeBytes,
      encrypted: false,
      includesKey: true,
    });
    expect(logger.entries.find((e) => e.level === "warn")?.message).toBe(UNENCRYPTED_KEY_WARNING);
    expect(UNENCRYPTED_KEY_WARNING).toMatch(/contains your encryption key.*NOT encrypted/);
  });

  it("encrypts the whole archive with a passphrase (age) and does not warn", async () => {
    const logger = createMemoryLogger();
    const result = await backup({ passphrase: "correct horse battery staple", logger });
    expect(result.fileName).toMatch(/\.tar\.gz\.age$/);
    expect(await isEncryptedArchive(result.path)).toBe(true);
    const raw = await readFile(result.path);
    expect(raw.includes(Buffer.from("%PDF-1.7 receipt"))).toBe(false);
    expect(logger.entries.filter((e) => e.level === "warn")).toEqual([]);
  });

  it("can leave the key out", async () => {
    const result = await backup({ key: null });
    const entries = await listArchive(result.path);
    expect(entries.has("secrets/crowhr.key")).toBe(false);
    expect(result.manifest.secrets).toBeNull();
  });

  it("records a failure and leaves no partial archive behind", async () => {
    const dumper = fakeDumper(testDb.db);
    dumper.dump = async () => {
      throw new Error("pg_dump failed: connection refused");
    };
    await expect(backup({ dumper })).rejects.toThrow(/connection refused/);
    const [run] = await testDb.db.select().from(backupRuns);
    expect(run).toMatchObject({ status: "failed", error: "pg_dump failed: connection refused" });
    expect(await readdir(join(dir, "backups"))).toEqual([]);
  });

  it("names scheduled and pre-migration archives so retention sorts them by time", () => {
    const at = new Date("2026-10-31T18:00:00Z");
    expect(backupFileName(at, "scheduled", true)).toBe("crowhr-backup-20261031T180000Z-scheduled.tar.gz.age");
    expect(backupFileName(at, "pre_migrate", false)).toBe("crowhr-backup-20261031T180000Z-pre-migrate.tar.gz");
  });

  it("retention keeps the newest N archives and ignores other files", async () => {
    const backups = join(dir, "retention");
    await mkdir(backups);
    const names = Array.from({ length: 5 }, (_, i) => `crowhr-backup-2026102${i}T020000Z-scheduled.tar.gz`);
    for (const n of [...names, "notes.txt", "crowhr-backup-20261019T020000Z.tar.gz.partial"]) {
      await writeFile(join(backups, n), "x");
    }
    expect(await applyRetention(backups, 3)).toEqual(names.slice(0, 2));
    expect((await readdir(backups)).sort()).toEqual(
      [...names.slice(2), "crowhr-backup-20261019T020000Z.tar.gz.partial", "notes.txt"].sort(),
    );
  });
});
