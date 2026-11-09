import { join } from "node:path";
import {
  type ApiModule,
  type AppDeps,
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
import { MailerConfigError, mailerFromEnv } from "./mailer.ts";
import { currentSchemaTag, databaseHasData, planMigrations, readBundledMigrations } from "./migrate/runner.ts";
import { migrateOnStart } from "./migrate/start.ts";
import { browserMonitoringFrom } from "./monitoring/browser.ts";
import { withMonitoring } from "./monitoring/logger.ts";
import { activeMonitoring, type Monitoring, startMonitoring } from "./monitoring/sentry.ts";
import { createIntervalScheduler } from "./scheduler.ts";
import { readExistingKey } from "./secrets/existing.ts";
import { resolveSecretKey } from "./secrets/key.ts";
import { prepareSetupCode } from "./setup/code.ts";
import { createSetupGate } from "./setup/gate.ts";
import { EX_CONFIG, StartupError } from "./startup-error.ts";

type Fetch = (req: Request, env?: unknown) => Response | Promise<Response>;

export interface StartOptions {
  /** Extra deps (e.g. workflow plugins); the e2e server registers a test request type this way. */
  deps?: Partial<AppDeps>;
  /** Extra API modules mounted under /api/v1. */
  modules?: readonly ApiModule[];
}

export async function startServer(options: StartOptions = {}) {
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
  let mailer: ReturnType<typeof mailerFromEnv>;
  try {
    mailer = mailerFromEnv(process.env);
  } catch (err) {
    if (err instanceof MailerConfigError) {
      console.error(`Invalid server configuration:\n  - ${err.message}\nSee .env.example for every variable.`);
      process.exit(EX_CONFIG);
    }
    throw err;
  }

  const consoleLogger = createJsonConsoleLogger({ level: config.LOG_LEVEL, base: { service: "crowhr" } });
  // Normally already started by instrument.ts (node --import); started here otherwise.
  const preloaded = activeMonitoring() !== null;
  const monitoring: Monitoring | null = config.monitoring?.dsn
    ? (activeMonitoring() ?? (await startMonitoring(config.monitoring)))
    : null;
  const logger =
    monitoring && config.monitoring
      ? withMonitoring(consoleLogger, monitoring, { logs: config.monitoring.logs, minLevel: config.LOG_LEVEL })
      : consoleLogger;
  logger.info("Crow HR starting", { version: VERSION, publicUrl: config.PUBLIC_URL, node: process.version });
  if (config.monitoring) {
    logger.info("Error monitoring is on", {
      server: monitoring !== null,
      browser: config.monitoring.browserDsn !== null,
      environment: config.monitoring.environment,
      release: config.monitoring.release,
      tracesSampleRate: config.monitoring.tracesSampleRate,
      logs: config.monitoring.logs,
    });
    if (monitoring && !preloaded) {
      logger.warn(
        "Monitoring started late: requests and database queries are not traced. Start the server with node --import ./apps/server/src/instrument.ts (the Docker image does).",
      );
    }
  }

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
      await monitoring?.flush(2000).catch(() => false);
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
    await prepareSetupCode({
      db: database.db,
      publicUrl: config.PUBLIC_URL,
      logger,
      // Plain text (not JSON) so the banner is readable in `docker compose logs`.
      print: (t) => process.stdout.write(`${t}\n`),
      ...(config.SETUP_CODE ? { generate: () => config.SETUP_CODE as string } : {}),
    });

    const maintenance = createMaintenanceProbe(config.DATA_DIR);
    const deps = createServerDeps(config, database, logger, key.bytes, {
      ...(mailer ? { mailer } : {}),
      ...options.deps,
    });
    if (!mailer) logger.info("Email is not configured (SMTP_URL); notifications are in-app only.");
    const app = createServerApp(deps, {
      webDistDir: config.WEB_DIST_DIR,
      brandingDir: join(config.DATA_DIR, "branding"),
      maintenance,
      modules: options.modules ?? [],
      browserMonitoring: browserMonitoringFrom(config.monitoring),
      ...(config.SETUP_GATE ? { setupGate: createSetupGate(database.db) } : {}),
    });
    handler = app.fetch as Fetch;
    logger.info("Crow HR is ready", { publicUrl: config.PUBLIC_URL });

    // One in-process scheduler (every 60 s, and once now): the workflows sweep (escalations,
    // reminders, email outbox, transitions) and the nightly backup check. Paused during a restore.
    const backups = scheduledBackups(config, database, logger, () => maintenance() !== null);
    const scheduler = createIntervalScheduler({
      deps,
      isPaused: () => maintenance() !== null,
      jobs: backups ? [{ name: "backup", run: () => backups.tick() }] : [],
    });
    scheduler.start();
    stopScheduler = async () => {
      await scheduler.stop();
      await backups?.stop();
      mailer?.close();
    };
  } catch (err) {
    if (err instanceof StartupError) {
      console.error(`\nCrow HR cannot start.\n${err.message}\n`);
      await database?.close().catch(() => undefined);
      process.exit(err.exitCode);
    }
    throw err;
  }
}

/** The nightly backup job (not started: the shared scheduler calls its `tick`). */
function scheduledBackups(config: ServerConfig, database: Database, logger: Logger, isPaused: () => boolean) {
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
    hasData: () => databaseHasData(database.db),
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
  return scheduler;
}

if (import.meta.main) {
  startServer().catch(async (err: unknown) => {
    console.error("Crow HR failed to start:", err instanceof Error ? err.message : err);
    const monitoring = activeMonitoring();
    if (monitoring) {
      monitoring.captureException(err);
      await monitoring.flush(2000).catch(() => false);
    }
    process.exit(1);
  });
}
