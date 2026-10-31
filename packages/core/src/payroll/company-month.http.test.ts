import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  clientAs,
  createTestDb,
  createTestDeps,
  seedMember,
  type TestClient,
  type TestDb,
} from "../../testing/index.ts";
import { createApp } from "../app.ts";
import { auditEvents } from "../db/schema/audit.ts";
import { payrollPayslips } from "../db/schema/payroll.ts";
import { type CompanyKey, createPayrollCompany, type PayrollCompany } from "../testing/payroll-harness.ts";
import { canonicalHash } from "./engine/canonical.ts";
import { computeEmployeePay } from "./engine/compute.ts";

/**
 * Task 3.6: October 2026 for the fictional 12-person company. Every expected figure below was worked
 * by hand from the cited rules (2026 CPF Table 1–3, SHG tables, SDL 0.25% min $2 max $11.25, MOM
 * incomplete-month formula, MOM OT formula), not copied from the engine's output.
 */

let t: TestDb;
let co: PayrollCompany;
let admin: TestClient;
let owner: TestClient;
const api = "/api/v1/payroll";
let runId = "";

type Row = {
  employeeId: string;
  grossCents: number;
  cpfEmployeeCents: number;
  cpfEmployerCents: number;
  shgCents: number;
  netCents: number;
  otherDeductionsCents: number;
  overtimeCents: number;
  nplCents: number;
  additionalCents: number;
};

beforeAll(async () => {
  t = await createTestDb();
  co = await createPayrollCompany(createTestDeps(t.db));
  const app = createApp(co.h.deps);
  admin = await clientAs(app, co.h.deps, await seedMember(co.h.deps, co.h.orgId, { roles: ["payroll_admin"] }));
  owner = await clientAs(app, co.h.deps, await seedMember(co.h.deps, co.h.orgId, { roles: ["owner"] }));
}, 60_000);
afterAll(() => t.close());

async function json<T = Record<string, unknown>>(res: Response, status: number): Promise<T> {
  const body = await res.json();
  if (res.status !== status) throw new Error(`expected ${status}, got ${res.status}: ${JSON.stringify(body)}`);
  return body as T;
}

async function overview() {
  return json<{
    run: { status: string; totals: Record<string, number>; inputHash: string; resultHash: string };
    rows: Row[];
    issues: { code: string; severity: string; employeeId: string | null; message: string }[];
  }>(await admin.get(`${api}/runs/${runId}`), 200);
}

const rowOf = (rows: Row[], key: CompanyKey) => rows.find((r) => r.employeeId === co.e[key]) as Row;

describe("October 2026 payroll for a 12-person company", () => {
  let deductionId = "";

  it("creates the run and enters the month's items", async () => {
    const run = await json<{ id: string }>(
      await admin.post(`${api}/runs`, { kind: "regular", month: "2026-10", payDate: "2026-10-30" }),
      201,
    );
    runId = run.id;
    const add = async (body: Record<string, unknown>) =>
      (await json<{ id: string }>(await admin.post(`${api}/runs/${runId}/items`, body), 201)).id;
    await add({ employeeId: co.e.D, kind: "overtime", label: "Overtime", minutes: 120 });
    await add({
      employeeId: co.e.K,
      kind: "bonus",
      label: "Performance bonus",
      amountCents: 2_000_000,
      wageClass: "AW",
      awPayableDate: "2026-10-30",
    });
    await add({ employeeId: co.e.L, kind: "unpaid_leave", label: "No-pay leave", days: 3 });
    deductionId = await add({
      employeeId: co.e.L,
      kind: "deduction",
      label: "Damaged espresso grinder",
      amountCents: 60_000,
      deductionCategory: "damage_loss",
    });
    // A second regular run for the same month is refused.
    expect((await admin.post(`${api}/runs`, { kind: "regular", month: "2026-10" })).status).toBe(409);
  });

  it("blocks on the 25% damage-or-loss limit, and submission is refused", async () => {
    await json(await admin.post(`${api}/runs/${runId}/compute`), 200);
    const o = await overview();
    const blocking = o.issues.filter((i) => i.severity === "blocking");
    // Also over the 50% overall limit: 600 + 345 CPF + 0.50 CDAC = S$945.50 > 50% × 1,727.27 = S$863.63.
    expect(blocking.map((i) => [i.code, i.employeeId])).toEqual([
      ["EA_DEDUCTION_CATEGORY_CAP", co.e.L],
      ["EA_DEDUCTION_OVERALL_CAP", co.e.L],
    ]);
    expect(blocking[1]?.message).toContain("S$863.63");
    // 25% × S$1,727.27 = S$431.81; S$600.00 is S$168.19 over.
    expect(blocking[0]?.message).toContain("S$431.81");
    expect(blocking[0]?.message).toContain("S$168.19");
    const submit = await admin.post(`${api}/runs/${runId}/submit`);
    expect(submit.status).toBe(409);
    expect((await submit.json()).error.message).toContain("2 blocking issues");
  });

  it("computes every employee to the cent once the deduction is reduced", async () => {
    const put = await admin.put(`${api}/runs/${runId}/items/${deductionId}`, {
      employeeId: co.e.L,
      kind: "deduction",
      label: "Damaged espresso grinder",
      amountCents: 40_000,
      deductionCategory: "damage_loss",
    });
    expect(put.status).toBe(204);
    await json(await admin.post(`${api}/runs/${runId}/compute`), 200);
    const o = await overview();
    expect(o.issues.filter((i) => i.severity === "blocking")).toEqual([]);
    expect(o.rows).toHaveLength(12);
    const expected: Record<CompanyKey, [gross: number, cpfEe: number, cpfEr: number, shg: number, net: number]> = {
      // SC ≤55, S$4,000 + S$200 transport: 37% × 4,200 = 1,554; ee 20% = 840; CDAC S$1.50.
      A: [420_000, 84_000, 71_400, 150, 335_850],
      // SC 55–60, 34% / 18% of 3,500 = 1,190 / 630; CDAC S$1.00.
      B: [350_000, 63_000, 56_000, 100, 286_900],
      // SC 60–65, 25% / 12.5% of 3,000 = 750 / 375; CDAC S$1.00.
      C: [300_000, 37_500, 37_500, 100, 262_400],
      // SC 65–70, S$2,400 + 2 h OT (12 × 2,400 / 2,288 × 1.5 × 2 = 37.7622 → 37.76):
      // 16.5% × 2,437.76 = 402.2304 → 402; ee 7.5% = 182.832 → 182; CDAC S$1.00.
      D: [243_776, 18_200, 22_000, 100, 225_476],
      // SC above 70, 12.5% / 5% of 1,800 = 225 / 90; CDAC S$0.50.
      E: [180_000, 9_000, 13_500, 50, 170_950],
      // SPR year 1 G/G (Table 2), 9% / 5% of 5,000 = 450 / 250; CDAC S$1.50.
      F: [500_000, 25_000, 20_000, 150, 474_850],
      // SPR year 2 G/G (Table 3), 24% / 15% of 4,500 = 1,080 / 675; CDAC S$1.50.
      G: [450_000, 67_500, 40_500, 150, 382_350],
      // Foreigner on EP: no CPF; Indian descent EP holder → SINDA S$12.00.
      H: [900_000, 0, 0, 1_200, 898_800],
      // Joined 16 Oct: 3,600 × 11/22 = 1,800; 37% = 666; ee 360; CDAC S$0.50.
      I: [180_000, 36_000, 30_600, 50, 143_950],
      // Leaves 15 Oct: 4,400 × 11/22 = 2,200; 37% = 814; ee 440; CDAC S$1.00.
      J: [220_000, 44_000, 37_400, 100, 175_900],
      // S$8,000 + S$20,000 bonus. AW ceiling = 102,000 − (72,000 + 8,000 + 2 × 8,000) = 6,000.
      // 37% × (8,000 + 6,000) = 5,180; ee 2,800; CDAC S$3.00 on 28,000.
      K: [2_800_000, 280_000, 238_000, 300, 2_519_700],
      // S$2,000, 3 days no-pay leave: 2,000 × 19/22 = 1,727.27; 37% = 639.0899 → 639; ee 345.454 → 345;
      // CDAC S$0.50; S$400 deduction.
      L: [172_727, 34_500, 29_400, 50, 98_177],
    };
    for (const [key, [gross, ee, er, shg, net]] of Object.entries(expected) as [CompanyKey, number[]][]) {
      const r = rowOf(o.rows, key);
      expect([key, r.grossCents, r.cpfEmployeeCents, r.cpfEmployerCents, r.shgCents, r.netCents]).toEqual([
        key,
        gross,
        ee,
        er,
        shg,
        net,
      ]);
    }
    expect(rowOf(o.rows, "D").overtimeCents).toBe(3_776);
    expect(rowOf(o.rows, "L").nplCents).toBe(27_273);
    expect(rowOf(o.rows, "L").otherDeductionsCents).toBe(40_000);
    // SDL: sum of per-employee 0.25% (min $2, max $11.25) = $96.662575 → $96 for the month.
    expect(o.run.totals.sdlChargedCents).toBe(9_600);
    expect(o.run.totals.headcount).toBe(12);
    const sum = (k: keyof Row) => o.rows.reduce((s, r) => s + (r[k] as number), 0);
    expect(o.run.totals.netCents).toBe(sum("netCents"));
    expect(o.run.totals.cpfTotalChargedCents).toBe(sum("cpfEmployeeCents") + sum("cpfEmployerCents"));
  });

  it("warns where earlier 2026 months are unknown to Crow HR (no opening balance)", async () => {
    const codes = async (key: CompanyKey) =>
      (
        await json<{ result: { issues: { code: string }[] } }>(
          await admin.get(`${api}/runs/${runId}/employees/${co.e[key]}`),
          200,
        )
      ).result.issues.map((i) => i.code);
    expect(await codes("A")).toContain("YTD_BEFORE_CROWHR_MISSING");
    expect(await codes("K")).not.toContain("YTD_BEFORE_CROWHR_MISSING"); // opening balance through September
    expect(await codes("I")).not.toContain("YTD_BEFORE_CROWHR_MISSING"); // joined in October
    // The overview lists the same warning for many people once.
    const o = await overview();
    const grouped = o.issues.filter((i) => i.code === "YTD_BEFORE_CROWHR_MISSING");
    expect(grouped).toHaveLength(1);
    expect(grouped[0]?.employeeId).toBeNull();
  });

  it("shows the AW ceiling working for the bonus", async () => {
    const d = await json<{
      result: {
        cpf: {
          awSubjectCents: number;
          awNotSubjectCents: number;
          awCeiling: { basis: string; annualAwCeilingCents: number };
        };
        working: { text: string }[];
        rules: { source: string; effectiveFrom: string }[];
      };
    }>(await admin.get(`${api}/runs/${runId}/employees/${co.e.K}`), 200);
    expect(d.result.cpf.awCeiling).toMatchObject({ basis: "ESTIMATE", annualAwCeilingCents: 600_000 });
    expect([d.result.cpf.awSubjectCents, d.result.cpf.awNotSubjectCents]).toEqual([600_000, 1_400_000]);
    expect(d.result.working.map((w) => w.text).join("\n")).toContain(
      "opening balance from the previous payroll system",
    );
    expect(
      d.result.rules.every((r) => r.source.startsWith("https://") && /^\d{4}-\d{2}-\d{2}$/.test(r.effectiveFrom)),
    ).toBe(true);
  });

  it("is deterministic: recomputing gives the same hashes, and every stored snapshot reproduces its result byte for byte", async () => {
    const before = (await overview()).run;
    await json(await admin.post(`${api}/runs/${runId}/compute`), 200);
    const after = (await overview()).run;
    expect([after.inputHash, after.resultHash]).toEqual([before.inputHash, before.resultHash]);
    const slips = await t.db
      .select()
      .from(payrollPayslips)
      .where(and(eq(payrollPayslips.orgId, co.h.orgId), eq(payrollPayslips.runId, runId)));
    expect(slips).toHaveLength(12);
    for (const s of slips) {
      expect(await canonicalHash(s.input)).toBe(s.inputHash);
      expect(await canonicalHash(computeEmployeePay(structuredClone(s.input)))).toBe(s.resultHash);
    }
  });

  it("submits, is approved by the owner, released and paid, with an audit trail", async () => {
    await json(await admin.post(`${api}/runs/${runId}/submit`), 200);
    // The submitter (a payroll admin) cannot approve their own run.
    expect((await admin.post(`${api}/runs/${runId}/decision`, { outcome: "approved" })).status).toBe(403);
    await json(await owner.post(`${api}/runs/${runId}/decision`, { outcome: "approved" }), 200);
    await json(await admin.post(`${api}/runs/${runId}/release`), 200);
    const paid = await json<{ status: string }>(await admin.post(`${api}/runs/${runId}/mark-paid`), 200);
    expect(paid.status).toBe("paid");
    // Locked: items can no longer change.
    expect(
      (
        await admin.post(`${api}/runs/${runId}/items`, {
          employeeId: co.e.A,
          kind: "bonus",
          label: "x",
          amountCents: 1,
          wageClass: "OW",
        })
      ).status,
    ).toBe(409);
    const actions = (await t.db.select().from(auditEvents).where(eq(auditEvents.orgId, co.h.orgId)))
      .map((a) => a.action)
      .filter((a) => a.startsWith("payroll.") || a.startsWith("payslip."));
    expect(actions).toEqual(
      expect.arrayContaining([
        "payroll.run_created",
        "payroll.item_added",
        "payroll.item_updated",
        "payroll.run_computed",
        "payroll.run_submitted",
        "payroll.run_approved",
        "payslip.released",
        "payroll.run_paid",
      ]),
    );
  });

  it("produces the CPF EZPay file and the generic pain.001 bank file", async () => {
    const cpf = await admin.get(`${api}/runs/${runId}/files/cpf-ezpay`);
    expect([cpf.status, cpf.status === 200 ? "" : await cpf.clone().text()]).toEqual([200, ""]);
    expect(cpf.headers.get("content-disposition")).toContain("201912345KPTE01OCT202601.DTL");
    const lines = (await cpf.text()).split("\r\n").filter(Boolean);
    for (const l of lines) expect(l).toHaveLength(150);
    const o = await overview();
    // CPF summary (01) = all CPF charged; SDL (11) = $96.
    const summary = (code: string) => lines.find((l) => l[1] === "0" && l.slice(26, 28) === code)?.slice(28, 40);
    expect(Number(summary("01"))).toBe(o.run.totals.cpfTotalChargedCents);
    expect(summary("11")).toBe("000000009600");
    // 11 CPF detail records (everyone but the EP holder) and the joiner/leaver statuses.
    const cpfDetails = lines.filter((l) => l[1] === "1" && l.slice(26, 28) === "01");
    expect(cpfDetails).toHaveLength(11);
    expect(cpfDetails.filter((l) => l[69] === "N").map((l) => l.slice(70, 136).trim())).toEqual(["ISABEL TAN"]);
    expect(cpfDetails.filter((l) => l[69] === "L").map((l) => l.slice(70, 136).trim())).toEqual(["JASON LIM"]);
    const excluded = JSON.parse(decodeURIComponent(cpf.headers.get("x-crowhr-excluded") ?? "[]"));
    expect(excluded).toEqual([{ employeeName: "Harish Iyer", reason: expect.stringContaining("SINDA") }]);

    // Without the company's debit account the bank file is refused with a fix-it message.
    const refused = await admin.get(`${api}/runs/${runId}/files/bank`);
    expect([refused.status, (await refused.json()).error.message]).toEqual([
      409,
      expect.stringContaining("Payroll settings"),
    ]);
    const put = await admin.put(`${api}/settings`, {
      debitBankBic: "DBSSSGSG",
      debitAccountNumber: "0720123456",
      debitAccountName: "Kopi Kaki Pte. Ltd.",
    });
    expect((await put.json()).debitAccountMasked).toBe("••••3456");
    const bank = await admin.get(`${api}/runs/${runId}/files/bank`);
    expect(bank.status).toBe(200);
    const xml = await bank.text();
    expect(xml).toContain('xmlns="urn:iso:std:iso:20022:tech:xsd:pain.001.001.03"');
    expect(xml.match(/<CdtTrfTxInf>/g)).toHaveLength(12);
    const ctrl = xml.match(/<CtrlSum>([\d.]+)<\/CtrlSum>/)?.[1];
    const net = o.run.totals.netPayableCents as number;
    expect(ctrl).toBe(`${Math.floor(net / 100)}.${String(net % 100).padStart(2, "0")}`);
    expect(xml).toContain("<ReqdExctnDt>2026-10-30</ReqdExctnDt>");
  });
});
