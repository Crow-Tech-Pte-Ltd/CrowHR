import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "../../testing/index.ts";
import { decideRun, type PayrollHttp, payrollHttp } from "../../testing/payroll-http.ts";
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
    await p.ok(decideRun(p.owner, reg.id, "approved"));
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

  it("refuses a second final pay run for the same employee and month", async () => {
    const res = await p.admin.post(`${api}/runs`, {
      kind: "off_cycle",
      month: "2026-10",
      offCycleReason: "final_pay",
      employeeIds: [p.co.e.B],
    });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: { message: string } }).error.message).toMatch(
      /already has a final pay run for October 2026\. Reopen it/,
    );
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

  it("gives each run of the month its own CPF EZPay advice code, keeps it, and refuses past 99", async () => {
    const runs = (
      await p.ok<{ items: { id: string; kind: string; offCycleReason: string | null }[] }>(p.admin.get(`${api}/runs`))
    ).items;
    const regular = runs.find((r) => r.kind === "regular")?.id as string;
    const finalPay = runs.find((r) => r.offCycleReason === "final_pay")?.id as string;
    const bonus = runs.find((r) => r.offCycleReason === "bonus")?.id as string;
    await p.ok(p.admin.put(`${api}/settings`, { cpfAdviceCode: "98" }));
    const advice = async (id: string) => {
      const res = await p.admin.get(`${api}/runs/${id}/files/cpf-ezpay`);
      if (res.status !== 200) return `${res.status}`;
      return /OCT2026(\d\d)\.DTL/.exec(res.headers.get("content-disposition") ?? "")?.[1];
    };
    expect(await advice(regular)).toBe("98");
    expect(await advice(finalPay)).toBe("99");
    expect(await advice(regular)).toBe("98"); // stable on re-download
    expect(await advice(bonus)).toBe("409"); // no code left: refused, never a reused 99
    await p.ok(p.admin.put(`${api}/settings`, { cpfAdviceCode: "01" }));
  });

  it("reopening a bonus run corrects the bonus only: salary and allowances are not paid again", async () => {
    const runs = (
      await p.ok<{ items: { id: string; kind: string; offCycleReason: string | null }[] }>(p.admin.get(`${api}/runs`))
    ).items;
    const bonus = runs.find((r) => r.kind === "off_cycle" && r.offCycleReason === "bonus")?.id as string;
    const adj = await p.ok<{ id: string }>(
      p.admin.post(`${api}/runs/${bonus}/reopen`, { reason: "Bonus amount to be checked" }),
      201,
    );
    await p.ok(p.admin.post(`${api}/runs/${adj.id}/compute`));
    const o = await p.ok<Overview & { rows: { netPayableCents: number }[] }>(p.admin.get(`${api}/runs/${adj.id}`));
    const a = o.rows.find((r) => r.employeeId === p.co.e.A);
    // The same bonus again: nothing more to pay or charge.
    expect([a?.basicCents, a?.cpfEmployeeCents, a?.netCents, a?.netPayableCents]).toEqual([0, 20_000, 79_950, 0]);
    expect(o.run.totals.cpfTotalChargedCents).toBe(0);
    const slip = await p.ok<{ result: { lines: { category: string }[] } }>(
      p.admin.get(`${api}/runs/${adj.id}/employees/${p.co.e.A}`),
    );
    expect(slip.result.lines.map((l) => l.category)).not.toContain("basic");
    expect(slip.result.lines.map((l) => l.category)).not.toContain("allowance");
    // Once approved, November still compares itself with October's regular run, not the bonus.
    await p.ok(p.admin.post(`${api}/runs/${adj.id}/submit`));
    await p.ok(decideRun(p.owner, adj.id, "approved"));
    const nov = await p.ok<{ id: string }>(p.admin.post(`${api}/runs`, { kind: "regular", month: "2026-11" }), 201);
    await p.ok(p.admin.post(`${api}/runs/${nov.id}/compute`));
    const n = await p.ok<{ changes: { comparedWith: { runId: string } | null } }>(p.admin.get(`${api}/runs/${nov.id}`));
    expect(n.changes.comparedWith?.runId).toBe(runs.find((r) => r.kind === "regular")?.id);
  });

  it("refuses a final pay run for someone in the month's regular run waiting for approval", async () => {
    const nov = (
      await p.ok<{ items: { id: string; month: string; kind: string }[] }>(p.admin.get(`${api}/runs`))
    ).items.find((r) => r.month === "2026-11" && r.kind === "regular")?.id as string;
    await p.ok(p.admin.post(`${api}/runs/${nov}/submit`));
    const res = await p.admin.post(`${api}/runs`, {
      kind: "off_cycle",
      month: "2026-11",
      offCycleReason: "final_pay",
      employeeIds: [p.co.e.A],
    });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: { message: string } }).error.message).toMatch(/waiting for approval/);
  });
});
