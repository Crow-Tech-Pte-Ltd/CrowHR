import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setTimesheetApproval } from "../../testing/attendance.ts";
import type { TestClient } from "../../testing/http.ts";
import { createLeaveWorld, type LeaveWorld } from "../../testing/leave.ts";
import { attendancePunches } from "../db/schema/attendance.ts";
import { auditEvents } from "../db/schema/audit.ts";

/**
 * Timesheet approval: settings, submission and decisions through the workflows engine
 * (add-timesheet-approval specs "Timesheet approval setting", "Timesheet submission",
 * "Timesheet decisions", "Timesheets on Home").
 */

interface Timesheet {
  id: string;
  status: string;
  periodStart: string;
  periodEnd: string;
  periodLabel: string;
  submittedBy: string;
  submittedTotals: { daysWorked: number; workedMinutes: number; missingPunches: number; otMinutes: number };
  approvedTotals: { workedMinutes: number } | null;
  decidedBy: string | null;
  comment: string | null;
  approvalRequestId: string | null;
}
interface Overview {
  settings: { approval: boolean; period: string; submittedBy: string; payrollApprovedOnly: boolean };
  period: { start: string; end: string; label: string };
  over: boolean;
  items: {
    employee: { id: string; name: string };
    status: string;
    timesheet: Timesheet | null;
    taskId: string | null;
    canSubmit: boolean;
    canWithdraw: boolean;
    canReopen: boolean;
  }[];
}

describe("timesheet approval", () => {
  let w: LeaveWorld;
  beforeEach(async () => {
    // Friday 13 Nov 2026, 10:00 SGT: October is over, November isn't.
    w = await createLeaveWorld({ now: "2026-11-13T02:00:00.000Z" });
  });
  afterEach(() => w.close());

  /** Punches inserted as recorded (October is past the 7-day limit for live punches). */
  const punchAt = async (employeeId: string, date: string, kind: "in" | "out", hhmm: string) => {
    const t = new Date(`${date}T${hhmm}:00+08:00`);
    await w.deps.db.insert(attendancePunches).values({
      id: w.deps.ids.newId(),
      orgId: w.orgId,
      employeeId,
      kind,
      idempotencyKey: `t-${employeeId}-${date}-${kind}-${hhmm}`,
      source: "web",
      deviceTime: t,
      sentAt: t,
      serverTime: t,
      recordedAt: t,
      workDate: date,
      skewSeconds: 0,
    });
  };
  const tasksOf = async (c: TestClient) =>
    ((await (await c.get("/api/v1/approvals/tasks")).json()) as { items: { taskId: string; requestId: string }[] })
      .items;
  const decide = async (c: TestClient, requestId: string, decision: "approve" | "reject", comment?: string) => {
    const task = (await tasksOf(c)).find((t) => t.requestId === requestId);
    if (!task) throw new Error("no task for that request");
    return c.post(`/api/v1/approvals/tasks/${task.taskId}/decision`, { decision, comment });
  };
  const submit = async (c: TestClient, body: Record<string, unknown>) => {
    const res = await c.post("/api/v1/attendance/timesheets", body);
    return { res, body: (await res.clone().json()) as { timesheet: Timesheet; warnings: string[] } };
  };

  it("is off by default, and settings keep it when a client leaves it out; payroll limit needs it on", async () => {
    const hr = await w.as("hr");
    const s = (await (await hr.get("/api/v1/attendance/settings")).json()) as Record<string, unknown>;
    expect(s.timesheets).toEqual({
      approval: false,
      period: "monthly",
      submittedBy: "employee",
      payrollApprovedOnly: false,
    });
    const me = (await (await (await w.as("staff")).get("/api/v1/attendance/me")).json()) as { timesheets: unknown };
    expect(me.timesheets).toEqual({ approval: false, period: "monthly", submittedBy: "employee" });
    // Off: submitting answers 409.
    const off = await (await w.as("staff")).post("/api/v1/attendance/timesheets", { date: "2026-10-01" });
    expect(off.status).toBe(409);
    expect(((await off.json()) as { error: { message: string } }).error.message).toMatch(/Settings → Attendance/);

    const { effectivePdpaNotice: _e, timesheets: _t, ...rest } = s;
    const bad = await hr.put("/api/v1/attendance/settings", {
      ...rest,
      timesheets: { approval: false, period: "monthly", submittedBy: "employee", payrollApprovedOnly: true },
    });
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as { error: { message: string } }).error.message).toMatch(/approval is on/);

    await setTimesheetApproval(hr, { approval: true, period: "weekly", payrollApprovedOnly: true });
    // An older client saves without `timesheets`: the stored values stay.
    const keep = await hr.put("/api/v1/attendance/settings", { ...rest, breakMinutes: 45 });
    expect(keep.status, await keep.clone().text()).toBe(200);
    expect(((await keep.json()) as { timesheets: unknown }).timesheets).toEqual({
      approval: true,
      period: "weekly",
      submittedBy: "employee",
      payrollApprovedOnly: true,
    });
    const audits = await w.deps.db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.action, "attendance.settings_updated"));
    expect(audits.some((a) => JSON.stringify(a.diff ?? {}).includes("timesheetApproval"))).toBe(true);
  });

  it("an employee submits October; it warns, snapshots the totals and goes to their manager, who approves", async () => {
    await setTimesheetApproval(await w.as("hr"), { approval: true });
    const s = w.emp.staff;
    await punchAt(s, "2026-10-01", "in", "09:00");
    await punchAt(s, "2026-10-01", "out", "18:00");
    await punchAt(s, "2026-10-02", "in", "09:00"); // no clock-out
    await punchAt(s, "2026-10-05", "in", "09:00");
    await punchAt(s, "2026-10-05", "out", "20:30"); // 150 min OT, not claimed
    const staff = await w.as("staff");

    const early = await staff.post("/api/v1/attendance/timesheets", { date: "2026-11-02" });
    expect(early.status).toBe(400);
    expect(((await early.json()) as { error: { message: string } }).error.message).toBe(
      "The timesheet for 1–30 Nov 2026 can be submitted once the period is over, from 1 Dec 2026.",
    );
    expect(
      (await staff.post("/api/v1/attendance/timesheets", { date: "2026-10-01", employeeId: w.emp.other })).status,
    ).toBe(404);

    const { res, body } = await submit(staff, { date: "2026-10-14" });
    expect(res.status, await res.clone().text()).toBe(201);
    expect(body.timesheet).toMatchObject({
      status: "submitted",
      periodStart: "2026-10-01",
      periodEnd: "2026-10-31",
      periodLabel: "1–31 Oct 2026",
      submittedBy: "Ravi Kumar",
      submittedTotals: { daysWorked: 2, workedMinutes: 480 + 630, missingPunches: 1, otMinutes: 150 },
    });
    expect(body.warnings.join(" ")).toMatch(/1 day has a missing punch \(2 Oct\)/);
    expect(body.warnings.join(" ")).toMatch(/Overtime on 1 day isn't claimed \(5 Oct\)/);
    expect((await staff.post("/api/v1/attendance/timesheets", { date: "2026-10-31" })).status).toBe(409);

    // The manager sees it in the inbox and on the overview, with the totals.
    const manager = await w.as("manager");
    const requestId = body.timesheet.approvalRequestId as string;
    const detail = (await (await manager.get(`/api/v1/approvals/requests/${requestId}`)).json()) as {
      summary: { title: string; lines: { label: string; value: string }[] };
      link: string;
    };
    expect(detail.summary.title).toBe("Timesheet, 1–31 Oct 2026");
    expect(detail.summary.lines).toEqual(
      expect.arrayContaining([
        { label: "Employee", value: "Ravi Kumar" },
        { label: "Days worked", value: "2" },
        { label: "Hours worked", value: "18 h 30 min" },
        { label: "Missing punches", value: "1" },
      ]),
    );
    expect(detail.link).toBe(`/attendance/timesheets?timesheet=${body.timesheet.id}`);
    const overview = (await (await manager.get("/api/v1/attendance/timesheets?date=2026-10-01")).json()) as Overview;
    const row = overview.items.find((i) => i.employee.id === s);
    expect(row).toMatchObject({ status: "submitted", canSubmit: false, canWithdraw: false, canReopen: false });
    expect(row?.taskId).toBeTruthy();
    // Colleagues can't read it.
    expect((await (await w.as("other")).get(`/api/v1/attendance/timesheets/${body.timesheet.id}`)).status).toBe(404);

    // A correction while pending is allowed, and is part of what is approved.
    const fix = await manager.post("/api/v1/attendance/corrections", {
      employeeId: s,
      kind: "out",
      time: "2026-10-02T18:00:00+08:00",
      reason: "Forgot to clock out",
    });
    expect(fix.status, await fix.clone().text()).toBe(201);
    const changed = (await (await manager.get(`/api/v1/approvals/requests/${requestId}`)).json()) as {
      summary: { context: { label: string }[] };
    };
    expect(changed.summary.context.map((c) => c.label)).toContain("Changed since it was sent");
    expect((await decide(manager, requestId, "approve")).status).toBe(200);
    const got = (await (await staff.get(`/api/v1/attendance/timesheets/${body.timesheet.id}`)).json()) as Timesheet;
    expect(got).toMatchObject({ status: "approved", decidedBy: "Wong Kai Wen" });
    expect(got.submittedTotals.workedMinutes).toBe(1110);
    expect(got.approvedTotals?.workedMinutes).toBe(1110 + 480);
    // HR may reopen it; the employee and the manager may not.
    const asHr = (await (
      await (await w.as("hr")).get(`/api/v1/attendance/timesheets?date=2026-10-01&employeeId=${s}`)
    ).json()) as Overview;
    expect(asHr.items[0]).toMatchObject({ status: "approved", canReopen: true, canSubmit: false });
    const mine = (await (await staff.get("/api/v1/attendance/timesheets?date=2026-10-01")).json()) as Overview;
    expect(mine.items.map((i) => i.employee.id)).toEqual([s]);
    expect(mine.items[0]).toMatchObject({ status: "approved", canReopen: false });
    const submitted = await w.deps.db
      .select()
      .from(auditEvents)
      .where(
        and(eq(auditEvents.action, "attendance.timesheet_submitted"), eq(auditEvents.targetId, body.timesheet.id)),
      );
    expect(submitted).toHaveLength(1);
  });

  it("returning needs a comment; a returned timesheet can be submitted again; withdrawal", async () => {
    await setTimesheetApproval(await w.as("hr"), { approval: true });
    const newbie = await w.as("newbie");
    const manager = await w.as("manager");
    const first = await submit(newbie, { date: "2026-10-01" });
    expect(first.res.status).toBe(201);
    const requestId = first.body.timesheet.approvalRequestId as string;
    expect((await decide(manager, requestId, "reject")).status).toBe(400);
    expect((await decide(manager, requestId, "reject", "Missing clock-out on 14 Oct")).status).toBe(200);
    const returned = (await (
      await newbie.get(`/api/v1/attendance/timesheets/${first.body.timesheet.id}`)
    ).json()) as Timesheet;
    expect(returned).toMatchObject({ status: "returned", comment: "Missing clock-out on 14 Oct" });
    const again = await submit(newbie, { date: "2026-10-01" });
    expect(again.res.status).toBe(201);
    expect(again.body.timesheet.id).not.toBe(first.body.timesheet.id);

    // Only the employee or the submitter withdraws; it closes the request and frees the period.
    expect((await manager.post(`/api/v1/attendance/timesheets/${again.body.timesheet.id}/withdraw`, {})).status).toBe(
      403,
    );
    const out = await newbie.post(`/api/v1/attendance/timesheets/${again.body.timesheet.id}/withdraw`, {});
    expect(out.status, await out.clone().text()).toBe(200);
    expect(((await out.json()) as Timesheet).status).toBe("withdrawn");
    expect((await tasksOf(manager)).some((t) => t.requestId === again.body.timesheet.approvalRequestId)).toBe(false);
    expect((await newbie.post(`/api/v1/attendance/timesheets/${again.body.timesheet.id}/withdraw`, {})).status).toBe(
      409,
    );
    expect((await submit(newbie, { date: "2026-10-01" })).res.status).toBe(201);
    // Before the hire date there is nothing to submit.
    const june = await newbie.post("/api/v1/attendance/timesheets", { date: "2026-06-01" });
    expect(june.status).toBe(400);
    expect(((await june.json()) as { error: { message: string } }).error.message).toMatch(/wasn't employed/);
    // After a switch to weekly periods, a week overlapping the open October timesheet is refused.
    await setTimesheetApproval(await w.as("hr"), { approval: true, period: "weekly" });
    const overlap = await newbie.post("/api/v1/attendance/timesheets", { date: "2026-10-26" });
    expect(overlap.status).toBe(409);
    expect(((await overlap.json()) as { error: { message: string } }).error.message).toBe(
      "The timesheet for 1–31 Oct 2026 was already submitted and is waiting for approval.",
    );
    expect((await submit(newbie, { date: "2026-11-02" })).res.status).toBe(201);
  });

  it("HR submits on an employee's behalf; in manager mode managers submit and HR decides", async () => {
    const hr = await w.as("hr");
    await setTimesheetApproval(hr, { approval: true });
    const onBehalf = await submit(hr, { date: "2026-10-01", employeeId: w.emp.partTimer });
    expect(onBehalf.res.status, await onBehalf.res.clone().text()).toBe(201);
    expect(onBehalf.body.timesheet.submittedBy).toBe("Tan Mei Ling");
    // A manager can't submit for a report while employees submit their own (out of scope: 404).
    expect(
      (
        await (
          await w.as("manager")
        ).post("/api/v1/attendance/timesheets", {
          date: "2026-10-01",
          employeeId: w.emp.staff,
        })
      ).status,
    ).toBe(404);

    await setTimesheetApproval(hr, { approval: true, submittedBy: "manager" });
    const staff = await w.as("staff");
    const own = await staff.post("/api/v1/attendance/timesheets", { date: "2026-10-01" });
    expect(own.status).toBe(403);
    expect(((await own.json()) as { error: { message: string } }).error.message).toMatch(/managers submit timesheets/);
    const manager = await w.as("manager");
    const mine = (await (await manager.get("/api/v1/attendance/timesheets?date=2026-10-01")).json()) as Overview;
    expect(mine.items.find((i) => i.employee.id === w.emp.satRest)?.canSubmit).toBe(true);
    expect(mine.items.find((i) => i.employee.id === w.emp.manager)?.canSubmit).toBe(false);
    const filed = await submit(manager, { date: "2026-10-01", employeeId: w.emp.satRest });
    expect(filed.res.status, await filed.res.clone().text()).toBe(201);
    const requestId = filed.body.timesheet.approvalRequestId as string;
    // The manager filed it, so the manager step is skipped and HR decides.
    expect((await tasksOf(manager)).some((t) => t.requestId === requestId)).toBe(false);
    expect((await decide(hr, requestId, "approve")).status).toBe(200);
    expect(
      ((await (await manager.get(`/api/v1/attendance/timesheets/${filed.body.timesheet.id}`)).json()) as Timesheet)
        .status,
    ).toBe("approved");
  });

  it("Home lists the latest ended period until it is submitted (employee mode), and the team count (manager mode)", async () => {
    const hr = await w.as("hr");
    const inbox = async (c: TestClient) =>
      (
        (await (await c.get("/api/v1/inbox")).json()) as { items: { kind: string; title: string; href: string }[] }
      ).items.filter((i) => i.kind === "timesheet_due");
    const staff = await w.as("staff");
    expect(await inbox(staff)).toEqual([]);
    await setTimesheetApproval(hr, { approval: true });
    expect(await inbox(staff)).toEqual([
      expect.objectContaining({
        title: "Submit your timesheet for 1–31 Oct 2026",
        href: "/attendance/timesheet?period=2026-10-01",
      }),
    ]);
    expect((await submit(staff, { date: "2026-10-01" })).res.status).toBe(201);
    expect(await inbox(staff)).toEqual([]);
    // The manager now has the approval task on Home.
    const manager = await w.as("manager");
    const items = ((await (await manager.get("/api/v1/inbox")).json()) as { items: { kind: string; title: string }[] })
      .items;
    expect(items.some((i) => i.kind === "approval" && i.title === "Timesheet, 1–31 Oct 2026")).toBe(true);

    await setTimesheetApproval(hr, { approval: true, submittedBy: "manager" });
    // Ravi submitted; Siti, Daniel and Ahmad haven't.
    expect(await inbox(manager)).toEqual([
      expect.objectContaining({
        title: "Submit 3 timesheets for 1–31 Oct 2026",
        href: "/attendance/timesheets?date=2026-10-01",
      }),
    ]);
    expect(await inbox(await w.as("newbie"))).toEqual([]);
  });
});
