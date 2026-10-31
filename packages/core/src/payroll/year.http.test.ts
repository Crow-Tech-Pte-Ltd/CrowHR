import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  clientAs,
  createTestDb,
  createTestDeps,
  seedMember,
  type TestClient,
  type TestDb,
} from "../../testing/index.ts";
import { decideRun } from "../../testing/payroll-http.ts";
import { createApp } from "../app.ts";
import { applyEvent, ctxFor } from "../employees/lifecycle.ts";
import { type SeededCompany, seedCompany } from "../testing/payroll-harness.ts";
import { OWNER } from "../testing/people-harness.ts";

/**
 * Task 3.7: one employee January → December 2026, S$6,000 a month rising to S$7,000 from July,
 * bonuses of S$30,000 (March) and S$40,000 (December). Hand-worked against CPF's AW ceiling rules
 * (Annual Salary Ceiling S$102,000; estimate at each AW payment, actual in December):
 * - March estimate: OW 6,000 × 2 + 6,000 + 9 × 6,000 = 72,000 → AW ceiling 30,000; all March AW subject.
 * - December actual: OW 6,000 × 6 + 7,000 × 6 = 78,000 → AW ceiling 24,000. March's AW is re-allocated
 *   to 24,000 (excess 6,000, refundable by CPF on application: 37% × 6,000 = S$2,220), December's
 *   S$40,000 is entirely above the ceiling.
 */

let t: TestDb;
let co: SeededCompany<"M">;
let admin: TestClient;
let owner: TestClient;
const api = "/api/v1/payroll";

type Detail = {
  result: {
    month: { cpfTotalCents: number; cpfEmployeeCents: number };
    cpf: {
      awSubjectCents: number;
      awNotSubjectCents: number;
      priorAwExcessCents: number;
      awCeiling: { basis: string; annualOwSubjectCents: number; annualAwCeilingCents: number } | null;
    };
    issues: { code: string }[];
    working: { code: string; text: string }[];
    stateAfter: {
      owSubjectCents: number;
      awPayments: { payableMonth: string; awPayableCents: number; awSubjectCents: number }[];
    };
  };
};

beforeAll(async () => {
  t = await createTestDb();
  co = await seedCompany(createTestDeps(t.db), [
    {
      key: "M",
      name: "Muthu Kumar",
      dob: "1986-02-14",
      residency: "citizen",
      hireDate: "2021-01-04",
      basicCents: 600_000,
    },
  ]);
  await applyEvent(ctxFor(co.h.deps, co.h.ports, co.h.actor(OWNER)), co.e.M, {
    type: "salary_change",
    effectiveDate: "2026-07-01",
    compensation: { payBasis: "monthly", amountCents: 700_000, reason: "Mid-year increment" },
  });
  const app = createApp(co.h.deps);
  admin = await clientAs(app, co.h.deps, await seedMember(co.h.deps, co.h.orgId, { roles: ["payroll_admin"] }));
  owner = await clientAs(app, co.h.deps, await seedMember(co.h.deps, co.h.orgId, { roles: ["owner"] }));
}, 60_000);
afterAll(() => t.close());

async function ok<T>(res: Response, status = 200): Promise<T> {
  const body = res.status === 204 ? null : await res.json();
  if (res.status !== status) throw new Error(`expected ${status}, got ${res.status}: ${JSON.stringify(body)}`);
  return body as T;
}

const details = new Map<string, Detail>();

async function payMonth(month: string, bonusCents?: number) {
  const run = await ok<{ id: string }>(await admin.post(`${api}/runs`, { kind: "regular", month }), 201);
  if (bonusCents) {
    await ok(
      await admin.post(`${api}/runs/${run.id}/items`, {
        employeeId: co.e.M,
        kind: "bonus",
        label: "Bonus",
        amountCents: bonusCents,
        wageClass: "AW",
        awPayableDate: `${month}-20`,
      }),
      201,
    );
  }
  await ok(await admin.post(`${api}/runs/${run.id}/compute`));
  await ok(await admin.post(`${api}/runs/${run.id}/submit`));
  await ok(await decideRun(owner, run.id, "approved"));
  await ok(await admin.post(`${api}/runs/${run.id}/mark-paid`));
  details.set(month, await ok<Detail>(await admin.get(`${api}/runs/${run.id}/employees/${co.e.M}`)));
}

describe("a year of payroll for one employee", () => {
  it("runs January to December", async () => {
    for (let m = 1; m <= 12; m++) {
      const month = `2026-${String(m).padStart(2, "0")}`;
      await payMonth(month, m === 3 ? 3_000_000 : m === 12 ? 4_000_000 : undefined);
    }
    expect(details.size).toBe(12);
  }, 120_000);

  it("carries YTD state from run to run", () => {
    expect(details.get("2026-01")?.result.working.find((w) => w.code === "CPF_YTD_SOURCE")?.text).toContain(
      "first payroll month of 2026",
    );
    expect(details.get("2026-02")?.result.working.find((w) => w.code === "CPF_YTD_SOURCE")?.text).toContain(
      "January 2026",
    );
    expect(details.get("2026-06")?.result.stateAfter.owSubjectCents).toBe(3_600_000);
    expect(details.get("2026-11")?.result.stateAfter.owSubjectCents).toBe(3_600_000 + 5 * 700_000);
    // Months without AW leave the March AW payment untouched.
    expect(details.get("2026-11")?.result.stateAfter.awPayments).toEqual([
      { payableMonth: "2026-03", owCents: 600_000, awPayableCents: 3_000_000, awSubjectCents: 3_000_000 },
    ]);
  });

  it("estimates the AW ceiling in March", () => {
    const mar = details.get("2026-03")?.result;
    expect(mar?.cpf.awCeiling).toMatchObject({
      basis: "ESTIMATE",
      annualOwSubjectCents: 7_200_000,
      annualAwCeilingCents: 3_000_000,
    });
    expect(mar?.cpf.awSubjectCents).toBe(3_000_000);
    // 37% × (6,000 + 30,000) = 13,320; employee 20% = 7,200.
    expect([mar?.month.cpfTotalCents, mar?.month.cpfEmployeeCents]).toEqual([1_332_000, 720_000]);
  });

  it("recomputes the AW ceiling on actual OW in December", () => {
    const dec = details.get("2026-12")?.result;
    expect(dec?.cpf.awCeiling).toMatchObject({
      basis: "ACTUAL",
      annualOwSubjectCents: 7_800_000,
      annualAwCeilingCents: 2_400_000,
    });
    expect([dec?.cpf.awSubjectCents, dec?.cpf.awNotSubjectCents]).toEqual([0, 4_000_000]);
    // December's own CPF is on OW only: 37% × 7,000 = 2,590; employee 1,400.
    expect([dec?.month.cpfTotalCents, dec?.month.cpfEmployeeCents]).toEqual([259_000, 140_000]);
    // March over-contributed on S$6,000: indicative refund 37% × 6,000 = S$2,220, never netted.
    expect(dec?.cpf.priorAwExcessCents).toBe(222_000);
    expect(dec?.issues.map((i) => i.code)).toContain("CPF_AW_EXCESS_REFUND");
    expect(dec?.stateAfter.awPayments).toEqual([
      { payableMonth: "2026-03", owCents: 600_000, awPayableCents: 3_000_000, awSubjectCents: 2_400_000 },
      { payableMonth: "2026-12", owCents: 700_000, awPayableCents: 4_000_000, awSubjectCents: 0 },
    ]);
  });
});
