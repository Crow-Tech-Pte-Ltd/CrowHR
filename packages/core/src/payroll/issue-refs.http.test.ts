import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, seedMember, type TestDb } from "../../testing/index.ts";
import { type PayrollHttp, payrollHttp } from "../../testing/payroll-http.ts";
import { overtimeClaims } from "../db/schema/attendance.ts";
import { compensationRecords } from "../db/schema/employees.ts";

/**
 * A blocking issue must say what to do and carry what it is about (`ref`), so the web app can open
 * the place that fixes it: the allowance to classify, the holiday to pay, the item to correct.
 */

type Issue = {
  code: string;
  severity: string;
  message: string;
  ref?: { itemId?: string; holidayDate?: string; holidayName?: string; allowanceCodes?: string[] };
};

let t: TestDb;
let p: PayrollHttp<"A" | "B">;
const api = "/api/v1/payroll";

beforeAll(async () => {
  t = await createTestDb();
  // A has a S$200 transport allowance (as created through the API, with no treatment set); B has none.
  p = await payrollHttp(t, [
    {
      key: "A",
      name: "Ravi Kumar",
      dob: "1990-01-01",
      residency: "citizen",
      hireDate: "2020-01-01",
      basicCents: 260_000,
    },
    {
      key: "B",
      name: "Siti Rahman",
      dob: "1992-05-05",
      residency: "citizen",
      hireDate: "2020-01-01",
      basicCents: 260_000,
    },
  ]);
});
afterAll(() => t.close());

async function computed(month: string) {
  const { id } = await p.ok<{ id: string }>(
    p.admin.post(`${api}/runs`, { kind: "regular", month, payDate: `${month}-28` }),
    201,
  );
  await p.ok(p.admin.post(`${api}/runs/${id}/compute`));
  return id;
}
async function overview(id: string) {
  return p.ok<{ issues: (Issue & { employeeId: string | null })[] }>(p.admin.get(`${api}/runs/${id}`));
}
async function employee(id: string, key: "A" | "B") {
  return p.ok<{ result: { issues: Issue[]; totals: { additionalCents: number; overtimeCents: number } } }>(
    p.admin.get(`${api}/runs/${id}/employees/${p.co.e[key]}`),
  );
}

describe("a fresh organisation's allowance treatment", () => {
  it("starts CPF-liable and pro-rated, with no answer for the gross rate of pay", async () => {
    const { items } = await p.ok<{
      items: { code: string; cpfLiable: boolean; prorate: boolean; grossRateIncluded: boolean | null }[];
    }>(p.admin.get(`${api}/allowance-settings`));
    expect(items).toEqual([
      expect.objectContaining({ code: "TRANSPORT", cpfLiable: true, prorate: true, grossRateIncluded: null }),
    ]);
  });

  it("is asked for on the first run, before a holiday on an off day needs it", async () => {
    // October 2026 has no public holiday on a Saturday: nothing blocks, but the run asks.
    const oct = await computed("2026-10");
    const { issues } = await overview(oct);
    expect(issues.filter((i) => i.severity === "blocking")).toEqual([]);
    const ask = issues.find((i) => i.code === "ALLOWANCE_GROSS_RATE_UNSET");
    expect(ask).toMatchObject({ severity: "warning", employeeId: null, ref: { allowanceCodes: ["TRANSPORT"] } });
    expect(ask?.message).toContain("Transport allowance");
    expect(ask?.message).toContain("Payroll → Allowance treatment");
  });

  it("blocks a holiday on an off day with the holiday and the allowance to classify, then pays it once classified", async () => {
    // Hari Raya Puasa, Saturday 21 Mar 2026: an off day on the Mon–Fri schedule.
    const mar = await computed("2026-03");
    const a = (await employee(mar, "A")).result.issues.find((i) => i.code === "PH_GROSS_RATE_REQUIRED");
    expect(a).toMatchObject({
      severity: "blocking",
      ref: { holidayDate: "2026-03-21", holidayName: "Hari Raya Puasa", allowanceCodes: ["TRANSPORT"] },
    });
    expect(a?.message).toContain("21 Mar 2026");
    expect(a?.message).toContain("Transport allowance");
    // B has no allowance: paid automatically, one day at the gross rate (S$2,600 × 12 / 260 = S$120).
    const b = (await employee(mar, "B")).result;
    expect(b.issues.map((i) => i.code)).not.toContain("PH_GROSS_RATE_REQUIRED");
    expect(b.totals.additionalCents).toBe(12_000);

    await p.ok(
      p.admin.put(`${api}/allowance-settings/${p.co.allowances.transport}`, {
        cpfLiable: true,
        prorate: true,
        grossRateIncluded: false,
      }),
    );
    await p.ok(p.admin.post(`${api}/runs/${mar}/compute`));
    const after = await overview(mar);
    expect(after.issues.map((i) => i.code)).not.toContain("PH_GROSS_RATE_REQUIRED");
    expect(after.issues.map((i) => i.code)).not.toContain("ALLOWANCE_GROSS_RATE_UNSET");
    expect((await employee(mar, "A")).result.totals.additionalCents).toBe(12_000);
  });
});

describe("issues that need an amount on the run", () => {
  it("an hourly employee's off-day holiday names the date; holiday pay entered on the run clears it", async () => {
    await t.db
      .update(compensationRecords)
      .set({ payBasis: "hourly", amountCents: 1_500 })
      .where(eq(compensationRecords.employeeId, p.co.e.B));
    // Labour Day, Saturday 1 May 2027.
    const may = await computed("2027-05");
    const ph = (await employee(may, "B")).result.issues.find((i) => i.code === "PH_GROSS_RATE_REQUIRED");
    expect(ph).toMatchObject({ severity: "blocking", ref: { holidayDate: "2027-05-01", holidayName: "Labour Day" } });
    expect(ph?.ref?.allowanceCodes).toBeUndefined();
    expect(ph?.message).toContain("run items");

    for (const body of [
      { kind: "hours", label: "Hours worked", minutes: 160 * 60 },
      {
        kind: "other_earning",
        label: "Public holiday: Labour Day (off day)",
        amountCents: 12_000,
        holidayDate: "2027-05-01",
      },
    ])
      await p.ok(p.admin.post(`${api}/runs/${may}/items`, { employeeId: p.co.e.B, ...body }), 201);
    await p.ok(p.admin.post(`${api}/runs/${may}/compute`));
    const after = (await employee(may, "B")).result;
    expect(after.issues.filter((i) => i.severity === "blocking")).toEqual([]);
    expect(after.totals.additionalCents).toBe(12_000);
  });

  it("fed overtime without a statutory rate points at its overtime claim; an amount for that claim clears it", async () => {
    // Above the Part 4 salary limit: no statutory overtime rate.
    await t.db
      .update(compensationRecords)
      .set({ amountCents: 500_000 })
      .where(eq(compensationRecords.employeeId, p.co.e.A));
    const member = await seedMember(p.co.h.deps, p.co.h.orgId, { employeeId: p.co.e.A });
    const sourceId = p.co.h.deps.ids.newId();
    await t.db.insert(overtimeClaims).values({
      id: sourceId,
      orgId: p.co.h.orgId,
      employeeId: p.co.e.A,
      workDate: "2027-01-12",
      computedMinutes: 90,
      claimedMinutes: 90,
      approvedMinutes: 90,
      statutory: false,
      status: "approved",
      createdByMembershipId: member.membershipId,
    });
    const jan = await computed("2027-01");
    const ot = (await employee(jan, "A")).result.issues.find((i) => i.code === "OT_NOT_STATUTORY");
    expect(ot).toMatchObject({ severity: "blocking", ref: { itemId: `attendance:${sourceId}` } });

    await p.ok(
      p.admin.post(`${api}/runs/${jan}/items`, {
        employeeId: p.co.e.A,
        kind: "overtime",
        label: "Overtime (contract rate)",
        minutes: 90,
        amountCents: 6_000,
        overtimeSourceId: sourceId,
      }),
      201,
    );
    await p.ok(p.admin.post(`${api}/runs/${jan}/compute`));
    const after = (await employee(jan, "A")).result;
    expect(after.issues.map((i) => i.code)).not.toContain("OT_NOT_STATUTORY");
    expect(after.totals.overtimeCents).toBe(6_000);
  });

  it("an issue about a manual item carries that item's ID", async () => {
    const feb = await computed("2027-02");
    const { id } = await p.ok<{ id: string }>(
      p.admin.post(`${api}/runs/${feb}/items`, {
        employeeId: p.co.e.A,
        kind: "bonus",
        label: "Year-end bonus",
        amountCents: 100_000,
        wageClass: "AW",
        awPayableDate: "2027-03-15",
      }),
      201,
    );
    await p.ok(p.admin.post(`${api}/runs/${feb}/compute`));
    const aw = (await employee(feb, "A")).result.issues.find((i) => i.code === "AW_PAYABLE_OUTSIDE_PERIOD");
    expect(aw).toMatchObject({ severity: "blocking", ref: { itemId: id } });
    // The run overview carries the same reference.
    expect((await overview(feb)).issues.find((i) => i.code === "AW_PAYABLE_OUTSIDE_PERIOD")?.ref).toEqual({
      itemId: id,
    });
  });
});
