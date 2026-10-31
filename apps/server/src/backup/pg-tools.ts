import { spawn } from "node:child_process";
import { Readable } from "node:stream";

/** Dumps and restores the database. Real: pg_dump/pg_restore/psql. Tests inject a fake. */
export interface DbDumper {
  readonly kind: string;
  /** Writes a pg_dump custom-format file. */
  dump(outFile: string): Promise<void>;
  /**
   * Replaces the whole database with the dump, atomically: either everything is restored or
   * the database is left as it was.
   */
  restore(dumpFile: string): Promise<void>;
}

/** libpq environment from a postgres:// URL, so the password never appears in `ps` output. */
export function pgEnv(databaseUrl: string): Record<string, string> {
  const url = new URL(databaseUrl);
  const env: Record<string, string> = {
    PGHOST: url.hostname,
    PGPORT: url.port || "5432",
    PGUSER: decodeURIComponent(url.username),
    PGPASSWORD: decodeURIComponent(url.password),
    PGDATABASE: decodeURIComponent(url.pathname.replace(/^\//, "")),
    PGCONNECT_TIMEOUT: "10",
  };
  const sslmode = url.searchParams.get("sslmode");
  if (sslmode) env.PGSSLMODE = sslmode;
  return env;
}

/**
 * Everything the app owns lives in `public` (tables) and `drizzle` (migration tracking).
 * pg_dump 17 never emits CREATE SCHEMA public, so dropping and recreating both schemas inside
 * the same transaction as the restore gives an exact, all-or-nothing replacement.
 */
const RESTORE_PRELUDE =
  "DROP SCHEMA IF EXISTS drizzle CASCADE;\nDROP SCHEMA IF EXISTS public CASCADE;\nCREATE SCHEMA public;\n";

interface RunResult {
  code: number | null;
  stderr: string;
}

function run(cmd: string, args: string[], env: Record<string, string>, stdin?: Readable): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      env: { ...process.env, ...env },
      stdio: [stdin ? "pipe" : "ignore", "ignore", "pipe"],
    });
    let stderr = "";
    child.stderr?.on("data", (d: Buffer) => {
      stderr = (stderr + d.toString()).slice(-8000);
    });
    child.on("error", (err) => {
      reject(
        (err as NodeJS.ErrnoException).code === "ENOENT"
          ? new Error(
              `${cmd} is not installed. The Crow HR image ships it; outside Docker install the PostgreSQL 17 client.`,
            )
          : err,
      );
    });
    if (stdin && child.stdin) {
      stdin.on("error", reject);
      stdin.pipe(child.stdin);
    }
    child.on("close", (code) => resolve({ code, stderr }));
  });
}

export function createPgDumper(databaseUrl: string): DbDumper {
  const env = pgEnv(databaseUrl);
  return {
    kind: "pg_dump",
    async dump(outFile) {
      const r = await run("pg_dump", ["--format=custom", "--no-owner", "--no-acl", `--file=${outFile}`], env);
      if (r.code !== 0) throw new Error(`pg_dump failed: ${r.stderr.trim() || `exit ${r.code}`}`);
    },
    async restore(dumpFile) {
      // Refuse unreadable dumps before psql has run a single statement.
      const listed = await run("pg_restore", ["--list", dumpFile], env);
      if (listed.code !== 0)
        throw new Error(`pg_restore cannot read the dump: ${listed.stderr.trim() || `exit ${listed.code}`}`);
      // pg_restore renders SQL; psql applies prelude + SQL in ONE transaction, stopping at the first error.
      const sqlStream = spawn("pg_restore", ["--no-owner", "--no-acl", "--file=-", dumpFile], {
        env: { ...process.env, ...env },
        stdio: ["ignore", "pipe", "pipe"],
      });
      let restoreErr = "";
      sqlStream.stderr.on("data", (d: Buffer) => {
        restoreErr = (restoreErr + d.toString()).slice(-4000);
      });
      const exited = new Promise<number | null>((r) => sqlStream.on("close", r));
      sqlStream.on("error", () => undefined);
      const input = Readable.from(
        (async function* () {
          yield RESTORE_PRELUDE;
          for await (const chunk of sqlStream.stdout) yield chunk;
          // psql commits at end of input; if pg_restore failed part-way, force a rollback instead.
          if ((await exited) !== 0) yield "\nDO $$ BEGIN RAISE EXCEPTION 'pg_restore failed; rolling back'; END $$;\n";
        })(),
      );
      const r = await run(
        "psql",
        ["--no-psqlrc", "--quiet", "--single-transaction", "--set=ON_ERROR_STOP=1", "--file=-"],
        env,
        input,
      );
      const code = await exited;
      if (code !== 0) throw new Error(`pg_restore could not read the dump: ${restoreErr.trim() || `exit ${code}`}`);
      if (r.code !== 0) throw new Error(`psql failed while restoring (nothing was changed): ${r.stderr.trim()}`);
    },
  };
}

/** PGlite (development) has no pg_dump. */
export const unsupportedDumper: DbDumper = {
  kind: "unsupported",
  dump: async () => {
    throw new Error(
      "Backups need PostgreSQL. This server uses PGlite (development); run with DATABASE_URL=postgres://… or docker compose.",
    );
  },
  restore: async () => {
    throw new Error("Restore needs PostgreSQL. This server uses PGlite (development).");
  },
};
