import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createMemoryLogger, createUuidV7Generator, schema, systemClock } from "@crowhr/core";
import { createTestDb, type TestDb } from "@crowhr/core/testing";
import { desc, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { applyRetention, runBackup } from "./backup.ts";
import { backupDue, createBackupScheduler, localTime } from "./schedule.ts";
import { fakeDumper } from "./test-helpers.ts";

const SGT = "Asia/Singapore";
const at = (iso: string) => new Date(iso);

describe("backupDue", () => {
  const two = { hour: 2, minute: 0 };
  it("uses Singapore local time", () => {
    expect(localTime(at("2026-10-30T18:00:00Z"), SGT)).toEqual({ date: "2026-10-31", minutes: 120 });
  });
  it("is due from BACKUP_TIME SGT, once per local day", () => {
    expect(backupDue(at("2026-10-30T17:59:00Z"), null, two, SGT)).toBe(false); // 01:59 SGT
    expect(backupDue(at("2026-10-30T18:00:00Z"), null, two, SGT)).toBe(true); // 02:00 SGT
    expect(backupDue(at("2026-10-31T03:00:00Z"), at("2026-10-30T18:00:05Z"), two, SGT)).toBe(false); // ran today
    expect(backupDue(at("2026-10-31T18:00:00Z"), at("2026-10-30T18:00:05Z"), two, SGT)).toBe(true); // next day
  });
  it("catches up later the same day after downtime", () => {
    expect(backupDue(at("2026-10-31T09:30:00Z"), at("2026-10-29T18:00:00Z"), two, SGT)).toBe(true);
  });
});

describe("scheduled backups", () => {
  let dir: string;
  let testDb: TestDb;
  let now: Date;
  const ids = createUuidV7Generator(systemClock);

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "crowhr-schedule-"));
    await mkdir(join(dir, "backups"));
    testDb = await createTestDb();
    now = at("2026-10-30T17:30:00Z"); // 01:30 SGT
  });
  afterEach(async () => {
    await testDb.close();
    await rm(dir, { recursive: true, force: true });
  });

  function scheduler(options: { keep?: number; failing?: boolean; paused?: () => boolean } = {}) {
    const dumper = fakeDumper(testDb.db);
    if (options.failing) {
      dumper.dump = async () => {
        throw new Error("pg_dump: disk full");
      };
    }
    const logger = createMemoryLogger();
    const s = createBackupScheduler({
      time: { hour: 2, minute: 0 },
      timeZone: SGT,
      now: () => now,
      logger,
      isPaused: options.paused ?? (() => false),
      lastScheduledStart: async () => {
        const [row] = await testDb.db
          .select()
          .from(schema.backupRuns)
          .where(eq(schema.backupRuns.trigger, "scheduled"))
          .orderBy(desc(schema.backupRuns.startedAt))
          .limit(1);
        return row?.startedAt ?? null;
      },
      run: async () => {
        await runBackup({
          db: testDb.db,
          dumper,
          backupDir: join(dir, "backups"),
          filesDir: join(dir, "files"),
          key: new Uint8Array(32),
          passphrase: null,
          trigger: "scheduled",
          schemaTag: null,
          newId: () => ids.newId(),
          now: () => now,
        });
        await applyRetention(join(dir, "backups"), options.keep ?? 14);
      },
    });
    return { s, dumper, logger };
  }

  it("runs daily at BACKUP_TIME SGT via the tick, with an injected clock", async () => {
    const { s, dumper } = scheduler();
    expect(await s.tick()).toBe("not_due");
    now = at("2026-10-30T18:00:30Z"); // 02:00 SGT
    expect(await s.tick()).toBe("ran");
    now = at("2026-10-30T18:01:30Z");
    expect(await s.tick()).toBe("not_due");
    now = at("2026-10-31T18:00:30Z");
    expect(await s.tick()).toBe("ran");
    expect(dumper.dumps).toBe(2);
    expect(await readdir(join(dir, "backups"))).toEqual([
      "crowhr-backup-20261030T180030Z-scheduled.tar.gz",
      "crowhr-backup-20261031T180030Z-scheduled.tar.gz",
    ]);
  });

  it("keeps only the newest BACKUP_KEEP archives", async () => {
    for (let day = 1; day <= 4; day++) {
      await writeFile(
        join(dir, "backups", `crowhr-backup-202610${String(day).padStart(2, "0")}T180000Z-scheduled.tar.gz`),
        "x",
      );
    }
    const { s } = scheduler({ keep: 3 });
    now = at("2026-10-30T18:00:30Z");
    expect(await s.tick()).toBe("ran");
    expect(await readdir(join(dir, "backups"))).toEqual([
      "crowhr-backup-20261003T180000Z-scheduled.tar.gz",
      "crowhr-backup-20261004T180000Z-scheduled.tar.gz",
      "crowhr-backup-20261030T180030Z-scheduled.tar.gz",
    ]);
  });

  it("records a failure and does not retry every minute", async () => {
    const { s, logger } = scheduler({ failing: true });
    now = at("2026-10-30T18:00:30Z");
    expect(await s.tick()).toBe("failed");
    const [run] = await testDb.db.select().from(schema.backupRuns);
    expect(run).toMatchObject({ status: "failed", trigger: "scheduled", error: "pg_dump: disk full" });
    expect(logger.entries.some((e) => e.level === "error" && e.message === "Scheduled backup failed")).toBe(true);
    now = at("2026-10-30T18:01:30Z");
    expect(await s.tick()).toBe("not_due");
  });

  it("pauses during maintenance", async () => {
    const { s } = scheduler({ paused: () => true });
    now = at("2026-10-30T18:00:30Z");
    expect(await s.tick()).toBe("paused");
  });
});
