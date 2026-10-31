import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, createTestDeps, type TestDb } from "../../testing/index.ts";
import type { WorkWeek } from "../db/schema/organisation.ts";
import { ctxFor, hire } from "../employees/lifecycle.ts";
import {
  createPeopleHarness,
  hirePayload,
  OFFICE_WEEK,
  OWNER,
  type PeopleHarness,
  seedBasicStructure,
} from "../testing/people-harness.ts";
import { saveCompanyProfile } from "./profile.ts";
import { setupChecklist } from "./setup-checklist.ts";
import {
  createWorkSchedule,
  dayTypeOn,
  listWorkSchedules,
  setDefaultWorkSchedule,
  updateWorkSchedule,
  validateWeek,
  workScheduleAsAt,
} from "./work-schedules.ts";

let t: TestDb;
let h: PeopleHarness;
beforeEach(async () => {
  t = await createTestDb();
  h = await createPeopleHarness(createTestDeps(t.db));
});
afterEach(() => t.close());

const week = (): WorkWeek => OFFICE_WEEK.map((d) => ({ ...d }));

describe("work schedules", () => {
  it("weekly minutes are the sum of the days", async () => {
    const s = await createWorkSchedule(h.deps, h.ports, h.actor(OWNER), {
      name: "Office 5-day",
      kind: "fixed",
      days: week(),
    });
    expect(s.current?.weeklyMinutes).toBe(2400);
  });

  it("requires exactly one rest day and sane hours", () => {
    const none = week().map((d) => (d.type === "rest" ? { type: "off" as const, minutes: 0 } : d));
    expect(validateWeek(none)[0]?.message).toBe("Mark exactly one day as the rest day (usually Sunday).");
    const two = week().map((d) => (d.type === "off" ? { type: "rest" as const, minutes: 0 } : d));
    expect(validateWeek(two)[0]?.message).toContain("2 are marked");
    const half = week();
    half[5] = { type: "half", minutes: 480 };
    expect(validateWeek(half)[0]?.path).toBe("days.5.minutes");
  });

  it("shift schedules record only weekly hours", async () => {
    const s = await createWorkSchedule(h.deps, h.ports, h.actor(OWNER), {
      name: "Kitchen shifts",
      kind: "shift",
      weeklyMinutes: 44 * 60,
    });
    expect(s).toMatchObject({ kind: "shift", current: { days: null, weeklyMinutes: 2640 } });
  });

  it("exactly one default; first schedule is the default", async () => {
    const a = await createWorkSchedule(h.deps, h.ports, h.actor(OWNER), { name: "A", kind: "fixed", days: week() });
    const b = await createWorkSchedule(h.deps, h.ports, h.actor(OWNER), { name: "B", kind: "fixed", days: week() });
    expect(a.isDefault).toBe(true);
    expect(b.isDefault).toBe(false);
    await setDefaultWorkSchedule(h.deps, h.ports, h.actor(OWNER), b.id);
    const all = await listWorkSchedules(h.deps, h.actor(OWNER));
    expect(all.filter((s) => s.isDefault).map((s) => s.name)).toEqual(["B"]);
  });

  it("a change is a new version from its date; history unchanged", async () => {
    const s = await createWorkSchedule(h.deps, h.ports, h.actor(OWNER), {
      name: "Office 5-day",
      kind: "fixed",
      days: week(),
    });
    const halfSat = week();
    halfSat[5] = { type: "half", minutes: 240 };
    await updateWorkSchedule(h.deps, h.ports, h.actor(OWNER), s.id, {
      effectiveFrom: "2026-12-01",
      kind: "fixed",
      days: halfSat,
    });
    const before = await workScheduleAsAt(t.db, h.orgId, s.id, "2026-11-28");
    const after = await workScheduleAsAt(t.db, h.orgId, s.id, "2026-12-05");
    expect(dayTypeOn(before?.days ?? [], "2026-11-28")).toBe("off"); // a Saturday
    expect(dayTypeOn(after?.days ?? [], "2026-12-05")).toBe("half");
    expect(after?.weeklyMinutes).toBe(2640);
    expect(dayTypeOn(week(), "2026-11-29")).toBe("rest"); // Sunday
  });

  it("only owner/hr_admin change schedules", async () => {
    await expect(
      createWorkSchedule(h.deps, h.ports, h.actor(["payroll_admin"]), { name: "X", kind: "fixed", days: week() }),
    ).rejects.toMatchObject({ code: "forbidden" });
  });
});

describe("setup checklist", () => {
  it("steps come from the data", async () => {
    let c = await setupChecklist(t.db, h.orgId);
    expect(c.steps.map((s) => s.done)).toEqual([false, false, false, false]);
    await saveCompanyProfile(h.deps, h.ports, h.actor(OWNER), { legalName: "Kopi Kaki Pte. Ltd.", uen: "201912345K" });
    c = await setupChecklist(t.db, h.orgId);
    expect(c.steps.find((s) => s.id === "company_profile")?.done).toBe(true);
    expect(c.steps.find((s) => s.id === "work_schedule")?.done).toBe(false);
    const s = await seedBasicStructure(h);
    await hire(ctxFor(h.deps, h.ports, h.actor(OWNER)), hirePayload(s));
    c = await setupChecklist(t.db, h.orgId);
    expect(c.complete).toBe(true);
  });
});
