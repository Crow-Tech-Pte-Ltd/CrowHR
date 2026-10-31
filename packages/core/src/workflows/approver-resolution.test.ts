import { and, asc, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createWorkflowWorld, seedMember, seedOrg, type WorkflowWorld } from "../../testing/index.ts";
import { systemAuditContext } from "../audit/audit.ts";
import { memberships } from "../db/schema/access.ts";
import { approvalSteps, approvalTasks } from "../db/schema/workflows.ts";
import { decideTask, resolveRule, submitApproval } from "./engine.ts";
import { replacePolicies } from "./policies.ts";

describe("approver resolution", () => {
  let w: WorkflowWorld;
  beforeEach(async () => {
    w = await createWorkflowWorld();
  });
  afterEach(() => w.close());

  const ctx = () => ({ db: w.deps.db, deps: w.deps, now: w.deps.clock.now() });
  const requestOf = (m: { membershipId: string; employeeId: string | null }) => ({
    orgId: w.org.id,
    requesterMembershipId: m.membershipId,
    requesterEmployeeId: m.employeeId,
  });
  const steps = (requestId: string) =>
    w.deps.db
      .select()
      .from(approvalSteps)
      .where(eq(approvalSteps.requestId, requestId))
      .orderBy(asc(approvalSteps.position));
  const openTasks = (requestId: string) =>
    w.deps.db
      .select()
      .from(approvalTasks)
      .where(and(eq(approvalTasks.requestId, requestId), eq(approvalTasks.status, "pending")));
  const assignees = async (requestId: string) => (await openTasks(requestId)).map((t) => t.assigneeMembershipId).sort();

  it("resolves manager, manager_of_manager, role and member rules", async () => {
    const r = requestOf(w.m.staff);
    expect((await resolveRule(ctx(), r, "manager")).members.map((m) => m.membershipId)).toEqual([
      w.m.manager.membershipId,
    ]);
    expect((await resolveRule(ctx(), r, "manager_of_manager")).members.map((m) => m.membershipId)).toEqual([
      w.m.head.membershipId,
    ]);
    expect((await resolveRule(ctx(), r, "role:hr_admin")).members.map((m) => m.membershipId).sort()).toEqual(
      [w.m.hr.membershipId, w.m.hr2.membershipId].sort(),
    );
    expect(
      (await resolveRule(ctx(), r, `member:${w.m.payroll.membershipId}`)).members.map((m) => m.membershipId),
    ).toEqual([w.m.payroll.membershipId]);
  });

  it("skips self, no manager and suspended approvers with the reason", async () => {
    expect((await resolveRule(ctx(), requestOf(w.m.loner), "manager")).skipReason).toBe("no_manager");
    expect(
      (await resolveRule(ctx(), requestOf({ membershipId: w.m.hr2.membershipId, employeeId: null }), "manager"))
        .skipReason,
    ).toBe("no_manager");
    expect((await resolveRule(ctx(), requestOf(w.m.staff), `member:${w.m.staff.membershipId}`)).skipReason).toBe(
      "self",
    );
    await w.deps.db
      .update(memberships)
      .set({ status: "suspended" })
      .where(eq(memberships.id, w.m.manager.membershipId));
    expect((await resolveRule(ctx(), requestOf(w.m.staff), "manager")).skipReason).toBe("inactive");
  });

  it("employee without manager: manager step skipped with no_manager, hr_admins get the task", async () => {
    const { requestId } = await w.submit(w.m.loner, "leave");
    const s = await steps(requestId);
    expect(s[0]).toMatchObject({ approverRule: "manager", status: "skipped", skipReason: "no_manager" });
    expect(s[1]).toMatchObject({ approverRule: "role:hr_admin", status: "active" });
    expect(await assignees(requestId)).toEqual([w.m.hr.membershipId, w.m.hr2.membershipId].sort());
  });

  it("manager applies for own leave: the owner (their manager) gets it, they cannot approve it", async () => {
    const { requestId } = await w.submit(w.m.head, "leave");
    expect(await assignees(requestId)).toEqual([w.m.owner.membershipId]);
    const tasks = await openTasks(requestId);
    await expect(
      decideTask(
        w.deps,
        {
          orgId: w.org.id,
          membershipId: w.m.head.membershipId,
          roles: [],
          audit: systemAuditContext(w.org.id, "system", "t"),
        },
        {
          taskId: tasks[0]?.id as string,
          decision: "approve",
        },
      ),
    ).rejects.toMatchObject({ code: "not_found" });
  });

  it("all steps skipped → hr_admins", async () => {
    await replacePolicies(w.deps.db, w.deps, systemAuditContext(w.org.id, "system", "t"), w.org.id, "leave", [
      { name: "Default", condition: null, priority: 0, steps: [{ approverRule: "manager", escalateAfterDays: 3 }] },
    ]);
    const { requestId } = await w.submit(w.m.loner, "leave");
    const s = await steps(requestId);
    expect(s.map((x) => [x.approverRule, x.status, x.fallback])).toEqual([
      ["manager", "skipped", false],
      ["role:hr_admin", "active", true],
    ]);
    expect(await assignees(requestId)).toEqual([w.m.hr.membershipId, w.m.hr2.membershipId].sort());
  });

  it("an hr_admin's request skips themselves; with no other hr_admin it goes to owners", async () => {
    // hr2 has no manager; hr is the other hr_admin.
    const first = await w.submit(w.m.hr2, "leave");
    expect(await assignees(first.requestId)).toEqual([w.m.hr.membershipId]);
    // Make hr2 the only hr_admin.
    await w.deps.db.update(memberships).set({ status: "suspended" }).where(eq(memberships.id, w.m.hr.membershipId));
    const second = await w.submit(w.m.hr2, "leave");
    const s = await steps(second.requestId);
    expect(s.map((x) => [x.approverRule, x.status, x.skipReason])).toEqual([
      ["manager", "skipped", "no_manager"],
      ["role:hr_admin", "skipped", "self"],
      ["role:owner", "active", null],
    ]);
    expect(await assignees(second.requestId)).toEqual([w.m.owner.membershipId]);
  });

  it("payroll runs go to owners, never hr_admins", async () => {
    await replacePolicies(w.deps.db, w.deps, systemAuditContext(w.org.id, "system", "t"), w.org.id, "payroll_run", [
      { name: "Default", condition: null, priority: 0, steps: [{ approverRule: "manager", escalateAfterDays: 3 }] },
    ]);
    const { requestId } = await w.submit(w.m.payroll, "payroll_run");
    expect(await assignees(requestId)).toEqual([w.m.owner.membershipId]);
  });

  it("a sole owner may decide their own request, marked self_approved", async () => {
    const org = await seedOrg(w.deps);
    const solo = await seedMember(w.deps, org.id, { roles: ["owner"], displayName: "Solo Owner" });
    const audit = systemAuditContext(org.id, "system", "t");
    const subjectId = w.deps.ids.newId();
    const { requestId } = await w.deps.db.transaction((tx) =>
      submitApproval(tx, w.deps, audit, {
        orgId: org.id,
        subjectType: "payroll_run",
        subjectId,
        requesterMembershipId: solo.membershipId,
      }),
    );
    const [task] = await openTasks(requestId);
    expect(task).toMatchObject({ assigneeMembershipId: solo.membershipId, selfApproved: true });
    const result = await decideTask(
      w.deps,
      { orgId: org.id, membershipId: solo.membershipId, roles: ["owner"], audit },
      {
        taskId: task?.id as string,
        decision: "approve",
      },
    );
    expect(result.requestStatus).toBe("approved");
    const [decided] = await w.deps.db
      .select()
      .from(approvalTasks)
      .where(eq(approvalTasks.id, task?.id as string));
    expect(decided).toMatchObject({ status: "approved", selfApproved: true });
  });

  it("a requester who is not an owner never gets a self-approval task", async () => {
    const org = await seedOrg(w.deps);
    const lone = await seedMember(w.deps, org.id, { roles: ["hr_admin"] });
    const audit = systemAuditContext(org.id, "system", "t");
    const { requestId, status } = await w.deps.db.transaction((tx) =>
      submitApproval(tx, w.deps, audit, {
        orgId: org.id,
        subjectType: "leave",
        subjectId: w.deps.ids.newId(),
        requesterMembershipId: lone.membershipId,
      }),
    );
    expect(status).toBe("pending");
    expect(await openTasks(requestId)).toEqual([]);
  });
});
