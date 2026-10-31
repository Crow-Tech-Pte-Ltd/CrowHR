import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { punch } from "../../testing/attendance.ts";
import type { TestClient } from "../../testing/http.ts";
import { createLeaveWorld, type LeaveWorld } from "../../testing/leave.ts";
import { overtimeClaims } from "../db/schema/attendance.ts";

/** Overtime claims through the workflows engine (spec "Overtime and claims"). */
describe("overtime claims", () => {
  let w: LeaveWorld;
  beforeEach(async () => {
    // Friday 13 Nov 2026, 10:00 SGT.
    w = await createLeaveWorld({ now: "2026-11-13T02:00:00.000Z" });
  });
  afterEach(() => w.close());

  const SENT = "2026-11-13T02:00:00.000Z";
  /** in/out on `date` at SGT times. */
  const worked = async (c: TestClient, date: string, from: string, to: string) => {
    await punch(c, "in", new Date(`${date}T${from}:00+08:00`).toISOString(), { sentAt: SENT, queued: true });
    await punch(c, "out", new Date(`${date}T${to}:00+08:00`).toISOString(), { sentAt: SENT, queued: true });
  };
  const decide = async (decision: "approve" | "reject", comment?: string) => {
    const manager = await w.as("manager");
    const tasks = (await (await manager.get("/api/v1/approvals/tasks")).json()) as {
      items: { taskId: string; requestId: string }[];
    };
    const task = tasks.items[0];
    if (!task) throw new Error("no task");
    const res = await manager.post(`/api/v1/approvals/tasks/${task.taskId}/decision`, { decision, comment });
    expect(res.status, await res.clone().text()).toBe(200);
    return task;
  };

  it("claims up to the timesheet's OT, as statutory OT for a Part 4 employee, and the manager approves it", async () => {
    const staff = await w.as("staff");
    await worked(staff, "2026-11-12", "09:00", "20:30"); // 150 min OT
    const tooMuch = await staff.post("/api/v1/attendance/overtime", { date: "2026-11-12", minutes: 180 });
    expect(tooMuch.status).toBe(400);
    expect(((await tooMuch.json()) as { error: { message: string } }).error.message).toMatch(/At most 2 h 30 min/);
    const res = await staff.post("/api/v1/attendance/overtime", {
      date: "2026-11-12",
      minutes: 90,
      reason: "Stocktake",
    });
    expect(res.status, await res.clone().text()).toBe(201);
    const { claim, warnings } = (await res.json()) as {
      claim: { id: string; statutory: boolean; status: string; computedMinutes: number };
      warnings: string[];
    };
    expect(claim).toMatchObject({ statutory: true, status: "pending", computedMinutes: 150 });
    expect(warnings).toEqual([]);
    const again = await staff.post("/api/v1/attendance/overtime", { date: "2026-11-12", minutes: 30 });
    expect(again.status).toBe(409);

    await decide("approve");
    const got = (await (await staff.get(`/api/v1/attendance/overtime/${claim.id}`)).json()) as {
      status: string;
      approvedMinutes: number;
    };
    expect(got).toMatchObject({ status: "approved", approvedMinutes: 90 });
    const feed = (await (
      await (
        await w.as("payroll")
      ).get("/api/v1/attendance/payroll-overtime?periodStart=2026-11-01&periodEnd=2026-11-30")
    ).json()) as { items: unknown[] };
    expect(feed.items).toEqual([
      { sourceId: claim.id, employeeId: w.emp.staff, minutes: 90, periodStart: "2026-11-12", periodEnd: "2026-11-12" },
    ]);
    // The timesheet shows the claim on the day.
    const sheet = (await (await staff.get("/api/v1/attendance/timesheet?from=2026-11-12&to=2026-11-12")).json()) as {
      days: { otClaim: { status: string } | null }[];
    };
    expect(sheet.days[0]?.otClaim?.status).toBe("approved");
  });

  it("warns, without blocking, when the month would pass 72 hours, and shows it to the approver", async () => {
    // 70 hours already approved in November.
    for (let i = 0; i < 7; i++) {
      await w.deps.db.insert(overtimeClaims).values({
        id: w.deps.ids.newId(),
        orgId: w.orgId,
        employeeId: w.emp.staff,
        workDate: `2026-11-0${i + 1}`,
        computedMinutes: 600,
        claimedMinutes: 600,
        approvedMinutes: 600,
        statutory: true,
        status: "approved",
        createdByMembershipId: w.m.staff.membershipId,
      });
    }
    const staff = await w.as("staff");
    await worked(staff, "2026-11-11", "09:00", "21:00"); // 180 min OT
    const res = await staff.post("/api/v1/attendance/overtime", { date: "2026-11-11", minutes: 180 });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { claim: { approvalRequestId: string }; warnings: string[] };
    expect(body.warnings.join(" ")).toMatch(/73 OT hours this month exceeds the 72-hour limit/);
    const detail = (await (
      await (await w.as("manager")).get(`/api/v1/approvals/requests/${body.claim.approvalRequestId}`)
    ).json()) as { summary: { title: string; context: { label: string; value: string }[] } };
    expect(detail.summary.title).toBe("Overtime, 11 Nov 2026");
    expect(detail.summary.context[0]).toEqual({
      label: "OT in Nov 2026",
      value: "73 h of 72 h (over the 72-hour monthly limit: lawful only with an MOM exemption)",
    });
  });

  it("an employee outside Part 4 gets contractual OT; rejection and withdrawal close claims", async () => {
    const other = await w.as("other");
    await worked(other, "2026-11-12", "09:00", "20:00");
    const res = await other.post("/api/v1/attendance/overtime", { date: "2026-11-12", minutes: 60 });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { claim: { id: string; statutory: boolean }; warnings: string[] };
    expect(body.claim.statutory).toBe(false);
    expect(body.warnings.join(" ")).toMatch(/contractual/);
    const withdrawn = await other.post(`/api/v1/attendance/overtime/${body.claim.id}/withdraw`, {});
    expect(((await withdrawn.json()) as { status: string }).status).toBe("withdrawn");
    expect((await other.post(`/api/v1/attendance/overtime/${body.claim.id}/withdraw`, {})).status).toBe(409);

    const staff = await w.as("staff");
    await worked(staff, "2026-11-12", "09:00", "20:00");
    const c = (await (await staff.post("/api/v1/attendance/overtime", { date: "2026-11-12", minutes: 60 })).json()) as {
      claim: { id: string };
    };
    await decide("reject", "Not pre-approved");
    const got = (await (await staff.get(`/api/v1/attendance/overtime/${c.claim.id}`)).json()) as { status: string };
    expect(got.status).toBe("rejected");
    // A rejected day can be claimed again.
    expect((await staff.post("/api/v1/attendance/overtime", { date: "2026-11-12", minutes: 30 })).status).toBe(201);
    // Not for a future day, and colleagues can't read it.
    expect((await staff.post("/api/v1/attendance/overtime", { date: "2026-11-20", minutes: 30 })).status).toBe(400);
    expect((await (await w.as("other")).get(`/api/v1/attendance/overtime/${c.claim.id}`)).status).toBe(404);
    const mine = (await (await staff.get("/api/v1/attendance/overtime")).json()) as { items: unknown[] };
    expect(mine.items).toHaveLength(2);
  });
});
