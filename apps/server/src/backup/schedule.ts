import type { Logger } from "@crowhr/core";

/**
 * Nightly backup (spec "Backup and restore"): daily at BACKUP_TIME in BACKUP_TIMEZONE
 * (default 02:00 Asia/Singapore), one attempt per local day, newest BACKUP_KEEP kept.
 *
 * Runs in-process on a one-minute timer. When the workflows `tick` (add-approvals-and-
 * notifications) lands, `tick()` below becomes one of its sweeps; the logic stays the same.
 * A server that was down at 02:00 catches up on its next tick that day.
 */

export interface LocalTime {
  /** YYYY-MM-DD in the time zone. */
  date: string;
  /** Minutes since local midnight. */
  minutes: number;
}

export function localTime(at: Date, timeZone: string): LocalTime {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(at)
      .map((p) => [p.type, p.value]),
  );
  return { date: `${parts.year}-${parts.month}-${parts.day}`, minutes: Number(parts.hour) * 60 + Number(parts.minute) };
}

/** Due when today's local time has reached the target and no scheduled backup started today. */
export function backupDue(
  now: Date,
  lastScheduledStart: Date | null,
  time: { hour: number; minute: number },
  timeZone: string,
): boolean {
  const today = localTime(now, timeZone);
  if (today.minutes < time.hour * 60 + time.minute) return false;
  return !lastScheduledStart || localTime(lastScheduledStart, timeZone).date !== today.date;
}

export type TickResult = "ran" | "failed" | "not_due" | "paused" | "busy" | "nothing_to_back_up";

export interface SchedulerOptions {
  time: { hour: number; minute: number };
  timeZone: string;
  now: () => Date;
  /** Start time of the most recent scheduled backup attempt (backup_runs). */
  lastScheduledStart: () => Promise<Date | null>;
  /** Runs one scheduled backup, records it, and applies retention. */
  run: () => Promise<void>;
  /** True during maintenance (restore): jobs pause. */
  isPaused: () => boolean;
  /** False until setup has created an organisation: an empty install has nothing to back up. */
  hasData?: () => Promise<boolean>;
  /** Cross-instance guard (advisory lock); null = another instance is backing up. */
  tryLock?: () => Promise<(() => Promise<void>) | null>;
  logger: Logger;
}

export function createBackupScheduler(options: SchedulerOptions) {
  let running = false;
  let timer: ReturnType<typeof setInterval> | null = null;

  async function tick(): Promise<TickResult> {
    if (running) return "busy";
    if (options.isPaused()) return "paused";
    running = true;
    let release: (() => Promise<void>) | null = null;
    try {
      const last = await options.lastScheduledStart();
      if (!backupDue(options.now(), last, options.time, options.timeZone)) return "not_due";
      if (options.hasData && !(await options.hasData())) return "nothing_to_back_up";
      if (options.tryLock) {
        release = await options.tryLock();
        if (!release) return "busy";
        // Re-check under the lock: another instance may have just finished.
        if (!backupDue(options.now(), await options.lastScheduledStart(), options.time, options.timeZone))
          return "not_due";
      }
      try {
        await options.run();
        return "ran";
      } catch (err) {
        // Recorded in backup_runs by run(); Settings → System and Home show it. Next try: tomorrow.
        options.logger.error("Scheduled backup failed", { error: err instanceof Error ? err.message : String(err) });
        return "failed";
      }
    } catch (err) {
      options.logger.warn("Backup scheduler check failed", { error: err instanceof Error ? err.message : String(err) });
      return "failed";
    } finally {
      if (release) await release().catch(() => undefined);
      running = false;
    }
  }

  return {
    tick,
    start(intervalMs = 60_000) {
      timer = setInterval(() => void tick(), intervalMs);
      timer.unref?.();
      void tick();
    },
    async stop() {
      if (timer) clearInterval(timer);
      timer = null;
      // Let an in-flight backup finish so no half-written archive is left behind.
      while (running) await new Promise((r) => setTimeout(r, 100));
    },
  };
}
