import journal from "../../core/drizzle/meta/_journal.json";
import type { MigrationBundle } from "./migrations.ts";

/**
 * Core's migrations, inlined by Vite at build time (`?raw`). Works in the demo bundle and in
 * Vitest; `migrations.test.ts` proves the bundle matches `packages/core/drizzle/` byte for byte.
 */
const files = import.meta.glob<string>("../../core/drizzle/*.sql", { query: "?raw", import: "default", eager: true });

const sql: Record<string, string> = {};
for (const [path, text] of Object.entries(files)) {
  const tag = path
    .split("/")
    .pop()
    ?.replace(/\.sql$/, "");
  if (tag) sql[tag] = text;
}

export const CORE_MIGRATIONS: MigrationBundle = { journal, sql };
