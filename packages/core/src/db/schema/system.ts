import { bigint, boolean, index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

/**
 * Install-wide settings for the self-hosted server (not tenant data, so no `org_id`):
 * `schema_version`, `setup.code_hash`. (The key check value lives in
 * `secret_key_checks`, owned by the identity module.) Values are
 * JSON. Read and written through `system/settings.ts`.
 */
export const systemSettings = pgTable("system_settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * One row per backup attempt (manual `crowhr backup`, scheduled, or pre-migration).
 * Install-wide, not tenant data. Settings → System and the Home backup-age warning read it.
 */
export const backupRuns = pgTable(
  "backup_runs",
  {
    id: uuid("id").primaryKey(),
    trigger: text("trigger", { enum: ["manual", "scheduled", "pre_migrate"] }).notNull(),
    status: text("status", { enum: ["running", "succeeded", "failed"] }).notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    /** Archive file name inside the backups volume. */
    fileName: text("file_name"),
    sizeBytes: bigint("size_bytes", { mode: "number" }),
    encrypted: boolean("encrypted").notNull().default(false),
    includesKey: boolean("includes_key").notNull().default(true),
    error: text("error"),
  },
  (t) => [index("backup_runs_started_at_idx").on(t.startedAt)],
);

export type SystemSetting = typeof systemSettings.$inferSelect;
export type BackupRun = typeof backupRuns.$inferSelect;
export type NewBackupRun = typeof backupRuns.$inferInsert;
