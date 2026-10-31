import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "../../testing/index.ts";
import { type PayrollHttp, payrollHttp } from "../../testing/payroll-http.ts";
import { applyEvent, ctxFor } from "../employees/lifecycle.ts";
import { OWNER } from "../testing/people-harness.ts";

/** Task 3.2: run lifecycle rules not covered by the company-month test. */

let t: TestDb;
let p: PayrollHttp<"A">;
const api = "/api/v1/payroll";

beforeAll(async () => {
  t = await createTestDb();
  p = await payrollHttp(t, [
    {
      key: "A",
      name: "Aw Chee Keong",
      dob: "1990-04-12",
      residency: "citizen",
      hireDate: "2020-01-06",
      basicCents: 400_000,
    },
  ]);
}, 60_000);
afterAll(() => t.close());

describe("run lifecycle", () => {
  let runId = "";

  it("refuses to submit before computing, and when records changed after computing", async () => {
    runId = (
      await p.ok<{ id: string }>(
        p.admin.post(`${api}/runs`, { kind: "regular", month: "2026-10", payDate: "2026-11-12" }),
        201,
      )
    ).id;
    const early = await p.admin.post(`${api}/runs/${runId}/submit`);
    expect([early.status, (await early.json()).error.message]).toEqual([409, "Compute the run before submitting it."]);
    await p.ok(p.admin.post(`${api}/runs/${runId}/compute`));
    await applyEvent(ctxFor(p.co.h.deps, p.co.h.ports, p.co.h.actor(OWNER)), p.co.e.A, {
      type: "salary_change",
      effectiveDate: "2026-10-01",
      compensation: { payBasis: "monthly", amountCents: 420_000, reason: "Correction" },
    });
    const stale = await p.admin.post(`${api}/runs/${runId}/submit`);
    expect(stale.status).toBe(409);
    expect((await stale.json()).error.message).toContain("Recompute the run");
  });

  it("warns when the pay date is more than 7 days after the period", async () => {
    await p.ok(p.admin.post(`${api}/runs/${runId}/compute`));
    const o = await p.ok<{ issues: { code: string; severity: string; message: string; source: string }[] }>(
      p.admin.get(`${api}/runs/${runId}`),
    );
    const late = o.issues.find((i) => i.code === "EA_SALARY_PAID_LATE");
    expect(late).toMatchObject({
      severity: "warning",
      source: "https://www.mom.gov.sg/employment-practices/salary/paying-salary",
    });
    expect(late?.message).toContain("by 7 Nov 2026");
  });

  it("rejection needs a comment and returns the run to draft", async () => {
    await p.ok(p.admin.patch(`${api}/runs/${runId}`, { payDate: "2026-10-30" }));
    await p.ok(p.admin.post(`${api}/runs/${runId}/compute`));
    await p.ok(p.admin.post(`${api}/runs/${runId}/submit`));
    // In review: inputs are frozen.
    expect((await p.admin.post(`${api}/runs/${runId}/compute`)).status).toBe(409);
    expect((await p.owner.post(`${api}/runs/${runId}/decision`, { outcome: "rejected" })).status).toBe(400);
    const r = await p.ok<{ status: string; decisionComment: string }>(
      p.owner.post(`${api}/runs/${runId}/decision`, { outcome: "rejected", comment: "Pay date should be the 28th" }),
    );
    expect(r).toMatchObject({ status: "draft", decisionComment: "Pay date should be the 28th" });
  });

  it("an owner may approve their own run, marked self-approved; release before approval is refused", async () => {
    await p.ok(p.owner.post(`${api}/runs/${runId}/submit`));
    expect((await p.admin.post(`${api}/runs/${runId}/release`)).status).toBe(409);
    const r = await p.ok<{ status: string; selfApproved: boolean }>(
      p.owner.post(`${api}/runs/${runId}/decision`, { outcome: "approved" }),
    );
    expect(r).toMatchObject({ status: "approved", selfApproved: true });
    // Drafts can be deleted; approved runs cannot.
    expect((await p.admin.delete(`${api}/runs/${runId}`)).status).toBe(409);
  });
});
