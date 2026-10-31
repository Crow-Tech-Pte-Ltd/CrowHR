import type { AppDeps, Scheduler, TickReport } from "@crowhr/core";
import { tick as coreTick } from "@crowhr/core";

/**
 * Drives core's `tick(now)` in-process (workflows "Scheduled sweep"): once on start, then every
 * 60 s. No queue, no extra service. A tick never overlaps the previous one; with several
 * replicas each runs its own scheduler and core's row locks keep the work exactly-once.
 */
export interface IntervalSchedulerOptions {
  deps: AppDeps;
  intervalMs?: number;
  /** Injected for tests (fake timers). */
  tick?: (deps: AppDeps, now: Date) => Promise<TickReport>;
  /** Host-only jobs run on the same beat after the core sweep (e.g. the nightly backup check). */
  jobs?: readonly { name: string; run: () => Promise<unknown> }[];
  /** True while maintenance (a restore) is running: beats are skipped. */
  isPaused?: () => boolean;
  timers?: {
    setInterval: (fn: () => void, ms: number) => unknown;
    clearInterval: (handle: unknown) => void;
  };
}

export function createIntervalScheduler(options: IntervalSchedulerOptions): Scheduler & { readonly ticks: number } {
  const { deps } = options;
  const intervalMs = options.intervalMs ?? 60_000;
  const run = options.tick ?? coreTick;
  const timers = options.timers ?? {
    setInterval: (fn: () => void, ms: number) => {
      const handle = setInterval(fn, ms);
      handle.unref?.();
      return handle;
    },
    clearInterval: (h: unknown) => clearInterval(h as ReturnType<typeof setInterval>),
  };
  let handle: unknown = null;
  let inFlight: Promise<void> | null = null;
  let ticks = 0;

  const once = () => {
    if (inFlight) return; // still running: skip this beat
    if (options.isPaused?.()) return;
    inFlight = (async () => {
      try {
        const report = await run(deps, deps.clock.now());
        if (report.errors.length) deps.logger.warn("Scheduled sweep finished with errors", { errors: report.errors });
      } catch (err) {
        deps.logger.error("Scheduled sweep failed", { error: err instanceof Error ? err.message : String(err) });
      }
      for (const job of options.jobs ?? []) {
        try {
          await job.run();
        } catch (err) {
          deps.logger.error("Scheduled job failed", {
            job: job.name,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
      ticks++;
      inFlight = null;
    })();
  };

  return {
    get ticks() {
      return ticks;
    },
    start() {
      if (handle) return;
      once();
      handle = timers.setInterval(once, intervalMs);
    },
    async stop() {
      if (handle) timers.clearInterval(handle);
      handle = null;
      await inFlight;
    },
  };
}
