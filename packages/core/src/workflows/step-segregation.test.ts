import { readFileSync } from "node:fs";
import { and, asc, eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  clientAs,
  createWorkflowWorld,
  EMP,
  movableClock,
  type SeededMember,
  seedMember,
  type WorkflowWorld,
} from "../../testing/index.ts";
import { migrationsFolder } from "../../testing/migrations-folder.ts";
import { type AuditContext, systemAuditContext } from "../audit/audit.ts";
import { membershipRoles } from "../db/schema/access.ts";
import { auditEvents } from "../db/schema/audit.ts";
import { approvalRequests, approvalSteps, approvalTasks } from "../db/schema/workflows.ts";
import { tick } from "../jobs/tick.ts";
import { createDelegation } from "./delegations.ts";
import { decideTask, reassignTask } from "./engine.ts";
import { myOpenTasks } from "./inbox-approvals.ts";
import { replacePolicies } from "./policies.ts";

/**
 * Segregation of duties across steps: whoever approved an earlier step of a request doesn't decide
 * a later one (a manager who is also an HR admin can't approve both steps of a claim). The step
 * goes to someone else; only when nobody else may decide it does the earlier approver decide it
 * too, marked `repeat_approval`, so requests never wait for ever.
 */
const DAY = 86_400_000;

describe("a later step is decided by someone other than an earlier step's approver", () => {
  let w: WorkflowWorld;
  const clock = movableClock("2026-11-02T01:00:00.000Z");
  beforeEach(async () => {
    clock.set("2026-11-02T01:00:00.000Z");
    w = await createWorkflowWorld({ clock });
  });
  afterEach(() => w.close());

  const system = () => systemAuditContext(w.org.id, "system", "test");
  const actor = (m: SeededMember) => ({
    orgId: w.org.id,
    membershipId: m.membershipId,
    employeeId: m.employeeId,
    roles: [],
    audit: { ...system(), actorType: "member", actorMembershipId: m.membershipId } as AuditContext,
  });
  const grant = (m: SeededMember, role: "owner" | "hr_admin" | "payroll_admin") =>
    w.deps.db.insert(membershipRoles).values({ orgId: w.org.id, membershipId: m.membershipId, role });
  const revokeAll = (m: SeededMember) =>
    w.deps.db.delete(membershipRoles).where(eq(membershipRoles.membershipId, m.membershipId));
  const pending = (requestId: string, position?: number) =>
    w.deps.db
      .select()
      .from(approvalTasks)
      .where(
        and(
          eq(approvalTasks.requestId, requestId),
          eq(approvalTasks.status, "pending"),
          position === undefined ? undefined : eq(approvalTasks.position, position),
        ),
      )
      .orderBy(asc(approvalTasks.createdAt));
  const holders = async (requestId: string, position?: number) =>
    (await pending(requestId, position)).map((t) => t.assigneeMembershipId).sort();
  const statusOf = async (requestId: string) =>
    (await w.deps.db.select().from(approvalRequests).where(eq(approvalRequests.id, requestId)))[0]?.status;
  const approve = async (m: SeededMember, requestId: string) => {
    const task = (await pending(requestId)).find((t) => t.assigneeMembershipId === m.membershipId);
    if (!task) throw new Error(`${m.membershipId} has no open task on ${requestId}`);
    return decideTask(w.deps, actor(m), { taskId: task.id, decision: "approve" });
  };
  const ids = (...members: SeededMember[]) => members.map((m) => m.membershipId).sort();

  it("a manager who is also an HR admin approves the manager step only; the other HR admins get the HR step", async () => {
    await grant(w.m.manager, "hr_admin");
    const { requestId } = await w.submit(w.m.staff, "claim", { amountCents: 12_000 });
    expect(await holders(requestId)).toEqual(ids(w.m.manager));
    await approve(w.m.manager, requestId);

    expect(await statusOf(requestId)).toBe("pending");
    expect(await holders(requestId, 2)).toEqual(ids(w.m.hr, w.m.hr2));
    expect(await myOpenTasks(w.deps.db, w.org.id, w.m.manager.membershipId, w.deps)).toEqual([]);

    // A task planted for them (as before this rule) can't be used, by a single or a bulk decision.
    const [planted] = await w.deps.db
      .insert(approvalTasks)
      .values({
        id: w.deps.ids.newId(),
        orgId: w.org.id,
        requestId,
        position: 2,
        assigneeMembershipId: w.m.manager.membershipId,
        origin: "resolved",
        status: "pending",
        viaRole: "hr_admin",
        createdAt: clock.now(),
      })
      .returning();
    const manager = await clientAs(w.app, w.deps, w.m.manager);
    const single = await manager.post(`/api/v1/approvals/tasks/${planted?.id}/decision`, { decision: "approve" });
    expect(single.status).toBe(403);
    expect(((await single.json()) as { error: { message: string } }).error.message).toMatch(/earlier step/);
    const bulk = (await (
      await manager.post("/api/v1/approvals/tasks/decisions", { taskIds: [planted?.id], decision: "approve" })
    ).json()) as { results: { ok: boolean; code: string }[] };
    expect(bulk.results[0]).toMatchObject({ ok: false, code: "forbidden" });
    expect(await statusOf(requestId)).toBe("pending");

    await approve(w.m.hr2, requestId);
    expect(await statusOf(requestId)).toBe("approved");
    expect(w.fake.calls.at(-1)?.decision).toMatchObject({ decidedByMembershipId: w.m.hr2.membershipId });
  });

  it("with no other HR admin, the HR step goes to the owners", async () => {
    await grant(w.m.manager, "hr_admin");
    await revokeAll(w.m.hr);
    await revokeAll(w.m.hr2);
    const { requestId } = await w.submit(w.m.staff, "claim", { amountCents: 12_000 });
    await approve(w.m.manager, requestId);

    const step2 = await pending(requestId, 2);
    expect(step2.map((t) => [t.assigneeMembershipId, t.viaRole, t.repeatApproval])).toEqual([
      [w.m.owner.membershipId, "owner", false],
    ]);
    await approve(w.m.owner, requestId);
    expect(await statusOf(requestId)).toBe("approved");
  });

  it("an earlier approver decides again only when nobody else may, and it is marked in the chain and the audit log", async () => {
    // A small company: the owner manages the staff member and is its only HR admin.
    w.managers[EMP.staff] = EMP.owner;
    await grant(w.m.owner, "hr_admin");
    await revokeAll(w.m.hr);
    await revokeAll(w.m.hr2);
    const { requestId } = await w.submit(w.m.staff, "claim", { amountCents: 12_000 });
    expect(await holders(requestId)).toEqual(ids(w.m.owner));
    await approve(w.m.owner, requestId);

    const [repeat] = await pending(requestId, 2);
    expect(repeat).toMatchObject({ assigneeMembershipId: w.m.owner.membershipId, repeatApproval: true });
    // It stays on their Home, so the request doesn't wait for ever.
    expect((await myOpenTasks(w.deps.db, w.org.id, w.m.owner.membershipId, w.deps)).map((r) => r.task.id)).toEqual([
      repeat?.id,
    ]);
    await approve(w.m.owner, requestId);
    expect(await statusOf(requestId)).toBe("approved");

    const decided = await w.deps.db
      .select()
      .from(auditEvents)
      .where(and(eq(auditEvents.targetId, requestId), eq(auditEvents.action, "approval.decided")))
      .orderBy(asc(auditEvents.seq));
    expect(decided.map((e) => (e.meta as { repeatApproval?: boolean }).repeatApproval ?? false)).toEqual([false, true]);

    const owner = await clientAs(w.app, w.deps, w.m.owner);
    const detail = (await (await owner.get(`/api/v1/approvals/requests/${requestId}`)).json()) as {
      steps: { position: number; tasks: { repeatApproval: boolean; status: string }[] }[];
    };
    expect(detail.steps.map((s) => s.tasks.map((t) => [t.status, t.repeatApproval]))).toEqual([
      [["approved", false]],
      [["approved", true]],
    ]);
  });

  it("a second owner decides the owner step of a manager-then-owner chain the owner started", async () => {
    w.managers[EMP.staff] = EMP.owner;
    const owner2 = await seedMember(w.deps, w.org.id, {
      displayName: "Farah Iskandar",
      roles: ["owner"],
      email: "farah@kopi.example",
    });
    await replacePolicies(w.deps.db, w.deps, system(), w.org.id, "claim", [
      {
        name: "Manager, then owner",
        condition: null,
        priority: 0,
        steps: [
          { approverRule: "manager", escalateAfterDays: 3 },
          { approverRule: "role:owner", escalateAfterDays: 3 },
        ],
      },
    ]);
    const { requestId } = await w.submit(w.m.staff, "claim", { amountCents: 70_000 });
    await approve(w.m.owner, requestId);
    expect(await holders(requestId, 2)).toEqual(ids(owner2));
  });

  it("cover, escalation and reassignment never hand a later step to an earlier approver", async () => {
    await grant(w.m.manager, "hr_admin");
    // Out-of-office cover from HR admin Tan Mei Ling to the manager, who also holds hr_admin.
    await createDelegation(
      w.deps,
      { orgId: w.org.id, membershipId: w.m.hr.membershipId, canManageOthers: false, audit: system() },
      { toMembershipId: w.m.manager.membershipId, startsOn: "2026-11-01", endsOn: "2026-11-30", subjectTypes: null },
    );
    const { requestId } = await w.submit(w.m.staff, "claim", { amountCents: 12_000 });
    await approve(w.m.manager, requestId);
    expect(await holders(requestId, 2)).toEqual(ids(w.m.hr, w.m.hr2));

    const step2 = await pending(requestId, 2);
    await expect(
      reassignTask(
        w.deps,
        { ...actor(w.m.owner), roles: ["owner"] },
        {
          taskId: step2[0]?.id as string,
          toMembershipId: w.m.manager.membershipId,
          reason: "Covering",
        },
      ),
    ).rejects.toMatchObject({ code: "validation_failed", message: expect.stringMatching(/earlier step/) });

    clock.advance(3 * DAY + 60_000);
    await tick(w.deps);
    const after = await pending(requestId, 2);
    expect(after.some((t) => t.assigneeMembershipId === w.m.manager.membershipId)).toBe(false);
    expect(after.filter((t) => t.origin === "escalated").map((t) => t.assigneeMembershipId)).toEqual([
      w.m.owner.membershipId,
    ]);
  });

  it("an approval made as a delegate counts: the delegate doesn't decide the next step", async () => {
    // The manager is away and covered by HR admin Tan Mei Ling, who approves the manager step.
    await createDelegation(
      w.deps,
      { orgId: w.org.id, membershipId: w.m.manager.membershipId, canManageOthers: false, audit: system() },
      { toMembershipId: w.m.hr.membershipId, startsOn: "2026-11-01", endsOn: "2026-11-30", subjectTypes: null },
    );
    const { requestId } = await w.submit(w.m.staff, "claim", { amountCents: 12_000 });
    await approve(w.m.hr, requestId);
    expect(await holders(requestId, 2)).toEqual(ids(w.m.hr2));
  });

  it("a manager step after an HR step goes to the other HR admins when the HR admin is also the manager", async () => {
    await replacePolicies(w.deps.db, w.deps, system(), w.org.id, "claim", [
      {
        name: "HR, then manager",
        condition: null,
        priority: 0,
        steps: [
          { approverRule: "role:hr_admin", escalateAfterDays: 3 },
          { approverRule: "manager", escalateAfterDays: 3 },
        ],
      },
    ]);
    w.managers[EMP.staff] = EMP.hr;
    const { requestId } = await w.submit(w.m.staff, "claim", { amountCents: 12_000 });
    await approve(w.m.hr, requestId);
    const step2 = await pending(requestId, 2);
    expect(step2.map((t) => [t.assigneeMembershipId, t.viaRole])).toEqual([[w.m.hr2.membershipId, "hr_admin"]]);
  });

  it("the upgrade marks an open later-step task held by its earlier approver only when nobody else holds the step", async () => {
    // Requests in flight from before the rule: both have the manager (an HR admin) on step 2.
    await grant(w.m.manager, "hr_admin");
    const alone = await w.submit(w.m.staff, "claim", { amountCents: 12_000 });
    const shared = await w.submit(w.m.other, "claim", { amountCents: 12_000 });
    for (const { requestId } of [alone, shared]) {
      await approve(w.m.manager, requestId);
      await w.deps.db.insert(approvalTasks).values({
        id: w.deps.ids.newId(),
        orgId: w.org.id,
        requestId,
        position: 2,
        assigneeMembershipId: w.m.manager.membershipId,
        origin: "resolved",
        status: "pending",
        viaRole: "hr_admin",
        createdAt: clock.now(),
      });
    }
    // Only the manager holds step 2 of `alone`.
    await w.deps.db
      .update(approvalTasks)
      .set({ status: "superseded", supersededReason: "reassigned" })
      .where(
        and(
          eq(approvalTasks.requestId, alone.requestId),
          eq(approvalTasks.position, 2),
          sql`${approvalTasks.assigneeMembershipId} <> ${w.m.manager.membershipId}`,
        ),
      );

    const migration = readFileSync(`${migrationsFolder}/0022_approval_repeat_approval.sql`, "utf8");
    const update = migration.split("--> statement-breakpoint").find((s) => s.includes("UPDATE"));
    expect(update).toBeDefined();
    await w.deps.db.execute(sql.raw(update as string));

    const flagged = async (requestId: string) =>
      (await pending(requestId, 2)).map((t) => [t.assigneeMembershipId, t.repeatApproval]);
    expect(await flagged(alone.requestId)).toEqual([[w.m.manager.membershipId, true]]);
    expect((await flagged(shared.requestId)).sort()).toEqual(
      [
        [w.m.hr.membershipId, false],
        [w.m.hr2.membershipId, false],
        [w.m.manager.membershipId, false],
      ].sort(),
    );
    // The marked task can be decided; the other still can't.
    await approve(w.m.manager, alone.requestId);
    expect(await statusOf(alone.requestId)).toBe("approved");
    await expect(approve(w.m.manager, shared.requestId)).rejects.toMatchObject({ code: "forbidden" });
    const steps = await w.deps.db.select().from(approvalSteps).where(eq(approvalSteps.requestId, shared.requestId));
    expect(steps.find((s) => s.position === 2)?.status).toBe("active");
  });
});
