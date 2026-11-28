/** Development helper. Starts its own PostgreSQL cluster and accepts no database URL. */
import { execFile, execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { type Db, schema, VERSION } from "@crowhr/core";
import type { Logger } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { writeArchive } from "../src/backup/archive.ts";
import { openDatabase } from "../src/db.ts";

const execute = promisify(execFile);

export async function startBenchPostgres(logger: Logger) {
  const bin = process.env.BENCH_PG_BIN ?? execFileSync("pg_config", ["--bindir"], { encoding: "utf8" }).trim();
  const pgCommand = (name: string, args: string[]) => execFileSync(join(bin, name), args, { encoding: "utf8" });
  const version = pgCommand("postgres", ["--version"]).trim();
  if (!/\(PostgreSQL\) 17\./.test(version)) throw new Error("The benchmark needs PostgreSQL 17 binaries.");
  const root = mkdtempSync(join(tmpdir(), "crowhr-bench-"));
  const data = join(root, "db");
  const user = "crowhr_bench";
  const socket = `'${root.replaceAll("'", "'\\''")}'`;
  const cleanup = () => {
    if (existsSync(join(data, "postmaster.pid"))) pgCommand("pg_ctl", ["-D", data, "-w", "-m", "fast", "stop"]);
    rmSync(root, { recursive: true, force: true });
  };
  const interrupt = () => {
    cleanup();
    process.exit(130);
  };
  const terminate = () => {
    cleanup();
    process.exit(143);
  };

  let pool: pg.Pool | undefined;
  try {
    process.once("SIGINT", interrupt);
    process.once("SIGTERM", terminate);
    pgCommand("initdb", [
      "-D",
      data,
      "--username",
      user,
      "--auth-local=trust",
      "--auth-host=reject",
      "--no-locale",
      "--encoding=UTF8",
    ]);
    pgCommand("pg_ctl", [
      "-D",
      data,
      "-l",
      join(root, "postgres.log"),
      "-o",
      `-c listen_addresses='' -k ${socket}`,
      "-t",
      "20",
      "-w",
      "start",
    ]);
    const url = new URL(`postgres://${user}@localhost:5432/postgres`);
    url.searchParams.set("host", root);
    const migrator = await openDatabase(url.href);
    try {
      await migrator.migrate();
    } finally {
      await migrator.close();
    }
    const client = new pg.Pool({ connectionString: url.href, max: 10, connectionTimeoutMillis: 5000 });
    pool = client;
    const db = drizzle({ client, schema, logger }) as unknown as Db;
    const postmaster = Number(readFileSync(join(data, "postmaster.pid"), "utf8").split("\n")[0]);
    const passphrase = randomBytes(24).toString("base64url");

    return {
      db,
      version,
      query: (statement: string, params?: unknown[]) => client.query(statement, params),
      async backup() {
        const dumpFile = join(root, "snapshot.dump");
        const outFile = join(root, "snapshot.tar.gz.age");
        try {
          await execute(join(bin, "pg_dump"), [
            "--no-password",
            "--format=custom",
            "--no-owner",
            "--no-acl",
            "--host",
            root,
            "--port",
            "5432",
            "--username",
            user,
            "--dbname",
            "postgres",
            "--file",
            dumpFile,
          ]);
          await writeArchive({
            dumpFile,
            outFile,
            filesDir: join(root, "files"),
            key: null,
            passphrase,
            manifest: {
              appVersion: VERSION,
              schema: { tag: null },
              createdAt: new Date().toISOString(),
              trigger: "manual",
            },
          });
          return (await stat(outFile)).size;
        } finally {
          await Promise.all([rm(dumpFile, { force: true }), rm(outFile, { force: true })]);
        }
      },
      async resources() {
        const { stdout } = await execute("ps", ["-eo", "pid=,ppid=,rss="]);
        const postgresRssKiB = stdout
          .trim()
          .split("\n")
          .reduce((sum, line) => {
            const [pid, parent, rss] = line.trim().split(/\s+/).map(Number);
            return sum + (pid === postmaster || parent === postmaster ? (rss ?? 0) : 0);
          }, 0);
        const size = await client.query<{ bytes: string }>("select pg_database_size(current_database()) as bytes");
        return { postgresRssKiB, databaseBytes: Number(size.rows[0]?.bytes ?? 0), waiting: client.waitingCount };
      },
      async close() {
        try {
          await client.end();
        } finally {
          process.off("SIGINT", interrupt);
          process.off("SIGTERM", terminate);
          cleanup();
        }
      },
    };
  } catch (err) {
    await pool?.end();
    process.off("SIGINT", interrupt);
    process.off("SIGTERM", terminate);
    cleanup();
    throw err;
  }
}
