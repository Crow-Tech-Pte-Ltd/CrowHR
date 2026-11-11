import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { clientAs, createWorkflowWorld, EMP, type WorkflowWorld } from "../../testing/index.ts";
import { markMembershipFormer } from "../access/members-routes.ts";
import { systemAuditContext } from "../audit/audit.ts";
import { auditEvents } from "../db/schema/audit.ts";
import { approvalRequests, approvalTasks } from "../db/schema/workflows.ts";
import { createDelegation } from "./delegations.ts";
import { decideTask, onReportingLineChanged } from "./engine.ts";
import { replacePolicies } from "./policies.ts";

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

  it("losing the last step's approver after an approval finishes the request as approved", async () => {
    const audit = systemAuditContext(w.org.id, "system", "test");
    await replacePolicies(w.deps.db, w.deps, audit, w.org.id, "claim", [
      {
        name: "Two managers",
        condition: null,
        priority: 0,
        steps: [
          { approverRule: "manager", escalateAfterDays: 3 },
          { approverRule: "manager_of_manager", escalateAfterDays: 3 },
        ],
      },
    ]);
    const { requestId, subjectId } = await w.submit(w.m.staff, "claim", { amountCents: 3_000 });
    const [first] = (await tasks(requestId)).filter((t) => t.status === "pending");
    await decideTask(
      w.deps,
      { orgId: w.org.id, membershipId: w.m.manager.membershipId, roles: [], audit },
      { taskId: first?.id as string, decision: "approve" },
    );
    expect((await tasks(requestId)).find((t) => t.status === "pending")?.assigneeMembershipId).toBe(
      w.m.head.membershipId,
    );
    // Staff now report to the owner, who has no manager: step 2 has nobody left to decide.
    w.managers[EMP.staff] = EMP.owner;
    await w.deps.db.transaction((tx) =>
      onReportingLineChanged(tx, w.deps, audit, { orgId: w.org.id, employeeId: EMP.staff }),
    );
    const [request] = await w.deps.db.select().from(approvalRequests).where(eq(approvalRequests.id, requestId));
    expect(request?.status).toBe("approved");
    expect(w.fake.state.get(subjectId)).toBe("approved");
    expect((await tasks(requestId)).filter((t) => t.status === "pending")).toEqual([]);
  });

  it("a manager who leaves: their step is skipped, so HR decides once, not twice", async () => {
    const audit = systemAuditContext(w.org.id, "system", "test");
    const { requestId, subjectId } = await w.submit(w.m.staff, "claim", { amountCents: 3_000 });
    await markMembershipFormer(w.deps, w.deps.db, audit, { orgId: w.org.id, employeeId: EMP.manager });
    const open = () => tasks(requestId).then((all) => all.filter((t) => t.status === "pending"));
    const hrTask = (await open()).find((t) => t.assigneeMembershipId === w.m.hr.membershipId);
    expect(hrTask?.position).toBe(2);
    await decideTask(
      w.deps,
      { orgId: w.org.id, membershipId: w.m.hr.membershipId, roles: ["hr_admin"], audit },
      { taskId: hrTask?.id as string, decision: "approve" },
    );
    expect(w.fake.state.get(subjectId)).toBe("approved");
    expect(await open()).toEqual([]);
  });

  it("reassigning a task retires the cover tasks on its holder's behalf; a cover task itself isn't reassigned", async () => {
    const audit = systemAuditContext(w.org.id, "system", "test");
    const { requestId } = await w.submit(w.m.staff, "leave");
    await createDelegation(
      w.deps,
      { orgId: w.org.id, membershipId: w.m.manager.membershipId, canManageOthers: false, audit },
      { toMembershipId: w.m.head.membershipId, startsOn: "2026-10-01", endsOn: "2026-12-31", subjectTypes: null },
    );
    const open = () => tasks(requestId).then((all) => all.filter((t) => t.status === "pending"));
    const cover = (await open()).find((t) => t.origin === "delegated");
    expect(cover?.assigneeMembershipId).toBe(w.m.head.membershipId);
    const asHr = await clientAs(w.app, w.deps, w.m.hr);
    const refused = await asHr.post(`/api/v1/approvals/tasks/${cover?.id}/reassign`, {
      toMembershipId: w.m.other.membershipId,
      reason: "Rajesh is busy",
    });
    expect(refused.status).toBe(409);
    expect(((await refused.json()) as { error: { message: string } }).error.message).toMatch(/Wong Kai Wen's own task/);
    const own = (await open()).find((t) => t.origin === "resolved");
    const res = await asHr.post(`/api/v1/approvals/tasks/${own?.id}/reassign`, {
      toMembershipId: w.m.other.membershipId,
      reason: "Wong is on medical leave",
    });
    expect(res.status).toBe(200);
    expect((await open()).map((t) => [t.assigneeMembershipId, t.origin])).toEqual([
      [w.m.other.membershipId, "reassigned"],
    ]);
  });

  it("a member who loses the role of their task gives it up, and the step re-resolves", async () => {
    // A bank change goes to the payroll admin; the owner then removes that role.
    const { requestId } = await w.submit(w.m.staff, "profile_change", { typeCode: "bank" });
    const open = () => tasks(requestId).then((all) => all.filter((t) => t.status === "pending"));
    expect((await open()).map((t) => t.assigneeMembershipId)).toEqual([w.m.payroll.membershipId]);
    const owner = await clientAs(w.app, w.deps, w.m.owner);
    expect((await owner.put(`/api/v1/members/${w.m.payroll.membershipId}/roles`, { roles: [] })).status).toBe(200);
    const now = await open();
    expect(now.some((t) => t.assigneeMembershipId === w.m.payroll.membershipId)).toBe(false);
    // Nobody else holds payroll_admin, so bank changes fall back to owners (never HR).
    expect(now.map((t) => t.assigneeMembershipId)).toEqual([w.m.owner.membershipId]);
    const [gone] = (await tasks(requestId)).filter((t) => t.assigneeMembershipId === w.m.payroll.membershipId);
    expect(gone).toMatchObject({ status: "superseded", supersededReason: "role_removed" });
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
