import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { clientAs, createTestDb, seedMember, seedOrg, type TestClient, type TestDb } from "../../testing/index.ts";
import { decideRun, type PayrollHttp, payrollHttp } from "../../testing/payroll-http.ts";
import { taxableCashClaims } from "../claims/taxable.ts";
import { claims, claimTypes } from "../db/schema/claims.ts";
import { approvalRequests, approvalTasks } from "../db/schema/workflows.ts";

/**
 * Review finding #8: an adjustment (reopened) run must carry the claim reimbursements the replaced
 * run already paid or reserved. Otherwise the revised net drops them, books a false
 * ADJUSTMENT_OVERPAID, and the reservation is stranded on the superseded run.
 */

let t: TestDb;
let p: PayrollHttp<"A">;
let employee: TestClient;
const api = "/api/v1/payroll";

type Slip = {
  result: {
    totals: { netCents: number; netPayableCents: number; reimbursementsCents: number };
    issues: { code: string }[];
  };
};

async function ownerApproves(claimId: string) {
  const [req] = await t.db.select().from(approvalRequests).where(eq(approvalRequests.subjectId, claimId));
  const [task] = await t.db
    .select()
    .from(approvalTasks)
    .where(and(eq(approvalTasks.requestId, req?.id as string), eq(approvalTasks.status, "pending")));
  await p.ok(p.owner.post(`/api/v1/approvals/tasks/${task?.id}/decision`, { decision: "approve" }));
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
      gender: "male",
    },
  ]);
  employee = await clientAs(p.app, p.co.h.deps, await seedMember(p.co.h.deps, p.co.h.orgId, { employeeId: p.co.e.A }));
  await p.ok(
    p.owner.put("/api/v1/approvals/policies/claim", {
      policies: [{ name: "Owner", condition: null, steps: [{ approverRule: "role:owner" }] }],
    }),
  );
}, 60_000);
afterAll(() => t.close());

describe("adjustment of a run that reimbursed claims", () => {
  it.each([["paid"], ["approved"]])("original %s: the adjustment carries the claim and pays it once", async (state) => {
    const type = await p.ok<{ id: string }>(
      p.owner.post("/api/v1/claims/types", {
        code: `T${state}`.toUpperCase(),
        name: "Transport",
        category: "transport",
        receiptRule: "never",
        taxable: true,
        capPeriod: "none",
      }),
      201,
    );
    const month = state === "paid" ? "2026-10" : "2026-11";
    const claim = (
      await p.ok<{ id: string }>(
        employee.post("/api/v1/claims", {
          lines: [
            {
              claimTypeId: type.id,
              expenseDate: "2026-10-02",
              merchant: "Grab",
              description: "Client visit",
              currency: "SGD",
              amountMinor: 20000,
            },
          ],
          submit: true,
        }),
        201,
      )
    ).id;
    await ownerApproves(claim);
    const runId = (
      await p.ok<{ id: string }>(p.admin.post(`${api}/runs`, { kind: "regular", month, payDate: `${month}-28` }), 201)
    ).id;
    await p.ok(p.admin.post(`${api}/runs/${runId}/compute`));
    await p.ok(p.admin.post(`${api}/runs/${runId}/submit`));
    await p.ok(decideRun(p.owner, runId, "approved"));
    if (state === "paid") await p.ok(p.admin.post(`${api}/runs/${runId}/mark-paid`));
    const orig = await p.ok<Slip>(p.admin.get(`${api}/runs/${runId}/employees/${p.co.e.A}`));
    expect(orig.result.totals.reimbursementsCents).toBe(20000);

    const adj = await p.ok<{ id?: string; run?: { id: string } }>(
      p.admin.post(`${api}/runs/${runId}/reopen`, { reason: "Nothing changed" }),
      201,
    );
    const adjId = (adj.id ?? adj.run?.id) as string;
    await p.ok(p.admin.post(`${api}/runs/${adjId}/compute`));
    const a = await p.ok<Slip>(p.admin.get(`${api}/runs/${adjId}/employees/${p.co.e.A}`));
    expect(a.result.totals.reimbursementsCents).toBe(20000);
    expect(a.result.totals.netCents).toBe(orig.result.totals.netCents);
    expect(a.result.totals.netPayableCents).toBe(0);
    expect(a.result.issues.map((i) => i.code)).not.toContain("ADJUSTMENT_OVERPAID");

    await p.ok(p.admin.post(`${api}/runs/${adjId}/compute`)); // recompute keeps it
    await p.ok(p.admin.post(`${api}/runs/${adjId}/submit`));
    await p.ok(decideRun(p.owner, adjId, "approved"));
    await p.ok(p.admin.post(`${api}/runs/${adjId}/mark-paid`));
    const [row] = await t.db.select().from(claims).where(eq(claims.id, claim));
    expect(row?.status).toBe("paid");
    // Paid by the original: unchanged. Reserved by the superseded original: paid by the adjustment.
    expect(row?.payrollRunId).toBe(state === "paid" ? runId : adjId);
    expect(row?.paidOn).toBe(`${month}-28`);

    // IR8A reports each effective reimbursement once, including the reserved original's carry.
    const ir8a = await p.ok<{ records: { allowances: number }[] }>(p.admin.get(`${api}/years/2026/ir8a`));
    expect(ir8a.records[0]?.allowances).toBe(state === "paid" ? 400 : 800); // each month's S$200 allowance + S$200 claim

    // Never payable again.
    const outside = await p.admin.post("/api/v1/claims/mark-paid", {
      claimIds: [claim],
      paidOn: `${month}-28`,
      reference: "FAST",
    });
    expect(outside.status).toBe(409);
  });
  it("reports taxable cash paid outside payroll by payment year and keeps tenant isolation", async () => {
    for (const [taxable, amountMinor] of [
      [true, 12345],
      [false, 9999],
    ] as const) {
      const type = await p.ok<{ id: string }>(
        p.owner.post("/api/v1/claims/types", {
          code: taxable ? "TAXOUT" : "EXEMPT",
          name: taxable ? "Private cash benefit" : "Business cost",
          category: "other",
          receiptRule: "never",
          capPeriod: "none",
          payoutMethod: "outside",
          taxable,
        }),
        201,
      );
      const claim = await p.ok<{ id: string }>(
        employee.post("/api/v1/claims", {
          submit: true,
          lines: [
            {
              claimTypeId: type.id,
              expenseDate: "2026-10-02",
              merchant: "Merchant",
              description: "Cash reimbursement",
              currency: "SGD",
              amountMinor,
            },
          ],
        }),
        201,
      );
      await ownerApproves(claim.id);
      await p.ok(
        p.admin.post("/api/v1/claims/mark-paid", { claimIds: [claim.id], paidOn: "2026-12-30", reference: "FAST" }),
      );
    }
    const preview = await p.ok<{ records: { allowances: number }[] }>(p.admin.get(`${api}/years/2026/ir8a`));
    expect(preview.records[0]?.allowances).toBe(923);
    const other = await seedOrg(p.co.h.deps);
    expect(await taxableCashClaims(t.db, other.id, 2026, [])).toEqual([]);
    // Changing the type later must not rewrite the classification snapshotted by payroll.
    await t.db.update(claimTypes).set({ taxable: false }).where(eq(claimTypes.code, "TPAID"));
    expect(
      (await p.ok<{ records: { allowances: number }[] }>(p.admin.get(`${api}/years/2026/ir8a`))).records[0]?.allowances,
    ).toBe(923);
  });
});
