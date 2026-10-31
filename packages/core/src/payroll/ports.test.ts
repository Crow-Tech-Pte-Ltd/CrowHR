import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "../../testing/index.ts";
import { type PayrollHttp, payrollHttp } from "../../testing/payroll-http.ts";
import type { AppDeps } from "../deps.ts";
import {
  createMemoryOvertime,
  createMemoryPayrollApprovals,
  createMemoryReimbursements,
} from "../testing/payroll-doubles.ts";

/** Task 3.3: the approvals, reimbursement and overtime ports drive payroll as the real modules will. */

let t: TestDb;
let p: PayrollHttp<"A">;
let depsRef: AppDeps;
const approvals = createMemoryPayrollApprovals(() => depsRef);
const claims = createMemoryReimbursements();
const overtime = createMemoryOvertime();
const api = "/api/v1/payroll";

beforeAll(async () => {
  t = await createTestDb();
  p = await payrollHttp(
    t,
    [
      {
        key: "A",
        name: "Daud bin Hassan",
        dob: "1985-08-08",
        residency: "citizen",
        hireDate: "2020-09-01",
        basicCents: 260_000,
      },
    ],
    { payroll: { approvals, reimbursements: claims, overtime } },
  );
  depsRef = p.co.h.deps;
  claims.claims.push({ claimId: "claim-1", employeeId: p.co.e.A, typeName: "Transport", amountCents: 4_550 });
  overtime.entries.push({
    sourceId: "ot-1",
    employeeId: p.co.e.A,
    minutes: 120,
    periodStart: "2026-10-01",
    periodEnd: "2026-10-31",
  });
}, 60_000);
afterAll(() => t.close());

describe("payroll ports", () => {
  let runId = "";

  it("feeds approved overtime and payable claims into the run and reserves the claims", async () => {
    runId = (
      await p.ok<{ id: string }>(
        p.admin.post(`${api}/runs`, { kind: "regular", month: "2026-10", payDate: "2026-10-30" }),
        201,
      )
    ).id;
    await p.ok(p.admin.post(`${api}/runs/${runId}/compute`));
    const d = await p.ok<{
      result: { lines: { category: string; amountCents: number; label: string }[]; totals: { netCents: number } };
    }>(p.admin.get(`${api}/runs/${runId}/employees/${p.co.e.A}`));
    // MOM example: S$2,600 non-workman, 2 h → S$40.80.
    expect(d.result.lines.find((l) => l.category === "overtime")).toMatchObject({
      amountCents: 4_080,
      label: "Overtime (approved in attendance)",
    });
    expect(d.result.lines.find((l) => l.category === "claim")).toMatchObject({
      amountCents: 4_550,
      label: "Claims reimbursement: Transport",
    });
    expect(claims.reserved.get("claim-1")).toBe(runId);
  });

  it("submits to the engine and the decision runs the adapter in one transaction", async () => {
    await p.ok(p.admin.post(`${api}/runs/${runId}/submit`));
    const req = approvals.requests[0];
    expect(req).toMatchObject({ subjectType: "payroll_run", subjectId: runId, attributes: { typeCode: "regular" } });
    expect(req?.attributes.amountCents).toBeGreaterThan(0);
    // With an engine wired, the local decision route refuses.
    expect((await p.owner.post(`${api}/runs/${runId}/decision`, { outcome: "approved" })).status).toBe(409);
    await approvals.decide(req?.approvalRequestId as string, {
      outcome: "rejected",
      decidedByUserId: "00000000-0000-7000-8000-000000000009",
      decidedByMembershipId: "00000000-0000-7000-8000-000000000009",
      comment: "Check the overtime",
      selfApproved: false,
    });
    let run = await p.ok<{ run: { status: string; decisionComment: string } }>(p.admin.get(`${api}/runs/${runId}`));
    expect(run.run).toMatchObject({ status: "draft", decisionComment: "Check the overtime" });
    await p.ok(p.admin.post(`${api}/runs/${runId}/compute`));
    await p.ok(p.admin.post(`${api}/runs/${runId}/submit`));
    await approvals.decide(approvals.requests[1]?.approvalRequestId as string, {
      outcome: "approved",
      decidedByUserId: "00000000-0000-7000-8000-000000000009",
      decidedByMembershipId: "00000000-0000-7000-8000-000000000009",
      comment: null,
      selfApproved: false,
    });
    run = await p.ok(p.admin.get(`${api}/runs/${runId}`));
    expect(run.run.status).toBe("approved");
  });

  it("marks reserved claims paid when the run is paid, and they are not payable again", async () => {
    await p.ok(p.admin.post(`${api}/runs/${runId}/mark-paid`));
    expect(claims.paid.get("claim-1")).toBe("2026-10-30");
    expect(await claims.listPayable("org", "2026-11-30")).toEqual([]);
  });
});
