import { randomBytes } from "node:crypto";
import { chmod, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { createSecretBox, type Db, type Logger, schema, verifySecretKeyAgainstDb } from "@crowhr/core";
import { decodeSecretKey } from "../config.ts";
import { EX_CONFIG, StartupError } from "../startup-error.ts";

export type KeySource = "env" | "file" | "generated";

export interface SecretKey {
  bytes: Uint8Array;
  source: KeySource;
  /** File the key was read from or written to (null when it came from CROWHR_SECRET_KEY). */
  file: string | null;
  /** True when this start stored the database's key check value for the first time. */
  firstBoot: boolean;
}

export interface ResolveKeyOptions {
  envKey: Uint8Array | null;
  keyFile: string;
  db: Db;
  logger: Logger;
}

export const KEY_MISMATCH_MESSAGE =
  "CROWHR_SECRET_KEY does not match this database. Restore the key from your backup (crowhr restore --secrets-only <file>)";

async function hasKeyCheck(db: Db): Promise<boolean> {
  return (await db.select({ keyId: schema.secretKeyChecks.keyId }).from(schema.secretKeyChecks).limit(1)).length > 0;
}

/**
 * Whether `key` matches the check value the identity module stored (`secret_key_checks`).
 * Null when the database has no check value yet.
 */
export async function keyMatchesDatabase(db: Db, key: Uint8Array): Promise<boolean | null> {
  const rows = await db.select().from(schema.secretKeyChecks);
  if (!rows.length) return null;
  const box = createSecretBox(new Uint8Array(key));
  const [keyId, check] = [await box.keyId(), await box.checkValue()];
  return rows.some((r) => r.keyId === keyId && r.checkValue === check);
}

/**
 * Finds the encryption key (spec "Generated secrets"):
 * 1. CROWHR_SECRET_KEY wins when set.
 * 2. Otherwise the key file in the data volume.
 * 3. Otherwise generate one (0600) — but never when the database already has a key check:
 *    that means the data volume was lost, and a new key would silently orphan encrypted data.
 * Then checks the key against the database through the identity module's
 * `verifySecretKeyAgainstDb` (which stores the check value on first boot).
 */
export async function resolveSecretKey(options: ResolveKeyOptions): Promise<SecretKey> {
  const { envKey, keyFile, db, logger } = options;

  let found: Omit<SecretKey, "firstBoot"> | null = null;
  if (envKey) {
    found = { bytes: envKey, source: "env", file: null };
  } else {
    const existing = await readKeyFile(keyFile, logger);
    if (existing) found = { bytes: existing, source: "file", file: keyFile };
  }

  if (!found) {
    if (await hasKeyCheck(db)) {
      throw new StartupError(
        [
          `${KEY_MISMATCH_MESSAGE}.`,
          `The key file ${keyFile} is missing, but this database was already set up with a key. Crow HR will not generate a new key over existing data.`,
          "Fix: copy a backup archive into the backups volume and run",
          "  docker compose run --rm app crowhr restore --secrets-only /backups/<file>",
          "or set CROWHR_SECRET_KEY in .env to the original key.",
        ].join("\n"),
        EX_CONFIG,
      );
    }
    found = { bytes: await generateKeyFile(keyFile), source: "generated", file: keyFile };
    logger.warn(
      `Generated a new encryption key at ${keyFile} (mode 600). Back it up: without it, encrypted data (NRIC, bank details, SSO secrets) cannot be recovered. Every crowhr backup includes it.`,
      { keyFile },
    );
  }

  const check = await verifySecretKeyAgainstDb(db, createSecretBox(new Uint8Array(found.bytes)));
  if (!check.ok) {
    throw new StartupError(
      [
        `${KEY_MISMATCH_MESSAGE}.`,
        found.source === "env"
          ? "The key comes from CROWHR_SECRET_KEY in .env. Put back the original value, or remove it to use the key file in the data volume."
          : `The key comes from ${found.file}. It was replaced or belongs to another install.`,
      ].join("\n"),
      EX_CONFIG,
    );
  }
  return { ...found, firstBoot: check.firstBoot };
}

async function readKeyFile(path: string, logger: Logger): Promise<Uint8Array | null> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw new StartupError(
      `Cannot read the encryption key file ${path}: ${(err as Error).message}. Check that the data volume is mounted and owned by uid 10001.`,
      EX_CONFIG,
    );
  }
  const bytes = decodeSecretKey(raw);
  if (!bytes) {
    throw new StartupError(
      `The encryption key file ${path} is damaged (it must hold 32 bytes as base64). Restore it with: docker compose run --rm app crowhr restore --secrets-only /backups/<file>`,
      EX_CONFIG,
    );
  }
  const mode = (await stat(path)).mode & 0o777;
  if (mode & 0o077) {
    await chmod(path, 0o600).catch(() => undefined);
    logger.warn(`Tightened permissions on ${path} to 600 (was ${mode.toString(8)}).`);
  }
  return bytes;
}

/** Writes a new random key with mode 0600. If another process wins the race, uses its key. */
async function generateKeyFile(path: string): Promise<Uint8Array> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const bytes = new Uint8Array(randomBytes(32));
  try {
    await writeFile(path, `${Buffer.from(bytes).toString("base64")}\n`, { mode: 0o600, flag: "wx" });
    await chmod(path, 0o600);
    return bytes;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
    const raced = decodeSecretKey(await readFile(path, "utf8"));
    if (!raced) throw new StartupError(`The encryption key file ${path} is damaged.`, EX_CONFIG);
    return raced;
  }
}
