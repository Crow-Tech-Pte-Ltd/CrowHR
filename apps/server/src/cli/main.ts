import { readFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import {
  createJsonConsoleLogger,
  createUuidV7Generator,
  generateSetupCode,
  isSetupRequired,
  schema,
  systemClock,
  VERSION,
} from "@crowhr/core";
import { migrationsFolder } from "@crowhr/core/migrations-folder";
import { runBackup, UNENCRYPTED_KEY_WARNING } from "../backup/backup.ts";
import { createPgDumper } from "../backup/pg-tools.ts";
import { restoreBackup } from "../backup/restore.ts";
import { ConfigError, loadConfig, type ServerConfig } from "../config.ts";
import { waitForDatabase } from "../db/wait.ts";
import { type Database, openDatabase } from "../db.ts";
import { currentSchemaTag, readBundledMigrations } from "../migrate/runner.ts";
import { migrateOnStart } from "../migrate/start.ts";
import { DEFAULT_DB_PASSWORD_FILE, initDbPassword } from "../secrets/db-password.ts";
import { readExistingKey } from "../secrets/existing.ts";
import { prepareSetupCode } from "../setup/code.ts";
import { EX_CONFIG, StartupError } from "../startup-error.ts";
import { cliDeps, resetOwnerPasswordCommand, verifyAuditCommand } from "./admin.ts";
import { runDoctor } from "./doctor.ts";

export interface CliIo {
  out(text: string): void;
  err(text: string): void;
}

const consoleIo: CliIo = {
  // biome-ignore lint/suspicious/noConsole: CLI output.
  out: (t) => console.log(t),
  err: (t) => console.error(t),
};

const HELP = `crowhr ${VERSION} — Crow HR server administration

Run inside the app container:  docker compose exec app crowhr <command>

Commands
  backup [--passphrase-file <file> | --passphrase <text>] [--without-key]
      Write a backup archive (database, uploaded files, encryption key) to /backups.
      Encrypted when BACKUP_PASSPHRASE or a passphrase option is given.
  restore <file> [--force] [--secrets-only] [--passphrase-file <file>] [--no-restart]
      Restore a backup archive. --force is required when the database already has data.
      --secrets-only restores just the encryption key (after losing the data volume).
  migrate
      Apply pending database migrations (the app also does this on start).
  doctor
      Check configuration, database, migrations, key, disk, clock and proxy headers.
  setup-code
      Print a new first-run setup code (the previous one stops working).
  init-secrets
      Create the database password in the shared secrets volume (compose init service).
  create-reset-link --email <owner email> [--org <slug>]
      Break-glass: print a one-time password reset link (60 minutes) for an owner.
  reset-owner-mfa --email <owner email> [--org <slug>]
      Break-glass: clear an owner's two-step verification and print a reset link.
  admin verify-audit [--org <slug>]
      Check that the audit log hash chain is intact.
  admin reset-owner-password --org <slug> --email <email> [--reset-mfa]
      Same as create-reset-link / reset-owner-mfa.
`;

/** Runs one CLI command and returns the exit code. */
export async function runCli(
  argv: string[],
  env: Record<string, string | undefined>,
  io: CliIo = consoleIo,
): Promise<number> {
  const [command, ...rest] = argv;
  try {
    switch (command) {
      case "init-secrets": {
        const path = env.DATABASE_PASSWORD_FILE?.trim() || DEFAULT_DB_PASSWORD_FILE;
        const result = await initDbPassword(path);
        io.out(
          result.created
            ? `Generated a database password at ${path}.`
            : `Database password at ${path} already exists; left unchanged.`,
        );
        return 0;
      }
      case "backup":
        return await withDatabase(env, io, (config, database) => backup(config, database, rest, io));
      case "restore":
        return await withDatabase(env, io, (config, database) => restore(config, database, rest, io));
      case "migrate":
        return await withDatabase(env, io, async (config, database) => {
          const logger = createJsonConsoleLogger({ level: "warn" });
          const result = await migrateOnStart({ config, database, logger });
          io.out(result.applied.length ? `Applied ${result.applied.join(", ")}.` : "Database schema is up to date.");
          return 0;
        });
      case "setup-code":
        return await withDatabase(env, io, async (config, database) => {
          if (!(await isSetupRequired(database.db))) {
            io.out(`Setup is already complete. Sign in at ${config.PUBLIC_URL}`);
            return 0;
          }
          await prepareSetupCode({
            db: database.db,
            publicUrl: config.PUBLIC_URL,
            logger: createJsonConsoleLogger({ level: "warn" }),
            print: io.out,
            generate: generateSetupCode,
          });
          return 0;
        });
      case "doctor":
        return await runDoctor(env, io);
      case "reset-owner-mfa":
      case "create-reset-link":
        return await withDatabase(env, io, (config, database) =>
          ownerRecovery(config, database, rest, command === "reset-owner-mfa", io),
        );
      case "admin": {
        const [sub, ...args] = rest;
        if (sub === "verify-audit") {
          return await withDatabase(env, io, async (_config, database) => {
            const { values } = parseArgs({ args, options: { org: { type: "string" } } });
            return printResult(await verifyAuditCommand(database.db, values.org), io);
          });
        }
        if (sub === "reset-owner-password") {
          return await withDatabase(env, io, (config, database) => {
            const resetMfa = args.includes("--reset-mfa");
            return ownerRecovery(
              config,
              database,
              args.filter((a) => a !== "--reset-mfa"),
              resetMfa,
              io,
            );
          });
        }
        io.err(
          "Usage: crowhr admin verify-audit [--org <slug>] | crowhr admin reset-owner-password --org <slug> --email <email> [--reset-mfa]",
        );
        return 64;
      }
      case undefined:
      case "help":
      case "--help":
      case "-h":
        io.out(HELP);
        return command === undefined ? 64 : 0;
      case "--version":
      case "version":
        io.out(VERSION);
        return 0;
      default:
        io.err(`Unknown command "${command}".\n\n${HELP}`);
        return 64;
    }
  } catch (err) {
    if (err instanceof ConfigError) {
      io.err(err.message);
      return EX_CONFIG;
    }
    if (err instanceof StartupError) {
      io.err(err.message);
      return err.exitCode;
    }
    io.err(`crowhr ${command}: ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }
}

async function withDatabase(
  env: Record<string, string | undefined>,
  io: CliIo,
  fn: (config: ServerConfig, database: Database) => Promise<number>,
): Promise<number> {
  const config = loadConfig(env);
  const database = await openDatabase(config.DATABASE_URL);
  try {
    await waitForDatabase(() => database.probe(), {
      timeoutSeconds: Math.min(config.DB_WAIT_SECONDS, 15),
      logger: createJsonConsoleLogger({ level: "warn" }),
    });
    return await fn(config, database);
  } finally {
    await database.close().catch(() => undefined);
    void io;
  }
}

function printResult(result: { ok: boolean; lines: string[] }, io: CliIo): number {
  for (const line of result.lines) (result.ok ? io.out : io.err)(line);
  return result.ok ? 0 : 1;
}

/** Break-glass owner recovery through the identity module (audited with actor `cli`). */
async function ownerRecovery(
  config: ServerConfig,
  database: Database,
  args: string[],
  resetMfa: boolean,
  io: CliIo,
): Promise<number> {
  const { values } = parseArgs({ args, options: { org: { type: "string" }, email: { type: "string" } } });
  if (!values.email) {
    io.err("Usage: crowhr create-reset-link --email <owner email> [--org <slug>]");
    return 64;
  }
  let orgSlug = values.org;
  if (!orgSlug) {
    const orgs = await database.db.select({ slug: schema.organisations.slug }).from(schema.organisations).limit(2);
    if (orgs.length !== 1 || !orgs[0]?.slug) {
      io.err("This install has several organisations (or none). Say which one with --org <slug>.");
      return 64;
    }
    orgSlug = orgs[0].slug;
  }
  return printResult(
    await resetOwnerPasswordCommand(cliDeps(database.db, config.PUBLIC_URL), {
      orgSlug,
      email: values.email,
      resetMfa,
    }),
    io,
  );
}

function readPassphrase(
  values: { passphrase?: string; "passphrase-file"?: string },
  config: ServerConfig,
): string | null {
  if (values["passphrase-file"]) return readFileSync(values["passphrase-file"], "utf8").trim();
  if (values.passphrase) return values.passphrase;
  return config.BACKUP_PASSPHRASE;
}

async function backup(config: ServerConfig, database: Database, args: string[], io: CliIo): Promise<number> {
  const { values } = parseArgs({
    args,
    options: {
      passphrase: { type: "string" },
      "passphrase-file": { type: "string" },
      "without-key": { type: "boolean", default: false },
    },
  });
  if (database.driver !== "postgres") {
    io.err("Backups need PostgreSQL. This server uses PGlite (development).");
    return 1;
  }
  const passphrase = readPassphrase(values, config);
  if (passphrase !== null && passphrase.length < 12) {
    io.err("The backup passphrase must be at least 12 characters.");
    return EX_CONFIG;
  }
  const key = values["without-key"] ? null : await readExistingKey(config);
  const ids = createUuidV7Generator(systemClock);
  const result = await runBackup({
    db: database.db,
    dumper: createPgDumper(config.DATABASE_URL),
    backupDir: config.BACKUP_DIR,
    filesDir: config.FILE_STORAGE_DIR,
    key,
    passphrase,
    trigger: "manual",
    schemaTag: await currentSchemaTag(database.db, readBundledMigrations(migrationsFolder)),
    newId: () => ids.newId(),
  });
  io.out(`Backup written: ${result.path} (${formatBytes(result.sizeBytes)})`);
  io.out(
    `  database, ${result.manifest.files.length} uploaded file(s)${result.includesKey ? ", encryption key" : ""}${result.encrypted ? "; encrypted with your passphrase" : ""}`,
  );
  if (!result.includesKey) {
    io.err(
      "NOTE: the encryption key is NOT in this backup. Keep a separate copy of /data/secrets/crowhr.key, or this backup cannot restore NRIC, bank and SSO data.",
    );
  } else if (!result.encrypted) {
    io.err(`\n${UNENCRYPTED_KEY_WARNING}\n`);
  }
  io.out(`Copy it off this server, for example: docker compose cp app:${result.path} .`);
  return 0;
}

async function restore(config: ServerConfig, database: Database, args: string[], io: CliIo): Promise<number> {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      force: { type: "boolean", default: false },
      "secrets-only": { type: "boolean", default: false },
      "no-restart": { type: "boolean", default: false },
      passphrase: { type: "string" },
      "passphrase-file": { type: "string" },
    },
  });
  const [file] = positionals;
  if (!file) {
    io.err(
      "Usage: crowhr restore <file> [--force] [--secrets-only]. Backups are in /backups: docker compose exec app ls /backups",
    );
    return 64;
  }
  const archive = isAbsolute(file)
    ? file
    : file.includes("/")
      ? join(process.cwd(), file)
      : join(config.BACKUP_DIR, file);
  const bundled = readBundledMigrations(migrationsFolder);
  const logger = createJsonConsoleLogger({ level: "warn" });
  if (database.driver !== "postgres" && !values["secrets-only"]) {
    io.err("Restore needs PostgreSQL. This server uses PGlite (development).");
    return 1;
  }
  io.out(`Restoring ${archive} …`);
  const result = await restoreBackup({
    archive,
    passphrase: readPassphrase(values, config),
    db: database.db,
    dumper: createPgDumper(config.DATABASE_URL),
    backupDir: config.BACKUP_DIR,
    dataDir: config.DATA_DIR,
    filesDir: config.FILE_STORAGE_DIR,
    keyFile: config.SECRET_KEY_FILE,
    envKey: config.CROWHR_SECRET_KEY,
    bundledTags: bundled.map((m) => m.tag),
    force: values.force ?? false,
    secretsOnly: values["secrets-only"] ?? false,
    migrate: () => migrateOnStart({ config: { ...config, BACKUP_BEFORE_MIGRATE: false }, database, logger }),
    logger,
  });
  const m = result.manifest;
  io.out(
    result.restored.database
      ? `Restored the database, ${result.restored.files} uploaded file(s)${result.restored.key ? " and the encryption key" : ""} from a backup made ${m.createdAt} by Crow HR ${m.appVersion}.`
      : `Restored the encryption key to ${config.SECRET_KEY_FILE}.`,
  );
  for (const w of result.warnings) io.err(`WARNING: ${w}`);
  if (!values["no-restart"] && restartRunningApp()) {
    io.out("Restarting the app so it uses the restored data. Check with: docker compose ps");
  } else {
    io.out("Now restart the app: docker compose restart app");
  }
  return 0;
}

/**
 * Inside the app container, PID 1 is tini running the server; SIGTERM makes it shut down
 * gracefully and Docker's restart policy starts it again with the restored key and data.
 * Under `docker compose run` (the server is not PID 1's child) nothing is signalled.
 */
function restartRunningApp(): boolean {
  if (process.env.CROWHR_CONTAINER !== "1" || process.pid === 1) return false;
  try {
    const cmdline = readFileSync("/proc/1/cmdline", "utf8");
    if (!cmdline.includes("main.ts")) return false;
    process.kill(1, "SIGTERM");
    return true;
  } catch {
    return false;
  }
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v < 10 ? 1 : 0)} ${units[i]}`;
}

// Entry point: `crowhr <command>` (see Dockerfile) or `node apps/server/src/cli/main.ts`.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const code = await runCli(process.argv.slice(2), process.env);
  process.exit(code);
}
