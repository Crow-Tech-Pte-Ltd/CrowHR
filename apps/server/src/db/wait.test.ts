import { createMemoryLogger } from "@crowhr/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StartupError } from "../startup-error.ts";
import { waitForDatabase } from "./wait.ts";

describe("waitForDatabase", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const refused = () => Object.assign(new Error("connect ECONNREFUSED 172.18.0.2:5432"), { code: "ECONNREFUSED" });

  it("retries for 60 s with progress logs every 5 s, then exits with the docker compose ps hint", async () => {
    const logger = createMemoryLogger();
    const probe = vi.fn(async () => {
      throw refused();
    });
    const done = waitForDatabase(probe, { timeoutSeconds: 60, logger }).catch((e) => e);
    await vi.advanceTimersByTimeAsync(61_000);
    const err = await done;
    expect(err).toBeInstanceOf(StartupError);
    expect(err.exitCode).toBe(69);
    expect(err.message).toMatch(/^Cannot reach the database after 60 s: connect ECONNREFUSED 172\.18\.0\.2:5432/);
    expect(err.message).toContain("docker compose ps");
    const waits = logger.entries.filter((e) => e.message === "waiting for database");
    expect(waits.length).toBeGreaterThanOrEqual(11);
    expect(waits.length).toBeLessThanOrEqual(12);
    expect(waits[0]).toMatchObject({ waitedSeconds: 5 });
    expect(probe.mock.calls.length).toBeGreaterThanOrEqual(60);
  });

  it("returns as soon as the database answers", async () => {
    const logger = createMemoryLogger();
    let calls = 0;
    const probe = async () => {
      calls += 1;
      if (calls < 4) throw refused();
    };
    const done = waitForDatabase(probe, { timeoutSeconds: 60, logger });
    await vi.advanceTimersByTimeAsync(3_000);
    await expect(done).resolves.toBeUndefined();
    expect(logger.entries.at(-1)).toMatchObject({ message: "Database is reachable", attempts: 4 });
  });

  it("does not wait at all when the first probe works", async () => {
    const logger = createMemoryLogger();
    await waitForDatabase(async () => undefined, { timeoutSeconds: 60, logger });
    expect(logger.entries).toEqual([]);
  });
});
