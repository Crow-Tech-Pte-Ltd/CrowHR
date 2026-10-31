import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { clientAs, createTestDb, seedMember, type TestClient, type TestDb } from "../../testing/index.ts";
import { type PayrollHttp, payrollHttp } from "../../testing/payroll-http.ts";
import { applyEvent, ctxFor } from "../employees/lifecycle.ts";
import { createReportingScopeResolver } from "../employees/reports/reporting-scope.ts";
import { OWNER } from "../testing/people-harness.ts";

/** Task 3.8: who may see payroll and payslips (access-control matrix rows payroll:* and payslips:read). */

let t: TestDb;
let p: PayrollHttp<"A" | "B">;
let hr: TestClient;
let manager: TestClient;
let empA: TestClient;
let empB: TestClient;
let runId = "";
const api = "/api/v1";

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
      dob: "1980-05-20",
      residency: "citizen",
      hireDate: "2019-03-02",
      basicCents: 600_000,
    },
  ]);
  const deps = p.co.h.deps;
  Object.assign(deps, { reportingScope: createReportingScopeResolver(t.db) });
  // B manages A.
  await applyEvent(ctxFor(deps, p.co.h.ports, p.co.h.actor(OWNER)), p.co.e.A, {
    type: "transfer",
    effectiveDate: "2026-01-01",
    changes: { managerEmployeeId: p.co.e.B },
  });
  hr = await clientAs(p.app, deps, await seedMember(deps, p.co.h.orgId, { roles: ["hr_admin"] }));
  manager = await clientAs(p.app, deps, await seedMember(deps, p.co.h.orgId, { employeeId: p.co.e.B }));
  empA = await clientAs(p.app, deps, await seedMember(deps, p.co.h.orgId, { employeeId: p.co.e.A }));
  empB = manager;
  const run = await p.ok<{ id: string }>(
    p.admin.post(`${api}/payroll/runs`, { kind: "regular", month: "2026-10", payDate: "2026-10-30" }),
    201,
  );
  runId = run.id;
  await p.ok(p.admin.post(`${api}/payroll/runs/${runId}/compute`));
}, 60_000);
afterAll(() => t.close());

const slips = async (c: TestClient) =>
  (await (await c.get(`${api}/payslips`)).json()) as { items: { id: string; title: string }[] };

describe("payroll access", () => {
  it("payroll_admin and owner can read runs; hr_admin, manager and employee get 403", async () => {
    expect((await p.admin.get(`${api}/payroll/runs/${runId}`)).status).toBe(200);
    expect((await p.owner.get(`${api}/payroll/runs`)).status).toBe(200);
    for (const c of [hr, manager, empA]) {
      expect((await c.get(`${api}/payroll/runs`)).status).toBe(403);
      expect((await c.get(`${api}/payroll/runs/${runId}`)).status).toBe(403);
      expect((await c.post(`${api}/payroll/runs/${runId}/compute`)).status).toBe(403);
    }
    // Only payroll:finalise holders decide.
    expect((await hr.post(`${api}/payroll/runs/${runId}/decision`, { outcome: "approved" })).status).toBe(403);
  });

  it("employees see nothing before release, then only their own payslip", async () => {
    await p.ok(p.admin.post(`${api}/payroll/runs/${runId}/submit`));
    await p.ok(p.owner.post(`${api}/payroll/runs/${runId}/decision`, { outcome: "approved" }));
    expect((await slips(empA)).items).toEqual([]);
    const overview = await p.ok<{ rows: { employeeId: string; payslipId: string }[] }>(
      p.admin.get(`${api}/payroll/runs/${runId}`),
    );
    const slipA = overview.rows.find((r) => r.employeeId === p.co.e.A)?.payslipId as string;
    const slipB = overview.rows.find((r) => r.employeeId === p.co.e.B)?.payslipId as string;
    expect((await empA.get(`${api}/payslips/${slipA}`)).status).toBe(404);

    await p.ok(p.admin.post(`${api}/payroll/runs/${runId}/release`));
    expect((await slips(empA)).items.map((s) => [s.id, s.title])).toEqual([[slipA, "Payslip, October 2026"]]);
    expect((await empA.get(`${api}/payslips/${slipA}`)).status).toBe(200);
    // Another employee's payslip is indistinguishable from a missing one.
    expect((await empA.get(`${api}/payslips/${slipB}`)).status).toBe(404);
    // A manager does not see their report's payslip.
    expect((await manager.get(`${api}/payslips/${slipA}`)).status).toBe(404);
    expect((await slips(empB)).items.map((s) => s.id)).toEqual([slipB]);
    // hr_admin without an employee record holds no payslips:read.
    expect((await hr.get(`${api}/payslips`)).status).toBe(403);
  });

  it("a former employee keeps read-only access to their released payslips", async () => {
    const former = await clientAs(
      p.app,
      p.co.h.deps,
      await seedMember(p.co.h.deps, p.co.h.orgId, {
        employeeId: p.co.e.A,
        status: "former",
        email: "aw.former@example.sg",
      }),
    );
    const list = await slips(former);
    expect(list.items).toHaveLength(1);
    expect((await former.get(`${api}/payslips/${list.items[0]?.id}`)).status).toBe(200);
    expect((await former.get(`${api}/payroll/runs`)).status).toBe(403);
  });
});
