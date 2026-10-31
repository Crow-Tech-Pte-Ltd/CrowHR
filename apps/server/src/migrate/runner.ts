import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  type Db,
  getSystemSetting,
  type Logger,
  noopLogger,
  type SchemaVersion,
  SYSTEM_KEYS,
  setSystemSetting,
  VERSION,
} from "@crowhr/core";
import { sql } from "drizzle-orm";
import { describeDbError } from "../db/wait.ts";
import { StartupError } from "../startup-error.ts";

/**
 * Migrations on start (self-hosting spec "Migrations on start"). Compatible with drizzle-kit's
 * tracking table (`drizzle.__drizzle_migrations`: hash + journal `when`), but unlike Drizzle's
 * own migrator each migration runs in its own transaction, so a failure in 0042 leaves
 * 0001–0041 applied and nothing of 0042. The whole run holds a Postgres advisory lock.
 */

export interface AdvisoryLock {
  /** Resolves to a release function, or null when `timeoutMs` passed without the lock. */
  acquire(
    name: string,
    options: { timeoutMs: number; onWait?: (waitedSeconds: number) => void },
  ): Promise<(() => Promise<void>) | null>;
}

export interface MigrationFile {
  tag: string;
  /** Journal `when` (ms); drizzle stores it as `created_at`. */
  when: number;
  hash: string;
  statements: string[];
}

export const MIGRATION_LOCK = "crowhr:migrate";

export function readBundledMigrations(folder: string): MigrationFile[] {
  const journal = JSON.parse(readFileSync(join(folder, "meta", "_journal.json"), "utf8")) as {
    entries: { tag: string; when: number }[];
  };
  return journal.entries
    .map((entry) => {
      const query = readFileSync(join(folder, `${entry.tag}.sql`), "utf8");
      return {
        tag: entry.tag,
        when: entry.when,
        hash: createHash("sha256").update(query).digest("hex"),
        statements: query.split("--> statement-breakpoint").filter((s) => s.trim()),
      };
    })
    .sort((a, b) => a.when - b.when);
}

interface AppliedRow {
  hash: string;
  created_at: string | number;
}

function rowsOf<T>(result: unknown): T[] {
  return ((result as { rows?: T[] }).rows ?? (result as T[])) as T[];
}

async function ensureTrackingTable(db: Db) {
  await db.execute(sql`create schema if not exists drizzle`);
  await db.execute(
    sql`create table if not exists drizzle.__drizzle_migrations (id serial primary key, hash text not null, created_at bigint)`,
  );
}

export interface MigrationPlan {
  pending: MigrationFile[];
  /** Applied in the database but unknown to this image: the database is newer. */
  unknown: AppliedRow[];
  appliedCount: number;
}

export async function planMigrations(db: Db, bundled: readonly MigrationFile[]): Promise<MigrationPlan> {
  await ensureTrackingTable(db);
  const applied = rowsOf<AppliedRow>(
    await db.execute(sql`select hash, created_at from drizzle.__drizzle_migrations order by created_at`),
  );
  const known = new Set(bundled.map((m) => m.when));
  const unknown = applied.filter((r) => !known.has(Number(r.created_at)));
  const last = applied.reduce((max, r) => Math.max(max, Number(r.created_at)), 0);
  return {
    pending: bundled.filter((m) => m.when > last),
    unknown,
    appliedCount: applied.length,
  };
}

/** Tag of the newest bundled migration the database has applied (null on an empty database). */
export async function currentSchemaTag(db: Db, bundled: readonly MigrationFile[]): Promise<string | null> {
  const reg = rowsOf<{ t: string | null }>(
    await db.execute(sql`select to_regclass('drizzle.__drizzle_migrations')::text as t`),
  );
  if (!reg[0]?.t) return null;
  const rows = rowsOf<{ last: string | number | null }>(
    await db.execute(sql`select max(created_at) as last from drizzle.__drizzle_migrations`),
  );
  const last = Number(rows[0]?.last ?? 0);
  return [...bundled].reverse().find((m) => m.when <= last)?.tag ?? null;
}

/** True when the database already holds an organisation (so a pre-migration backup is worth it). */
export async function databaseHasData(db: Db): Promise<boolean> {
  const reg = rowsOf<{ t: string | null }>(
    await db.execute(sql`select to_regclass('public.organisations')::text as t`),
  );
  if (!reg[0]?.t) return false;
  const rows = rowsOf<{ one: number }>(await db.execute(sql`select 1 as one from organisations limit 1`));
  return rows.length > 0;
}

export interface RunMigrationsOptions {
  db: Db;
  lock: AdvisoryLock;
  migrationsFolder: string;
  logger?: Logger;
  appVersion?: string;
  lockTimeoutMs?: number;
  /** Called inside the lock when migrations are pending and the database has data. Returns the backup path. */
  beforeMigrate?: (pending: readonly MigrationFile[]) => Promise<string | null>;
  now?: () => Date;
  /** Development hint for the "database is newer" message. */
  driver?: "postgres" | "pglite";
}

export interface MigrationResult {
  applied: string[];
  latestTag: string | null;
  backupPath: string | null;
}

export async function runMigrations(options: RunMigrationsOptions): Promise<MigrationResult> {
  const { db, lock } = options;
  const logger = options.logger ?? noopLogger;
  const appVersion = options.appVersion ?? VERSION;
  const now = options.now ?? (() => new Date());
  const lockTimeoutMs = options.lockTimeoutMs ?? 300_000;
  const bundled = readBundledMigrations(options.migrationsFolder);
  const latestTag = bundled.at(-1)?.tag ?? null;

  const release = await lock.acquire(MIGRATION_LOCK, {
    timeoutMs: lockTimeoutMs,
    onWait: (s) => logger.info("Waiting for another Crow HR instance to finish migrations", { waitedSeconds: s }),
  });
  if (!release) {
    throw new StartupError(
      [
        `Another Crow HR instance has held the migration lock for over ${Math.round(lockTimeoutMs / 1000)} s.`,
        "Only one app container should run against a database. Check with: docker compose ps",
        "If a previous container is stuck, stop it (docker compose down, then docker compose up -d).",
      ].join("\n"),
    );
  }
  try {
    const plan = await planMigrations(db, bundled);
    if (plan.unknown.length) {
      const stored = await getSystemSetting<SchemaVersion>(db, SYSTEM_KEYS.schemaVersion).catch(() => null);
      const newer = stored?.appVersion && stored.appVersion !== appVersion ? stored.appVersion : null;
      throw new StartupError(
        [
          newer
            ? `This database was upgraded by Crow HR ${newer}. Run ${newer} or newer`
            : "This database was upgraded by a newer Crow HR version. Run that version or newer",
          `(this image is ${appVersion}; the database has ${plan.unknown.length} migration(s) this image does not know). Downgrades are not supported: set the image tag back in docker-compose.yml and run docker compose up -d, or restore a backup taken before the upgrade.`,
          ...(options.driver === "pglite"
            ? ["Development: migrations were regenerated. Delete the PGlite directory (./data/pglite) to start fresh."]
            : []),
        ].join("\n"),
      );
    }
    if (plan.pending.length === 0) {
      await recordSchemaVersion(db, latestTag, appVersion, now, false);
      return { applied: [], latestTag, backupPath: null };
    }

    let backupPath: string | null = null;
    if (options.beforeMigrate && (await databaseHasData(db))) {
      backupPath = await options.beforeMigrate(plan.pending);
    }

    logger.info("Applying database migrations", { pending: plan.pending.map((m) => m.tag) });
    const applied: string[] = [];
    for (const migration of plan.pending) {
      try {
        await db.transaction(async (tx) => {
          for (const statement of migration.statements) await tx.execute(sql.raw(statement));
          await tx.execute(
            sql`insert into drizzle.__drizzle_migrations ("hash", "created_at") values (${migration.hash}, ${migration.when})`,
          );
        });
      } catch (err) {
        throw new StartupError(
          [
            `Database migration ${migration.tag} failed: ${describeDbError(unwrapCause(err))}`,
            `Nothing from ${migration.tag} was applied${applied.length ? `; ${applied.join(", ")} were applied before it and remain` : ""}. Your data is intact.`,
            backupPath
              ? `A backup taken just before this upgrade is at ${backupPath}.`
              : "No pre-migration backup was taken (empty database or BACKUP_BEFORE_MIGRATE=false).",
            "Go back to the previous image version (docker-compose.yml image tag, then docker compose up -d) and report this error with the log above.",
          ].join("\n"),
        );
      }
      applied.push(migration.tag);
      logger.info("Applied migration", { tag: migration.tag });
    }
    await recordSchemaVersion(db, latestTag, appVersion, now, true);
    return { applied, latestTag, backupPath };
  } finally {
    await release();
  }
}

async function recordSchemaVersion(db: Db, tag: string | null, appVersion: string, now: () => Date, force: boolean) {
  if (!tag) return;
  const reg = rowsOf<{ t: string | null }>(
    await db.execute(sql`select to_regclass('public.system_settings')::text as t`),
  );
  if (!reg[0]?.t) return;
  const current = await getSystemSetting<SchemaVersion>(db, SYSTEM_KEYS.schemaVersion);
  if (!force && current?.tag === tag && current.appVersion === appVersion) return;
  const value: SchemaVersion = { tag, appVersion, migratedAt: now().toISOString() };
  await setSystemSetting(db, SYSTEM_KEYS.schemaVersion, value, now());
}

function unwrapCause(err: unknown): unknown {
  let e = err;
  // Drizzle wraps driver errors as `Failed query: …` with the original in `cause`.
  while (e instanceof Error && e.cause instanceof Error) e = e.cause;
  return e;
}
