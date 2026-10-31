import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { clientAs, createTestDb, seedMember, type TestClient, type TestDb } from "../../testing/index.ts";
import { decideRun, type PayrollHttp, payrollHttp } from "../../testing/payroll-http.ts";
import { claims } from "../db/schema/claims.ts";
import { approvalRequests, approvalTasks } from "../db/schema/workflows.ts";

/**
 * Claims × payroll with no doubles: `payrollPorts(deps)` defaults to the claims module's
 * ReimbursementSource. An approved claim becomes a "Claims reimbursement: <type>" payslip line,
 * is reserved by the run, and is paid with the run's payment date when payroll marks the run paid.
 * A claim approved after the run was computed is not paid with it and stays payable.
 */
let t: TestDb;
let p: PayrollHttp<"A">;
let employee: TestClient;
const api = "/api/v1/payroll";

async function json(res: Response | Promise<Response>) {
  const r = await res;
  const text = await r.text();
  return { status: r.status, body: text ? JSON.parse(text) : null };
}

async function ownerApproves(claimId: string) {
  const [req] = await t.db.select().from(approvalRequests).where(eq(approvalRequests.subjectId, claimId));
  const [task] = await t.db
    .select()
    .from(approvalTasks)
    .where(and(eq(approvalTasks.requestId, req?.id as string), eq(approvalTasks.status, "pending")));
  const res = await json(p.owner.post(`/api/v1/approvals/tasks/${task?.id}/decision`, { decision: "approve" }));
  expect(res.status, JSON.stringify(res.body)).toBe(200);
}

beforeAll(async () => {
  t = await createTestDb();
  p = await payrollHttp(t, [
    {
      key: "A",
      name: "Daud bin Hassan",
      dob: "1985-08-08",
      residency: "citizen",
      hireDate: "2020-09-01",
      basicCents: 260_000,
    },
  ]);
  employee = await clientAs(p.app, p.co.h.deps, await seedMember(p.co.h.deps, p.co.h.orgId, { employeeId: p.co.e.A }));
  // Owners approve claims in this company (Daud has no manager).
  await p.ok(
    p.owner.put("/api/v1/approvals/policies/claim", {
      policies: [{ name: "Owner", condition: null, steps: [{ approverRule: "role:owner" }] }],
    }),
  );
}, 60_000);
afterAll(() => t.close());

describe("claims reimbursed through payroll (real ReimbursementSource)", () => {
  let runId = "";
  let first = "";
  let late = "";

  it("approved claims become payslip reimbursement lines, reserved by the run", async () => {
    const type = await p.ok<{ id: string }>(
      p.owner.post("/api/v1/claims/types", {
        code: "TRANSPORT",
        name: "Transport",
        category: "transport",
        receiptRule: "never",
        capPeriod: "none",
      }),
      201,
    );
    const line = (amountMinor: number) => ({
      claimTypeId: type.id,
      expenseDate: "2026-10-20",
      merchant: "Grab",
      description: "Site visit",
      currency: "SGD",
      amountMinor,
    });
    first = (
      await p.ok<{ id: string }>(employee.post("/api/v1/claims", { lines: [line(4000), line(550)], submit: true }), 201)
    ).id;
    late = (await p.ok<{ id: string }>(employee.post("/api/v1/claims", { lines: [line(1200)], submit: true }), 201)).id;
    await ownerApproves(first);

    runId = (
      await p.ok<{ id: string }>(
        p.admin.post(`${api}/runs`, { kind: "regular", month: "2026-10", payDate: "2026-10-30" }),
        201,
      )
    ).id;
    await p.ok(p.admin.post(`${api}/runs/${runId}/compute`));
    const d = await p.ok<{ result: { lines: { category: string; amountCents: number; label: string }[] } }>(
      p.admin.get(`${api}/runs/${runId}/employees/${p.co.e.A}`),
    );
    expect(d.result.lines.filter((l) => l.category === "claim")).toEqual([
      expect.objectContaining({ amountCents: 4_550, label: "Claims reimbursement: Transport" }),
    ]);
    const [row] = await t.db.select().from(claims).where(eq(claims.id, first));
    expect(row?.payrollRunId).toBe(runId);
    // Recomputing keeps the claim (release + reserve by the same run).
    await p.ok(p.admin.post(`${api}/runs/${runId}/compute`));
    expect((await t.db.select().from(claims).where(eq(claims.id, first)))[0]?.payrollRunId).toBe(runId);
    // The claim is shown as "in the payroll run" and can't be paid outside it.
    const outside = await json(
      p.admin.post("/api/v1/claims/mark-paid", { claimIds: [first], paidOn: "2026-10-30", reference: "FAST" }),
    );
    expect(outside.status).toBe(409);
  });

  it("marking the run paid pays its claims once; a claim approved after the run was computed rolls over", async () => {
    await p.ok(p.admin.post(`${api}/runs/${runId}/submit`));
    // Approved before the cutoff, but after October was computed.
    await ownerApproves(late);
    await p.ok(decideRun(p.owner, runId, "approved"));
    await p.ok(p.admin.post(`${api}/runs/${runId}/mark-paid`));
    const mine = await p.ok<{ status: string; paidVia: string; paidOn: string }>(
      employee.get(`/api/v1/claims/${first}`),
    );
    expect(mine).toMatchObject({ status: "paid", paidVia: "payroll", paidOn: "2026-10-30" });
    // Marking paid again is refused by payroll and leaves the claim as it was.
    expect((await json(p.admin.post(`${api}/runs/${runId}/mark-paid`))).status).toBe(409);
    expect((await t.db.select().from(claims).where(eq(claims.id, first)))[0]).toMatchObject({
      status: "paid",
      paidOn: "2026-10-30",
    });

    const lateRow = (await t.db.select().from(claims).where(eq(claims.id, late)))[0];
    expect(lateRow).toMatchObject({ status: "approved", payrollRunId: null });
    const payable = await p.ok<{ items: { claimId: string }[] }>(
      p.admin.get("/api/v1/claims/payable?periodEnd=2026-11-30"),
    );
    expect(payable.items.map((i) => i.claimId)).toEqual([late]);
  });
});
