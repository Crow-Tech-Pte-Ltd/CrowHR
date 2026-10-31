import type { AppDeps } from "../deps.ts";
import { type TickReport, tick } from "./tick.ts";

/**
 * How a host drives `tick`. Core has no timers (it runs in the browser demo too): the server
 * implements this with `setInterval` (apps/server/src/scheduler.ts); tests and the demo use the
 * manual scheduler and call `tick()` themselves (the demo from its own interval).
 */
export interface Scheduler {
  start(): void;
  stop(): Promise<void>;
}

export interface ManualScheduler extends Scheduler {
  /** Runs one sweep now (or at `at`). Overlapping calls wait for the running one, then run again. */
  tick(at?: Date): Promise<TickReport>;
  readonly running: boolean;
}

export function createManualScheduler(deps: AppDeps): ManualScheduler {
  let chain: Promise<unknown> = Promise.resolve();
  let started = false;
  return {
    start() {
      started = true;
    },
    async stop() {
      started = false;
      await chain.catch(() => undefined);
    },
    get running() {
      return started;
    },
    tick(at) {
      const next = chain.then(() => tick(deps, at ?? deps.clock.now()));
      chain = next.catch(() => undefined);
      return next;
    },
  };
}
