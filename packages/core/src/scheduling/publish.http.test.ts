import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { TestClient } from "../../testing/http.ts";
import {
  applyLeaveAs,
  createSchedulingWorld,
  decideAll,
  notificationTitles,
  ok,
  type SchedulingWorld,
} from "../../testing/scheduling.ts";
import { auditEvents } from "../db/schema/audit.ts";
import { createPlannedShifts } from "./feeds.ts";

/** Publishing (spec "Publishing"), leave approved after publishing, and `PlannedShifts`. */
let w: SchedulingWorld;
let manager: TestClient;
let crewA: TestClient;
let rosterId: string;
let shiftA: { id: string; updatedAt: string };
const api = "/api/v1/scheduling";
const week = "2026-11-02";

interface Me {
  shifts: { id: string; date: string; start: string | null; end: string | null }[];
  weeks: { weekStart: string; published: boolean }[];
}

beforeAll(async () => {
  w = await createSchedulingWorld();
  manager = await w.as("manager");
  crewA = await w.asCrew("crewA");
  rosterId = (await ok<{ id: string }>(manager.post(`${api}/rosters`, { weekStart: week, locationId: w.locationId })))
    .id;
  // Nurul has approved annual leave on Tue 3 Nov.
  await applyLeaveAs(await w.asCrew("crewB"), "annual", "2026-11-03");
  await decideAll(manager, "leave");
  const add = (employeeId: string, date: string, startTime = "07:00", endTime = "15:00") =>
    ok<{ id: string; updatedAt: string }>(
      manager.post(`${api}/rosters/${rosterId}/shifts`, { employeeId, date, startTime, endTime, breakMinutes: 30 }),
      201,
    );
  shiftA = await add(w.crew.crewA, "2026-11-02");
  await add(w.crew.crewA, "2026-11-04");
  await add(w.crew.crewB, "2026-11-03");
  await add(w.crew.crewB, "2026-11-05");
}, 60_000);
afterAll(() => w.close());

describe("publishing", () => {
  it("drafts are invisible to employees", async () => {
    const me = await ok<Me>(crewA.get(`${api}/me?from=${week}&to=2026-11-08`));
    expect(me.shifts).toEqual([]);
    expect(me.weeks).toEqual([{ weekStart: week, published: false }]);
    const roster = await ok<{ mode: string; roster: { status: string }; shifts: unknown[] }>(
      crewA.get(`${api}/rosters?weekStart=${week}&locationId=${w.locationId}`),
    );
    expect(roster).toMatchObject({ mode: "published", roster: { status: "none" }, shifts: [] });
    expect(await createPlannedShifts(w.deps).forEmployee(w.orgId, w.crew.crewA, week, "2026-11-08")).toEqual([]);
  });

  it("the shift over approved leave shows On leave and blocks publishing until acknowledged", async () => {
    const v = await ok<{
      shifts: { id: string; employeeId: string; date: string; conflicts: { kind: string; label: string }[] }[];
      toAcknowledge: { shiftId: string; kind: string; employeeName: string }[];
    }>(manager.get(`${api}/rosters/${rosterId}`));
    const onLeave = v.shifts.find((s) => s.employeeId === w.crew.crewB && s.date === "2026-11-03");
    expect(onLeave?.conflicts.map((c) => c.label)).toContain("On leave");
    expect(v.toAcknowledge).toEqual([
      expect.objectContaining({ shiftId: onLeave?.id, kind: "on_leave", employeeName: "Nurul Huda" }),
    ]);
    const refused = await manager.post(`${api}/rosters/${rosterId}/publish`, {});
    expect(refused.status).toBe(409);
    const err = (await refused.json()).error;
    expect(err.code).toBe("unacknowledged_conflicts");
    expect(err.details.conflicts).toEqual([
      expect.objectContaining({ shiftId: onLeave?.id, kind: "on_leave", date: "2026-11-03" }),
    ]);
    const done = await ok<{ version: number; notified: number; changedEmployees: number }>(
      manager.post(`${api}/rosters/${rosterId}/publish`, { acknowledge: [{ shiftId: onLeave?.id, kind: "on_leave" }] }),
    );
    expect(done).toMatchObject({ version: 1, notified: 2, changedEmployees: 2 });
    const [audit] = await w.deps.db
      .select()
      .from(auditEvents)
      .where(and(eq(auditEvents.orgId, w.orgId), eq(auditEvents.action, "scheduling.roster_published")));
    expect((audit?.meta as { acknowledged?: unknown[] } | undefined)?.acknowledged).toEqual([
      { shiftId: onLeave?.id, kind: "on_leave" },
    ]);
    expect(await notificationTitles(w.deps, w.cm.crewA.membershipId)).toContain(
      "Your schedule for the week of Mon 2 Nov 2026 is published",
    );
  });

  it("employees see the published copy; later edits stay invisible until republished", async () => {
    const me = await ok<Me>(crewA.get(`${api}/me?from=${week}&to=2026-11-08`));
    expect(me.shifts.map((s) => [s.date, s.start, s.end])).toEqual([
      ["2026-11-02", "07:00", "15:00"],
      ["2026-11-04", "07:00", "15:00"],
    ]);
    expect(me.weeks[0]?.published).toBe(true);
    w.clock.advance(60_000);
    await ok(
      manager.patch(`${api}/shifts/${shiftA.id}`, {
        employeeId: w.crew.crewA,
        date: "2026-11-02",
        startTime: "08:00",
        endTime: "16:00",
        breakMinutes: 30,
        expectedUpdatedAt: shiftA.updatedAt,
      }),
    );
    const v = await ok<{ roster: { hasChanges: boolean; status: string } }>(manager.get(`${api}/rosters/${rosterId}`));
    expect(v.roster).toMatchObject({ hasChanges: true, status: "published" });
    const still = await ok<Me>(crewA.get(`${api}/me?from=${week}&to=2026-11-08`));
    expect(still.shifts[0]).toMatchObject({ start: "07:00", end: "15:00" });
    const planned = await createPlannedShifts(w.deps).forEmployee(w.orgId, w.crew.crewA, week, "2026-11-02");
    expect(planned.map((p) => [p.date, p.paidMinutes])).toEqual([["2026-11-02", 450]]);
  });

  it("republishing notifies only the changed employee, with old and new times", async () => {
    const before = (await notificationTitles(w.deps, w.cm.crewB.membershipId)).length;
    const v = await ok<{ toAcknowledge: { shiftId: string; kind: string }[] }>(
      manager.get(`${api}/rosters/${rosterId}`),
    );
    const r = await ok<{ version: number; notified: number; changedEmployees: number }>(
      manager.post(`${api}/rosters/${rosterId}/publish`, { acknowledge: v.toAcknowledge }),
    );
    expect(r).toMatchObject({ version: 2, notified: 1, changedEmployees: 1 });
    expect(await notificationTitles(w.deps, w.cm.crewA.membershipId)).toContain(
      "Your shift on Mon 2 Nov 2026 changed from 07:00–15:00 to 08:00–16:00",
    );
    expect((await notificationTitles(w.deps, w.cm.crewB.membershipId)).length).toBe(before);
    const me = await ok<Me>(crewA.get(`${api}/me?from=${week}&to=2026-11-08`));
    expect(me.shifts[0]).toMatchObject({ start: "08:00", end: "16:00" });
  });

  it("leave approved after publishing flags the shift and tells the roster's editors", async () => {
    await applyLeaveAs(crewA, "annual", "2026-11-04");
    await decideAll(manager, "leave");
    expect(await notificationTitles(w.deps, w.m.manager.membershipId)).toContain(
      "Lee Wei Ming's approved leave overlaps a published shift (Wed 4 Nov)",
    );
    expect(await notificationTitles(w.deps, w.m.hr.membershipId)).toContain(
      "Lee Wei Ming's approved leave overlaps a published shift (Wed 4 Nov)",
    );
    const v = await ok<{ shifts: { employeeId: string; date: string; conflicts: { kind: string }[] }[] }>(
      manager.get(`${api}/rosters/${rosterId}`),
    );
    const s = v.shifts.find((x) => x.employeeId === w.crew.crewA && x.date === "2026-11-04");
    expect(s?.conflicts.map((c) => c.kind)).toContain("on_leave");
  });

  it("only editors with an eligible team member may publish", async () => {
    expect((await crewA.post(`${api}/rosters/${rosterId}/publish`, {})).status).toBe(403);
    expect((await (await w.as("other")).post(`${api}/rosters/${rosterId}/publish`, {})).status).toBe(403);
  });
});
