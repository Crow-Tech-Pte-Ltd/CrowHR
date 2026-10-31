import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createMemoryLogger, schema } from "@crowhr/core";
import { createTestDb, type TestDb } from "@crowhr/core/testing";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { StartupError } from "../startup-error.ts";
import { KEY_MISMATCH_MESSAGE, keyMatchesDatabase, resolveSecretKey } from "./key.ts";

describe("encryption key lifecycle", () => {
  let dir: string;
  let keyFile: string;
  let testDb: TestDb;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "crowhr-secrets-"));
    keyFile = join(dir, "data", "secrets", "crowhr.key");
    testDb = await createTestDb();
  });
  afterEach(async () => {
    await testDb.close();
    await rm(dir, { recursive: true, force: true });
  });

  const resolve = (envKey: Uint8Array | null = null, logger = createMemoryLogger()) =>
    resolveSecretKey({ envKey, keyFile, db: testDb.db, logger });

  it("generates a 32-byte key with mode 0600 on first boot, logs it clearly, and stores the key check", async () => {
    const logger = createMemoryLogger();
    const key = await resolve(null, logger);
    expect(key.source).toBe("generated");
    expect(key.bytes).toHaveLength(32);
    expect((await stat(keyFile)).mode & 0o777).toBe(0o600);
    expect((await stat(join(dir, "data", "secrets"))).mode & 0o777).toBe(0o700);
    expect(Buffer.from((await readFile(keyFile, "utf8")).trim(), "base64")).toEqual(Buffer.from(key.bytes));
    expect(logger.entries.find((e) => e.message.startsWith("Generated a new encryption key"))?.message).toContain(
      keyFile,
    );
    expect(key.firstBoot).toBe(true);
    expect(await testDb.db.select().from(schema.secretKeyChecks)).toHaveLength(1);
    expect(await keyMatchesDatabase(testDb.db, key.bytes)).toBe(true);
    expect(await keyMatchesDatabase(testDb.db, new Uint8Array(32))).toBe(false);
  });

  it("is idempotent: the second boot reuses the file", async () => {
    const first = await resolve();
    const second = await resolve();
    expect(second.source).toBe("file");
    expect(second.bytes).toEqual(first.bytes);
  });

  it("CROWHR_SECRET_KEY from the environment wins over the file", async () => {
    const env = new Uint8Array(32).fill(9);
    const key = await resolve(env);
    expect(key).toMatchObject({ source: "env", file: null });
    await expect(stat(keyFile)).rejects.toThrow();
  });

  it("exits with the restore hint when the key does not match the database", async () => {
    await resolve(new Uint8Array(32).fill(1));
    const err = await resolve(new Uint8Array(32).fill(2)).catch((e) => e);
    expect(err).toBeInstanceOf(StartupError);
    expect(err.message).toContain(KEY_MISMATCH_MESSAGE);
    expect(err.message).toContain("crowhr restore --secrets-only <file>");
  });

  it("refuses to generate a new key when the key file is gone but the database has a key check", async () => {
    await resolve();
    await rm(join(dir, "data"), { recursive: true }); // app data volume wiped, Postgres kept
    const err = await resolve().catch((e) => e);
    expect(err).toBeInstanceOf(StartupError);
    expect(err.message).toMatch(/^CROWHR_SECRET_KEY does not match this database\. Restore the key from your backup/);
    expect(err.message).toContain("will not generate a new key over existing data");
    await expect(stat(keyFile)).rejects.toThrow();
  });

  it("tightens a world-readable key file and rejects a damaged one", async () => {
    const first = await resolve();
    await writeFile(keyFile, `${Buffer.from(first.bytes).toString("base64")}\n`, { mode: 0o644 });
    await import("node:fs/promises").then((fs) => fs.chmod(keyFile, 0o644));
    await resolve();
    expect((await stat(keyFile)).mode & 0o777).toBe(0o600);
    await writeFile(keyFile, "garbage");
    await expect(resolve()).rejects.toThrow(/is damaged/);
  });
});
