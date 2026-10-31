import { createUuidV7Generator, type Logger, systemClock } from "@crowhr/core";
import { migrationsFolder as bundledFolder } from "@crowhr/core/migrations-folder";
import { runBackup } from "../backup/backup.ts";
import { createPgDumper, type DbDumper } from "../backup/pg-tools.ts";
import type { ServerConfig } from "../config.ts";
import type { Database } from "../db.ts";
import { readExistingKey } from "../secrets/existing.ts";
import { StartupError } from "../startup-error.ts";
import { currentSchemaTag, type MigrationResult, readBundledMigrations, runMigrations } from "./runner.ts";

export interface MigrateOnStartOptions {
  config: Pick<
    ServerConfig,
    | "BACKUP_BEFORE_MIGRATE"
    | "BACKUP_DIR"
    | "FILE_STORAGE_DIR"
    | "BACKUP_PASSPHRASE"
    | "CROWHR_SECRET_KEY"
    | "SECRET_KEY_FILE"
    | "DATABASE_URL"
    | "MIGRATE_LOCK_TIMEOUT_SECONDS"
  >;
  database: Pick<Database, "db" | "lock" | "driver">;
  logger: Logger;
  migrationsFolder?: string;
  /** Defaults to pg_dump for Postgres. PGlite (development) gets no pre-migration backup. */
  dumper?: DbDumper | null;
  appVersion?: string;
}

/**
 * Startup migrations with the pre-migration backup (spec "Migrations on start"): when
 * migrations are pending and the database already has an organisation, a backup is written
 * to the backups volume first, unless BACKUP_BEFORE_MIGRATE=false. A failed backup stops the
 * upgrade before anything changes.
 */
export async function migrateOnStart(options: MigrateOnStartOptions): Promise<MigrationResult> {
  const { config, database, logger } = options;
  const folder = options.migrationsFolder ?? bundledFolder;
  const dumper =
    options.dumper !== undefined
      ? options.dumper
      : database.driver === "postgres"
        ? createPgDumper(config.DATABASE_URL)
        : null;
  const bundled = readBundledMigrations(folder);
  const ids = createUuidV7Generator(systemClock);

  const beforeMigrate =
    config.BACKUP_BEFORE_MIGRATE && dumper
      ? async () => {
          logger.info("Migrations are pending: taking a backup first (BACKUP_BEFORE_MIGRATE=true)");
          try {
            const result = await runBackup({
              db: database.db,
              dumper,
              backupDir: config.BACKUP_DIR,
              filesDir: config.FILE_STORAGE_DIR,
              key: await readExistingKey(config),
              passphrase: config.BACKUP_PASSPHRASE,
              trigger: "pre_migrate",
              schemaTag: await currentSchemaTag(database.db, bundled),
              newId: () => ids.newId(),
              logger,
              ...(options.appVersion ? { appVersion: options.appVersion } : {}),
            });
            logger.info("Pre-migration backup written", { path: result.path });
            return result.path;
          } catch (err) {
            throw new StartupError(
              [
                `Could not take the backup that runs before database migrations: ${(err as Error).message}`,
                "Nothing was changed. Fix the cause (often disk space: docker compose exec app df -h /backups),",
                "or set BACKUP_BEFORE_MIGRATE=false in .env to upgrade without this safety copy.",
              ].join("\n"),
            );
          }
        }
      : undefined;

  return runMigrations({
    db: database.db,
    lock: database.lock,
    migrationsFolder: folder,
    logger,
    lockTimeoutMs: config.MIGRATE_LOCK_TIMEOUT_SECONDS * 1000,
    driver: database.driver,
    ...(options.appVersion ? { appVersion: options.appVersion } : {}),
    ...(beforeMigrate ? { beforeMigrate } : {}),
  });
}
