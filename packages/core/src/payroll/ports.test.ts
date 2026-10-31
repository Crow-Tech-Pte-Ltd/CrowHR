import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "../../testing/index.ts";
import { decideRun, type PayrollHttp, payrollHttp } from "../../testing/payroll-http.ts";
import { notifications } from "../db/schema/notifications.ts";
import { approvalRequests } from "../db/schema/workflows.ts";
import { tick } from "../jobs/tick.ts";
import { createMemoryOvertime, createMemoryReimbursements } from "../testing/payroll-doubles.ts";
import { payrollPeoplePort } from "./people-port.ts";

/**
 * Task 3.3: the ports and the workflows wiring. Approval runs through the real engine (the
 * `payroll_run` adapter registered in CORE_WORKFLOW_PLUGINS); claims and attendance OT through
 * their doubles; the payroll-cutoff reminder through the real tick sweep.
 */

let t: TestDb;
let p: PayrollHttp<"A">;
const claims = createMemoryReimbursements();
const overtime = createMemoryOvertime();
const api = "/api/v1/payroll";
let now = new Date("2026-10-31T01:00:00.000Z");

beforeAll(async () => {
  t = await createTestDb();
  p = await payrollHttp(
    t,
    [
      {
        key: "A",
        name: "Daud bin Hassan",
        dob: "1985-08-08",
        residency: "citizen",
        hireDate: "2020-09-01",
        basicCents: 260_000,
      },
    ],
    { payroll: { reimbursements: claims, overtime }, clock: { now: () => new Date(now) } },
  );
  // People's real payroll port (the harness installs test doubles for people's other ports).
  Object.assign(p.co.h.ports, { payroll: payrollPeoplePort(p.co.h.deps) });
  claims.claims.push({ claimId: "claim-1", employeeId: p.co.e.A, typeName: "Transport", amountCents: 4_550 });
  overtime.entries.push({
    sourceId: "ot-1",
    employeeId: p.co.e.A,
    minutes: 120,
    periodStart: "2026-10-01",
    periodEnd: "2026-10-31",
  });
}, 60_000);
afterAll(() => t.close());

describe("payroll ports and workflows wiring", () => {
  let runId = "";

  it("feeds approved overtime and payable claims into the run and reserves the claims", async () => {
    runId = (
      await p.ok<{ id: string }>(
        p.admin.post(`${api}/runs`, { kind: "regular", month: "2026-10", payDate: "2026-10-30" }),
        201,
      )
    ).id;
    await p.ok(p.admin.post(`${api}/runs/${runId}/compute`));
    const d = await p.ok<{ result: { lines: { category: string; amountCents: number; label: string }[] } }>(
      p.admin.get(`${api}/runs/${runId}/employees/${p.co.e.A}`),
    );
    // MOM example: S$2,600 non-workman, 2 h → S$40.80.
    expect(d.result.lines.find((l) => l.category === "overtime")).toMatchObject({
      amountCents: 4_080,
      label: "Overtime (approved in attendance)",
    });
    expect(d.result.lines.find((l) => l.category === "claim")).toMatchObject({
      amountCents: 4_550,
      label: "Claims reimbursement: Transport",
    });
    expect(claims.reserved.get("claim-1")).toBe(runId);
  });

  it("submits a payroll_run request to the engine; the owner's decision runs the adapter", async () => {
    await p.ok(p.admin.post(`${api}/runs/${runId}/submit`));
    const [req] = await t.db
      .select()
      .from(approvalRequests)
      .where(and(eq(approvalRequests.subjectType, "payroll_run"), eq(approvalRequests.subjectId, runId)));
    expect(req).toMatchObject({ status: "pending", title: "October 2026 payroll" });
    expect(req?.attributes).toMatchObject({ typeCode: "regular" });
    await p.ok(decideRun(p.owner, runId, "rejected", "Check the overtime"));
    let run = (await p.ok<{ run: { status: string; decisionComment: string } }>(p.admin.get(`${api}/runs/${runId}`)))
      .run;
    expect(run).toMatchObject({ status: "draft", decisionComment: "Check the overtime" });

    await p.ok(p.admin.post(`${api}/runs/${runId}/compute`));
    await p.ok(p.admin.post(`${api}/runs/${runId}/submit`));
    // Withdrawing closes the engine request and returns the run to draft.
    await p.ok(p.admin.post(`${api}/runs/${runId}/withdraw`));
    const open = await t.db
      .select()
      .from(approvalRequests)
      .where(and(eq(approvalRequests.subjectId, runId), eq(approvalRequests.status, "pending")));
    expect(open).toEqual([]);
    await p.ok(p.admin.post(`${api}/runs/${runId}/submit`));
    await p.ok(decideRun(p.owner, runId, "approved"));
    run = (await p.ok<{ run: { status: string; decisionComment: string } }>(p.admin.get(`${api}/runs/${runId}`))).run;
    expect(run.status).toBe("approved");
  });

  it("marks reserved claims paid when the run is paid", async () => {
    await p.ok(p.admin.post(`${api}/runs/${runId}/mark-paid`));
    expect(claims.paid.get("claim-1")).toBe("2026-10-30");
    expect(await claims.listPayable("org", "2026-11-30")).toEqual([]);
  });

  it("guards finalised periods for people and records back pay owed", async () => {
    // A raise dated inside the finalised October payroll needs `retroactive: true`.
    const late = await p.owner.post(`/api/v1/employees/${p.co.e.A}/events`, {
      type: "salary_change",
      effectiveDate: "2026-10-01",
      compensation: { payBasis: "monthly", amountCents: 280_000, reason: "Backdated raise" },
    });
    expect(late.status).toBe(400);
    expect((await late.json()).error.message).toContain("October 2026 payroll is finalised");
    const ok = await p.owner.post(`/api/v1/employees/${p.co.e.A}/events`, {
      type: "salary_change",
      effectiveDate: "2026-10-01",
      compensation: { payBasis: "monthly", amountCents: 280_000, reason: "Backdated raise", retroactive: true },
    });
    expect([200, 201]).toContain(ok.status);
    const nov = (await p.ok<{ id: string }>(p.admin.post(`${api}/runs`, { kind: "regular", month: "2026-11" }), 201))
      .id;
    await p.ok(p.admin.post(`${api}/runs/${nov}/compute`));
    const d = await p.ok<{ result: { issues: { code: string; message: string }[] } }>(
      p.admin.get(`${api}/runs/${nov}/employees/${p.co.e.A}`),
    );
    expect(d.result.issues.find((i) => i.code === "BACKPAY_OWED")?.message).toContain("2026-10-01");
  });

  it("reminds payroll admins 3 days before the cutoff while the month's run is not approved", async () => {
    await p.ok(p.admin.put(`${api}/settings`, { cutoffDay: 25 }));
    for (const day of ["2026-11-20", "2026-11-22", "2026-11-23", "2026-11-26"]) {
      now = new Date(`${day}T01:00:00.000Z`);
      await tick(p.co.h.deps, now);
    }
    const notes = await t.db.select().from(notifications).where(eq(notifications.kind, "payroll_cutoff"));
    expect(notes.map((n) => n.title)).toEqual(["November 2026 payroll cutoff is on 25 Nov 2026"]);
  });
});
