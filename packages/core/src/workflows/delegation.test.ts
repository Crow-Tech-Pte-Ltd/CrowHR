import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  clientAs,
  createWorkflowWorld,
  movableClock,
  type SeededMember,
  type WorkflowWorld,
} from "../../testing/index.ts";
import { systemAuditContext } from "../audit/audit.ts";
import { approvalTasks } from "../db/schema/workflows.ts";
import { tick } from "../jobs/tick.ts";
import { createDelegation } from "./delegations.ts";
import { decideTask } from "./engine.ts";

describe("delegation", () => {
  let w: WorkflowWorld;
  // 30 Nov 2026, 09:00 SGT.
  const clock = movableClock("2026-11-30T01:00:00.000Z");
  beforeEach(async () => {
    clock.set("2026-11-30T01:00:00.000Z");
    w = await createWorkflowWorld({ clock });
  });
  afterEach(() => w.close());

  const audit = () => systemAuditContext(w.org.id, "system", "test");
  const delegate = (
    from: SeededMember,
    to: SeededMember,
    startsOn: string,
    endsOn: string,
    subjectTypes: string[] | null = null,
  ) =>
    createDelegation(
      w.deps,
      { orgId: w.org.id, membershipId: from.membershipId, canManageOthers: false, audit: audit() },
      { toMembershipId: to.membershipId, startsOn, endsOn, subjectTypes },
    );
  const open = (requestId: string) =>
    w.deps.db
      .select()
      .from(approvalTasks)
      .where(and(eq(approvalTasks.requestId, requestId), eq(approvalTasks.status, "pending")));

  it("delegation during leave: both M and N get the task, N's decision is on behalf of M", async () => {
    await delegate(w.m.manager, w.m.head, "2026-12-01", "2026-12-05");
    clock.set("2026-12-02T02:00:00.000Z");
    const { requestId } = await w.submit(w.m.staff, "claim", { amountCents: 2_000 });
    const tasks = await open(requestId);
    expect(tasks.map((t) => [t.assigneeMembershipId, t.origin, t.onBehalfOfMembershipId]).sort()).toEqual(
      [
        [w.m.manager.membershipId, "resolved", null],
        [w.m.head.membershipId, "delegated", w.m.manager.membershipId],
      ].sort(),
    );
    const n = tasks.find((t) => t.origin === "delegated");
    await decideTask(
      w.deps,
      { orgId: w.org.id, membershipId: w.m.head.membershipId, roles: [], audit: audit() },
      {
        taskId: n?.id as string,
        decision: "approve",
      },
    );
    expect(w.fake.calls).toEqual([]);
    const [mTask] = await w.deps.db
      .select()
      .from(approvalTasks)
      .where(
        and(eq(approvalTasks.requestId, requestId), eq(approvalTasks.assigneeMembershipId, w.m.manager.membershipId)),
      );
    expect(mTask?.status).toBe("superseded");

    const client = await clientAs(w.app, w.deps, w.m.staff);
    const detail = (await (await client.get(`/api/v1/approvals/requests/${requestId}`)).json()) as {
      steps: { tasks: { assignee: string; onBehalfOf: string | null; status: string }[] }[];
    };
    expect(detail.steps[0]?.tasks).toContainEqual(
      expect.objectContaining({ assignee: "Rajesh Kumar", onBehalfOf: "Wong Kai Wen", status: "approved" }),
    );
  });

  it("the window is inclusive of both dates (Singapore time)", async () => {
    await delegate(w.m.manager, w.m.head, "2026-12-01", "2026-12-05");
    const at = async (iso: string) => {
      clock.set(iso);
      const { requestId } = await w.submit(w.m.staff, "leave");
      return (await open(requestId)).some((t) => t.origin === "delegated");
    };
    expect(await at("2026-11-30T15:59:00.000Z")).toBe(false); // 30 Nov 23:59 SGT
    expect(await at("2026-11-30T16:00:00.000Z")).toBe(true); // 1 Dec 00:00 SGT
    expect(await at("2026-12-05T15:59:00.000Z")).toBe(true); // 5 Dec 23:59 SGT
    expect(await at("2026-12-05T16:00:00.000Z")).toBe(false); // 6 Dec 00:00 SGT
  });

  it("respects the subject-type filter", async () => {
    await delegate(w.m.manager, w.m.head, "2026-11-30", "2026-12-05", ["claim"]);
    const leave = await w.submit(w.m.staff, "leave");
    const claim = await w.submit(w.m.staff, "claim", { amountCents: 100 });
    expect((await open(leave.requestId)).some((t) => t.origin === "delegated")).toBe(false);
    expect((await open(claim.requestId)).some((t) => t.origin === "delegated")).toBe(true);
  });

  it("a delegate never gets a task for their own request", async () => {
    await delegate(w.m.manager, w.m.staff, "2026-11-30", "2026-12-05");
    const { requestId } = await w.submit(w.m.staff, "leave");
    expect((await open(requestId)).map((t) => t.assigneeMembershipId)).toEqual([w.m.manager.membershipId]);
  });

  it("role steps delegate only to members holding the role", async () => {
    await delegate(w.m.hr, w.m.manager, "2026-11-30", "2026-12-05");
    await delegate(w.m.hr2, w.m.payroll, "2026-11-30", "2026-12-05");
    const { requestId } = await w.submit(w.m.loner, "leave");
    expect((await open(requestId)).some((t) => t.origin === "delegated")).toBe(false);
    // Personal (manager) steps delegate to anyone.
    const { requestId: r2 } = await w.submit(w.m.staff, "leave");
    expect((await open(r2)).length).toBe(1);
  });

  it("delegation loops (A→B, B→A) give each person one task and never cascade", async () => {
    await delegate(w.m.hr, w.m.hr2, "2026-11-30", "2026-12-05");
    await delegate(w.m.hr2, w.m.hr, "2026-11-30", "2026-12-05");
    await delegate(w.m.manager, w.m.head, "2026-11-30", "2026-12-05");
    await delegate(w.m.head, w.m.manager, "2026-11-30", "2026-12-05");
    const a = await w.submit(w.m.loner, "leave");
    const tasks = await open(a.requestId);
    expect(tasks.map((t) => t.assigneeMembershipId).sort()).toEqual([w.m.hr.membershipId, w.m.hr2.membershipId].sort());
    const b = await w.submit(w.m.staff, "leave");
    const bt = await open(b.requestId);
    expect(bt.map((t) => [t.assigneeMembershipId, t.origin]).sort()).toEqual(
      [
        [w.m.manager.membershipId, "resolved"],
        [w.m.head.membershipId, "delegated"],
      ].sort(),
    );
    // The sweep re-applies delegations idempotently.
    await tick(w.deps);
    await tick(w.deps);
    expect((await open(b.requestId)).length).toBe(2);
  });

  it("existing open tasks gain a delegate when cover starts; it ends when cover ends", async () => {
    const { requestId } = await w.submit(w.m.staff, "leave");
    await delegate(w.m.manager, w.m.head, "2026-12-01", "2026-12-02");
    expect((await open(requestId)).length).toBe(1); // not started yet
    clock.set("2026-12-01T01:00:00.000Z");
    await tick(w.deps);
    expect((await open(requestId)).map((t) => t.origin).sort()).toEqual(["delegated", "resolved"]);
    clock.set("2026-12-03T01:00:00.000Z");
    await tick(w.deps);
    // (By now the step has also escalated after three days; the delegate task is gone.)
    expect((await open(requestId)).some((t) => t.origin === "delegated")).toBe(false);
  });

  it("read access: a delegate reads the subject only while the delegated task is open", async () => {
    await delegate(w.m.manager, w.m.other, "2026-11-30", "2026-12-05");
    const { requestId } = await w.submit(w.m.staff, "leave");
    const asOther = await clientAs(w.app, w.deps, w.m.other);
    expect((await asOther.get(`/api/v1/approvals/requests/${requestId}`)).status).toBe(200);
    const mTask = (await open(requestId)).find((t) => t.origin === "resolved");
    await decideTask(
      w.deps,
      { orgId: w.org.id, membershipId: w.m.manager.membershipId, roles: [], audit: audit() },
      {
        taskId: mTask?.id as string,
        decision: "reject",
        comment: "Clash with stocktake",
      },
    );
    expect((await asOther.get(`/api/v1/approvals/requests/${requestId}`)).status).toBe(404);
  });

  it("hr_admins set cover on behalf of a member; others cannot", async () => {
    const asHr = await clientAs(w.app, w.deps, w.m.hr);
    const res = await asHr.post("/api/v1/approvals/delegations", {
      fromMembershipId: w.m.manager.membershipId,
      toMembershipId: w.m.head.membershipId,
      startsOn: "2026-12-01",
      endsOn: "2026-12-05",
    });
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({
      from: { name: "Wong Kai Wen" },
      to: { name: "Rajesh Kumar" },
      active: false,
    });
    const asStaff = await clientAs(w.app, w.deps, w.m.staff);
    const denied = await asStaff.post("/api/v1/approvals/delegations", {
      fromMembershipId: w.m.manager.membershipId,
      toMembershipId: w.m.head.membershipId,
      startsOn: "2026-12-01",
      endsOn: "2026-12-05",
    });
    expect(denied.status).toBe(403);
    const bad = await asStaff.post("/api/v1/approvals/delegations", {
      toMembershipId: w.m.head.membershipId,
      startsOn: "2026-12-05",
      endsOn: "2026-12-01",
    });
    expect(bad.status).toBe(400);
  });
});
