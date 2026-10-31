import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "../../testing/index.ts";
import { decideRun, type PayrollHttp, payrollHttp } from "../../testing/payroll-http.ts";
import { payrollPayslips } from "../db/schema/payroll.ts";

/** Task 3.4: reopening a paid run creates an adjustment; original figures never change. */

let t: TestDb;
let p: PayrollHttp<"A" | "B">;
const api = "/api/v1/payroll";
let octId = "";

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
    {
      key: "B",
      name: "Bala Krishnan",
      dob: "1991-05-20",
      residency: "citizen",
      hireDate: "2020-03-02",
      basicCents: 300_000,
    },
  ]);
  octId = await p.payRun({ kind: "regular", month: "2026-10", payDate: "2026-10-30" }, [], { release: true });
}, 60_000);
afterAll(() => t.close());

type Overview = {
  run: {
    id: string;
    status: string;
    kind: string;
    supersededByRunId: string | null;
    adjustsRunId: string | null;
    totals: Record<string, number>;
    resultHash: string;
  };
  rows: { employeeId: string; netCents: number; netPayableCents: number; cpfEmployeeCents: number }[];
  changes: { headline: string; items: { text: string }[] };
};

describe("reopen → adjustment", () => {
  let adjId = "";
  let originalSlips: unknown[] = [];

  it("refuses without a reason, then creates an adjustment run with the original's items", async () => {
    originalSlips = await t.db
      .select()
      .from(payrollPayslips)
      .where(and(eq(payrollPayslips.runId, octId)));
    expect((await p.admin.post(`${api}/runs/${octId}/reopen`, { reason: " " })).status).toBe(400);
    const adj = await p.ok<{ id: string; kind: string; adjustsRunId: string; status: string; reopenReason: string }>(
      p.admin.post(`${api}/runs/${octId}/reopen`, { reason: "Missed S$200 meal allowance for Aw Chee Keong" }),
      201,
    );
    adjId = adj.id;
    expect(adj).toMatchObject({ kind: "adjustment", adjustsRunId: octId, status: "draft" });
    // Only one open adjustment at a time.
    expect((await p.admin.post(`${api}/runs/${octId}/reopen`, { reason: "again" })).status).toBe(409);
  });

  it("charges only the difference and shows the net still payable", async () => {
    await p.ok(
      p.admin.post(`${api}/runs/${adjId}/items`, {
        employeeId: p.co.e.A,
        kind: "other_earning",
        label: "Meal allowance (October)",
        amountCents: 20_000,
        wageClass: "OW",
      }),
      201,
    );
    await p.ok(p.admin.post(`${api}/runs/${adjId}/compute`));
    const o = await p.ok<Overview>(p.admin.get(`${api}/runs/${adjId}`));
    const a = o.rows.find((r) => r.employeeId === p.co.e.A);
    const b = o.rows.find((r) => r.employeeId === p.co.e.B);
    // A: S$4,000 basic + S$200 transport. Revised: 4,400 − 880 CPF − 1.50 CDAC = 3,518.50;
    // already paid 4,200 − 840 − 1.50 = 3,358.50 → pay S$160.00 now.
    expect([a?.netCents, a?.netPayableCents, a?.cpfEmployeeCents]).toEqual([351_850, 16_000, 88_000]);
    expect(b?.netPayableCents).toBe(0);
    // CPF charged by the adjustment: 37% × 4,400 − 37% × 4,200 = 1,628 − 1,554 = 74.
    expect(o.run.totals.cpfTotalChargedCents).toBe(7_400);
    // SDL: month 11.00 + 7.50 = $18.50 → $18, already charged $18 (10.50 + 7.50): nothing more.
    expect(o.run.totals.sdlChargedCents).toBe(0);
    expect(o.changes.headline).toBe("1 change since the original run");
    expect(o.changes.items[0]?.text).toContain("S$3,358.50 → S$3,518.50");
  });

  it("supersedes the original on approval without changing its figures", async () => {
    await p.ok(p.admin.post(`${api}/runs/${adjId}/submit`));
    await p.ok(decideRun(p.owner, adjId, "approved"));
    const orig = await p.ok<Overview>(p.admin.get(`${api}/runs/${octId}`));
    expect(orig.run.supersededByRunId).toBe(adjId);
    expect(orig.run.status).toBe("paid");
    const after = await t.db
      .select()
      .from(payrollPayslips)
      .where(and(eq(payrollPayslips.runId, octId)));
    expect(after).toEqual(originalSlips);
    // A superseded run cannot be reopened again; the adjustment can.
    expect((await p.admin.post(`${api}/runs/${octId}/reopen`, { reason: "x" })).status).toBe(409);
  });

  it("November starts from the adjustment's CPF state", async () => {
    const nov = await p.ok<{ id: string }>(p.admin.post(`${api}/runs`, { kind: "regular", month: "2026-11" }), 201);
    await p.ok(p.admin.post(`${api}/runs/${nov.id}/compute`));
    const d = await p.ok<{
      result: { working: { code: string; text: string }[]; stateAfter: { owSubjectCents: number } };
    }>(p.admin.get(`${api}/runs/${nov.id}/employees/${p.co.e.A}`));
    expect(d.result.working.find((w) => w.code === "CPF_YTD_SOURCE")?.text).toContain("adjustment run");
    expect(d.result.working.find((w) => w.code === "CPF_YTD_SOURCE")?.text).toContain(adjId.slice(-8));
    expect(d.result.stateAfter.owSubjectCents).toBe(440_000 + 420_000);
  });
});
