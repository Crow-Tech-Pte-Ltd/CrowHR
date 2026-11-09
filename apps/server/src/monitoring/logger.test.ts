import { setImmediate as tick } from "node:timers/promises";
import { createMemoryLogger } from "@crowhr/core";
import { describe, expect, it, vi } from "vitest";
import { toAttributes, withMonitoring } from "./logger.ts";
import type { Monitoring } from "./sentry.ts";

function fakeMonitoring() {
  return {
    captureException: vi.fn(),
    captureMessage: vi.fn(),
    tagRequest: vi.fn(),
    log: vi.fn(),
    flush: vi.fn(async () => true),
  } satisfies Monitoring;
}

describe("logger to monitoring", () => {
  it("keeps console logging unchanged and forwards entries as logs", () => {
    const inner = createMemoryLogger();
    const monitoring = fakeMonitoring();
    const logger = withMonitoring(inner, monitoring, { logs: true, minLevel: "info" });
    logger.child({ requestId: "r1" }).info("Backup written", { bytes: 10 });
    expect(inner.entries).toMatchObject([{ level: "info", message: "Backup written", requestId: "r1", bytes: 10 }]);
    expect(monitoring.log).toHaveBeenCalledWith("info", "Backup written", { requestId: "r1", bytes: 10 });
    expect(monitoring.captureException).not.toHaveBeenCalled();
    expect(monitoring.captureMessage).not.toHaveBeenCalled();
  });

  it("turns error entries into issues: the Error when there is one, else the message", async () => {
    const monitoring = fakeMonitoring();
    const logger = withMonitoring(createMemoryLogger(), monitoring, { logs: false, minLevel: "info" });
    const err = new Error("connection reset");
    logger.child({ requestId: "r2" }).error("Unhandled error", { err, path: "/api/v1/payroll", method: "POST" });
    expect(monitoring.tagRequest).toHaveBeenCalledWith("r2");
    // One tick later, so the framework integration can report a request's error first.
    expect(monitoring.captureException).not.toHaveBeenCalled();
    await tick();
    expect(monitoring.captureException).toHaveBeenCalledWith(err, {
      message: "Unhandled error",
      requestId: "r2",
      path: "/api/v1/payroll",
      method: "POST",
    });
    logger.error("Scheduled backup failed", { error: "disk full" });
    expect(monitoring.captureMessage).toHaveBeenCalledWith("Scheduled backup failed", { error: "disk full" });
    expect(monitoring.log).not.toHaveBeenCalled();
  });

  it("respects LOG_LEVEL and warn entries never become issues", async () => {
    const monitoring = fakeMonitoring();
    const logger = withMonitoring(createMemoryLogger(), monitoring, { logs: true, minLevel: "warn" });
    logger.debug("noise");
    logger.info("noise");
    logger.warn("Password reset email failed", { err: new Error("SMTP down") });
    expect(monitoring.log).toHaveBeenCalledTimes(1);
    expect(monitoring.log).toHaveBeenCalledWith("warn", "Password reset email failed", { err: "Error: SMTP down" });
    await tick();
    expect(monitoring.captureException).not.toHaveBeenCalled();
  });

  it("never lets a monitoring failure break logging", () => {
    const inner = createMemoryLogger();
    const monitoring = fakeMonitoring();
    monitoring.log.mockImplementation(() => {
      throw new Error("SDK broke");
    });
    const logger = withMonitoring(inner, monitoring, { logs: true, minLevel: "info" });
    expect(() => logger.error("Something failed")).not.toThrow();
    expect(inner.entries).toHaveLength(1);
  });

  it("flattens fields into log attributes", () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(
      toAttributes({
        s: "x",
        n: 1,
        b: false,
        none: undefined,
        nil: null,
        at: new Date("2026-11-09T00:00:00.000Z"),
        list: ["a", 1],
        circular,
        long: "y".repeat(3000),
      }),
    ).toEqual({
      s: "x",
      n: 1,
      b: false,
      at: "2026-11-09T00:00:00.000Z",
      list: '["a",1]',
      circular: "[unserialisable]",
      long: `${"y".repeat(2000)}…`,
    });
  });
});
