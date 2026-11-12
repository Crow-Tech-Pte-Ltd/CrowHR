import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { clientAs, createWorkflowWorld, seedMember, seedOrg, type WorkflowWorld } from "../../testing/index.ts";
import { approvalTasks } from "../db/schema/workflows.ts";

describe("approvals HTTP", () => {
  let w: WorkflowWorld;
  beforeEach(async () => {
    w = await createWorkflowWorld();
  });
  afterEach(() => w.close());

  it("task list is scoped to the assignee", async () => {
    await w.submit(w.m.staff, "leave");
    const asManager = await clientAs(w.app, w.deps, w.m.manager);
    const mine = (await (await asManager.get("/api/v1/approvals/tasks")).json()) as {
      items: { title: string; requester: { name: string }; step: { position: number; of: number; label: string } }[];
    };
    expect(mine.items).toHaveLength(1);
    expect(mine.items[0]).toMatchObject({
      requester: { name: "Ravi Kumar" },
      step: { position: 1, of: 2, label: "Manager" },
    });
    const asHr = await clientAs(w.app, w.deps, w.m.hr);
    expect(((await (await asHr.get("/api/v1/approvals/tasks")).json()) as { items: unknown[] }).items).toEqual([]);
  });

  it("request detail: requester and assignee read it with the adapter summary; others get 404", async () => {
    const { requestId } = await w.submit(w.m.staff, "claim", { amountCents: 2_500, typeCode: "transport" });
    const asStaff = await clientAs(w.app, w.deps, w.m.staff);
    const detail = (await (await asStaff.get(`/api/v1/approvals/requests/${requestId}`)).json()) as Record<
      string,
      unknown
    >;
    expect(detail).toMatchObject({
      status: "pending",
      subjectLabel: "Claim",
      requester: { name: "Ravi Kumar" },
      summary: { lines: [{ label: "Type", value: "transport" }], context: [{ label: "Balance", value: "10 days" }] },
      steps: [
        { label: "Manager", status: "active", tasks: [{ assignee: "Wong Kai Wen", status: "pending" }] },
        { label: "HR admin", status: "waiting", tasks: [] },
      ],
      viewer: { canWithdraw: true, myTaskId: null },
    });
    const asManager = await clientAs(w.app, w.deps, w.m.manager);
    const asMgr = (await (await asManager.get(`/api/v1/approvals/requests/${requestId}`)).json()) as {
      viewer: { myTaskId: string | null };
    };
    expect(asMgr.viewer.myTaskId).toBeTruthy();
    const asOther = await clientAs(w.app, w.deps, w.m.other);
    expect((await asOther.get(`/api/v1/approvals/requests/${requestId}`)).status).toBe(404);
    // hr_admins see requests (to reassign), but not payroll runs.
    const asHr = await clientAs(w.app, w.deps, w.m.hr);
    expect((await asHr.get(`/api/v1/approvals/requests/${requestId}`)).status).toBe(200);
    const payroll = await w.submit(w.m.payroll, "payroll_run");
    expect((await asHr.get(`/api/v1/approvals/requests/${payroll.requestId}`)).status).toBe(404);
  });

  it("decide endpoint: approve, reject needs a comment, bulk approve", async () => {
    const a = await w.submit(w.m.staff, "leave");
    const b = await w.submit(w.m.other, "leave");
    const asManager = await clientAs(w.app, w.deps, w.m.manager);
    const tasks = (await (await asManager.get("/api/v1/approvals/tasks")).json()) as {
      items: { taskId: string; requestId: string }[];
    };
    const ta = tasks.items.find((t) => t.requestId === a.requestId)?.taskId;
    const noComment = await asManager.post(`/api/v1/approvals/tasks/${ta}/decision`, { decision: "reject" });
    expect(noComment.status).toBe(400);
    const body = (await noComment.json()) as { error: { details: { issues: { path: string }[] } } };
    expect(body.error.details.issues[0]?.path).toBe("comment");
    const bulk = await asManager.post("/api/v1/approvals/tasks/decisions", {
      taskIds: tasks.items.map((t) => t.taskId),
      decision: "approve",
    });
    expect(bulk.status).toBe(200);
    const results = (await bulk.json()) as { results: { ok: boolean; requestStatus: string }[] };
    expect(results.results.map((r) => [r.ok, r.requestStatus])).toEqual([
      [true, "pending"],
      [true, "pending"],
    ]);
    // Bulk again: every task is already decided by the same member → replayed, still ok.
    const again = (await (
      await asManager.post("/api/v1/approvals/tasks/decisions", {
        taskIds: tasks.items.map((t) => t.taskId),
        decision: "approve",
      })
    ).json()) as { results: { ok: boolean }[] };
    expect(again.results.every((r) => r.ok)).toBe(true);
    void b;
  });

  it("a member of another organisation gets 404 for this org's tasks and requests", async () => {
    const { requestId } = await w.submit(w.m.staff, "leave");
    const [task] = await w.deps.db.select().from(approvalTasks).where(eq(approvalTasks.requestId, requestId));
    const other = await seedOrg(w.deps);
    const intruder = await seedMember(w.deps, other.id, { roles: ["owner", "hr_admin"] });
    const client = await clientAs(w.app, w.deps, intruder);
    expect((await client.get(`/api/v1/approvals/requests/${requestId}`)).status).toBe(404);
    expect((await client.post(`/api/v1/approvals/tasks/${task?.id}/decision`, { decision: "approve" })).status).toBe(
      404,
    );
    expect((await client.post(`/api/v1/approvals/requests/${requestId}/withdraw`)).status).toBe(404);
    expect((await client.post(`/api/v1/approvals/requests/${requestId}/comments`, { body: "hi" })).status).toBe(404);
  });

  it("comments notify the other party and show on the request", async () => {
    const { requestId } = await w.submit(w.m.staff, "claim", { amountCents: 900 });
    const asManager = await clientAs(w.app, w.deps, w.m.manager);
    const res = await asManager.post(`/api/v1/approvals/requests/${requestId}/comments`, {
      body: "Which client was this for?",
    });
    expect(res.status).toBe(201);
    const asStaff = await clientAs(w.app, w.deps, w.m.staff);
    const detail = (await (await asStaff.get(`/api/v1/approvals/requests/${requestId}`)).json()) as {
      comments: { author: string; body: string }[];
    };
    expect(detail.comments).toEqual([
      expect.objectContaining({ author: "Wong Kai Wen", body: "Which client was this for?" }),
    ]);
    const n = (await (await asStaff.get("/api/v1/notifications")).json()) as { items: { kind: string }[] };
    expect(n.items.map((i) => i.kind)).toContain("request_comment");
  });

  it("policies: hr_admins edit claims, only owners edit payroll; built-in defaults are listed", async () => {
    const asHr = await clientAs(w.app, w.deps, w.m.hr);
    const list = (await (await asHr.get("/api/v1/approvals/policies")).json()) as {
      types: {
        subjectType: string;
        installed: boolean;
        canEdit: boolean;
        policies: { builtIn: boolean; steps: { label: string }[] }[];
      }[];
    };
    const leave = list.types.find((t) => t.subjectType === "leave");
    expect(leave).toMatchObject({ installed: true, canEdit: true });
    expect(leave?.policies[0]).toMatchObject({ builtIn: true, steps: [{ label: "Manager" }, { label: "HR admin" }] });
    // Attendance submits timesheets (add-timesheet-approval); their built-in chain is the manager.
    const timesheet = list.types.find((t) => t.subjectType === "timesheet");
    expect(timesheet).toMatchObject({ installed: true, canEdit: true });
    expect(timesheet?.policies[0]).toMatchObject({ builtIn: true, steps: [{ label: "Manager" }] });
    expect(timesheet?.policies[0]?.steps).toHaveLength(1);
    expect(list.types.find((t) => t.subjectType === "payroll_run")?.canEdit).toBe(false);

    const save = await asHr.put("/api/v1/approvals/policies/claim", {
      policies: [
        { name: "Default", condition: null, steps: [{ approverRule: "manager" }] },
        {
          name: "Over S$500",
          condition: { amountGte: 50_000 },
          priority: 10,
          steps: [{ approverRule: "manager" }, { approverRule: "role:owner", escalateAfterDays: 5 }],
        },
      ],
    });
    expect(save.status).toBe(200);
    const twoDefaults = await asHr.put("/api/v1/approvals/policies/claim", {
      policies: [
        { name: "A", condition: null, steps: [{ approverRule: "manager" }] },
        { name: "B", condition: null, steps: [{ approverRule: "manager" }] },
      ],
    });
    expect(twoDefaults.status).toBe(400);
    // Rules are exactly as documented: lower case, and a member is a membership ID (never a 500).
    for (const approverRule of [
      "Manager",
      "ROLE:owner",
      `MEMBER:${w.m.head.membershipId}`,
      `member:${"-".repeat(36)}`,
    ]) {
      const res = await asHr.put("/api/v1/approvals/policies/claim", {
        policies: [{ name: "Default", condition: null, steps: [{ approverRule }] }],
      });
      expect(res.status, approverRule).toBe(400);
      expect(
        ((await res.json()) as { error: { details: { issues: { message: string }[] } } }).error.details.issues[0]
          ?.message,
      ).toMatch(/Choose manager/);
    }
    expect(
      (
        await asHr.put("/api/v1/approvals/policies/payroll_run", {
          policies: [{ name: "D", condition: null, steps: [{ approverRule: "role:hr_admin" }] }],
        })
      ).status,
    ).toBe(403);
    const asStaff = await clientAs(w.app, w.deps, w.m.staff);
    expect((await asStaff.get("/api/v1/approvals/policies")).status).toBe(403);
    const asOwner = await clientAs(w.app, w.deps, w.m.owner);
    expect(
      (
        await asOwner.put("/api/v1/approvals/policies/payroll_run", {
          policies: [{ name: "Owner", condition: null, steps: [{ approverRule: "role:owner" }] }],
        })
      ).status,
    ).toBe(200);
  });

  it("my requests list what I'm waiting on", async () => {
    await w.submit(w.m.staff, "leave");
    const asStaff = await clientAs(w.app, w.deps, w.m.staff);
    const mine = (await (await asStaff.get("/api/v1/approvals/requests")).json()) as {
      items: { status: string; waitingOn: string | null }[];
    };
    expect(mine.items).toEqual([expect.objectContaining({ status: "pending", waitingOn: "Wong Kai Wen" })]);
  });
});
