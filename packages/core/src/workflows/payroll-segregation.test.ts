import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, expect, it } from "vitest";
import { clientAs, createTestDb, seedMember, type TestDb } from "../../testing/index.ts";
import { payrollHttp } from "../../testing/payroll-http.ts";
import { recordAudit, systemAuditContext } from "../audit/audit.ts";
import { approvalRequests, approvalTasks } from "../db/schema/workflows.ts";

let t: TestDb;
beforeEach(async () => {
  t = await createTestDb();
});
afterEach(() => t.close());

it.each(["add", "update", "legacy"])(
  "flags self-entered earnings (%s), excludes their editor even after gaining owner, and allows another owner",
  async (path) => {
    const p = await payrollHttp(t, [
      {
        key: "A",
        name: "Aw Chee Keong",
        dob: "1990-04-12",
        residency: "citizen",
        hireDate: "2020-01-06",
        basicCents: 400_000,
      },
    ]);
    const deps = p.co.h.deps;
    const orgId = p.co.h.orgId;
    // Both assigned roles: the editor would otherwise receive an owner approval task.
    const editor = await seedMember(deps, orgId, {
      displayName: "Aw Chee Keong",
      roles: ["owner", "payroll_admin"],
      employeeId: p.co.e.A,
    });
    const self = await clientAs(p.app, deps, editor);
    const run = await p.ok<{ id: string }>(
      p.admin.post("/api/v1/payroll/runs", { kind: "regular", month: "2026-10", payDate: "2026-10-30" }),
      201,
    );
    const item = {
      employeeId: p.co.e.A,
      kind: "bonus",
      label: "Self bonus",
      amountCents: 100_000,
      wageClass: "AW",
      awPayableDate: "2026-10-20",
    };
    if (path === "add") {
      await p.ok(self.post(`/api/v1/payroll/runs/${run.id}/items`, item), 201);
    } else {
      const added = await p.ok<{ id: string }>(p.admin.post(`/api/v1/payroll/runs/${run.id}/items`, item), 201);
      if (path === "legacy") {
        await deps.db.transaction((tx) =>
          recordAudit(
            tx,
            deps,
            {
              ...systemAuditContext(orgId, "system", "historical fixture"),
              actorType: "member",
              actorMembershipId: editor.membershipId,
            },
            {
              action: "payroll.item_added",
              targetType: "payroll_run",
              targetId: run.id,
              meta: { itemId: added.id, employeeId: p.co.e.A, kind: "bonus" },
            },
          ),
        );
      } else {
        await p.ok(
          self.put(`/api/v1/payroll/runs/${run.id}/items/${added.id}`, { ...item, amountCents: 200_000 }),
          204,
        );
      }
    }
    await p.ok(p.admin.post(`/api/v1/payroll/runs/${run.id}/compute`));
    await p.ok(p.admin.post(`/api/v1/payroll/runs/${run.id}/submit`));
    const [request] = await deps.db
      .select()
      .from(approvalRequests)
      .where(and(eq(approvalRequests.orgId, orgId), eq(approvalRequests.subjectId, run.id)));
    expect(request?.excludedDeciderMembershipIds).toContain(editor.membershipId);
    const open = await deps.db
      .select()
      .from(approvalTasks)
      .where(and(eq(approvalTasks.requestId, request?.id as string), eq(approvalTasks.status, "pending")));
    expect(open.some((task) => task.assigneeMembershipId === editor.membershipId)).toBe(false);
    const detail = await p.ok<{ summary: { context: { label: string; value: string }[] } }>(
      p.owner.get(`/api/v1/approvals/requests/${request?.id}`),
    );
    expect(
      detail.summary.context.some((line) => /own earnings/i.test(line.label) && /Aw Chee Keong/.test(line.value)),
    ).toBe(true);
    // Even a planted task with selfApproved set cannot bypass the subject's guard.
    const [planted] = await deps.db
      .insert(approvalTasks)
      .values({
        id: deps.ids.newId(),
        orgId,
        requestId: request?.id as string,
        position: open[0]?.position ?? 1,
        assigneeMembershipId: editor.membershipId,
        origin: "reassigned",
        status: "pending",
        selfApproved: true,
        viaRole: "owner",
        createdAt: deps.clock.now(),
      })
      .returning();
    expect((await self.post(`/api/v1/approvals/tasks/${planted?.id}/decision`, { decision: "approve" })).status).toBe(
      403,
    );
    expect(
      (await p.owner.post(`/api/v1/approvals/tasks/${open[0]?.id}/decision`, { decision: "approve" })).status,
    ).toBe(200);
  },
);
