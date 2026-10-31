import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "../../testing/index.ts";
import { type PayrollHttp, payrollHttp } from "../../testing/payroll-http.ts";
import { applyEvent, ctxFor } from "../employees/lifecycle.ts";
import { OWNER } from "../testing/people-harness.ts";

/** Task 3.5: off-cycle final pay and bonus runs. */

let t: TestDb;
let p: PayrollHttp<"A" | "B">;
const api = "/api/v1/payroll";

type Overview = {
  run: { totals: Record<string, number> };
  rows: { employeeId: string; basicCents: number; netCents: number; cpfEmployeeCents: number }[];
  issues: { code: string }[];
};

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
  // B is dismissed with last day 14 Oct 2026.
  await applyEvent(ctxFor(p.co.h.deps, p.co.h.ports, p.co.h.actor(OWNER)), p.co.e.B, {
    type: "termination",
    reason: "dismissal",
    lastWorkingDay: "2026-10-14",
  });
}, 60_000);
afterAll(() => t.close());

describe("off-cycle runs", () => {
  it("pays final pay separately and leaves the employee out of the regular run", async () => {
    expect(
      (await p.admin.post(`${api}/runs`, { kind: "off_cycle", month: "2026-10", offCycleReason: "final_pay" })).status,
    ).toBe(400);
    const finalId = await p.payRun({
      kind: "off_cycle",
      month: "2026-10",
      offCycleReason: "final_pay",
      employeeIds: [p.co.e.B],
      payDate: "2026-10-14",
    });
    const fin = await p.ok<Overview>(p.admin.get(`${api}/runs/${finalId}`));
    // 3,000 × 10/22 (1–14 Oct) = 1,363.64 (CPF test vector PM-01's wage).
    expect(fin.rows.map((r) => [r.employeeId, r.basicCents])).toEqual([[p.co.e.B, 136_364]]);
    expect(fin.rows[0]?.cpfEmployeeCents).toBe(27_200);
    const reg = await p.ok<{ id: string }>(
      p.admin.post(`${api}/runs`, { kind: "regular", month: "2026-10", payDate: "2026-10-30" }),
      201,
    );
    await p.ok(p.admin.post(`${api}/runs/${reg.id}/compute`));
    const o = await p.ok<Overview>(p.admin.get(`${api}/runs/${reg.id}`));
    expect(o.rows.map((r) => r.employeeId)).toEqual([p.co.e.A]);
    await p.ok(p.admin.post(`${api}/runs/${reg.id}/submit`));
    await p.ok(p.owner.post(`${api}/runs/${reg.id}/decision`, { outcome: "approved" }));
  });

  it("a bonus run in the same month recomputes the month's CPF and charges the difference", async () => {
    const id = await p.payRun(
      { kind: "off_cycle", month: "2026-10", offCycleReason: "bonus", employeeIds: [p.co.e.A], payDate: "2026-10-30" },
      [
        {
          employeeId: p.co.e.A,
          kind: "bonus",
          label: "Deepavali bonus",
          amountCents: 100_000,
          wageClass: "AW",
          awPayableDate: "2026-10-30",
        },
      ],
    );
    const o = await p.ok<Overview>(p.admin.get(`${api}/runs/${id}`));
    const a = o.rows[0];
    // A earns S$4,000 + S$200 transport. Month: 37% × 5,200 = 1,924 vs 1,554 charged → 370;
    // employee 1,040 − 840 = 200; CDAC S$2.00 for $5,200 vs S$1.50 deducted → S$0.50 more.
    expect([a?.basicCents, a?.cpfEmployeeCents, a?.netCents]).toEqual([0, 20_000, 79_950]);
    expect(o.run.totals.cpfTotalChargedCents).toBe(37_000);
    // SDL: A's month wages 5,200 → $11.25 (was $10.50); B $3.4091: $14.6591 → $14 − $13 already charged = $1.
    expect(o.run.totals.sdlChargedCents).toBe(100);
  });

  it("refuses a final pay run for someone the regular run already paid", async () => {
    const res = await p.admin.post(`${api}/runs`, {
      kind: "off_cycle",
      month: "2026-10",
      offCycleReason: "final_pay",
      employeeIds: [p.co.e.A],
    });
    expect(res.status).toBe(409);
  });
});
