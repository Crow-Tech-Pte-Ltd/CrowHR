import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { punch, setTimesheetApproval } from "../../testing/attendance.ts";
import type { TestClient } from "../../testing/http.ts";
import { createLeaveWorld, type LeaveWorld } from "../../testing/leave.ts";
import { attendancePunches } from "../db/schema/attendance.ts";
import { auditEvents } from "../db/schema/audit.ts";

/**
 * Approved timesheets lock the period; HR corrections and reopen (add-timesheet-approval specs
 * "Approved timesheets lock the period", "Reopening a timesheet"). Weekly periods: on Friday
 * 13 Nov 2026 the week of 2–8 Nov is over and still within the 7-day limit for live punches.
 */

interface ErrorBody {
  error: { code: string; message: string; details?: { reason?: string; canReopen?: boolean; timesheetId?: string } };
}

describe("timesheet lock and reopen", () => {
  let w: LeaveWorld;
  let hr: TestClient;
  let manager: TestClient;
  let staff: TestClient;
  beforeEach(async () => {
    w = await createLeaveWorld({ now: "2026-11-13T02:00:00.000Z" });
    hr = await w.as("hr");
    manager = await w.as("manager");
    staff = await w.as("staff");
    await setTimesheetApproval(hr, { approval: true, period: "weekly" });
  });
  afterEach(() => w.close());

  const punchAt = async (employeeId: string, date: string, kind: "in" | "out", hhmm: string) => {
    const t = new Date(`${date}T${hhmm}:00+08:00`);
    const id = w.deps.ids.newId();
    await w.deps.db.insert(attendancePunches).values({
      id,
      orgId: w.orgId,
      employeeId,
      kind,
      idempotencyKey: `t-${id}`,
      source: "web",
      deviceTime: t,
      sentAt: t,
      serverTime: t,
      recordedAt: t,
      workDate: date,
      skewSeconds: 0,
    });
    return id;
  };
  /** Submits `who`'s week containing `date` and has `approver` approve it. */
  const approveWeek = async (who: TestClient, approver: TestClient, date: string) => {
    const res = await who.post("/api/v1/attendance/timesheets", { date });
    expect(res.status, await res.clone().text()).toBe(201);
    const { timesheet } = (await res.json()) as { timesheet: { id: string; approvalRequestId: string } };
    const tasks = (await (await approver.get("/api/v1/approvals/tasks")).json()) as {
      items: { taskId: string; requestId: string }[];
    };
    const task = tasks.items.find((t) => t.requestId === timesheet.approvalRequestId);
    if (!task) throw new Error("approver has no task");
    expect(
      (await approver.post(`/api/v1/approvals/tasks/${task.taskId}/decision`, { decision: "approve" })).status,
    ).toBe(200);
    return timesheet.id;
  };
  const correction = (c: TestClient, body: Record<string, unknown>) =>
    c.post("/api/v1/attendance/corrections", {
      employeeId: w.emp.staff,
      kind: "out",
      time: "2026-11-05T18:00:00+08:00",
      reason: "Forgot to clock out",
      ...body,
    });

  it("refuses punches, manager corrections and new OT claims in an approved week; replays still answer", async () => {
    const s = w.emp.staff;
    const voidable = await punchAt(s, "2026-11-04", "in", "09:00");
    await punchAt(s, "2026-11-04", "out", "20:30");
    await punchAt(s, "2026-11-05", "in", "09:00");
    // Tapped offline on Saturday 7 Nov and sent before the approval: recorded.
    const sent = "2026-11-13T02:00:00.000Z";
    const early = await punch(staff, "in", "2026-11-07T01:00:00.000Z", {
      sentAt: sent,
      queued: true,
      key: "offline-7nov",
    });
    expect(early.status, await early.clone().text()).toBe(201);
    const id = await approveWeek(staff, manager, "2026-11-02");

    // A punch tapped on 8 Nov arriving now is refused with the code native clients already handle.
    const late = await punch(staff, "out", "2026-11-08T02:00:00.000Z", { sentAt: sent, queued: true });
    expect(late.status).toBe(422);
    const lateBody = (await late.json()) as ErrorBody;
    expect(lateBody.error.code).toBe("punch_rejected");
    expect(lateBody.error.details).toMatchObject({ reason: "timesheet_locked", timesheetId: id });
    expect(lateBody.error.message).toBe(
      "Your timesheet for 2–8 Nov 2026 is approved, so this punch can't be added. Ask HR to add it if it was right.",
    );
    // The retry of a punch recorded before the approval still returns it.
    const replay = await punch(staff, "in", "2026-11-07T01:00:00.000Z", {
      sentAt: sent,
      queued: true,
      key: "offline-7nov",
    });
    expect(replay.status).toBe(200);
    // Today (13 Nov) is outside the week: clocking in works.
    expect((await punch(staff, "in", "2026-11-13T01:59:00.000Z", { sentAt: sent })).status).toBe(201);

    const byManager = await correction(manager, {});
    expect(byManager.status).toBe(409);
    expect(((await byManager.json()) as ErrorBody).error).toMatchObject({
      code: "timesheet_locked",
      details: { canReopen: false, reason: "timesheet_locked" },
    });
    // Even with the confirmation flag: managers can't reopen.
    expect((await correction(manager, { reopen: true })).status).toBe(409);
    expect(
      (await manager.post(`/api/v1/attendance/punches/${voidable}/void`, { reason: "Clocked in twice" })).status,
    ).toBe(409);
    const ot = await staff.post("/api/v1/attendance/overtime", { date: "2026-11-04", minutes: 60 });
    expect(ot.status).toBe(409);
    expect(((await ot.json()) as ErrorBody).error.code).toBe("timesheet_locked");

    const sheet = (await (await staff.get("/api/v1/attendance/timesheet?from=2026-11-01&to=2026-11-09")).json()) as {
      days: { date: string; locked: boolean }[];
    };
    expect(sheet.days.filter((d) => d.locked).map((d) => d.date)).toEqual([
      "2026-11-02",
      "2026-11-03",
      "2026-11-04",
      "2026-11-05",
      "2026-11-06",
      "2026-11-07",
      "2026-11-08",
    ]);
  });

  it("HR corrects a locked day only when confirming; that reopens the timesheet, audited and notified", async () => {
    await punchAt(w.emp.staff, "2026-11-05", "in", "09:00");
    const id = await approveWeek(staff, manager, "2026-11-02");
    const ask = await correction(hr, {});
    expect(ask.status).toBe(409);
    const askBody = (await ask.json()) as ErrorBody;
    expect(askBody.error.details?.canReopen).toBe(true);
    expect(askBody.error.message).toMatch(/Correcting this day reopens it/);

    const done = await correction(hr, { reopen: true });
    expect(done.status, await done.clone().text()).toBe(201);
    const ts = (await (await staff.get(`/api/v1/attendance/timesheets/${id}`)).json()) as {
      status: string;
      reopenReason: string;
      reopenedBy: string;
    };
    expect(ts).toMatchObject({ status: "reopened", reopenReason: "Forgot to clock out", reopenedBy: "Tan Mei Ling" });
    const actions = (await w.deps.db.select().from(auditEvents)).map((a) => a.action);
    expect(actions).toContain("attendance.timesheet_reopened");
    expect(actions).toContain("attendance.correction_added");
    const notes = (await (await staff.get("/api/v1/notifications")).json()) as {
      items: { kind: string; title: string; link: string }[];
    };
    expect(notes.items).toContainEqual(
      expect.objectContaining({
        kind: "timesheet_reopened",
        title: "Your timesheet for 2–8 Nov 2026 was reopened",
        link: "/attendance/timesheet?period=2026-11-02",
      }),
    );
    // Open again: the manager corrects, and the week can be submitted again.
    expect((await correction(manager, { time: "2026-11-05T18:05:00+08:00", kind: "in" })).status).toBe(201);
    expect((await staff.post("/api/v1/attendance/timesheets", { date: "2026-11-02" })).status).toBe(201);
  });

  it("a pending week isn't locked; turning approval off lifts every lock", async () => {
    expect((await staff.post("/api/v1/attendance/timesheets", { date: "2026-10-26" })).status).toBe(201);
    expect((await correction(manager, { time: "2026-10-27T18:00:00+08:00" })).status).toBe(201);
    await approveWeek(staff, manager, "2026-11-02");
    expect((await correction(manager, {})).status).toBe(409);
    await setTimesheetApproval(hr, { approval: false });
    expect((await correction(manager, {})).status).toBe(201);
    const sheet = (await (await staff.get("/api/v1/attendance/timesheet?from=2026-11-02&to=2026-11-08")).json()) as {
      days: { locked: boolean }[];
    };
    expect(sheet.days.some((d) => d.locked)).toBe(false);
  });

  it("reopen: owners and HR only, never their own, approved timesheets only", async () => {
    const id = await approveWeek(staff, manager, "2026-11-02");
    const url = `/api/v1/attendance/timesheets/${id}/reopen`;
    expect((await staff.post(url, { reason: "Wrong week" })).status).toBe(403);
    expect((await manager.post(url, { reason: "Wrong week" })).status).toBe(403);
    expect((await hr.post(url, { reason: "x" })).status).toBe(400);
    const ok = await hr.post(url, { reason: "Missing clock-out on 4 Nov" });
    expect(ok.status, await ok.clone().text()).toBe(200);
    expect(((await ok.json()) as { status: string }).status).toBe("reopened");
    expect((await hr.post(url, { reason: "Again" })).status).toBe(409);
    const reopened = await w.deps.db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.action, "attendance.timesheet_reopened"));
    expect(reopened).toHaveLength(1);

    // Tan Mei Ling (hr_admin, no manager) submits her own week; it goes to the owner.
    const owner = await w.as("owner");
    const own = await approveWeek(hr, owner, "2026-11-02");
    const self = await hr.post(`/api/v1/attendance/timesheets/${own}/reopen`, { reason: "My own week" });
    expect(self.status).toBe(403);
    expect(((await self.json()) as ErrorBody).error.code).toBe("self_change_requires_approval");
    expect((await owner.post(`/api/v1/attendance/timesheets/${own}/reopen`, { reason: "Her request" })).status).toBe(
      200,
    );
  });
});
