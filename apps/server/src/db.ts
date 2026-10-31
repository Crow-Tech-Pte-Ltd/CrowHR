import { mkdir } from "node:fs/promises";
import type { Db } from "@crowhr/core";
import { schema } from "@crowhr/core";
import { migrationsFolder } from "@crowhr/core/migrations-folder";
import { PGlite } from "@electric-sql/pglite";
import { drizzle as drizzleNodePg } from "drizzle-orm/node-postgres";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import pg from "pg";
import { type AdvisoryLock, runMigrations } from "./migrate/runner.ts";

export interface Database {
  db: Db;
  /** Applies pending drizzle-kit migrations from packages/core/drizzle (see migrate/runner.ts). */
  migrate(): Promise<void>;
  /** Cheap round trip, used while waiting for the database to come up. */
  probe(): Promise<void>;
  /** Session-level advisory lock on a dedicated connection (Postgres), or a no-op lock (PGlite). */
  lock: AdvisoryLock;
  close(): Promise<void>;
  /** "postgres" in production; "pglite" for local development and e2e. */
  driver: "postgres" | "pglite";
}

/**
 * `postgres://…` → node-postgres pool (production).
 * `pglite:memory` / `pglite:<dir>` → in-process PGlite. Development and local
 * e2e only: single process, no connection pooling, no pg_dump backups.
 */
export async function openDatabase(url: string): Promise<Database> {
  if (url.startsWith("pglite:")) {
    const target = url.slice("pglite:".length);
    let client: PGlite;
    if (target === "memory" || target === "") {
      client = new PGlite();
    } else {
      await mkdir(target, { recursive: true });
      client = new PGlite(target);
    }
    const db = drizzlePglite({ client, schema });
    const database: Database = {
      db,
      driver: "pglite",
      // One process owns a PGlite directory, so there is nobody to race with.
      lock: { acquire: async () => async () => undefined },
      probe: async () => {
        await client.query("select 1");
      },
      migrate: async () => {
        await runMigrations({ db, lock: database.lock, migrationsFolder });
      },
      close: () => client.close(),
    };
    return database;
  }

  const pool = new pg.Pool({ connectionString: url, max: 10, connectionTimeoutMillis: 5000 });
  // An idle client losing its connection (database restart) must not crash the process.
  pool.on("error", () => undefined);
  const db = drizzleNodePg({ client: pool, schema });
  const database: Database = {
    db,
    driver: "postgres",
    lock: createPgAdvisoryLock(pool),
    probe: async () => {
      await pool.query("select 1");
    },
    migrate: async () => {
      await runMigrations({ db, lock: database.lock, migrationsFolder });
    },
    close: () => pool.end(),
  };
  return database;
}

/**
 * `pg_try_advisory_lock(hashtext(name))` polled once a second on one dedicated pool client,
 * so the lock lives exactly as long as that session. A crashed holder releases it
 * automatically when its connection drops.
 */
export function createPgAdvisoryLock(pool: pg.Pool): AdvisoryLock {
  return {
    async acquire(name, { timeoutMs, onWait }) {
      const client = await pool.connect();
      const started = Date.now();
      let lastNotice = 0;
      try {
        for (;;) {
          const res = await client.query<{ ok: boolean }>("select pg_try_advisory_lock(hashtext($1)) as ok", [name]);
          if (res.rows[0]?.ok) break;
          const waited = Date.now() - started;
          if (waited >= timeoutMs) {
            client.release();
            return null;
          }
          if (waited - lastNotice >= 5000 || lastNotice === 0) {
            lastNotice = waited || 1;
            onWait?.(Math.round(waited / 1000));
          }
          await new Promise((r) => setTimeout(r, 1000));
        }
      } catch (err) {
        client.release();
        throw err;
      }
      return async () => {
        try {
          await client.query("select pg_advisory_unlock(hashtext($1))", [name]);
        } finally {
          client.release();
        }
      };
    },
  };
}
