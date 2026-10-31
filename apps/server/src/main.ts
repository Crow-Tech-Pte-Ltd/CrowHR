import {
  createJsonConsoleLogger,
  createUuidV7Generator,
  type Logger,
  schema,
  systemClock,
  VERSION,
} from "@crowhr/core";
import { migrationsFolder } from "@crowhr/core/migrations-folder";
import { serve } from "@hono/node-server";
import { desc, eq } from "drizzle-orm";
import { applyRetention, runBackup } from "./backup/backup.ts";
import { clearMaintenance, createMaintenanceProbe } from "./backup/maintenance.ts";
import { createPgDumper } from "./backup/pg-tools.ts";
import { createBackupScheduler } from "./backup/schedule.ts";
import { ConfigError, loadConfig, type ServerConfig } from "./config.ts";
import { waitForDatabase } from "./db/wait.ts";
import { type Database, openDatabase } from "./db.ts";
import { createServerDeps } from "./deps.ts";
import { createServerApp, createStartingApp } from "./http.ts";
import { currentSchemaTag, planMigrations, readBundledMigrations } from "./migrate/runner.ts";
import { migrateOnStart } from "./migrate/start.ts";
import { readExistingKey } from "./secrets/existing.ts";
import { resolveSecretKey } from "./secrets/key.ts";
import { prepareSetupCode } from "./setup/code.ts";
import { createSetupGate } from "./setup/gate.ts";
import { EX_CONFIG, StartupError } from "./startup-error.ts";

type Fetch = (req: Request, env?: unknown) => Response | Promise<Response>;

async function main() {
  let config: ServerConfig;
  try {
    config = loadConfig(process.env);
  } catch (err) {
    if (err instanceof ConfigError) {
      console.error(err.message);
      process.exit(EX_CONFIG);
    }
    throw err;
  }

  const logger = createJsonConsoleLogger({ level: config.LOG_LEVEL, base: { service: "crowhr" } });
  logger.info("Crow HR starting", { version: VERSION, publicUrl: config.PUBLIC_URL, node: process.version });

  // Listen straight away so health checks see `starting` (503) instead of connection refused
  // while we wait for the database and run migrations.
  let handler: Fetch = createStartingApp().fetch;
  const server = serve({ fetch: (req, env) => handler(req, env), hostname: config.HOST, port: config.PORT }, (info) => {
    logger.info("Crow HR listening", { url: `http://${info.address}:${info.port}`, publicUrl: config.PUBLIC_URL });
  });
  server.on("error", (err: NodeJS.ErrnoException) => {
    console.error(
      err.code === "EADDRINUSE"
        ? `Port ${config.PORT} is already in use. Stop the other program, or change PORT (inside the container) / HTTP_PORT (on the host) in .env.`
        : `Cannot listen on ${config.HOST}:${config.PORT}: ${err.message}`,
    );
    process.exit(EX_CONFIG);
  });

  let database: Database | null = null;
  let stopScheduler: (() => Promise<void>) | null = null;
  let shuttingDown = false;
  const shutdown = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info("Shutting down", { signal });
    setTimeout(() => {
      logger.warn("Forced exit after 25 s");
      process.exit(1);
    }, 25_000).unref();
    server.close(async () => {
      await stopScheduler?.();
      await database?.close().catch(() => undefined);
      process.exit(0);
    });
    // Idle keep-alive sockets would otherwise hold close() open.
    (server as unknown as { closeIdleConnections?: () => void }).closeIdleConnections?.();
  };
  process.once("SIGINT", () => shutdown("SIGINT"));
  process.once("SIGTERM", () => shutdown("SIGTERM"));

  try {
    // A restore finished (or crashed) before this start: the new process serves the restored data.
    await clearMaintenance(config.DATA_DIR);
    database = await openDatabase(config.DATABASE_URL);
    if (database.driver === "pglite") {
      logger.warn("Using in-process PGlite. Fine for development; use PostgreSQL in production.");
    }
    const db = database;
    await waitForDatabase(() => db.probe(), { timeoutSeconds: config.DB_WAIT_SECONDS, logger });

    if (config.MIGRATE_ON_START) {
      const result = await migrateOnStart({ config, database, logger });
      logger.info(result.applied.length ? "Database migrations applied" : "Database schema is up to date", {
        applied: result.applied,
        schema: result.latestTag,
      });
    } else {
      const plan = await planMigrations(database.db, readBundledMigrations(migrationsFolder));
      if (plan.pending.length || plan.unknown.length) {
        logger.warn("MIGRATE_ON_START=false and the schema does not match this image. Run: crowhr migrate", {
          pending: plan.pending.map((m) => m.tag),
        });
      }
    }

    const key = await resolveSecretKey({
      envKey: config.CROWHR_SECRET_KEY,
      keyFile: config.SECRET_KEY_FILE,
      db: database.db,
      logger,
    });
    logger.info("Encryption key loaded", { source: key.source, ...(key.file ? { file: key.file } : {}) });
    if (key.firstBoot)
      logger.info("Stored the encryption key check value in the database. Back up the key with your backups.");
    if (!config.secureCookies) {
      logger.warn("PUBLIC_URL is plain http: session cookies are not marked Secure. Use https outside a trusted LAN.");
    }

    // biome-ignore lint/suspicious/noConsole: the setup banner must be readable plain text in `docker compose logs`.
    await prepareSetupCode({ db: database.db, publicUrl: config.PUBLIC_URL, logger, print: (t) => console.log(t) });

    const maintenance = createMaintenanceProbe(config.DATA_DIR);
    const deps = createServerDeps(config, database, logger, key.bytes);
    const app = createServerApp(deps, {
      webDistDir: config.WEB_DIST_DIR,
      maintenance,
      ...(config.SETUP_GATE ? { setupGate: createSetupGate(database.db) } : {}),
    });
    handler = app.fetch as Fetch;
    logger.info("Crow HR is ready", { publicUrl: config.PUBLIC_URL });

    stopScheduler = startScheduledBackups(config, database, logger, () => maintenance() !== null);
  } catch (err) {
    if (err instanceof StartupError) {
      console.error(`\nCrow HR cannot start.\n${err.message}\n`);
      await database?.close().catch(() => undefined);
      process.exit(err.exitCode);
    }
    throw err;
  }
}

function startScheduledBackups(
  config: ServerConfig,
  database: Database,
  logger: Logger,
  isPaused: () => boolean,
): (() => Promise<void>) | null {
  if (!config.BACKUP_TIME) {
    logger.info("Scheduled backups are off (BACKUP_TIME=off)");
    return null;
  }
  if (database.driver !== "postgres") return null;
  const dumper = createPgDumper(config.DATABASE_URL);
  const ids = createUuidV7Generator(systemClock);
  const bundled = readBundledMigrations(migrationsFolder);
  const { backupRuns } = schema;
  const scheduler = createBackupScheduler({
    time: config.BACKUP_TIME,
    timeZone: config.BACKUP_TIMEZONE,
    now: () => new Date(),
    logger,
    isPaused,
    lastScheduledStart: async () => {
      const [row] = await database.db
        .select({ startedAt: backupRuns.startedAt })
        .from(backupRuns)
        .where(eq(backupRuns.trigger, "scheduled"))
        .orderBy(desc(backupRuns.startedAt))
        .limit(1);
      return row?.startedAt ?? null;
    },
    tryLock: () => database.lock.acquire("crowhr:backup", { timeoutMs: 0 }),
    run: async () => {
      await runBackup({
        db: database.db,
        dumper,
        backupDir: config.BACKUP_DIR,
        filesDir: config.FILE_STORAGE_DIR,
        key: await readExistingKey(config),
        passphrase: config.BACKUP_PASSPHRASE,
        trigger: "scheduled",
        schemaTag: await currentSchemaTag(database.db, bundled),
        newId: () => ids.newId(),
        logger,
      });
      const deleted = await applyRetention(config.BACKUP_DIR, config.BACKUP_KEEP);
      if (deleted.length) logger.info("Deleted old backups", { deleted, keep: config.BACKUP_KEEP });
    },
  });
  scheduler.start();
  return () => scheduler.stop();
}

main().catch((err: unknown) => {
  console.error("Crow HR failed to start:", err instanceof Error ? err.message : err);
  process.exit(1);
});
