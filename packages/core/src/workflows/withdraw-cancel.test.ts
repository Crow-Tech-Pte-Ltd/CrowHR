import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createWorkflowWorld, type SeededMember, type WorkflowWorld } from "../../testing/index.ts";
import { systemAuditContext } from "../audit/audit.ts";
import { notifications } from "../db/schema/notifications.ts";
import { approvalRequests, approvalTasks } from "../db/schema/workflows.ts";
import { decideTask, withdrawRequest, withdrawSubject } from "./engine.ts";
import { loadInbox } from "./inbox.ts";

describe("withdraw and cancel", () => {
  let w: WorkflowWorld;
  beforeEach(async () => {
    w = await createWorkflowWorld();
  });
  afterEach(() => w.close());

  const actor = (m: SeededMember) => ({
    orgId: w.org.id,
    membershipId: m.membershipId,
    roles: [] as const,
    audit: systemAuditContext(w.org.id, "system", "test"),
  });
  const inboxOf = (m: SeededMember) =>
    loadInbox(w.deps, {
      orgId: w.org.id,
      membershipId: m.membershipId,
      employeeId: m.employeeId,
      roles: [],
      isManager: false,
    });

  it("withdrawing pending leave supersedes tasks, empties the manager's inbox and notifies them", async () => {
    const { requestId, subjectId } = await w.submit(w.m.staff, "leave");
    expect((await inboxOf(w.m.manager)).items).toHaveLength(1);
    const r = await withdrawRequest(w.deps, actor(w.m.staff), requestId);
    expect(r.status).toBe("withdrawn");
    const tasks = await w.deps.db.select().from(approvalTasks).where(eq(approvalTasks.requestId, requestId));
    expect(tasks.map((t) => [t.status, t.supersededReason])).toEqual([["superseded", "withdrawn"]]);
    expect((await inboxOf(w.m.manager)).items).toEqual([]);
    const notes = await w.deps.db
      .select()
      .from(notifications)
      .where(
        and(
          eq(notifications.recipientMembershipId, w.m.manager.membershipId),
          eq(notifications.kind, "request_withdrawn"),
        ),
      );
    expect(notes).toHaveLength(1);
    expect(notes[0]?.title).toBe("Ravi Kumar withdrew a leave request");
    expect(w.fake.calls).toEqual([expect.objectContaining({ event: "withdrawn", subjectId })]);
  });

  it("only the requester can withdraw, and only while pending", async () => {
    const { requestId } = await w.submit(w.m.staff, "leave");
    await expect(withdrawRequest(w.deps, actor(w.m.manager), requestId)).rejects.toMatchObject({ code: "not_found" });
    const [task] = await w.deps.db.select().from(approvalTasks).where(eq(approvalTasks.requestId, requestId));
    await decideTask(w.deps, actor(w.m.manager), {
      taskId: task?.id as string,
      decision: "reject",
      comment: "Busy week",
    });
    await expect(withdrawRequest(w.deps, actor(w.m.staff), requestId)).rejects.toMatchObject({
      code: "already_decided",
    });
  });

  it("modules can withdraw a subject's open request", async () => {
    const { requestId, subjectId } = await w.submit(w.m.staff, "claim", { amountCents: 1_000 });
    const done = await w.deps.db.transaction((tx) =>
      withdrawSubject(tx, w.deps, systemAuditContext(w.org.id, "system", "claims"), {
        orgId: w.org.id,
        subjectType: "claim",
        subjectId,
      }),
    );
    expect(done).toBe(true);
    const [req] = await w.deps.db.select().from(approvalRequests).where(eq(approvalRequests.id, requestId));
    expect(req?.status).toBe("withdrawn");
  });

  it("cancelling approved leave is a separate request; the original stays approved until it is approved", async () => {
    const leave = await w.submit(w.m.loner, "leave");
    const [hrTask] = await w.deps.db
      .select()
      .from(approvalTasks)
      .where(
        and(eq(approvalTasks.requestId, leave.requestId), eq(approvalTasks.assigneeMembershipId, w.m.hr.membershipId)),
      );
    await decideTask(
      w.deps,
      { ...actor(w.m.hr), roles: ["hr_admin"] },
      { taskId: hrTask?.id as string, decision: "approve" },
    );
    expect(w.fake.state.get(leave.subjectId)).toBe("approved");

    // The leave module submits a leave_cancellation subject for the same leave.
    const cancel = await w.submit(w.m.loner, "leave_cancellation", {}, leave.subjectId);
    expect(cancel.requestId).not.toBe(leave.requestId);
    const [original] = await w.deps.db.select().from(approvalRequests).where(eq(approvalRequests.id, leave.requestId));
    expect(original?.status).toBe("approved");
    const [cancelTask] = await w.deps.db
      .select()
      .from(approvalTasks)
      .where(
        and(
          eq(approvalTasks.requestId, cancel.requestId),
          eq(approvalTasks.assigneeMembershipId, w.m.hr2.membershipId),
        ),
      );
    await decideTask(
      w.deps,
      { ...actor(w.m.hr2), roles: ["hr_admin"] },
      { taskId: cancelTask?.id as string, decision: "approve" },
    );
    expect(w.fake.calls.map((c) => `${c.type}:${c.event}`)).toEqual(["leave:approved", "leave_cancellation:approved"]);
    const [stillApproved] = await w.deps.db
      .select()
      .from(approvalRequests)
      .where(eq(approvalRequests.id, leave.requestId));
    expect(stillApproved?.status).toBe("approved");
  });
});
