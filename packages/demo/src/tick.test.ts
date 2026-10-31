import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CORE_MIGRATIONS } from "./bundled-migrations.ts";
import { type DemoRuntime, openDemo } from "./runtime.ts";

/**
 * workflows task 5.4: the demo drives core's scheduled sweep itself (the page calls the worker's
 * `tick` every 30 s and on navigation), and email that the sweep sends lands in the Demo outbox.
 */
describe("demo scheduler tick", () => {
  let pglite: PGlite;
  let demo: DemoRuntime;
  let realNow = Date.parse("2026-10-31T02:00:00Z");

  beforeAll(async () => {
    pglite = new PGlite();
    demo = await openDemo({
      pglite,
      origin: "https://hr.crow.sg",
      dataVersion: "tick",
      migrations: CORE_MIGRATIONS,
      realNow: () => realNow,
    });
  });
  afterAll(async () => {
    await demo?.stop();
    await pglite?.close();
  });

  it("runs the sweep on the demo clock and delivers its email to the outbox", async () => {
    await demo.tick();
    const before = (await demo.outbox()).length;
    // Four days later the waiting approvals are past their 3-day escalation and reminders are due.
    realNow += 4 * 24 * 3600_000;
    const report = await demo.tick();
    expect(report.errors).toEqual([]);
    const after = await demo.outbox();
    expect(after.length).toBeGreaterThan(before);
    expect(new Date(after[0]?.sentAt ?? 0).toISOString().slice(0, 10)).toBe("2026-11-04");
  });
});
