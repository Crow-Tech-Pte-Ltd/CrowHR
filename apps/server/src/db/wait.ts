import type { Logger } from "@crowhr/core";
import { EX_UNAVAILABLE, StartupError } from "../startup-error.ts";

export interface WaitOptions {
  timeoutSeconds: number;
  logger: Logger;
  /** Between attempts. */
  intervalMs?: number;
  /** How often to log "waiting for database". */
  logEveryMs?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Retries `probe` until the database answers (spec "Startup configuration errors"): up to
 * `timeoutSeconds` (default 60), logging "waiting for database" every 5 s, then exits with
 * the connection error and a hint to check `docker compose ps`.
 */
export async function waitForDatabase(probe: () => Promise<unknown>, options: WaitOptions): Promise<void> {
  const { logger, timeoutSeconds } = options;
  const intervalMs = options.intervalMs ?? 1000;
  const logEveryMs = options.logEveryMs ?? 5000;
  const sleep = options.sleep ?? defaultSleep;
  const now = options.now ?? Date.now;
  const start = now();
  let lastLog = start;
  let attempts = 0;
  for (;;) {
    attempts += 1;
    try {
      await probe();
      if (attempts > 1)
        logger.info("Database is reachable", { attempts, waitedSeconds: Math.round((now() - start) / 1000) });
      return;
    } catch (err) {
      const elapsed = now() - start;
      const reason = describeDbError(err);
      if (elapsed >= timeoutSeconds * 1000) {
        throw new StartupError(
          [
            `Cannot reach the database after ${timeoutSeconds} s: ${reason}`,
            "Check that the database container is running and healthy: docker compose ps",
            "and look at its log: docker compose logs db",
            "If you set DATABASE_URL yourself, check the host, port, user and password in .env.",
          ].join("\n"),
          EX_UNAVAILABLE,
        );
      }
      if (now() - lastLog >= logEveryMs) {
        lastLog = now();
        logger.info("waiting for database", { waitedSeconds: Math.round(elapsed / 1000), error: reason });
      }
      await sleep(intervalMs);
    }
  }
}

export function describeDbError(err: unknown): string {
  if (err instanceof AggregateError && err.errors.length) return describeDbError(err.errors[0]);
  if (err instanceof Error) {
    const code = (err as { code?: string }).code;
    return code && !err.message.includes(code) ? `${err.message} (${code})` : err.message || String(code);
  }
  return String(err);
}
