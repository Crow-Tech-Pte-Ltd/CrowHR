import { type AppDeps, fixedClock, noopLogger, type TickReport } from "@crowhr/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createIntervalScheduler } from "./scheduler.ts";

const report = (): TickReport => ({
  at: new Date().toISOString(),
  escalations: 0,
  delegations: { added: 0, closed: 0 },
  reminders: 0,
  emails: { sent: 0, retried: 0, failed: 0, suppressed: 0 },
  notificationsDeleted: 0,
  transitions: {},
  demoCompanies: { purged: 0, seeded: 0 },
  errors: [],
});

describe("interval scheduler", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const deps = { clock: fixedClock("2026-10-31T01:00:00Z"), logger: noopLogger } as unknown as AppDeps;

  it("ticks on start and every 60 seconds, and stops on shutdown", async () => {
    const tick = vi.fn(async () => report());
    const scheduler = createIntervalScheduler({ deps, tick });
    scheduler.start();
    expect(tick).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(59_999);
    expect(tick).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(tick).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(tick).toHaveBeenCalledTimes(4);
    await scheduler.stop();
    await vi.advanceTimersByTimeAsync(600_000);
    expect(tick).toHaveBeenCalledTimes(4);
  });

  it("never overlaps a slow tick, and stop() waits for it", async () => {
    let release: () => void = () => undefined;
    const tick = vi.fn(
      () =>
        new Promise<TickReport>((resolve) => {
          release = () => resolve(report());
        }),
    );
    const scheduler = createIntervalScheduler({ deps, tick, intervalMs: 1_000 });
    scheduler.start();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(tick).toHaveBeenCalledTimes(1);
    const stopped = scheduler.stop();
    release();
    await stopped;
    expect(scheduler.ticks).toBe(1);
  });

  it("keeps going after a failing tick", async () => {
    const tick = vi.fn().mockRejectedValueOnce(new Error("db down")).mockResolvedValue(report());
    const scheduler = createIntervalScheduler({ deps, tick });
    scheduler.start();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(tick).toHaveBeenCalledTimes(2);
    await scheduler.stop();
  });
});
