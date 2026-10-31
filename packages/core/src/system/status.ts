import { sql } from "drizzle-orm";
import { z } from "zod";
import type { AuthContext, ClientInfo } from "../context.ts";
import type { AppDeps } from "../deps.ts";
import { AppError } from "../errors.ts";
import { VERSION } from "../version.ts";
import {
  appliedMigrationCount,
  getSystemSetting,
  lastBackupRuns,
  type SchemaVersion,
  SYSTEM_KEYS,
} from "./settings.ts";

const backupRun = z.object({
  id: z.string(),
  trigger: z.enum(["manual", "scheduled", "pre_migrate"]),
  status: z.enum(["running", "succeeded", "failed"]),
  startedAt: z.string(),
  finishedAt: z.string().nullable(),
  fileName: z.string().nullable(),
  sizeBytes: z.number().int().nullable(),
  encrypted: z.boolean(),
  includesKey: z.boolean(),
  error: z.string().nullable(),
});

export const systemStatusSchema = z.object({
  version: z.string(),
  time: z.string(),
  publicUrl: z.string().nullable(),
  secureCookies: z.boolean().nullable(),
  database: z.object({
    status: z.enum(["ok", "unreachable"]),
    driver: z.enum(["postgres", "pglite"]).nullable(),
    serverVersion: z.string().nullable(),
  }),
  schema: z.object({
    tag: z.string().nullable(),
    migratedByVersion: z.string().nullable(),
    migratedAt: z.string().nullable(),
    appliedMigrations: z.number().int().nullable(),
    bundledMigrations: z.number().int().nullable(),
  }),
  backups: z.object({
    last: backupRun.nullable(),
    lastSuccessful: backupRun.nullable(),
    encrypted: z.boolean().nullable(),
    schedule: z.string().nullable(),
    keep: z.number().int().nullable(),
    beforeMigrate: z.boolean().nullable(),
    directory: z.string().nullable(),
    /** True when the last successful backup is older than 48 hours, or there is none. */
    stale: z.boolean(),
  }),
  disk: z.array(z.object({ label: z.string(), path: z.string(), freeBytes: z.number(), totalBytes: z.number() })),
  request: z.object({
    clientIp: z.string().nullable(),
    peerIp: z.string().nullable(),
    scheme: z.enum(["http", "https"]),
    host: z.string().nullable(),
    viaTrustedProxy: z.boolean(),
  }),
  trustedProxies: z.array(z.string()).nullable(),
});

export type SystemStatus = z.output<typeof systemStatusSchema>;

/** Hours after which Home warns owners that backups are stale (spec "Backup and restore"). */
export const BACKUP_STALE_HOURS = 48;

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

/** Owner-only: everything the Settings → System page shows. Read-only. */
export async function getSystemStatus(deps: AppDeps, auth: AuthContext, client: ClientInfo): Promise<SystemStatus> {
  if (!auth.roles.includes("owner")) {
    throw new AppError("forbidden", "Only owners can see system status. Ask an owner if you need it.");
  }
  const now = deps.clock.now();
  const host = deps.systemHost ? await deps.systemHost.describe() : null;

  let dbStatus: "ok" | "unreachable" = "ok";
  let serverVersion: string | null = null;
  try {
    const result = await deps.db.execute<{ v: string }>(sql`select current_setting('server_version') as v`);
    const rows = (result as unknown as { rows?: { v: string }[] }).rows ?? (result as unknown as { v: string }[]);
    serverVersion = rows[0]?.v ?? null;
  } catch {
    dbStatus = "unreachable";
  }

  const [schemaVersion, runs, applied] =
    dbStatus === "ok"
      ? await Promise.all([
          getSystemSetting<SchemaVersion>(deps.db, SYSTEM_KEYS.schemaVersion),
          lastBackupRuns(deps.db),
          appliedMigrationCount(deps.db),
        ])
      : [null, { last: null, lastSuccessful: null }, null];

  const toRun = (r: (typeof runs)["last"]) =>
    r && {
      id: r.id,
      trigger: r.trigger,
      status: r.status,
      startedAt: r.startedAt.toISOString(),
      finishedAt: iso(r.finishedAt),
      fileName: r.fileName,
      sizeBytes: r.sizeBytes,
      encrypted: r.encrypted,
      includesKey: r.includesKey,
      error: r.error,
    };
  const lastOk = runs.lastSuccessful;
  const stale = !lastOk || now.getTime() - lastOk.startedAt.getTime() > BACKUP_STALE_HOURS * 3600_000;

  return {
    version: VERSION,
    time: now.toISOString(),
    publicUrl: host?.publicUrl ?? null,
    secureCookies: host?.secureCookies ?? null,
    database: { status: dbStatus, driver: host?.database.driver ?? null, serverVersion },
    schema: {
      tag: schemaVersion?.tag ?? null,
      migratedByVersion: schemaVersion?.appVersion ?? null,
      migratedAt: schemaVersion?.migratedAt ?? null,
      appliedMigrations: applied,
      bundledMigrations: host?.migrations.bundled ?? null,
    },
    backups: {
      last: toRun(runs.last),
      lastSuccessful: toRun(lastOk),
      encrypted: host?.backups.encrypted ?? null,
      schedule: host?.backups.schedule ?? null,
      keep: host?.backups.keep ?? null,
      beforeMigrate: host?.backups.beforeMigrate ?? null,
      directory: host?.backups.directory ?? null,
      stale,
    },
    disk: host ? [...host.disk] : [],
    request: {
      clientIp: client.ip,
      peerIp: client.peerIp,
      scheme: client.scheme,
      host: client.host,
      viaTrustedProxy: client.viaTrustedProxy,
    },
    trustedProxies: host ? [...host.trustedProxies] : null,
  };
}
