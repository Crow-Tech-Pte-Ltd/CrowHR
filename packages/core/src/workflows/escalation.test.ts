import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createWorkflowWorld, movableClock, type WorkflowWorld } from "../../testing/index.ts";
import { systemAuditContext } from "../audit/audit.ts";
import { membershipRoles } from "../db/schema/access.ts";
import { notifications } from "../db/schema/notifications.ts";
import { approvalSteps, approvalTasks } from "../db/schema/workflows.ts";
import { tick } from "../jobs/tick.ts";
import { decideTask } from "./engine.ts";
import { replacePolicies } from "./policies.ts";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

describe("escalation", () => {
  let w: WorkflowWorld;
  const clock = movableClock("2026-11-02T01:00:00.000Z");
  beforeEach(async () => {
    clock.set("2026-11-02T01:00:00.000Z");
    w = await createWorkflowWorld({ clock });
  });
  afterEach(() => w.close());

  const open = (requestId: string) =>
    w.deps.db
      .select()
      .from(approvalTasks)
      .where(and(eq(approvalTasks.requestId, requestId), eq(approvalTasks.status, "pending")));

  it("after three days the manager is reminded and hr_admins get an Escalated task; either can decide", async () => {
    const { requestId } = await w.submit(w.m.staff, "leave");
    clock.advance(3 * DAY - 60_000);
    await tick(w.deps);
    expect((await open(requestId)).map((t) => t.origin)).toEqual(["resolved"]);

    clock.advance(60_000);
    const report = await tick(w.deps);
    expect(report.escalations).toBe(1);
    const tasks = await open(requestId);
    // The manager's manager is the department head (a non-HR person) — one level up.
    expect(tasks.map((t) => [t.assigneeMembershipId, t.origin]).sort()).toEqual(
      [
        [w.m.manager.membershipId, "resolved"],
        [w.m.head.membershipId, "escalated"],
      ].sort(),
    );
    const reminder = await w.deps.db
      .select()
      .from(notifications)
      .where(
        and(eq(notifications.recipientMembershipId, w.m.manager.membershipId), eq(notifications.kind, "task_reminder")),
      );
    expect(reminder).toHaveLength(1);
    const escalatedNote = await w.deps.db
      .select()
      .from(notifications)
      .where(
        and(eq(notifications.recipientMembershipId, w.m.head.membershipId), eq(notifications.kind, "task_escalated")),
      );
    expect(escalatedNote[0]?.title).toMatch(/^Escalated: /);
    const [step] = await w.deps.db.select().from(approvalSteps).where(eq(approvalSteps.requestId, requestId));
    expect(step?.escalatedAt).toBeTruthy();

    // Escalation happens once per step.
    clock.advance(5 * DAY);
    expect((await tick(w.deps)).escalations).toBe(0);
    expect((await open(requestId)).length).toBe(2);

    const escalated = tasks.find((t) => t.origin === "escalated");
    const r = await decideTask(
      w.deps,
      {
        orgId: w.org.id,
        membershipId: w.m.head.membershipId,
        roles: [],
        audit: systemAuditContext(w.org.id, "system", "t"),
      },
      { taskId: escalated?.id as string, decision: "approve" },
    );
    expect(r.requestStatus).toBe("pending"); // on to the HR step
  });

  it("an assignee without a manager, or who is an hr_admin, escalates to hr_admins", async () => {
    const { requestId } = await w.submit(w.m.loner, "leave"); // hr + hr2 hold it
    clock.advance(3 * DAY);
    await tick(w.deps);
    // Both hr_admins already hold it, so owners are the next level.
    const tasks = await open(requestId);
    expect(tasks.filter((t) => t.origin === "escalated").map((t) => t.assigneeMembershipId)).toEqual([
      w.m.owner.membershipId,
    ]);

    // A manager with no manager of their own escalates to the hr_admins.
    w.managers[w.m.head.employeeId as string] = null;
    const second = await w.submit(w.m.manager, "leave"); // goes to head
    clock.advance(3 * DAY);
    await tick(w.deps);
    const escalated = (await open(second.requestId)).filter((t) => t.origin === "escalated");
    expect(escalated.map((t) => t.assigneeMembershipId).sort()).toEqual(
      [w.m.hr.membershipId, w.m.hr2.membershipId].sort(),
    );
  });

  it("0 days disables escalation", async () => {
    await replacePolicies(w.deps.db, w.deps, systemAuditContext(w.org.id, "system", "t"), w.org.id, "leave", [
      { name: "Default", condition: null, priority: 0, steps: [{ approverRule: "manager", escalateAfterDays: 0 }] },
    ]);
    const { requestId } = await w.submit(w.m.staff, "leave");
    expect((await open(requestId))[0]?.dueAt).toBeNull();
    clock.advance(30 * DAY);
    expect((await tick(w.deps)).escalations).toBe(0);
  });

  it("uses the injected clock and catches up after downtime, once per step", async () => {
    const a = await w.submit(w.m.staff, "leave");
    clock.advance(DAY);
    const b = await w.submit(w.m.other, "claim", { amountCents: 500 });
    // Server down for a week.
    clock.advance(7 * DAY);
    const first = await tick(w.deps);
    expect(first.escalations).toBe(2);
    expect((await tick(w.deps)).escalations).toBe(0);
    for (const r of [a, b]) expect((await open(r.requestId)).filter((t) => t.origin === "escalated")).toHaveLength(1);
  });

  it("two concurrent sweeps escalate a step once", async () => {
    const { requestId } = await w.submit(w.m.staff, "leave");
    clock.advance(4 * DAY);
    const [x, y] = await Promise.all([tick(w.deps), tick(w.deps)]);
    expect(x.escalations + y.escalations).toBe(1);
    expect((await open(requestId)).filter((t) => t.origin === "escalated")).toHaveLength(1);
  });

  it("with no hr_admin left, an hr_admin assignee escalates to owners", async () => {
    await w.deps.db.delete(membershipRoles).where(eq(membershipRoles.membershipId, w.m.hr2.membershipId));
    const { requestId } = await w.submit(w.m.loner, "leave"); // only hr
    clock.advance(3 * DAY);
    await tick(w.deps);
    expect((await open(requestId)).filter((t) => t.origin === "escalated").map((t) => t.assigneeMembershipId)).toEqual([
      w.m.owner.membershipId,
    ]);
  });
});
