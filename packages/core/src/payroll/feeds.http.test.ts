import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, seedMember, seedOrg, type TestDb } from "../../testing/index.ts";
import { decideRun, type PayrollHttp, payrollHttp } from "../../testing/payroll-http.ts";
import { overtimeClaims } from "../db/schema/attendance.ts";
import { compensationRecords } from "../db/schema/employees.ts";
import { payrollPayslips } from "../db/schema/payroll.ts";
import { reserveFeeds, unavailableFeeds } from "./feed-reservations.ts";
import { loadRun } from "./service.ts";

let t: TestDb;
let p: PayrollHttp<"A">;
const api = "/api/v1/payroll";
beforeAll(async () => {
  t = await createTestDb();
  p = await payrollHttp(t, [
    {
      key: "A",
      name: "Ravi Kumar",
      dob: "1990-01-01",
      residency: "citizen",
      hireDate: "2020-01-01",
      basicCents: 260_000,
    },
  ]);
});
afterAll(() => t.close());
async function run(month: string) {
  return (
    await p.ok<{ id: string }>(p.admin.post(`${api}/runs`, { kind: "regular", month, payDate: `${month}-28` }), 201)
  ).id;
}
async function approve(id: string) {
  await p.ok(p.admin.post(`${api}/runs/${id}/submit`));
  await p.ok(decideRun(p.owner, id, "approved"));
}
async function slip(id: string) {
  return p.ok<{
    input: { items: { id: string }[] };
    result: { totals: { overtimeCents: number; additionalCents: number }; issues: { code: string }[] };
  }>(p.admin.get(`${api}/runs/${id}/employees/${p.co.e.A}`));
}
// One live sign-in per employee record: create employee A's membership once and reuse it.
let memberA: Promise<{ membershipId: string }> | null = null;
async function overtime(workDate: string) {
  const id = p.co.h.deps.ids.newId();
  memberA ??= seedMember(p.co.h.deps, p.co.h.orgId, { employeeId: p.co.e.A });
  const member = await memberA;
  await t.db.insert(overtimeClaims).values({
    id,
    orgId: p.co.h.orgId,
    employeeId: p.co.e.A,
    workDate,
    computedMinutes: 120,
    claimedMinutes: 120,
    approvedMinutes: 120,
    statutory: true,
    status: "approved",
    createdByMembershipId: member.membershipId,
  });
  return id;
}
describe("payroll source feeds", () => {
  it("rolls late overtime into the next run once, preserves it on recompute and adjustment", async () => {
    const oct = await run("2026-10");
    await p.ok(p.admin.post(`${api}/runs/${oct}/compute`));
    await approve(oct);
    const sourceId = await overtime("2026-10-15");
    const nov = await run("2026-11");
    await p.ok(p.admin.post(`${api}/runs/${nov}/compute`));
    expect((await slip(nov)).input.items.map((i) => i.id)).toContain(`attendance:${sourceId}`);
    expect((await slip(nov)).result.totals.overtimeCents).toBe(4080);
    await p.ok(p.admin.post(`${api}/runs/${nov}/compute`));
    await approve(nov);
    const adjustment = await p.ok<{ id: string }>(
      p.admin.post(`${api}/runs/${nov}/reopen`, { reason: "Check carry" }),
      201,
    );
    await p.ok(p.admin.post(`${api}/runs/${adjustment.id}/compute`));
    expect((await slip(adjustment.id)).result.totals.overtimeCents).toBe(4080);
    const dec = await run("2026-12");
    await p.ok(p.admin.post(`${api}/runs/${dec}/compute`));
    expect((await slip(dec)).result.totals.overtimeCents).toBe(0);
  });
  it("allows an explicit contractual amount on fed overtime for non-Part IV and hourly staff", async () => {
    await t.db
      .update(compensationRecords)
      .set({ amountCents: 500_000 })
      .where(eq(compensationRecords.employeeId, p.co.e.A));
    const sourceId = await overtime("2027-01-05");
    const jan = await run("2027-01");
    await p.ok(
      p.admin.post(`${api}/runs/${jan}/items`, {
        employeeId: p.co.e.A,
        kind: "overtime",
        label: "Contractual OT",
        minutes: 120,
        amountCents: 7500,
        overtimeSourceId: sourceId,
      }),
      201,
    );
    await p.ok(p.admin.post(`${api}/runs/${jan}/compute`));
    expect((await slip(jan)).result.totals.overtimeCents).toBe(7500);
    expect((await slip(jan)).result.issues.map((i) => i.code)).not.toContain("OT_NOT_STATUTORY");
    await t.db
      .update(compensationRecords)
      .set({ payBasis: "hourly", amountCents: 2000 })
      .where(eq(compensationRecords.employeeId, p.co.e.A));
    await p.ok(p.admin.post(`${api}/runs/${jan}/compute`));
    expect((await slip(jan)).result.totals.overtimeCents).toBe(7500);
    expect((await slip(jan)).result.issues.map((i) => i.code)).not.toContain("OT_AMOUNT_REQUIRED");
  });
  it("pays an off-day public holiday at the daily gross rate, with an explicit allowance classification", async () => {
    await t.db
      .update(compensationRecords)
      .set({ payBasis: "monthly", amountCents: 260_000 })
      .where(eq(compensationRecords.employeeId, p.co.e.A));
    const mar = await run("2026-03");
    await p.ok(
      p.admin.put(`${api}/allowance-settings/${p.co.allowances.transport}`, {
        cpfLiable: true,
        prorate: true,
        grossRateIncluded: false,
      }),
    );
    await p.ok(p.admin.post(`${api}/runs/${mar}/compute`));
    expect((await slip(mar)).result.totals.additionalCents).toBe(12000);
  });
  it("does not read or create another organisation's earning reservations", async () => {
    const sourceId = await overtime("2027-05-13");
    const id = await run("2027-06");
    await p.ok(p.admin.post(`${api}/runs/${id}/compute`));
    const current = await loadRun(t.db, p.co.h.orgId, id);
    expect(await unavailableFeeds(t.db, { ...current, id: p.co.h.deps.ids.newId() }, [])).toContain(
      `attendance:${sourceId}`,
    );
    const other = await seedOrg(p.co.h.deps);
    const foreign = { ...current, orgId: other.id };
    expect(await unavailableFeeds(t.db, foreign, [])).toEqual(new Set());
    const [snapshot] = await t.db.select().from(payrollPayslips).where(eq(payrollPayslips.runId, id));
    if (!snapshot) throw new Error("Missing payslip");
    await expect(t.db.transaction((tx) => reserveFeeds(tx, foreign, [snapshot.input], []))).rejects.toThrow();
  });

  it("two concurrent runs cannot reserve the same late overtime", async () => {
    await overtime("2027-06-15");
    const ids = [await run("2027-07"), await run("2027-08")];
    const db = p.co.h.deps.db as unknown as { transaction: (...args: unknown[]) => Promise<unknown> };
    const original = db.transaction;
    let arrived = 0;
    let resume: () => void = () => {};
    const gate = new Promise<void>((r) => {
      resume = r;
    });
    const timer = setTimeout(() => resume(), 5000);
    db.transaction = async (...args: unknown[]) => {
      if (++arrived === 2) {
        db.transaction = original;
        resume();
      }
      await gate;
      return original.apply(db, args);
    };
    try {
      const responses = await Promise.all(ids.map((id) => p.admin.post(`${api}/runs/${id}/compute`)));
      expect(responses.map((r) => r.status).sort()).toEqual([200, 409]);
    } finally {
      db.transaction = original;
      resume();
      clearTimeout(timer);
    }
  });
});
