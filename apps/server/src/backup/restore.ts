import { chmod, mkdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { type Db, type Logger, noopLogger, VERSION } from "@crowhr/core";
import { decodeSecretKey } from "../config.ts";
import { databaseHasData } from "../migrate/runner.ts";
import { keyMatchesDatabase } from "../secrets/key.ts";
import { ArchiveError, extractArchive, type Manifest, readKeyFromStaging, verifyChecksums } from "./archive.ts";
import { clearMaintenance, setMaintenance } from "./maintenance.ts";
import type { DbDumper } from "./pg-tools.ts";

export class RestoreError extends Error {
  override name = "RestoreError";
}

export interface RestoreOptions {
  archive: string;
  passphrase: string | null;
  db: Db;
  dumper: DbDumper;
  /** Where restore staging goes (the backups volume). */
  backupDir: string;
  dataDir: string;
  filesDir: string;
  keyFile: string;
  /** CROWHR_SECRET_KEY from the environment, which overrides any key file. */
  envKey: Uint8Array | null;
  /** Migration tags this image knows, oldest first. */
  bundledTags: readonly string[];
  /** Overwrite a database that already has an organisation. */
  force: boolean;
  /** Restore only secrets/crowhr.key (the "wiped app volume" recovery). */
  secretsOnly: boolean;
  /** Runs pending migrations after the database is restored. */
  migrate: () => Promise<unknown>;
  appVersion?: string;
  logger?: Logger;
  now?: () => Date;
}

export interface RestoreResult {
  manifest: Manifest;
  restored: { database: boolean; files: number; key: boolean };
  warnings: string[];
}

/**
 * `crowhr restore <file>` (spec "Backup and restore"):
 * verify checksums → refuse newer schemas → refuse a non-empty database without --force →
 * maintenance on → database (one transaction) → files (atomic rename) → key → migrations.
 * Nothing is changed until the archive has been fully extracted and verified.
 */
export async function restoreBackup(options: RestoreOptions): Promise<RestoreResult> {
  const logger = options.logger ?? noopLogger;
  const appVersion = options.appVersion ?? VERSION;
  const stamp = (options.now?.() ?? new Date()).toISOString().replace(/[-:.]/g, "");
  const stagingDir = join(options.backupDir, `.restore-${stamp}`);
  // Same volume as the files directory, so the final swap is an atomic rename.
  const filesStaging = join(dirname(options.filesDir), `.${basename(options.filesDir)}.restore-${stamp}`);
  const warnings: string[] = [];

  try {
    await stat(options.archive).catch(() => {
      throw new RestoreError(
        `Cannot find ${options.archive}. Backups live in the backups volume (/backups in the container). List them with: docker compose exec app ls /backups`,
      );
    });
    const extracted = await extractArchive(options.archive, {
      passphrase: options.passphrase,
      stagingDir,
      filesStagingDir: filesStaging,
    });
    verifyChecksums(extracted);
    const { manifest } = extracted;

    if (manifest.schema.tag && !options.bundledTags.includes(manifest.schema.tag)) {
      throw new RestoreError(
        `This backup was made by Crow HR ${manifest.appVersion}, whose database schema (${manifest.schema.tag}) is newer than this image (${appVersion}). Upgrade to ${manifest.appVersion} or newer, then restore.`,
      );
    }

    const keyText = await readKeyFromStaging(stagingDir);
    const key = keyText ? decodeSecretKey(keyText) : null;
    if (keyText && !key) throw new RestoreError("The key inside the backup is damaged. Nothing was changed.");

    if (options.secretsOnly) {
      if (!key)
        throw new RestoreError(
          "This backup was made without the encryption key, so --secrets-only has nothing to restore.",
        );
      if ((await keyMatchesDatabase(options.db, key).catch(() => null)) === false) {
        throw new RestoreError(
          "The key in this backup does not match this database either. Use a backup from this install, or restore the whole backup (without --secrets-only).",
        );
      }
      await writeKey(options.keyFile, key);
      if (options.envKey) warnings.push(envKeyWarning());
      return { manifest, restored: { database: false, files: 0, key: true }, warnings };
    }

    if (!options.force && (await databaseHasData(options.db))) {
      throw new RestoreError(
        "This database already has data. Restoring replaces ALL of it (people, payroll, files) with the backup. To confirm, run the same command with --force.",
      );
    }

    await setMaintenance(options.dataDir, "restoring");
    logger.info("Restoring database", { archive: options.archive });
    try {
      await options.dumper.restore(join(stagingDir, "db.dump"));
    } catch (err) {
      await clearMaintenance(options.dataDir);
      throw new RestoreError(`Restoring the database failed; it was left exactly as it was. ${(err as Error).message}`);
    }

    // Swap the files directory atomically; keep the old one until the swap succeeded.
    const previous = join(dirname(options.filesDir), `.${basename(options.filesDir)}.before-restore-${stamp}`);
    const hadFiles = await stat(options.filesDir).then(
      () => true,
      () => false,
    );
    if (hadFiles) await rename(options.filesDir, previous);
    await rename(filesStaging, options.filesDir);
    if (hadFiles) await rm(previous, { recursive: true, force: true });

    if (key) {
      await writeKey(options.keyFile, key);
      if (options.envKey && Buffer.compare(Buffer.from(options.envKey), Buffer.from(key)) !== 0) {
        warnings.push(envKeyWarning());
      }
    } else {
      warnings.push(
        "This backup does not include the encryption key. Encrypted fields (NRIC, bank, SSO secrets) only work if the current key is the one the backup was made with.",
      );
    }

    await options.migrate();
    await setMaintenance(options.dataDir, "restored");
    return { manifest, restored: { database: true, files: manifest.files.length, key: Boolean(key) }, warnings };
  } catch (err) {
    if (err instanceof ArchiveError) throw new RestoreError(err.message);
    throw err;
  } finally {
    await rm(stagingDir, { recursive: true, force: true });
    await rm(filesStaging, { recursive: true, force: true });
  }
}

async function writeKey(path: string, key: Uint8Array) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const tmp = `${path}.restore`;
  await writeFile(tmp, `${Buffer.from(key).toString("base64")}\n`, { mode: 0o600 });
  await chmod(tmp, 0o600);
  await rename(tmp, path);
}

function envKeyWarning() {
  return "CROWHR_SECRET_KEY is set in .env and overrides the restored key file. Remove it from .env (the restored file in the data volume is then used), or set it to the key from this backup.";
}
