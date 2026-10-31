import { spawnSync } from "node:child_process";
import { isSetupRequired, lastBackupRuns, schema, VERSION } from "@crowhr/core";
import { migrationsFolder } from "@crowhr/core/migrations-folder";
import { sql } from "drizzle-orm";
import { ConfigError, loadConfig, type ServerConfig } from "../config.ts";
import { describeDbError } from "../db/wait.ts";
import { type Database, openDatabase } from "../db.ts";
import { planMigrations, readBundledMigrations } from "../migrate/runner.ts";
import { readObservation } from "../proxy/client.ts";
import { readExistingKey } from "../secrets/existing.ts";
import { keyMatchesDatabase } from "../secrets/key.ts";
import { diskUsage } from "../system/host.ts";
import type { CliIo } from "./main.ts";

type Level = "ok" | "warn" | "fail" | "info";

export interface Check {
  level: Level;
  title: string;
  detail?: string;
}

const LABEL: Record<Level, string> = { ok: "OK  ", warn: "WARN", fail: "FAIL", info: "INFO" };

/** Thresholds for the disk check. */
const MIN_FREE_BYTES = 1024 ** 3;
const MIN_FREE_RATIO = 0.1;
const MAX_CLOCK_SKEW_MS = 30_000;

/**
 * `crowhr doctor`: one screen that tells a non-specialist what is wrong and what to run.
 * Exit 0 when nothing failed (warnings allowed), 1 otherwise.
 */
export async function runDoctor(
  env: Record<string, string | undefined>,
  io: CliIo,
  fetchImpl: typeof fetch = fetch,
): Promise<number> {
  const checks = await collectChecks(env, fetchImpl);
  io.out(`Crow HR ${VERSION} doctor\n`);
  for (const c of checks) {
    io.out(`${LABEL[c.level]}  ${c.title}`);
    if (c.detail) for (const line of c.detail.split("\n")) io.out(`      ${line}`);
  }
  const failed = checks.filter((c) => c.level === "fail").length;
  const warned = checks.filter((c) => c.level === "warn").length;
  io.out(
    `\n${failed ? `${failed} problem(s) need fixing` : "No problems found"}${warned ? `, ${warned} warning(s)` : ""}.`,
  );
  return failed ? 1 : 0;
}

export async function collectChecks(
  env: Record<string, string | undefined>,
  fetchImpl: typeof fetch,
): Promise<Check[]> {
  const checks: Check[] = [];
  let config: ServerConfig;
  try {
    config = loadConfig(env);
    checks.push({ level: "ok", title: "Configuration is valid", detail: `PUBLIC_URL=${config.PUBLIC_URL}` });
  } catch (err) {
    if (err instanceof ConfigError) {
      checks.push({ level: "fail", title: "Configuration has problems", detail: err.problems.join("\n") });
      return checks;
    }
    throw err;
  }

  let database: Database | null = null;
  try {
    database = await openDatabase(config.DATABASE_URL);
    await Promise.race([
      database.probe(),
      new Promise((_, reject) => setTimeout(() => reject(new Error("timed out after 5 s")), 5000)),
    ]);
    checks.push(...(await databaseChecks(config, database)));
  } catch (err) {
    checks.push({
      level: "fail",
      title: "Cannot reach the database",
      detail: `${describeDbError(err)}\nCheck: docker compose ps   and   docker compose logs db`,
    });
  } finally {
    await database?.close().catch(() => undefined);
  }

  checks.push(...(await diskChecks(config)));
  checks.push(...(await proxyChecks(config, fetchImpl)));
  checks.push(toolCheck());
  return checks;
}

async function databaseChecks(config: ServerConfig, database: Database): Promise<Check[]> {
  const out: Check[] = [];
  const rows = (r: unknown) => ((r as { rows?: Record<string, unknown>[] }).rows ?? r) as Record<string, unknown>[];
  const info =
    rows(await database.db.execute(sql`select current_setting('server_version') as v, now() as now`))[0] ?? {};
  const version = String(info.v ?? "unknown");
  const major = Number.parseInt(version, 10);
  out.push({
    level: database.driver === "postgres" && major > 17 ? "warn" : "ok",
    title: `Database reachable (${database.driver === "postgres" ? "PostgreSQL" : "PGlite"} ${version})`,
    ...(database.driver === "postgres" && major > 17
      ? {
          detail:
            "The bundled pg_dump is version 17 and cannot back up a newer server. Use the postgres:17-alpine image.",
        }
      : {}),
  });

  const dbNow = info.now instanceof Date ? info.now : new Date(String(info.now));
  const skew = Math.abs(dbNow.getTime() - Date.now());
  out.push(
    skew > MAX_CLOCK_SKEW_MS
      ? {
          level: "warn",
          title: `Clock skew of ${Math.round(skew / 1000)} s between the app and the database`,
          detail:
            "Time-based sign-in codes and payroll cut-offs need correct clocks. Enable NTP on the Docker host (timedatectl set-ntp true).",
        }
      : { level: "ok", title: `Clocks agree (app vs database within ${Math.round(skew / 1000)} s)` },
  );

  const plan = await planMigrations(database.db, readBundledMigrations(migrationsFolder));
  if (plan.unknown.length) {
    out.push({
      level: "fail",
      title: "The database schema is newer than this image",
      detail: "Run the newer Crow HR version (image tag in docker-compose.yml).",
    });
  } else if (plan.pending.length) {
    out.push({
      level: "warn",
      title: `${plan.pending.length} database migration(s) pending`,
      detail: `${plan.pending.map((m) => m.tag).join(", ")}\nThey apply on the next start, or run: docker compose exec app crowhr migrate`,
    });
  } else {
    out.push({ level: "ok", title: `Database schema up to date (${plan.appliedCount} migrations)` });
  }

  const key = await readExistingKey(config);
  const matches = key ? await keyMatchesDatabase(database.db, key).catch(() => null) : null;
  const hasCheck =
    (
      await database.db
        .select()
        .from(schema.secretKeyChecks)
        .limit(1)
        .catch(() => [])
    ).length > 0;
  if (!key) {
    out.push(
      hasCheck
        ? {
            level: "fail",
            title: "Encryption key missing",
            detail: "Restore it: docker compose run --rm app crowhr restore --secrets-only /backups/<file>",
          }
        : { level: "info", title: "No encryption key yet: it is generated on first start" },
    );
  } else if (matches === false) {
    out.push({
      level: "fail",
      title: "Encryption key does not match this database",
      detail: "Restore the key from your backup (crowhr restore --secrets-only <file>).",
    });
  } else {
    out.push({
      level: "ok",
      title: `Encryption key present (${config.CROWHR_SECRET_KEY ? "CROWHR_SECRET_KEY" : config.SECRET_KEY_FILE})`,
    });
  }

  if (await isSetupRequired(database.db).catch(() => false)) {
    out.push({
      level: "info",
      title: "Setup not finished",
      detail: `Open ${config.PUBLIC_URL}/setup. New code: docker compose exec app crowhr setup-code`,
    });
  }

  const runs = await lastBackupRuns(database.db).catch(() => ({ last: null, lastSuccessful: null }));
  const ok = runs.lastSuccessful;
  const ageH = ok ? (Date.now() - ok.startedAt.getTime()) / 3600_000 : null;
  if (database.driver !== "postgres") {
    out.push({ level: "info", title: "Backups are off (PGlite development database)" });
  } else if (!ok) {
    out.push({
      level: "warn",
      title: "No successful backup yet",
      detail: "Run one now: docker compose exec app crowhr backup",
    });
  } else {
    out.push({
      level: ageH !== null && ageH > 48 ? "warn" : "ok",
      title: `Last successful backup ${Math.round(ageH ?? 0)} h ago (${ok.fileName})`,
      ...(runs.last && runs.last.status === "failed"
        ? { detail: `The latest attempt failed: ${runs.last.error}` }
        : {}),
    });
  }
  if (database.driver === "postgres") {
    out.push(
      config.BACKUP_PASSPHRASE
        ? { level: "ok", title: "Backups are encrypted (BACKUP_PASSPHRASE is set)" }
        : {
            level: "warn",
            title: "Backups are not encrypted",
            detail:
              "They include your encryption key. Set BACKUP_PASSPHRASE in .env and keep the passphrase somewhere safe.",
          },
    );
  }
  return out;
}

async function diskChecks(config: ServerConfig): Promise<Check[]> {
  const out: Check[] = [];
  for (const [label, path] of [
    ["Data volume", config.DATA_DIR],
    ["Backups volume", config.BACKUP_DIR],
  ] as const) {
    const d = await diskUsage(label, path);
    if (!d) {
      out.push({ level: "warn", title: `${label}: cannot read ${path}` });
      continue;
    }
    const gb = (n: number) => `${(n / 1024 ** 3).toFixed(1)} GB`;
    const low = d.freeBytes < MIN_FREE_BYTES || d.freeBytes / d.totalBytes < MIN_FREE_RATIO;
    out.push({
      level: low ? "warn" : "ok",
      title: `${label} ${path}: ${gb(d.freeBytes)} free of ${gb(d.totalBytes)}`,
      ...(low ? { detail: "Free some space: old backups in /backups, docker image prune, or a bigger disk." } : {}),
    });
  }
  return out;
}

async function proxyChecks(config: ServerConfig, fetchImpl: typeof fetch): Promise<Check[]> {
  const out: Check[] = [];
  try {
    const res = await fetchImpl(`${config.PUBLIC_URL}/api/health`, {
      signal: AbortSignal.timeout(5000),
      redirect: "manual",
    });
    out.push({
      level: res.status === 200 ? "ok" : "warn",
      title: `${config.PUBLIC_URL}/api/health answered ${res.status} from inside the container`,
    });
  } catch (err) {
    out.push({
      level: "info",
      title: `Could not open ${config.PUBLIC_URL} from inside the container`,
      detail: `${(err as Error).message}. Normal when the proxy or DNS is only reachable from outside; check from your browser instead.`,
    });
  }
  const seen = readObservation(config.DATA_DIR);
  out.push({
    level: "info",
    title: `Trusted proxies: ${config.TRUSTED_PROXIES.entries.length ? config.TRUSTED_PROXIES.entries.join(", ") : "none (forwarded headers are ignored)"}`,
  });
  if (!seen) {
    out.push({
      level: "info",
      title: "No browser request seen yet; open the site and run crowhr doctor again to check proxy headers",
    });
    return out;
  }
  const detail = [
    `at ${seen.at}: from ${seen.peerIp ?? "?"}, client ${seen.clientIp ?? "?"}, scheme ${seen.scheme}, host ${seen.host ?? "?"}`,
    `X-Forwarded-For: ${seen.forwardedFor ?? "(none)"}   X-Forwarded-Proto: ${seen.forwardedProto ?? "(none)"}`,
  ].join("\n");
  if (seen.ignoredForwardedHeaders) {
    out.push({
      level: "warn",
      title: `The last request came through a proxy at ${seen.peerIp} that is not trusted`,
      detail: `${detail}\nIf ${seen.peerIp} is your reverse proxy, set TRUSTED_PROXIES=${seen.peerIp} (or TRUSTED_PROXIES=private) in .env and run docker compose up -d.`,
    });
  } else if (seen.viaTrustedProxy && config.PUBLIC_URL.startsWith("https://") && seen.scheme !== "https") {
    out.push({
      level: "warn",
      title: "The trusted proxy does not send X-Forwarded-Proto: https",
      detail: `${detail}\nPUBLIC_URL is https, so cookies stay Secure either way, but configure the proxy to send X-Forwarded-Proto so client details are accurate.`,
    });
  } else {
    out.push({ level: "ok", title: "Last request as seen by the app", detail });
  }
  return out;
}

function toolCheck(): Check {
  const r = spawnSync("pg_dump", ["--version"], { encoding: "utf8" });
  if (r.error) return { level: "warn", title: "pg_dump not found: backups will fail outside the Docker image" };
  return { level: "ok", title: r.stdout.trim() };
}
