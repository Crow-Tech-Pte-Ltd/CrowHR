import { afterEach, describe, expect, it } from "vitest";
import { clientAs, createWorkflowWorld, movableClock, type WorkflowWorld } from "../../testing/index.ts";
import { backupRuns } from "../db/schema/system.ts";
import type { SystemHost } from "../system/host.ts";

const host = (schedule: string | null): SystemHost => ({
  describe: async () => ({
    publicUrl: "https://hr.test",
    secureCookies: true,
    trustedProxies: [],
    database: { driver: "postgres" },
    backups: { directory: "/backups", encrypted: true, schedule, keep: 14, beforeMigrate: true },
    disk: [],
    migrations: { bundled: 6, latestBundledTag: null },
  }),
});

describe("backup warning on Home", () => {
  let w: WorkflowWorld;
  const clock = movableClock("2026-10-31T01:00:00.000Z");
  afterEach(() => w.close());

  const kinds = async (m: WorkflowWorld["m"][keyof WorkflowWorld["m"]]) =>
    (
      (await (await (await clientAs(w.app, w.deps, m)).get("/api/v1/inbox")).json()) as {
        items: { kind: string; title: string }[];
      }
    ).items.filter((i) => i.kind === "backup_stale");

  it("tells owners when the last successful backup is older than 48 hours", async () => {
    w = await createWorkflowWorld({ clock, systemHost: host("02:00 Asia/Singapore") });
    expect((await kinds(w.m.owner)).map((i) => i.title)).toEqual(["No successful backup yet"]);
    expect(await kinds(w.m.hr)).toEqual([]);
    await w.deps.db.insert(backupRuns).values({
      id: w.deps.ids.newId(),
      trigger: "scheduled",
      status: "succeeded",
      startedAt: new Date("2026-10-30T18:00:00.000Z"),
    });
    expect(await kinds(w.m.owner)).toEqual([]);
    clock.set("2026-11-02T01:00:00.000Z");
    expect((await kinds(w.m.owner)).map((i) => i.title)).toEqual(["No backup in the last 48 hours"]);
  });

  it("warns immediately about disabled plaintext schedules even after a recent manual backup", async () => {
    const plain = host("02:00 Asia/Singapore");
    const describe = plain.describe;
    plain.describe = async () => {
      const h = await describe();
      return { ...h, backups: { ...h.backups, encrypted: false } };
    };
    w = await createWorkflowWorld({ clock, systemHost: plain });
    await w.deps.db
      .insert(backupRuns)
      .values({ id: w.deps.ids.newId(), trigger: "manual", status: "succeeded", startedAt: clock.now() });
    expect((await kinds(w.m.owner)).map((i) => i.title)).toEqual(["Scheduled backups are disabled"]);
  });

  it("with plaintext schedules disabled, an old last backup is also reported", async () => {
    const plain = host("02:00 Asia/Singapore");
    const describe = plain.describe;
    plain.describe = async () => {
      const h = await describe();
      return { ...h, backups: { ...h.backups, encrypted: false } };
    };
    w = await createWorkflowWorld({ clock, systemHost: plain });
    await w.deps.db.insert(backupRuns).values({
      id: w.deps.ids.newId(),
      trigger: "manual",
      status: "succeeded",
      startedAt: new Date(clock.now().getTime() - 3 * 86_400_000),
    });
    expect((await kinds(w.m.owner)).map((i) => i.title)).toEqual([
      "No backup in the last 48 hours",
      "Scheduled backups are disabled",
    ]);
  });

  it("stays quiet where backups aren't expected (no host, or scheduled backups off)", async () => {
    w = await createWorkflowWorld({ clock, systemHost: host(null) });
    expect(await kinds(w.m.owner)).toEqual([]);
    await w.close();
    w = await createWorkflowWorld({ clock });
    expect(await kinds(w.m.owner)).toEqual([]);
  });
});
