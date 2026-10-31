import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { clientAs, createTestDb, seedMember, type TestClient, type TestDb } from "../../testing/index.ts";
import { type PayrollHttp, payrollHttp } from "../../testing/payroll-http.ts";
import { overtimeClaims } from "../db/schema/attendance.ts";

/**
 * Leave and attendance × payroll with no doubles: `payrollPorts(deps)` defaults to leave's
 * UnpaidLeaveSource and attendance's OvertimeSource, so approved no-pay leave pro-rates the
 * salary and approved OT is paid, without anyone typing them into the run.
 */
let t: TestDb;
let p: PayrollHttp<"A">;
let employee: TestClient;
const api = "/api/v1/payroll";

beforeAll(async () => {
  t = await createTestDb();
  p = await payrollHttp(t, [
    {
      key: "A",
      name: "Daud bin Hassan",
      dob: "1985-08-08",
      residency: "citizen",
      hireDate: "2020-09-01",
      basicCents: 240_000,
    },
  ]);
  employee = await clientAs(p.app, p.co.h.deps, await seedMember(p.co.h.deps, p.co.h.orgId, { employeeId: p.co.e.A }));
}, 60_000);
afterAll(() => t.close());

describe("WS5 outputs reach the payroll run", () => {
  it("approved no-pay leave and approved OT become run inputs", async () => {
    const types = await p.ok<{ items: { id: string; code: string }[] }>(employee.get("/api/v1/leave/types"));
    const leave = await p.ok<{ id: string }>(
      employee.post("/api/v1/leave/requests", {
        leaveTypeId: types.items.find((x) => x.code === "no_pay")?.id,
        startDate: "2026-10-19",
        endDate: "2026-10-20",
        endSession: "am",
      }),
      201,
    );
    // No manager: the owner decides.
    const tasks = await p.ok<{ items: { taskId: string; subjectType: string }[] }>(
      p.owner.get("/api/v1/approvals/tasks"),
    );
    const task = tasks.items.find((x) => x.subjectType === "leave");
    await p.ok(p.owner.post(`/api/v1/approvals/tasks/${task?.taskId}/decision`, { decision: "approve" }));
    expect((await p.ok<{ status: string }>(employee.get(`/api/v1/leave/requests/${leave.id}`))).status).toBe(
      "approved",
    );
    const deps = p.co.h.deps;
    await deps.db.insert(overtimeClaims).values({
      id: deps.ids.newId(),
      orgId: p.co.h.orgId,
      employeeId: p.co.e.A,
      workDate: "2026-10-14",
      computedMinutes: 120,
      claimedMinutes: 120,
      approvedMinutes: 120,
      statutory: true,
      status: "approved",
      createdByMembershipId: (await seedMember(deps, p.co.h.orgId)).membershipId,
    });

    const run = await p.ok<{ id: string }>(
      p.admin.post(`${api}/runs`, { kind: "regular", month: "2026-10", payDate: "2026-10-30" }),
      201,
    );
    await p.ok(p.admin.post(`${api}/runs/${run.id}/compute`));
    const d = await p.ok<{
      input: {
        items: { kind: string; days: number | null; date: string | null; minutes: number | null; source: string }[];
      };
      result: { lines: { label: string; amountCents: number }[] };
    }>(p.admin.get(`${api}/runs/${run.id}/employees/${p.co.e.A}`));
    expect(d.input.items.map((i) => [i.kind, i.days, i.date, i.minutes, i.source])).toEqual([
      ["unpaid_leave", 1, "2026-10-19", null, "attendance"],
      ["unpaid_leave", 0.5, "2026-10-20", null, "attendance"],
      ["overtime", null, null, 120, "attendance"],
    ]);
    const labels = d.result.lines.map((l) => l.label).join(" | ");
    expect(labels).toMatch(/No-pay leave \(1\.5 days\)/);
    expect(labels).toMatch(/Overtime/);
  });
});
