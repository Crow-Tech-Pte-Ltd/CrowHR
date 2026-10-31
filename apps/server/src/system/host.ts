import { statfs } from "node:fs/promises";
import type { DiskUsage, SystemHost } from "@crowhr/core";
import { migrationsFolder } from "@crowhr/core/migrations-folder";
import type { ServerConfig } from "../config.ts";
import { readBundledMigrations } from "../migrate/runner.ts";

export async function diskUsage(label: string, path: string): Promise<DiskUsage | null> {
  try {
    const s = await statfs(path);
    return { label, path, freeBytes: s.bavail * s.bsize, totalBytes: s.blocks * s.bsize };
  } catch {
    return null;
  }
}

/** Host facts for Settings → System (`GET /api/v1/system/status`). */
export function createSystemHost(config: ServerConfig, driver: "postgres" | "pglite"): SystemHost {
  const bundled = readBundledMigrations(migrationsFolder);
  const pad = (n: number) => String(n).padStart(2, "0");
  return {
    async describe() {
      const disks = await Promise.all([
        diskUsage("Data (uploaded files, key)", config.DATA_DIR),
        diskUsage("Backups", config.BACKUP_DIR),
      ]);
      return {
        publicUrl: config.PUBLIC_URL,
        secureCookies: config.secureCookies,
        trustedProxies: config.TRUSTED_PROXIES.entries,
        database: { driver },
        backups: {
          directory: config.BACKUP_DIR,
          encrypted: config.BACKUP_PASSPHRASE !== null,
          schedule: config.BACKUP_TIME
            ? `${pad(config.BACKUP_TIME.hour)}:${pad(config.BACKUP_TIME.minute)} ${config.BACKUP_TIMEZONE}`
            : null,
          keep: config.BACKUP_KEEP,
          beforeMigrate: config.BACKUP_BEFORE_MIGRATE,
        },
        disk: disks.filter((d): d is DiskUsage => d !== null),
        migrations: { bundled: bundled.length, latestBundledTag: bundled.at(-1)?.tag ?? null },
      };
    },
  };
}
