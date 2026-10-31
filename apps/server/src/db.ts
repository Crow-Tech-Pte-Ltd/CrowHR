import { mkdir } from "node:fs/promises";
import type { Db } from "@crowhr/core";
import { schema } from "@crowhr/core";
import { migrationsFolder } from "@crowhr/core/migrations-folder";
import { PGlite } from "@electric-sql/pglite";
import { drizzle as drizzleNodePg } from "drizzle-orm/node-postgres";
import { migrate as migrateNodePg } from "drizzle-orm/node-postgres/migrator";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { migrate as migratePglite } from "drizzle-orm/pglite/migrator";
import pg from "pg";

export interface Database {
  db: Db;
  /** Applies pending drizzle-kit migrations from packages/core/drizzle. */
  migrate(): Promise<void>;
  close(): Promise<void>;
  /** "postgres" in production; "pglite" for local development and e2e. */
  driver: "postgres" | "pglite";
}

/**
 * `postgres://…` → node-postgres pool (production).
 * `pglite:memory` / `pglite:<dir>` → in-process PGlite. Development and local
 * e2e only: single process, no connection pooling, no backups.
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
    return {
      db,
      driver: "pglite",
      migrate: () => migratePglite(db, { migrationsFolder }),
      close: () => client.close(),
    };
  }

  const pool = new pg.Pool({ connectionString: url, max: 10 });
  const db = drizzleNodePg({ client: pool, schema });
  return {
    db,
    driver: "postgres",
    migrate: () => migrateNodePg(db, { migrationsFolder }),
    close: () => pool.end(),
  };
}
