import { readFileSync, statSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

/**
 * Maintenance flag shared by the CLI and the server through the data volume (the restore
 * runs as `docker compose exec app crowhr restore`, a separate process). While it is set the
 * server answers 503 and background jobs pause. A file, not a database row, because the
 * restore replaces the database itself.
 */
export type MaintenanceState = "restoring" | "restored";

export interface MaintenanceInfo {
  state: MaintenanceState;
  since: string;
}

export function maintenanceFile(dataDir: string): string {
  return join(dataDir, "maintenance.json");
}

export async function setMaintenance(dataDir: string, state: MaintenanceState, now = new Date()): Promise<void> {
  const file = maintenanceFile(dataDir);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify({ state, since: now.toISOString() } satisfies MaintenanceInfo));
}

export async function clearMaintenance(dataDir: string): Promise<void> {
  await rm(maintenanceFile(dataDir), { force: true });
}

/** Reads the flag at most once per `ttlMs` (it is checked on every request). */
export function createMaintenanceProbe(dataDir: string, ttlMs = 1000, now: () => number = Date.now) {
  const file = maintenanceFile(dataDir);
  let checkedAt = -Infinity;
  let cached: MaintenanceInfo | null = null;
  return (): MaintenanceInfo | null => {
    if (now() - checkedAt < ttlMs) return cached;
    checkedAt = now();
    try {
      statSync(file);
      cached = JSON.parse(readFileSync(file, "utf8")) as MaintenanceInfo;
    } catch {
      cached = null;
    }
    return cached;
  };
}

export function maintenanceMessage(info: MaintenanceInfo): string {
  return info.state === "restoring"
    ? "Crow HR is restoring a backup. This usually takes a minute; reload the page shortly."
    : "A backup was restored. The app is restarting; reload in a few seconds. If this stays, run: docker compose restart app";
}
