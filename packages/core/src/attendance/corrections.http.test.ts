import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { punch } from "../../testing/attendance.ts";
import { createLeaveWorld, type LeaveWorld } from "../../testing/leave.ts";
import { auditEvents } from "../db/schema/audit.ts";

/** Manager and HR corrections (spec "Daily timesheets", scenario "Manager correction"). */
describe("timesheet corrections", () => {
  let w: LeaveWorld;
  beforeEach(async () => {
    // Friday 13 Nov 2026, 10:00 SGT.
    w = await createLeaveWorld({ now: "2026-11-13T02:00:00.000Z" });
  });
  afterEach(() => w.close());

  const sheet = async (employeeId: string) => {
    const res = await (await w.as("hr")).get(
      `/api/v1/attendance/timesheet?employeeId=${employeeId}&from=2026-11-12&to=2026-11-12`,
    );
    return (
      (await res.json()) as {
        days: { workedMinutes: number; missingPunches: number; punches: { id: string; voided: boolean }[] }[];
      }
    ).days[0];
  };

  it("a manager adds a missing clock-out for a report; the day updates and the audit log records who did it", async () => {
    const staff = await w.as("staff");
    await punch(staff, "in", "2026-11-12T01:00:00.000Z", { sentAt: "2026-11-13T02:00:00.000Z", queued: true });
    expect((await sheet(w.emp.staff))?.missingPunches).toBe(1);
    const manager = await w.as("manager");
    const res = await manager.post("/api/v1/attendance/corrections", {
      employeeId: w.emp.staff,
      kind: "out",
      time: "2026-11-12T18:00:00+08:00",
      reason: "Forgot to clock out",
    });
    expect(res.status, await res.clone().text()).toBe(201);
    expect(await res.json()).toMatchObject({
      source: "correction",
      reason: "Forgot to clock out",
      workDate: "2026-11-12",
    });
    const day = await sheet(w.emp.staff);
    expect(day).toMatchObject({ workedMinutes: 480, missingPunches: 0 });
    const audit = await w.deps.db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.action, "attendance.correction_added"));
    expect(audit).toHaveLength(1);
    expect(audit[0]?.actorMembershipId).toBe(w.m.manager.membershipId);
  });

  it("voids a wrong punch with a reason and keeps the original", async () => {
    const staff = await w.as("staff");
    const sent = "2026-11-13T02:00:00.000Z";
    const dup = (await (
      await punch(staff, "in", "2026-11-12T00:50:00.000Z", { sentAt: sent, queued: true })
    ).json()) as { id: string };
    await punch(staff, "in", "2026-11-12T01:00:00.000Z", { sentAt: sent, queued: true });
    await punch(staff, "out", "2026-11-12T10:00:00.000Z", { sentAt: sent, queued: true });
    expect((await sheet(w.emp.staff))?.missingPunches).toBe(1);
    const manager = await w.as("manager");
    expect((await manager.post(`/api/v1/attendance/punches/${dup.id}/void`, {})).status).toBe(400);
    const res = await manager.post(`/api/v1/attendance/punches/${dup.id}/void`, { reason: "Clocked in twice" });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ voided: true, voidReason: "Clocked in twice" });
    const day = await sheet(w.emp.staff);
    expect(day?.missingPunches).toBe(0);
    expect(day?.punches.filter((p) => p.voided)).toHaveLength(1);
    expect((await manager.post(`/api/v1/attendance/punches/${dup.id}/void`, { reason: "Again" })).status).toBe(409);
  });

  it("scope: managers only their team, HR everyone, employees nobody, nobody their own", async () => {
    const body = (employeeId: string) => ({
      employeeId,
      kind: "in",
      time: "2026-11-12T09:00:00+08:00",
      reason: "Missed punch",
    });
    const manager = await w.as("manager");
    expect((await manager.post("/api/v1/attendance/corrections", body(w.emp.other))).status).toBe(404);
    expect((await manager.post("/api/v1/attendance/corrections", body(w.emp.manager))).status).toBe(404);
    const hr = await w.as("hr");
    expect((await hr.post("/api/v1/attendance/corrections", body(w.emp.other))).status).toBe(201);
    const own = await hr.post("/api/v1/attendance/corrections", body(w.emp.hr));
    expect(own.status).toBe(403);
    expect(((await own.json()) as { error: { code: string } }).error.code).toBe("self_change_requires_approval");
    expect((await (await w.as("staff")).post("/api/v1/attendance/corrections", body(w.emp.newbie))).status).toBe(403);
    const future = await hr.post("/api/v1/attendance/corrections", {
      ...body(w.emp.other),
      time: "2026-11-14T09:00:00+08:00",
    });
    expect(future.status).toBe(400);
  });
});
