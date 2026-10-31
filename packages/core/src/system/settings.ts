import { desc, eq, sql } from "drizzle-orm";
import { backupRuns, systemSettings } from "../db/schema/system.ts";
import type { Db } from "../db/types.ts";

/** Keys used in `system_settings`. Values are JSON. */
export const SYSTEM_KEYS = {
  /** `{ tag, appVersion, migratedAt }` — written after migrations by the server. */
  schemaVersion: "schema_version",
  /** `{ hash, createdAt }` — SHA-256 of the current one-time setup code. */
  setupCode: "setup.code_hash",
} as const;

export interface SchemaVersion {
  tag: string;
  appVersion: string;
  migratedAt: string;
}

export async function getSystemSetting<T>(db: Db, key: string): Promise<T | null> {
  const rows = await db.select().from(systemSettings).where(eq(systemSettings.key, key)).limit(1);
  return rows[0] ? (rows[0].value as T) : null;
}

export async function setSystemSetting(db: Db, key: string, value: unknown, now: Date): Promise<void> {
  await db
    .insert(systemSettings)
    .values({ key, value, updatedAt: now })
    .onConflictDoUpdate({ target: systemSettings.key, set: { value, updatedAt: now } });
}

export async function deleteSystemSetting(db: Db, key: string): Promise<void> {
  await db.delete(systemSettings).where(eq(systemSettings.key, key));
}

export async function lastBackupRuns(db: Db) {
  const [last] = await db.select().from(backupRuns).orderBy(desc(backupRuns.startedAt)).limit(1);
  const [lastSuccessful] = await db
    .select()
    .from(backupRuns)
    .where(eq(backupRuns.status, "succeeded"))
    .orderBy(desc(backupRuns.startedAt))
    .limit(1);
  return { last: last ?? null, lastSuccessful: lastSuccessful ?? null };
}

/** Applied drizzle-kit migrations (the tracking table lives in the `drizzle` schema). */
export async function appliedMigrationCount(db: Db): Promise<number | null> {
  try {
    const result = await db.execute<{ n: number | string }>(
      sql`select count(*)::int as n from drizzle.__drizzle_migrations`,
    );
    const rows =
      (result as unknown as { rows?: { n: number | string }[] }).rows ?? (result as unknown as { n: number }[]);
    const n = rows[0]?.n;
    return n === undefined ? null : Number(n);
  } catch {
    return null;
  }
}
