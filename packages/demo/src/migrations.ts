import type { Db } from "@crowhr/core";

/**
 * The real drizzle-kit migrations, applied without a filesystem. Drizzle's own migrator reads
 * `drizzle/meta/_journal.json` and the SQL files with `node:fs`, which the browser doesn't have,
 * so the demo bundles them (see `bundled-migrations.ts`) and hands them to the same dialect
 * migrator the server uses. The result is the identical schema and `drizzle.__drizzle_migrations`
 * bookkeeping.
 */
export interface MigrationJournal {
  entries: readonly { idx: number; when: number; tag: string; breakpoints: boolean }[];
}

export interface MigrationBundle {
  journal: MigrationJournal;
  /** SQL text by tag, e.g. `0000_init`. */
  sql: Readonly<Record<string, string>>;
}

export interface MigrationMeta {
  sql: string[];
  bps: boolean;
  folderMillis: number;
  hash: string;
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Same shape and hash as drizzle's `readMigrationFiles` (sha256 of the file, split on breakpoints). */
export async function readBundledMigrations(bundle: MigrationBundle): Promise<MigrationMeta[]> {
  const out: MigrationMeta[] = [];
  for (const entry of bundle.journal.entries) {
    const text = bundle.sql[entry.tag];
    if (text === undefined) throw new Error(`Migration ${entry.tag} is in the journal but was not bundled.`);
    out.push({
      sql: text.split("--> statement-breakpoint"),
      bps: entry.breakpoints,
      folderMillis: entry.when,
      hash: await sha256Hex(text),
    });
  }
  return out;
}

interface DialectMigrator {
  dialect: { migrate(migrations: MigrationMeta[], session: unknown, config: object): Promise<void> };
  session: unknown;
}

export async function applyMigrations(db: Db, bundle: MigrationBundle): Promise<number> {
  const migrations = await readBundledMigrations(bundle);
  // The dialect migrator is what `drizzle-orm/pglite/migrator` calls after reading the files.
  const d = db as unknown as DialectMigrator;
  await d.dialect.migrate(migrations, d.session, { migrationsFolder: "bundled" });
  return migrations.length;
}
