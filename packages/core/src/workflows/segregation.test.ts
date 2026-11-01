import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  clientAs,
  createFakeSubjects,
  createWorkflowWorld,
  movableClock,
  type SeededMember,
  type WorkflowWorld,
} from "../../testing/index.ts";
import { markMembershipFormer } from "../access/members-routes.ts";
import { type AuditContext, systemAuditContext } from "../audit/audit.ts";
import { membershipRoles, memberships } from "../db/schema/access.ts";
import { approvalRequests, approvalTasks, delegations } from "../db/schema/workflows.ts";
import { tick } from "../jobs/tick.ts";
import { createDelegation } from "./delegations.ts";
import { decideTask, reassignTask, submitApproval } from "./engine.ts";
import { replacePolicies } from "./policies.ts";

/**
 * Who may decide (security review #4, #5, #15, on-behalf requests, bank-change summaries): the
 * engine's eligibility rule holds on every path that hands out a task and on every decision.
 */
const DAY = 86_400_000;

describe("approval segregation of duties", () => {
  let w: WorkflowWorld;
  const clock = movableClock("2026-11-02T01:00:00.000Z");
  beforeEach(async () => {
    clock.set("2026-11-02T01:00:00.000Z");
    w = await createWorkflowWorld({ clock });
  });
  afterEach(() => w.close());

  const system = () => systemAuditContext(w.org.id, "system", "test");
  const asMember = (m: SeededMember): AuditContext => ({
    ...system(),
    actorType: "member",
    actorMembershipId: m.membershipId,
  });
  const actor = (m: SeededMember, roles: ("owner" | "hr_admin" | "payroll_admin")[] = []) => ({
    orgId: w.org.id,
    membershipId: m.membershipId,
    employeeId: m.employeeId,
    roles,
    audit: asMember(m),
  });
  const pending = (requestId: string) =>
    w.deps.db
      .select()
      .from(approvalTasks)
      .where(and(eq(approvalTasks.requestId, requestId), eq(approvalTasks.status, "pending")));
  const statusOf = async (requestId: string) =>
    (await w.deps.db.select().from(approvalRequests).where(eq(approvalRequests.id, requestId)))[0]?.status;

  describe("#4 escalation and fallback stay within who may decide", () => {
    it("an overdue payroll run escalates to other owners only, never hr_admins; an hr_admin can't decide one", async () => {
      const owner2 = await seedOwner(w, "Second Owner");
      const { requestId } = await w.submit(w.m.payroll, "payroll_run");
      clock.advance(3 * DAY + 60_000);
      await tick(w.deps);
      const open = await pending(requestId);
      expect(open.some((t) => t.assigneeMembershipId === w.m.hr.membershipId)).toBe(false);
      expect(open.some((t) => t.assigneeMembershipId === w.m.hr2.membershipId)).toBe(false);
      // Both owners already held it, so nobody new: no hr_admin is ever the next level.
      expect(open.map((t) => t.assigneeMembershipId).sort()).toEqual(
        [w.m.owner.membershipId, owner2.membershipId].sort(),
      );

      // Even a task planted for an hr_admin can't be used to decide (canDecide on every decision).
      const [planted] = await w.deps.db
        .insert(approvalTasks)
        .values({
          id: w.deps.ids.newId(),
          orgId: w.org.id,
          requestId,
          position: open[0]?.position ?? 1,
          assigneeMembershipId: w.m.hr.membershipId,
          origin: "escalated",
          status: "pending",
          viaRole: null,
          createdAt: clock.now(),
        })
        .returning();
      const hr = await clientAs(w.app, w.deps, w.m.hr);
      const res = await hr.post(`/api/v1/approvals/tasks/${planted?.id}/decision`, { decision: "approve" });
      expect(res.status).toBe(403);
      const bulk = (await (
        await hr.post("/api/v1/approvals/tasks/decisions", { taskIds: [planted?.id], decision: "approve" })
      ).json()) as { results: { ok: boolean; code: string }[] };
      expect(bulk.results[0]).toMatchObject({ ok: false, code: "forbidden" });
      expect(await statusOf(requestId)).toBe("pending");
    });

    it("a role step escalates within the role, then to owners, and the escalated tasks keep their role", async () => {
      // A bank change: payroll admins decide it. With one payroll admin, escalation goes to owners.
      const { requestId } = await w.submit(w.m.staff, "profile_change", { typeCode: "bank" });
      expect((await pending(requestId)).map((t) => [t.assigneeMembershipId, t.viaRole])).toEqual([
        [w.m.payroll.membershipId, "payroll_admin"],
      ]);
      clock.advance(3 * DAY + 60_000);
      await tick(w.deps);
      const escalated = (await pending(requestId)).filter((t) => t.origin === "escalated");
      expect(escalated.map((t) => [t.assigneeMembershipId, t.viaRole])).toEqual([[w.m.owner.membershipId, "owner"]]);
    });

    it("bank fallback is owner-only even when an HR admin also holds payroll_admin", async () => {
      await w.deps.db
        .insert(membershipRoles)
        .values({ orgId: w.org.id, membershipId: w.m.hr.membershipId, role: "payroll_admin" });
      await w.deps.db
        .update(memberships)
        .set({ status: "suspended" })
        .where(eq(memberships.id, w.m.manager.membershipId));
      await replacePolicies(w.deps.db, w.deps, system(), w.org.id, "profile_change", [
        {
          name: "Unavailable",
          condition: null,
          priority: 0,
          steps: [{ approverRule: `member:${w.m.manager.membershipId}`, escalateAfterDays: 1 }],
        },
      ]);
      const { requestId } = await w.submit(w.m.staff, "profile_change", { typeCode: "bank" });
      expect((await pending(requestId)).map((t) => [t.assigneeMembershipId, t.viaRole])).toEqual([
        [w.m.owner.membershipId, "owner"],
      ]);
    });

    it("with no payroll admin, a bank change falls back to owners, never hr_admins", async () => {
      await replacePolicies(w.deps.db, w.deps, system(), w.org.id, "profile_change", [
        {
          name: "Default",
          condition: null,
          priority: 0,
          steps: [{ approverRule: "role:payroll_admin", escalateAfterDays: 1 }],
        },
      ]);
      // No payroll admin at all: the fallback is owners, never hr_admins.
      await w.deps.db.delete(membershipRoles).where(eq(membershipRoles.membershipId, w.m.payroll.membershipId));
      const { requestId } = await w.submit(w.m.staff, "profile_change", { typeCode: "bank" });
      expect((await pending(requestId)).map((t) => t.assigneeMembershipId)).toEqual([w.m.owner.membershipId]);
    });
  });

  describe("#5 reassignment", () => {
    it("an hr_admin can't reassign a task on their own request", async () => {
      await replacePolicies(w.deps.db, w.deps, system(), w.org.id, "claim", [
        {
          name: "Owner approves",
          condition: null,
          priority: 0,
          steps: [{ approverRule: "role:owner", escalateAfterDays: 3 }],
        },
      ]);
      const { requestId } = await w.submit(w.m.hr, "claim", { amountCents: 500_000 });
      const [task] = await pending(requestId);
      const hr = await clientAs(w.app, w.deps, w.m.hr);
      const res = await hr.post(`/api/v1/approvals/tasks/${task?.id}/reassign`, {
        toMembershipId: w.m.loner.membershipId,
        reason: "Owner busy",
      });
      expect(res.status).toBe(403);
      expect((await pending(requestId)).map((t) => t.assigneeMembershipId)).toEqual([w.m.owner.membershipId]);
    });

    it("refuses a request about the actor, and a target who doesn't hold the step's role", async () => {
      await replacePolicies(w.deps.db, w.deps, system(), w.org.id, "claim", [
        {
          name: "Owner approves",
          condition: null,
          priority: 0,
          steps: [{ approverRule: "role:owner", escalateAfterDays: 3 }],
        },
      ]);
      // hr2 reassigns staff's owner-only task to a plain employee: refused, the step needs an owner.
      const { requestId } = await w.submit(w.m.staff, "claim", { amountCents: 500_000 });
      const [task] = await pending(requestId);
      await expect(
        reassignTask(w.deps, actor(w.m.hr2, ["hr_admin"]), {
          taskId: task?.id as string,
          toMembershipId: w.m.loner.membershipId,
          reason: "Owner busy",
        }),
      ).rejects.toMatchObject({ code: "validation_failed" });

      // A request filed on hr's behalf by someone else is still about hr: hr can't steer it.
      const about = await w.deps.db.transaction((tx) =>
        submitApproval(tx, w.deps, asMember(w.m.owner), {
          orgId: w.org.id,
          subjectType: "leave",
          subjectId: w.deps.ids.newId(),
          requesterMembershipId: w.m.hr.membershipId,
          requesterEmployeeId: w.m.hr.employeeId,
        }),
      );
      const [aboutTask] = await pending(about.requestId);
      await expect(
        reassignTask(w.deps, actor(w.m.hr, ["hr_admin"]), {
          taskId: aboutTask?.id as string,
          toMembershipId: w.m.hr2.membershipId,
          reason: "x",
        }),
      ).rejects.toMatchObject({ code: "forbidden" });
    });

    it("compensation policy editors are owners, including adapters without an owner-only hint", async () => {
      const comp = createFakeSubjects(["compensation"]);
      w.fake.plugin.subjects = [...(w.fake.plugin.subjects ?? []), ...(comp.plugin.subjects ?? [])];
      const hr = await clientAs(w.app, w.deps, w.m.hr);
      const body = { policies: [{ name: "Default", condition: null, steps: [{ approverRule: "role:owner" }] }] };
      expect((await hr.put("/api/v1/approvals/policies/compensation", body)).status).toBe(403);
      const owner = await clientAs(w.app, w.deps, w.m.owner);
      expect((await owner.put("/api/v1/approvals/policies/compensation", body)).status).toBe(200);
    });

    it("bank-change (profile change) policies are owner-only to edit", async () => {
      const hr = await clientAs(w.app, w.deps, w.m.hr);
      const body = {
        policies: [{ name: "Default", condition: null, steps: [{ approverRule: `member:${w.m.hr.membershipId}` }] }],
      };
      expect((await hr.put("/api/v1/approvals/policies/profile_change", body)).status).toBe(403);
      const owner = await clientAs(w.app, w.deps, w.m.owner);
      const list = (await (await hr.get("/api/v1/approvals/policies")).json()) as {
        types: { subjectType: string; ownerOnly: boolean; canEdit: boolean }[];
      };
      expect(list.types.find((t) => t.subjectType === "profile_change")).toMatchObject({
        ownerOnly: true,
        canEdit: false,
      });
      expect((await owner.put("/api/v1/approvals/policies/profile_change", body)).status).toBe(200);
    });
  });

  describe("on-behalf requests: the filer never decides", () => {
    it("an hr_admin filing leave for staff can't approve it, by any path", async () => {
      await replacePolicies(w.deps.db, w.deps, system(), w.org.id, "leave", [
        { name: "HR", condition: null, priority: 0, steps: [{ approverRule: "role:hr_admin", escalateAfterDays: 3 }] },
      ]);
      const { requestId } = await w.deps.db.transaction((tx) =>
        submitApproval(tx, w.deps, asMember(w.m.hr), {
          orgId: w.org.id,
          subjectType: "leave",
          subjectId: w.deps.ids.newId(),
          requesterMembershipId: w.m.staff.membershipId,
          requesterEmployeeId: w.m.staff.employeeId,
        }),
      );
      const [request] = await w.deps.db.select().from(approvalRequests).where(eq(approvalRequests.id, requestId));
      expect(request?.excludedDeciderMembershipIds).toEqual([w.m.hr.membershipId]);
      // Only the other hr_admin gets the task.
      expect((await pending(requestId)).map((t) => t.assigneeMembershipId)).toEqual([w.m.hr2.membershipId]);
      // Cover from hr2 to hr is not applied to this request.
      await createDelegation(
        w.deps,
        { orgId: w.org.id, membershipId: w.m.hr2.membershipId, canManageOthers: false, audit: system() },
        { toMembershipId: w.m.hr.membershipId, startsOn: "2026-11-01", endsOn: "2026-11-30", subjectTypes: null },
      );
      expect((await pending(requestId)).map((t) => t.assigneeMembershipId)).toEqual([w.m.hr2.membershipId]);
      // hr2 can't reassign it back to the filer.
      const [task] = await pending(requestId);
      await expect(
        reassignTask(w.deps, actor(w.m.hr2, ["hr_admin"]), {
          taskId: task?.id as string,
          toMembershipId: w.m.hr.membershipId,
          reason: "x",
        }),
      ).rejects.toMatchObject({ code: "validation_failed" });
      await expect(
        decideTask(w.deps, actor(w.m.hr, ["hr_admin"]), { taskId: task?.id as string, decision: "approve" }),
      ).rejects.toMatchObject({ code: "not_found" });
    });

    it("pre-migration requests still exclude their on-behalf filer using submission audit provenance", async () => {
      await replacePolicies(w.deps.db, w.deps, system(), w.org.id, "leave", [
        { name: "HR", condition: null, priority: 0, steps: [{ approverRule: "role:hr_admin", escalateAfterDays: 3 }] },
      ]);
      const { requestId } = await w.deps.db.transaction((tx) =>
        submitApproval(tx, w.deps, asMember(w.m.hr), {
          orgId: w.org.id,
          subjectType: "leave",
          subjectId: w.deps.ids.newId(),
          requesterMembershipId: w.m.staff.membershipId,
          requesterEmployeeId: w.m.staff.employeeId,
        }),
      );
      await w.deps.db
        .update(approvalRequests)
        .set({ excludedDeciderMembershipIds: [] })
        .where(eq(approvalRequests.id, requestId));
      const [task] = await w.deps.db
        .insert(approvalTasks)
        .values({
          id: w.deps.ids.newId(),
          orgId: w.org.id,
          requestId,
          position: (await pending(requestId))[0]?.position ?? 1,
          assigneeMembershipId: w.m.hr.membershipId,
          origin: "reassigned",
          status: "pending",
          viaRole: "hr_admin",
          createdAt: clock.now(),
        })
        .returning();
      await expect(
        decideTask(w.deps, actor(w.m.hr, ["hr_admin"]), { taskId: task?.id as string, decision: "approve" }),
      ).rejects.toMatchObject({ code: "forbidden" });
    });

    it("a sole owner filing for an employee without a sign-in is still excluded", async () => {
      await w.deps.db.delete(membershipRoles).where(eq(membershipRoles.role, "hr_admin"));
      const { requestId } = await w.deps.db.transaction((tx) =>
        submitApproval(tx, w.deps, asMember(w.m.owner), {
          orgId: w.org.id,
          subjectType: "leave",
          subjectId: w.deps.ids.newId(),
          // Modules use the filer as requester when the employee has no membership.
          requesterMembershipId: w.m.owner.membershipId,
          requesterEmployeeId: w.m.loner.employeeId,
        }),
      );
      expect(await pending(requestId)).toEqual([]);
      expect(await statusOf(requestId)).toBe("pending");
    });

    it("even a sole owner filing for someone is excluded from deciding", async () => {
      await w.deps.db.delete(membershipRoles).where(eq(membershipRoles.role, "hr_admin"));
      await replacePolicies(w.deps.db, w.deps, system(), w.org.id, "leave", [
        { name: "Owner", condition: null, priority: 0, steps: [{ approverRule: "role:owner", escalateAfterDays: 3 }] },
      ]);
      const { requestId } = await w.deps.db.transaction((tx) =>
        submitApproval(tx, w.deps, asMember(w.m.owner), {
          orgId: w.org.id,
          subjectType: "leave",
          subjectId: w.deps.ids.newId(),
          requesterMembershipId: w.m.loner.membershipId,
          requesterEmployeeId: w.m.loner.employeeId,
        }),
      );
      expect(await pending(requestId)).toEqual([]);
      expect(await statusOf(requestId)).toBe("pending");
    });
  });

  describe("bank-change summaries", () => {
    it("an hr_admin can't read a bank change unless they are also a payroll admin", async () => {
      const { requestId } = await w.submit(w.m.staff, "profile_change", { typeCode: "bank" });
      const hr = await clientAs(w.app, w.deps, w.m.hr);
      expect((await hr.get(`/api/v1/approvals/requests/${requestId}`)).status).toBe(404);
      const personal = await w.submit(w.m.staff, "profile_change", { typeCode: "personal" });
      expect((await hr.get(`/api/v1/approvals/requests/${personal.requestId}`)).status).toBe(200);
      await w.deps.db
        .insert(membershipRoles)
        .values({ orgId: w.org.id, membershipId: w.m.hr.membershipId, role: "payroll_admin" });
      expect((await hr.get(`/api/v1/approvals/requests/${requestId}`)).status).toBe(200);
    });
  });

  it("historical bank tasks do not give HR access after losing payroll role", async () => {
    await w.deps.db
      .insert(membershipRoles)
      .values({ orgId: w.org.id, membershipId: w.m.hr.membershipId, role: "payroll_admin" });
    const { requestId } = await w.submit(w.m.staff, "profile_change", { typeCode: "bank" });
    expect((await pending(requestId)).some((t) => t.assigneeMembershipId === w.m.hr.membershipId)).toBe(true);
    await w.deps.db
      .delete(membershipRoles)
      .where(and(eq(membershipRoles.membershipId, w.m.hr.membershipId), eq(membershipRoles.role, "payroll_admin")));
    const hr = await clientAs(w.app, w.deps, w.m.hr);
    expect((await hr.get(`/api/v1/approvals/requests/${requestId}`)).status).toBe(404);
    expect((await (await hr.get("/api/v1/approvals/tasks")).json()).items).toEqual([]);
  });

  describe("adapter eligibility is checked again on decisions", () => {
    it("refuses single, bulk and inbox decisions after the adapter revokes eligibility", async () => {
      let allowed = true;
      const adapter = w.fake.plugin.subjects?.find((a) => a.type === "leave");
      if (!adapter) throw new Error("Missing adapter");
      adapter.canDecide = async () => allowed;
      const { requestId } = await w.submit(w.m.loner, "leave");
      const task = (await pending(requestId)).find((t) => t.assigneeMembershipId === w.m.hr.membershipId);
      allowed = false;
      const hr = await clientAs(w.app, w.deps, w.m.hr);
      expect((await hr.post(`/api/v1/approvals/tasks/${task?.id}/decision`, { decision: "approve" })).status).toBe(403);
      const bulk = await (
        await hr.post("/api/v1/approvals/tasks/decisions", { taskIds: [task?.id], decision: "approve" })
      ).json();
      expect(bulk.results[0]).toMatchObject({ ok: false, code: "forbidden" });
      const inbox = await (await hr.get("/api/v1/inbox")).json();
      expect(inbox.items.filter((i: { task: { id: string } | null }) => i.task?.id === task?.id)).toEqual([]);
      expect(await statusOf(requestId)).toBe("pending");
    });

    it("revoking a delegate's subject eligibility prevents their decision", async () => {
      let allowed = true;
      const adapter = w.fake.plugin.subjects?.find((a) => a.type === "claim");
      if (!adapter) throw new Error("Missing adapter");
      adapter.canDecide = async (_db, m) => m.membershipId !== w.m.other.membershipId || allowed;
      await createDelegation(
        w.deps,
        { orgId: w.org.id, membershipId: w.m.manager.membershipId, canManageOthers: false, audit: system() },
        { toMembershipId: w.m.other.membershipId, startsOn: "2026-11-01", endsOn: "2026-11-30", subjectTypes: null },
      );
      const { requestId } = await w.submit(w.m.staff, "claim");
      const task = (await pending(requestId)).find((t) => t.origin === "delegated");
      expect(task).toBeDefined();
      allowed = false;
      await expect(
        decideTask(w.deps, actor(w.m.other), { taskId: task?.id as string, decision: "approve" }),
      ).rejects.toMatchObject({ code: "forbidden" });
    });
  });

  describe("#15 former and suspended members", () => {
    it("a former manager loses their tasks, cover and access; the step re-resolves", async () => {
      const { requestId } = await w.submit(w.m.staff, "claim", { amountCents: 12_345 });
      expect((await pending(requestId)).map((t) => t.assigneeMembershipId)).toEqual([w.m.manager.membershipId]);
      await createDelegation(
        w.deps,
        { orgId: w.org.id, membershipId: w.m.manager.membershipId, canManageOthers: false, audit: system() },
        { toMembershipId: w.m.other.membershipId, startsOn: "2026-11-01", endsOn: "2026-11-30", subjectTypes: null },
      );
      await markMembershipFormer(w.deps, w.deps.db, system(), {
        orgId: w.org.id,
        employeeId: w.m.manager.employeeId as string,
      });

      const fm = await clientAs(w.app, w.deps, w.m.manager);
      expect((await fm.get(`/api/v1/approvals/requests/${requestId}`)).status).toBe(404);
      expect(((await (await fm.get("/api/v1/approvals/tasks")).json()) as { items: unknown[] }).items).toEqual([]);
      expect((await fm.post(`/api/v1/approvals/requests/${requestId}/comments`, { body: "still here" })).status).toBe(
        403,
      );
      const dl = await fm.post("/api/v1/approvals/delegations", {
        toMembershipId: w.m.head.membershipId,
        startsOn: "2026-11-01",
        endsOn: "2026-12-31",
      });
      expect(dl.status).toBe(403);

      // Retirement happens with the status change, before a background sweep.
      expect(
        (await pending(requestId)).some(
          (t) =>
            t.assigneeMembershipId === w.m.manager.membershipId ||
            t.onBehalfOfMembershipId === w.m.manager.membershipId,
        ),
      ).toBe(false);
      await tick(w.deps);
      const open = await pending(requestId);
      expect(open.some((t) => t.assigneeMembershipId === w.m.manager.membershipId)).toBe(false);
      expect(open.some((t) => t.assigneeMembershipId === w.m.other.membershipId)).toBe(false);
      expect(open.length).toBeGreaterThan(0);
      const cover = await w.deps.db
        .select()
        .from(delegations)
        .where(eq(delegations.fromMembershipId, w.m.manager.membershipId));
      expect(cover.every((d) => d.revokedAt)).toBe(true);
    });

    it("suspension retires tasks and both directions of cover in the same transaction", async () => {
      const { requestId } = await w.submit(w.m.staff, "claim");
      for (const [from, to] of [
        [w.m.manager, w.m.other],
        [w.m.head, w.m.manager],
      ] as const) {
        await createDelegation(
          w.deps,
          { orgId: w.org.id, membershipId: from.membershipId, canManageOthers: false, audit: system() },
          { toMembershipId: to.membershipId, startsOn: "2026-11-01", endsOn: "2026-11-30", subjectTypes: null },
        );
      }
      const owner = await clientAs(w.app, w.deps, w.m.owner);
      expect((await owner.post(`/api/v1/members/${w.m.manager.membershipId}/suspend`, {})).status).toBe(200);
      const open = await pending(requestId);
      expect(open.length).toBeGreaterThan(0);
      expect(
        open.some(
          (t) =>
            t.assigneeMembershipId === w.m.manager.membershipId ||
            t.onBehalfOfMembershipId === w.m.manager.membershipId,
        ),
      ).toBe(false);
      const cover = await w.deps.db.select().from(delegations);
      expect(cover.every((d) => d.revokedAt)).toBe(true);
    });

    it("a delegate cannot act for an inactive delegator before the repair sweep", async () => {
      await createDelegation(
        w.deps,
        { orgId: w.org.id, membershipId: w.m.manager.membershipId, canManageOthers: false, audit: system() },
        { toMembershipId: w.m.other.membershipId, startsOn: "2026-11-01", endsOn: "2026-11-30", subjectTypes: null },
      );
      const { requestId } = await w.submit(w.m.staff, "claim");
      const delegated = (await pending(requestId)).find((t) => t.origin === "delegated");
      await w.deps.db
        .update(memberships)
        .set({ status: "suspended" })
        .where(eq(memberships.id, w.m.manager.membershipId));
      await expect(
        decideTask(w.deps, actor(w.m.other), { taskId: delegated?.id as string, decision: "approve" }),
      ).rejects.toMatchObject({ code: "forbidden" });
    });

    it("a suspended approver's tasks move to someone else on the next sweep", async () => {
      const { requestId } = await w.submit(w.m.loner, "leave"); // hr + hr2
      await w.deps.db.update(memberships).set({ status: "suspended" }).where(eq(memberships.id, w.m.hr.membershipId));
      await tick(w.deps);
      expect((await pending(requestId)).map((t) => t.assigneeMembershipId)).toEqual([w.m.hr2.membershipId]);
      // If nobody of the role is left, the step falls back like a skipped chain.
      await w.deps.db.update(memberships).set({ status: "suspended" }).where(eq(memberships.id, w.m.hr2.membershipId));
      await tick(w.deps);
      expect((await pending(requestId)).map((t) => t.assigneeMembershipId)).toEqual([w.m.owner.membershipId]);
    });
  });
});

async function seedOwner(w: WorkflowWorld, name: string) {
  const { seedMember } = await import("../../testing/index.ts");
  return seedMember(w.deps, w.org.id, {
    displayName: name,
    roles: ["owner"],
    email: `${name.split(" ")[0]?.toLowerCase()}2@kopi.example`,
  });
}
