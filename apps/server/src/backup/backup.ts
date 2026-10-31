import { mkdir, readdir, rm, stat, unlink } from "node:fs/promises";
import { join } from "node:path";
import { type Db, type Logger, noopLogger, schema, VERSION } from "@crowhr/core";

const { backupRuns } = schema;

import { eq, sql } from "drizzle-orm";
import { ARCHIVE_PATTERN, type Manifest, writeArchive } from "./archive.ts";
import type { DbDumper } from "./pg-tools.ts";

export type BackupTrigger = "manual" | "scheduled" | "pre_migrate";

export interface BackupOptions {
  db: Db;
  dumper: DbDumper;
  backupDir: string;
  filesDir: string;
  /** The encryption key to include (lead decision: included by default). Null = exclude. */
  key: Uint8Array | null;
  passphrase: string | null;
  trigger: BackupTrigger;
  /** Latest applied migration tag, recorded in the manifest for the restore version check. */
  schemaTag: string | null;
  appVersion?: string;
  now?: () => Date;
  newId: () => string;
  logger?: Logger;
}

export interface BackupResult {
  path: string;
  fileName: string;
  sizeBytes: number;
  encrypted: boolean;
  includesKey: boolean;
  manifest: Manifest;
}

/** The warning required by the lead decision when the key is in an unencrypted archive. */
export const UNENCRYPTED_KEY_WARNING = [
  "WARNING: this backup contains your encryption key (CROWHR_SECRET_KEY) and is NOT encrypted.",
  "Anyone who gets this file can read every NRIC/FIN, bank account and SSO secret in it.",
  "Set BACKUP_PASSPHRASE in .env (or pass --passphrase-file) to encrypt backups, and keep copies off this server.",
].join("\n");

export function backupFileName(at: Date, trigger: BackupTrigger, encrypted: boolean): string {
  const stamp = at
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}/, "");
  const label = trigger === "pre_migrate" ? "-pre-migrate" : trigger === "scheduled" ? "-scheduled" : "";
  return `crowhr-backup-${stamp}${label}.tar.gz${encrypted ? ".age" : ""}`;
}

async function tableExists(db: Db, name: string): Promise<boolean> {
  try {
    const r = await db.execute(sql`select to_regclass(${`public.${name}`})::text as t`);
    const rows = ((r as { rows?: { t: string | null }[] }).rows ?? r) as { t: string | null }[];
    return Boolean(rows[0]?.t);
  } catch {
    return false;
  }
}

/**
 * `crowhr backup`, the nightly schedule and the pre-migration backup all go through here.
 * The attempt is recorded in `backup_runs` (skipped when that table does not exist yet,
 * e.g. the pre-migration backup of a very old schema).
 */
export async function runBackup(options: BackupOptions): Promise<BackupResult> {
  const logger = options.logger ?? noopLogger;
  const now = options.now ?? (() => new Date());
  const startedAt = now();
  const encrypted = Boolean(options.passphrase);
  const fileName = backupFileName(startedAt, options.trigger, encrypted);
  const path = join(options.backupDir, fileName);
  const runId = options.newId();
  const record = await tableExists(options.db, "backup_runs");
  if (record) {
    await options.db.insert(backupRuns).values({
      id: runId,
      trigger: options.trigger,
      status: "running",
      startedAt,
      fileName,
      encrypted,
      includesKey: options.key !== null,
    });
  }

  const staging = join(options.backupDir, `.tmp-${runId}`);
  try {
    await mkdir(staging, { recursive: true, mode: 0o700 });
    const dumpFile = join(staging, "db.dump");
    await options.dumper.dump(dumpFile);
    const manifest = await writeArchive({
      outFile: path,
      dumpFile,
      filesDir: options.filesDir,
      key: options.key,
      passphrase: options.passphrase,
      manifest: {
        appVersion: options.appVersion ?? VERSION,
        schema: { tag: options.schemaTag },
        createdAt: startedAt.toISOString(),
        trigger: options.trigger,
      },
    });
    const sizeBytes = (await stat(path)).size;
    if (record) {
      await options.db
        .update(backupRuns)
        .set({ status: "succeeded", finishedAt: now(), sizeBytes })
        .where(eq(backupRuns.id, runId));
    }
    logger.info("Backup written", {
      path,
      sizeBytes,
      encrypted,
      includesKey: options.key !== null,
      trigger: options.trigger,
    });
    if (!encrypted && options.key) logger.warn(UNENCRYPTED_KEY_WARNING);
    return { path, fileName, sizeBytes, encrypted, includesKey: options.key !== null, manifest };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (record) {
      await options.db
        .update(backupRuns)
        .set({ status: "failed", finishedAt: now(), error: message.slice(0, 2000) })
        .where(eq(backupRuns.id, runId))
        .catch(() => undefined);
    }
    logger.error("Backup failed", { error: message, trigger: options.trigger });
    throw err;
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

/** Deletes the oldest archives so that at most `keep` remain. Returns the deleted names. */
export async function applyRetention(backupDir: string, keep: number): Promise<string[]> {
  const names = (await readdir(backupDir).catch(() => [] as string[])).filter((n) => ARCHIVE_PATTERN.test(n)).sort();
  const doomed = names.slice(0, Math.max(0, names.length - keep));
  for (const name of doomed) await unlink(join(backupDir, name)).catch(() => undefined);
  return doomed;
}
