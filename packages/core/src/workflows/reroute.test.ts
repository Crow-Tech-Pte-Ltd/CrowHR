import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { clientAs, createWorkflowWorld, EMP, type WorkflowWorld } from "../../testing/index.ts";
import { systemAuditContext } from "../audit/audit.ts";
import { auditEvents } from "../db/schema/audit.ts";
import { approvalTasks } from "../db/schema/workflows.ts";
import { onReportingLineChanged } from "./engine.ts";

describe("re-routing and reassignment", () => {
  let w: WorkflowWorld;
  beforeEach(async () => {
    w = await createWorkflowWorld();
  });
  afterEach(() => w.close());

  const tasks = (requestId: string) =>
    w.deps.db.select().from(approvalTasks).where(eq(approvalTasks.requestId, requestId));

  it("manager change from B to D: B's task is superseded and D receives it", async () => {
    const { requestId } = await w.submit(w.m.staff, "claim", { amountCents: 3_000 });
    expect((await tasks(requestId)).map((t) => t.assigneeMembershipId)).toEqual([w.m.manager.membershipId]);
    w.managers[EMP.staff] = EMP.head; // the people module changes the line…
    const moved = await w.deps.db.transaction((tx) =>
      onReportingLineChanged(tx, w.deps, systemAuditContext(w.org.id, "system", "people"), {
        orgId: w.org.id,
        employeeId: EMP.staff,
      }),
    );
    expect(moved).toBe(1);
    const all = await tasks(requestId);
    expect(all.find((t) => t.assigneeMembershipId === w.m.manager.membershipId)).toMatchObject({
      status: "superseded",
      supersededReason: "rerouted",
    });
    expect(all.find((t) => t.assigneeMembershipId === w.m.head.membershipId)).toMatchObject({
      status: "pending",
      origin: "resolved",
    });
    // Nothing to do when the line didn't change.
    const again = await w.deps.db.transaction((tx) =>
      onReportingLineChanged(tx, w.deps, systemAuditContext(w.org.id, "system", "people"), {
        orgId: w.org.id,
        employeeId: EMP.staff,
      }),
    );
    expect(again).toBe(0);
  });

  it("losing the manager skips the step and moves on to HR", async () => {
    const { requestId } = await w.submit(w.m.staff, "leave");
    w.managers[EMP.staff] = null;
    await w.deps.db.transaction((tx) =>
      onReportingLineChanged(tx, w.deps, systemAuditContext(w.org.id, "system", "people"), {
        orgId: w.org.id,
        employeeId: EMP.staff,
      }),
    );
    const open = (await tasks(requestId)).filter((t) => t.status === "pending").map((t) => t.assigneeMembershipId);
    expect(open.sort()).toEqual([w.m.hr.membershipId, w.m.hr2.membershipId].sort());
  });

  it("an hr_admin reassigns a pending task with a reason; it is audited", async () => {
    const { requestId } = await w.submit(w.m.staff, "leave");
    const [task] = await tasks(requestId);
    const asHr = await clientAs(w.app, w.deps, w.m.hr);
    const res = await asHr.post(`/api/v1/approvals/tasks/${task?.id}/reassign`, {
      toMembershipId: w.m.other.membershipId,
      reason: "Wong is on medical leave",
    });
    expect(res.status).toBe(200);
    const all = await tasks(requestId);
    expect(all.find((t) => t.id === task?.id)).toMatchObject({ status: "superseded", supersededReason: "reassigned" });
    expect(all.find((t) => t.assigneeMembershipId === w.m.other.membershipId)).toMatchObject({
      status: "pending",
      origin: "reassigned",
    });
    const [event] = await w.deps.db
      .select()
      .from(auditEvents)
      .where(and(eq(auditEvents.action, "approval.task_reassigned"), eq(auditEvents.targetId, requestId)));
    expect(event?.meta).toMatchObject({ reason: "Wong is on medical leave", to: w.m.other.membershipId });

    // Not to the requester, and not by a plain employee.
    const [next] = (await tasks(requestId)).filter((t) => t.status === "pending");
    const toSelf = await asHr.post(`/api/v1/approvals/tasks/${next?.id}/reassign`, {
      toMembershipId: w.m.staff.membershipId,
      reason: "x",
    });
    expect(toSelf.status).toBe(400);
    const asStaff = await clientAs(w.app, w.deps, w.m.staff);
    const denied = await asStaff.post(`/api/v1/approvals/tasks/${next?.id}/reassign`, {
      toMembershipId: w.m.other.membershipId,
      reason: "x",
    });
    expect(denied.status).toBe(403);
  });

  it("hr_admins cannot reassign payroll approvals", async () => {
    const { requestId } = await w.submit(w.m.payroll, "payroll_run");
    const [task] = await tasks(requestId);
    const asHr = await clientAs(w.app, w.deps, w.m.hr);
    const res = await asHr.post(`/api/v1/approvals/tasks/${task?.id}/reassign`, {
      toMembershipId: w.m.hr.membershipId,
      reason: "Owner away",
    });
    expect(res.status).toBe(404);
  });
});
