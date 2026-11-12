import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { clientAs, createTestDb, seedMember, type TestClient, type TestDb } from "../../testing/index.ts";
import { type PayrollHttp, payrollHttp } from "../../testing/payroll-http.ts";
import {
  allowanceTypes,
  compensationRecords,
  employmentRecords,
  recurringAllowances,
  tenures,
} from "../db/schema/employees.ts";
import { workScheduleVersions } from "../db/schema/organisation.ts";
import { payrollAllowanceSettings } from "../db/schema/payroll.ts";
import type { PayInput, PayResult } from "../payroll/engine/types.ts";

let t: TestDb;
let p: PayrollHttp<"fixed" | "variable" | "leaver">;
let annual: string;
let fixed: string;
let variable: string;
let hr: TestClient;
const leave = "/api/v1/leave";
const payroll = "/api/v1/payroll/runs";
type Request = { id: string; amountCents: number; rateText: string; rateDate: string };

beforeAll(async () => {
  t = await createTestDb();
  p = await payrollHttp(
    t,
    (["fixed", "variable", "leaver"] as const).map((key) => ({
      key,
      name: `Gross rate ${key}`,
      dob: "1990-01-01",
      residency: "citizen",
      hireDate: "2020-01-01",
      basicCents: 260_000,
    })),
  );
  hr = await clientAs(p.app, p.co.h.deps, await seedMember(p.co.h.deps, p.co.h.orgId, { roles: ["hr_admin"] }));
  const { items } = await p.ok<{ items: { id: string; code: string; policy: Record<string, unknown> }[] }>(
    p.owner.get(`${leave}/policies`),
  );
  const type = items.find((x) => x.code === "annual");
  if (!type) throw new Error("Missing annual leave");
  annual = type.id;
  await p.ok(p.owner.patch(`${leave}/policies/${annual}`, { policy: { ...type.policy, encashable: true } }));
  fixed = p.co.h.deps.ids.newId();
  variable = p.co.h.deps.ids.newId();
  await t.db.insert(allowanceTypes).values([
    { id: fixed, orgId: p.co.h.orgId, code: "FIXED", name: "Fixed contractual allowance" },
    { id: variable, orgId: p.co.h.orgId, code: "VARIABLE", name: "Variable productivity incentive" },
  ]);
  await t.db.insert(payrollAllowanceSettings).values([
    { orgId: p.co.h.orgId, allowanceTypeId: fixed, grossRateIncluded: true },
    { orgId: p.co.h.orgId, allowanceTypeId: variable, grossRateIncluded: false },
  ]);
  for (const key of ["fixed", "variable", "leaver"] as const) {
    await t.db.insert(recurringAllowances).values({
      id: p.co.h.deps.ids.newId(),
      orgId: p.co.h.orgId,
      employeeId: p.co.e[key],
      allowanceTypeId: variable,
      amountCents: 50_000,
      effectiveFrom: "2020-01-01",
    });
  }
  // End dates are exclusive: select the 31 Oct version, never expired or future versions.
  for (const [from, to, amount] of [
    ["2020-01-01", "2026-10-31", 13_000],
    ["2026-10-31", "2026-11-01", 26_000],
    ["2026-11-01", null, 52_000],
  ] as const) {
    for (const key of ["fixed", "leaver"] as const) {
      await t.db.insert(recurringAllowances).values({
        id: p.co.h.deps.ids.newId(),
        orgId: p.co.h.orgId,
        employeeId: p.co.e[key],
        allowanceTypeId: fixed,
        amountCents: amount,
        effectiveFrom: from,
        effectiveTo: to,
      });
    }
  }
  const [comp] = await t.db.select().from(compensationRecords).where(eq(compensationRecords.employeeId, p.co.e.fixed));
  if (!comp) throw new Error("Missing compensation");
  await t.db.update(compensationRecords).set({ effectiveTo: "2026-10-31" }).where(eq(compensationRecords.id, comp.id));
  await t.db.insert(compensationRecords).values([
    {
      ...comp,
      id: p.co.h.deps.ids.newId(),
      effectiveFrom: "2026-10-31",
      effectiveTo: "2026-11-01",
      amountCents: 240_001,
    },
    { ...comp, id: p.co.h.deps.ids.newId(), effectiveFrom: "2026-11-01", effectiveTo: null, amountCents: 520_000 },
  ]);
}, 60_000);
afterAll(() => t.close());

async function request(key: "fixed" | "variable" | "leaver", days = 2.5) {
  return p.ok<Request>(
    p.owner.post(`${leave}/encashments`, { employeeId: p.co.e[key], leaveTypeId: annual, days }),
    201,
  );
}

describe("leave encashment gross rate", () => {
  it("includes only in-force fixed allowances and preserves basic → gross → daily working in payroll", async () => {
    const r = await request("fixed");
    // (240001 + 26000) × 12 / (52 × 5) × 2.5 = 30692.423... cents.
    // Rounding the daily rate first would incorrectly produce 30693 cents.
    expect(r.amountCents).toBe(30_692);
    expect(r.rateText).toContain("Monthly basic S$2400.01");
    expect(r.rateText).toContain("Fixed contractual allowance S$260.00");
    expect(r.rateText).toContain("monthly gross S$2660.01");
    expect(r.rateText).toContain("Daily gross rate");
    expect(r.rateText).not.toContain("Variable productivity incentive");
    const { items } = await p.ok<{ items: { taskId: string }[] }>(hr.get("/api/v1/approvals/tasks"));
    expect(items).toHaveLength(1);
    await p.ok(hr.post(`/api/v1/approvals/tasks/${items[0]?.taskId}/decision`, { decision: "approve" }));
    const run = await p.ok<{ id: string }>(
      p.admin.post(payroll, { kind: "regular", month: "2026-11", payDate: "2026-11-28" }),
      201,
    );
    const compute = async () => {
      await p.ok(p.admin.post(`${payroll}/${run.id}/compute`));
      return p.ok<{ input: PayInput; result: PayResult }>(
        p.admin.get(`${payroll}/${run.id}/employees/${p.co.e.fixed}`),
      );
    };
    let d = await compute();
    expect(d.result.lines.find((l) => l.itemId === `encashment:${r.id}`)).toMatchObject({
      amountCents: 30_692,
      wageClass: "AW",
      cpfLiable: true,
    });
    expect(d.result.working.some((w) => w.text.includes(r.rateText))).toBe(true);
    // Changing allowance amounts/classification after approval must not reprice the payout.
    await t.db
      .update(recurringAllowances)
      .set({ amountCents: 99_999 })
      .where(and(eq(recurringAllowances.employeeId, p.co.e.fixed), eq(recurringAllowances.allowanceTypeId, fixed)));
    await t.db
      .update(payrollAllowanceSettings)
      .set({ grossRateIncluded: false })
      .where(eq(payrollAllowanceSettings.allowanceTypeId, fixed));
    d = await compute();
    expect(d.input.items.find((i) => i.id === `encashment:${r.id}`)).toMatchObject({
      amountCents: 30_692,
      rateExplanation: r.rateText,
    });
    await t.db
      .update(payrollAllowanceSettings)
      .set({ grossRateIncluded: true })
      .where(eq(payrollAllowanceSettings.allowanceTypeId, fixed));
  });

  it("excludes a variable allowance explicitly classified outside the gross rate", async () => {
    const r = await request("variable");
    expect(r.amountCents).toBe(30_000);
    expect(r.rateText).toContain("included allowances S$0.00");
    expect(r.rateText).toContain("monthly gross S$2600.00");
    await p.ok(p.owner.post(`${leave}/encashments/${r.id}/withdraw`), 204);
  });

  it("requires classification of active allowances, including a missing settings row", async () => {
    for (const missingRow of [false, true]) {
      if (missingRow)
        await t.db.delete(payrollAllowanceSettings).where(eq(payrollAllowanceSettings.allowanceTypeId, variable));
      else
        await t.db
          .update(payrollAllowanceSettings)
          .set({ grossRateIncluded: null })
          .where(eq(payrollAllowanceSettings.allowanceTypeId, variable));
      const res = await p.owner.post(`${leave}/encashments`, {
        employeeId: p.co.e.variable,
        leaveTypeId: annual,
        days: 1,
      });
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({
        error: {
          message: expect.stringMatching(/^Classify Variable productivity incentive .*Payroll → Allowance treatment/),
        },
      });
    }
    await t.db
      .insert(payrollAllowanceSettings)
      .values({ orgId: p.co.h.orgId, allowanceTypeId: variable, grossRateIncluded: false });
  });

  it("uses salary and allowances at cessation for a leaver", async () => {
    await t.db
      .update(tenures)
      .set({ lastWorkingDay: "2026-10-30", cessationReason: "resignation" })
      .where(eq(tenures.employeeId, p.co.e.leaver));
    const r = await request("leaver");
    expect(r.rateDate).toBe("2026-10-30");
    expect(r.amountCents).toBe(31_500); // (260000 + 13000) × 12 / 260 × 2.5
    expect(r.rateText).toContain("Fixed contractual allowance S$130.00");
    await p.ok(p.owner.post(`${leave}/encashments/${r.id}/withdraw`), 204);
  });

  it("includes monthly fixed allowances in hourly balances for both monthly and hourly paid staff", async () => {
    await t.db
      .update(employmentRecords)
      .set({ employmentType: "part_time" })
      .where(eq(employmentRecords.employeeId, p.co.e.variable));
    await t.db
      .update(workScheduleVersions)
      .set({ weeklyMinutes: 1200 })
      .where(eq(workScheduleVersions.scheduleId, p.co.structure.scheduleId));
    await t.db.insert(recurringAllowances).values({
      id: p.co.h.deps.ids.newId(),
      orgId: p.co.h.orgId,
      employeeId: p.co.e.variable,
      allowanceTypeId: fixed,
      amountCents: 26_000,
      effectiveFrom: "2020-01-01",
    });
    let r = await request("variable", 2.5);
    expect(r.amountCents).toBe(8_250); // (260000 + 26000) × 12 / (52 × 20) × 2.5 hours
    expect(r.rateText).toContain("Hourly gross rate");
    await p.ok(p.owner.post(`${leave}/encashments/${r.id}/withdraw`), 204);
    await t.db
      .update(compensationRecords)
      .set({ payBasis: "hourly", amountCents: 1000 })
      .where(eq(compensationRecords.employeeId, p.co.e.variable));
    r = await request("variable", 2.5);
    expect(r.amountCents).toBe(3_250); // (1000 + 26000 × 12 / (52 × 20)) × 2.5 hours
    expect(r.rateText).toContain("Hourly gross rate");
    await p.ok(p.owner.post(`${leave}/encashments/${r.id}/withdraw`), 204);
    await t.db
      .update(employmentRecords)
      .set({ employmentType: "full_time" })
      .where(eq(employmentRecords.employeeId, p.co.e.variable));
    r = await request("variable", 2.5);
    expect(r.amountCents).toBe(13_000); // hourly gross 1300 × 4 hours/day × 2.5 days
    expect(r.rateText).toContain("Daily gross rate");
  });
});
