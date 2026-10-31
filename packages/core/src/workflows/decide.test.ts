import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { clientAs, createWorkflowWorld, type SeededMember, type WorkflowWorld } from "../../testing/index.ts";
import { systemAuditContext } from "../audit/audit.ts";
import { auditEvents } from "../db/schema/audit.ts";
import { approvalRequests, approvalTasks } from "../db/schema/workflows.ts";
import { decideTask } from "./engine.ts";

describe("deciding tasks", () => {
  let w: WorkflowWorld;
  beforeEach(async () => {
    w = await createWorkflowWorld();
  });
  afterEach(() => w.close());

  const actor = (m: SeededMember, roles: ("owner" | "hr_admin" | "payroll_admin")[] = []) => ({
    orgId: w.org.id,
    membershipId: m.membershipId,
    roles,
    audit: systemAuditContext(w.org.id, "system", "test"),
  });
  const taskFor = async (requestId: string, m: SeededMember) => {
    const [t] = await w.deps.db
      .select()
      .from(approvalTasks)
      .where(
        and(
          eq(approvalTasks.requestId, requestId),
          eq(approvalTasks.assigneeMembershipId, m.membershipId),
          eq(approvalTasks.status, "pending"),
        ),
      );
    if (!t) throw new Error("no open task");
    return t;
  };
  const request = async (id: string) =>
    (await w.deps.db.select().from(approvalRequests).where(eq(approvalRequests.id, id)))[0];

  it("manager then hr_admin: the first decision closes an any-of step and supersedes the others", async () => {
    const { requestId, subjectId } = await w.submit(w.m.staff, "leave");
    const mgr = await taskFor(requestId, w.m.manager);
    const r1 = await decideTask(w.deps, actor(w.m.manager), { taskId: mgr.id, decision: "approve" });
    expect(r1).toMatchObject({ outcome: "approved", requestStatus: "pending", replayed: false });
    const hrTask = await taskFor(requestId, w.m.hr);
    const hr2Task = await taskFor(requestId, w.m.hr2);
    const r2 = await decideTask(w.deps, actor(w.m.hr, ["hr_admin"]), {
      taskId: hrTask.id,
      decision: "approve",
      comment: "Enjoy",
    });
    expect(r2.requestStatus).toBe("approved");
    const [other] = await w.deps.db.select().from(approvalTasks).where(eq(approvalTasks.id, hr2Task.id));
    expect(other).toMatchObject({ status: "superseded", supersededReason: "decided_by_other" });
    expect(w.fake.calls).toEqual([expect.objectContaining({ event: "approved", subjectId })]);
    expect(w.fake.calls[0]?.decision).toMatchObject({ decidedByMembershipId: w.m.hr.membershipId, comment: "Enjoy" });
    expect((await request(requestId))?.status).toBe("approved");
  });

  it("rejection needs a 1–500 character comment and ends the request", async () => {
    const { requestId } = await w.submit(w.m.staff, "claim", { amountCents: 4_200 });
    const mgr = await taskFor(requestId, w.m.manager);
    await expect(decideTask(w.deps, actor(w.m.manager), { taskId: mgr.id, decision: "reject" })).rejects.toMatchObject({
      code: "validation_failed",
    });
    await expect(
      decideTask(w.deps, actor(w.m.manager), { taskId: mgr.id, decision: "reject", comment: "x".repeat(501) }),
    ).rejects.toMatchObject({ code: "validation_failed" });
    const r = await decideTask(w.deps, actor(w.m.manager), {
      taskId: mgr.id,
      decision: "reject",
      comment: "No receipt",
    });
    expect(r.requestStatus).toBe("rejected");
    expect(w.fake.calls.map((c) => c.event)).toEqual(["rejected"]);
    // No hr_admin task was ever created.
    const all = await w.deps.db.select().from(approvalTasks).where(eq(approvalTasks.requestId, requestId));
    expect(all).toHaveLength(1);
  });

  it("two hr_admins race: one succeeds, the other gets 409 already_decided with who and when", async () => {
    const { requestId } = await w.submit(w.m.loner, "leave");
    const a = await taskFor(requestId, w.m.hr);
    const b = await taskFor(requestId, w.m.hr2);
    const results = await Promise.allSettled([
      decideTask(w.deps, actor(w.m.hr, ["hr_admin"]), { taskId: a.id, decision: "approve" }),
      decideTask(w.deps, actor(w.m.hr2, ["hr_admin"]), { taskId: b.id, decision: "approve" }),
    ]);
    const ok = results.filter((r) => r.status === "fulfilled");
    const failed = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    expect(ok).toHaveLength(1);
    expect(failed).toHaveLength(1);
    expect(failed[0]?.reason).toMatchObject({
      code: "already_decided",
      details: { decidedBy: expect.stringMatching(/Tan Mei Ling|Goh Pei Shan/), outcome: "approved" },
    });
    expect(w.fake.calls.filter((c) => c.event === "approved")).toHaveLength(1);
  });

  it("the same member approving twice (double click, retry) is a no-op replay", async () => {
    const { requestId } = await w.submit(w.m.loner, "leave");
    const a = await taskFor(requestId, w.m.hr);
    const results = await Promise.all([
      decideTask(w.deps, actor(w.m.hr, ["hr_admin"]), { taskId: a.id, decision: "approve" }),
      decideTask(w.deps, actor(w.m.hr, ["hr_admin"]), { taskId: a.id, decision: "approve" }),
    ]);
    expect(results.map((r) => r.replayed).sort()).toEqual([false, true]);
    expect(w.fake.calls.filter((c) => c.event === "approved")).toHaveLength(1);
    // A different decision on the same task is a conflict, not a replay.
    await expect(
      decideTask(w.deps, actor(w.m.hr, ["hr_admin"]), { taskId: a.id, decision: "reject", comment: "changed my mind" }),
    ).rejects.toMatchObject({ code: "already_decided" });
  });

  it("over HTTP: concurrent decisions answer 200 and 409 already_decided", async () => {
    const { requestId } = await w.submit(w.m.loner, "leave");
    const a = await taskFor(requestId, w.m.hr);
    const b = await taskFor(requestId, w.m.hr2);
    const [ca, cb] = [await clientAs(w.app, w.deps, w.m.hr), await clientAs(w.app, w.deps, w.m.hr2)];
    const [ra, rb] = await Promise.all([
      ca.post(`/api/v1/approvals/tasks/${a.id}/decision`, { decision: "approve" }),
      cb.post(`/api/v1/approvals/tasks/${b.id}/decision`, { decision: "approve" }),
    ]);
    expect([ra.status, rb.status].sort()).toEqual([200, 409]);
    const loser = ra.status === 409 ? ra : rb;
    const body = (await loser.json()) as { error: { code: string; message: string; details: { decidedAt: string } } };
    expect(body.error.code).toBe("already_decided");
    expect(body.error.message).toMatch(/already approved this/);
    expect(body.error.details.decidedAt).toBeTruthy();
  });

  it("a throwing callback rolls back: the task stays pending and no approval.decided is audited", async () => {
    const { requestId } = await w.submit(w.m.loner, "leave");
    const a = await taskFor(requestId, w.m.hr);
    w.fake.failNextApproval("Not enough annual leave left: 1.5 days remaining.");
    await expect(
      decideTask(w.deps, actor(w.m.hr, ["hr_admin"]), { taskId: a.id, decision: "approve" }),
    ).rejects.toMatchObject({
      message: "Not enough annual leave left: 1.5 days remaining.",
    });
    expect((await taskFor(requestId, w.m.hr)).status).toBe("pending");
    expect((await taskFor(requestId, w.m.hr2)).status).toBe("pending");
    expect((await request(requestId))?.status).toBe("pending");
    const decided = await w.deps.db.select().from(auditEvents).where(eq(auditEvents.action, "approval.decided"));
    expect(decided).toEqual([]);
    // Retrying after the module's problem is fixed works.
    const ok = await decideTask(w.deps, actor(w.m.hr, ["hr_admin"]), { taskId: a.id, decision: "approve" });
    expect(ok.requestStatus).toBe("approved");
  });

  it("records approval.decided in the audit log", async () => {
    const { requestId } = await w.submit(w.m.loner, "leave");
    const a = await taskFor(requestId, w.m.hr);
    await decideTask(w.deps, actor(w.m.hr, ["hr_admin"]), { taskId: a.id, decision: "approve" });
    const events = await w.deps.db.select().from(auditEvents).where(eq(auditEvents.targetId, requestId));
    expect(events.map((e) => e.action)).toEqual(["approval.submitted", "approval.decided"]);
    expect(events[1]?.meta).toMatchObject({ outcome: "approved", requestStatus: "approved", position: 2 });
  });

  it("someone without the task cannot decide it (404, indistinguishable from missing)", async () => {
    const { requestId } = await w.submit(w.m.staff, "leave");
    const mgr = await taskFor(requestId, w.m.manager);
    await expect(
      decideTask(w.deps, actor(w.m.owner, ["owner"]), { taskId: mgr.id, decision: "approve" }),
    ).rejects.toMatchObject({
      code: "not_found",
    });
  });

  it("resubmitting the same subject while pending is idempotent", async () => {
    const first = await w.submit(w.m.staff, "leave");
    const again = await w.submit(w.m.staff, "leave", {}, first.subjectId);
    expect(again).toMatchObject({ requestId: first.requestId, created: false });
  });
});
