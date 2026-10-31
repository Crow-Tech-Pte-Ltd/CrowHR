import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { TestClient } from "../../testing/http.ts";
import { createLeaveWorld, type LeaveWorld } from "../../testing/leave.ts";
import { auditEvents } from "../db/schema/audit.ts";
import { leaveLedger } from "../db/schema/leave.ts";

/** Approval and cancellation through the workflows engine (spec "Approval and cancellation"). */
describe("leave approvals", () => {
  let w: LeaveWorld;
  beforeEach(async () => {
    w = await createLeaveWorld();
  });
  afterEach(() => w.close());

  const annualId = async (c: TestClient) => {
    const body = (await (await c.get("/api/v1/leave/types")).json()) as { items: { id: string; code: string }[] };
    return body.items.find((t) => t.code === "annual")?.id as string;
  };
  const apply = async (c: TestClient, startDate: string, endDate: string) => {
    const res = await c.post("/api/v1/leave/requests", { leaveTypeId: await annualId(c), startDate, endDate });
    expect(res.status, await res.clone().text()).toBe(201);
    return (await res.json()) as { id: string; status: string };
  };
  const annual = async (c: TestClient) => {
    const b = (await (await c.get("/api/v1/leave/balances")).json()) as {
      items: { code: string; available: number; taken: number; pending: number }[];
    };
    return b.items.find((x) => x.code === "annual");
  };
  const taskFor = async (c: TestClient, subjectType = "leave") => {
    const tasks = (await (await c.get("/api/v1/approvals/tasks")).json()) as {
      items: { taskId: string; subjectType: string; title: string; requester: { name: string } }[];
    };
    return tasks.items.find((t) => t.subjectType === subjectType);
  };
  const decide = (c: TestClient, taskId: string, decision: "approve" | "reject", comment?: string) =>
    c.post(`/api/v1/approvals/tasks/${taskId}/decision`, { decision, comment });

  it("the manager approves in the engine and the balance is charged in the same transaction", async () => {
    const staff = await w.as("staff");
    const r = await apply(staff, "2026-11-10", "2026-11-11");
    expect(await annual(staff)).toMatchObject({ available: 7, pending: 2, taken: 0 });
    const manager = await w.as("manager");
    const task = await taskFor(manager);
    expect(task).toMatchObject({ title: "Annual leave, 10–11 Nov 2026", requester: { name: "Ravi Kumar" } });
    const res = await decide(manager, task?.taskId as string, "approve");
    expect(res.status).toBe(200);
    expect(((await (await staff.get(`/api/v1/leave/requests/${r.id}`)).json()) as { status: string }).status).toBe(
      "approved",
    );
    expect(await annual(staff)).toMatchObject({ available: 7, pending: 0, taken: 2 });
    const ledger = await w.deps.db.select().from(leaveLedger).where(eq(leaveLedger.requestId, r.id));
    expect(ledger.map((l) => [l.kind, l.hundredths, l.leaveYear])).toEqual([["taken", -200, 2026]]);
  });

  it("rejection needs a comment and releases the pending days; withdrawal too", async () => {
    const staff = await w.as("staff");
    const manager = await w.as("manager");
    const a = await apply(staff, "2026-11-10", "2026-11-10");
    const task = await taskFor(manager);
    expect((await decide(manager, task?.taskId as string, "reject")).status).toBe(400);
    expect((await decide(manager, task?.taskId as string, "reject", "Short-staffed that day")).status).toBe(200);
    expect(((await (await staff.get(`/api/v1/leave/requests/${a.id}`)).json()) as { status: string }).status).toBe(
      "rejected",
    );
    const b = await apply(staff, "2026-11-12", "2026-11-13");
    expect((await annual(staff))?.pending).toBe(2);
    const wd = await staff.post(`/api/v1/leave/requests/${b.id}/withdraw`, {});
    expect(wd.status).toBe(200);
    expect(((await wd.json()) as { status: string }).status).toBe("withdrawn");
    expect(await annual(staff)).toMatchObject({ pending: 0, available: 9 });
    expect(await taskFor(manager)).toBeUndefined();
  });

  it("refuses the approval when the balance no longer covers the leave", async () => {
    const staff = await w.as("staff");
    const r = await apply(staff, "2026-11-16", "2026-11-20");
    const hr = await w.as("hr");
    const adj = await hr.post("/api/v1/leave/adjustments", {
      employeeId: w.emp.staff,
      leaveTypeId: await annualId(hr),
      year: 2026,
      amount: -6,
      reason: "Correction: days taken in January",
    });
    expect(adj.status).toBe(201);
    const manager = await w.as("manager");
    const task = await taskFor(manager);
    const res = await decide(manager, task?.taskId as string, "approve");
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe("insufficient_balance");
    expect(body.error.message).toMatch(/no longer has enough annual leave for 2026 \(3 days left, 5 asked\)/);
    expect(((await (await staff.get(`/api/v1/leave/requests/${r.id}`)).json()) as { status: string }).status).toBe(
      "pending",
    );
  });

  it("cancelling approved leave goes for approval and restores the balance", async () => {
    const staff = await w.as("staff");
    const manager = await w.as("manager");
    const r = await apply(staff, "2026-11-10", "2026-11-11");
    await decide(manager, (await taskFor(manager))?.taskId as string, "approve");
    expect((await annual(staff))?.available).toBe(7);
    const cancel = await staff.post(`/api/v1/leave/requests/${r.id}/cancel`, { reason: "Trip postponed" });
    expect(cancel.status).toBe(200);
    expect(((await cancel.json()) as { status: string }).status).toBe("cancellation_pending");
    // Still charged while the cancellation waits.
    expect((await annual(staff))?.available).toBe(7);
    const task = await taskFor(manager, "leave_cancellation");
    expect(task?.title).toBe("Cancel annual leave, 10–11 Nov 2026");
    expect((await decide(manager, task?.taskId as string, "approve")).status).toBe(200);
    expect(((await (await staff.get(`/api/v1/leave/requests/${r.id}`)).json()) as { status: string }).status).toBe(
      "cancelled",
    );
    expect(await annual(staff)).toMatchObject({ available: 9, taken: 0 });
  });

  it("a rejected cancellation leaves the leave approved; HR may cancel directly with an audit entry", async () => {
    const staff = await w.as("staff");
    const manager = await w.as("manager");
    const r = await apply(staff, "2026-11-10", "2026-11-11");
    await decide(manager, (await taskFor(manager))?.taskId as string, "approve");
    await staff.post(`/api/v1/leave/requests/${r.id}/cancel`, { reason: "Changed my mind" });
    const t = await taskFor(manager, "leave_cancellation");
    expect((await decide(manager, t?.taskId as string, "reject", "Cover already arranged")).status).toBe(200);
    expect(((await (await staff.get(`/api/v1/leave/requests/${r.id}`)).json()) as { status: string }).status).toBe(
      "approved",
    );
    // Staff can't skip the approval.
    expect((await staff.post(`/api/v1/leave/requests/${r.id}/cancel`, { direct: true })).status).toBe(403);
    const hr = await w.as("hr");
    const direct = await hr.post(`/api/v1/leave/requests/${r.id}/cancel`, { direct: true, reason: "Outlet closed" });
    expect(direct.status).toBe(200);
    expect(((await direct.json()) as { status: string }).status).toBe("cancelled");
    expect((await annual(staff))?.available).toBe(9);
    const events = await w.deps.db
      .select()
      .from(auditEvents)
      .where(and(eq(auditEvents.orgId, w.orgId), eq(auditEvents.action, "leave.cancelled")));
    expect(events).toHaveLength(1);
  });

  it("a request with no manager falls back to HR", async () => {
    const other = await w.as("other");
    await apply(other, "2026-11-10", "2026-11-10");
    const hr = await w.as("hr");
    expect(await taskFor(hr)).toMatchObject({ requester: { name: "Farah Hassan" } });
  });
});
