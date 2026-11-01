import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { clientAs, createTestDb, seedMember, seedOrg, type TestClient, type TestDb } from "../../testing/index.ts";
import { decideRun, type PayrollHttp, payrollHttp } from "../../testing/payroll-http.ts";
import { compensationRecords, employees, tenures } from "../db/schema/employees.ts";
import { leaveEncashments, leaveLedger } from "../db/schema/leave.ts";
import { workSchedules } from "../db/schema/organisation.ts";
import { approvalRequests, approvalTasks } from "../db/schema/workflows.ts";
import type { PayInput, PayResult } from "../payroll/engine/types.ts";

let t: TestDb;
let p: PayrollHttp<"A" | "B">;
let employee: TestClient;
let hr: TestClient;
let annual: string;
let policy: Record<string, unknown>;
const leave = "/api/v1/leave";
const payroll = "/api/v1/payroll/runs";
type Encashment = { id: string; status: string; quantity: number; amountCents: number; approvalRequestId: string };
beforeAll(async () => {
  t = await createTestDb();
  p = await payrollHttp(
    t,
    ["A", "B"].map((key) => ({
      key: key as "A" | "B",
      name: `Employee ${key}`,
      dob: "1990-01-01",
      residency: "citizen",
      hireDate: "2020-01-01",
      basicCents: 260_000,
    })),
  );
  employee = await clientAs(p.app, p.co.h.deps, await seedMember(p.co.h.deps, p.co.h.orgId, { employeeId: p.co.e.A }));
  hr = await clientAs(p.app, p.co.h.deps, await seedMember(p.co.h.deps, p.co.h.orgId, { roles: ["hr_admin"] }));
  const types = await p.ok<{ items: { id: string; code: string; policy: Record<string, unknown> }[] }>(
    p.owner.get(`${leave}/policies`),
  );
  const type = types.items.find((x) => x.code === "annual");
  if (!type) throw new Error("Missing annual leave");
  annual = type.id;
  policy = type.policy;
}, 60_000);
afterAll(() => t.close());
async function available() {
  const b = await p.ok<{ items: { typeId: string; available: number }[] }>(employee.get(`${leave}/balances`));
  return b.items.find((x) => x.typeId === annual)?.available ?? 0;
}
async function request(days = 2.5, client = employee, extra: Record<string, unknown> = {}) {
  return p.ok<Encashment>(client.post(`${leave}/encashments`, { leaveTypeId: annual, days, ...extra }), 201);
}
async function decide(r: Encashment, decision: "approve" | "reject") {
  for (const client of [hr, p.admin, p.owner]) {
    const tasks = await p.ok<{ items: { taskId: string; requestId: string }[] }>(client.get("/api/v1/approvals/tasks"));
    const task = tasks.items.find((x) => x.requestId === r.approvalRequestId);
    if (!task) continue;
    await p.ok(client.post(`/api/v1/approvals/tasks/${task.taskId}/decision`, { decision, comment: "Reviewed" }));
    return;
  }
  throw new Error("No eligible approver task");
}
async function run(month: string, extra: Record<string, unknown> = {}) {
  return p.ok<{ id: string }>(p.admin.post(payroll, { kind: "regular", month, payDate: `${month}-28`, ...extra }), 201);
}
async function slip(id: string, employeeId = p.co.e.A) {
  return p.ok<{ input: PayInput; result: PayResult; netPayableCents: number }>(
    p.admin.get(`${payroll}/${id}/employees/${employeeId}`),
  );
}
describe("leave encashment through payroll", () => {
  it("enforces encashment and employee-request policy on the server", async () => {
    expect((await employee.post(`${leave}/encashments`, { leaveTypeId: annual, days: 1 })).status).toBe(403);
    policy = { ...policy, encashable: true };
    await p.ok(p.owner.patch(`${leave}/policies/${annual}`, { policy }));
    expect((await employee.post(`${leave}/encashments`, { leaveTypeId: annual, days: 1 })).status).toBe(403);
    policy = { ...policy, employeeEncashmentRequests: true };
    await p.ok(p.owner.patch(`${leave}/policies/${annual}`, { policy }));
    expect(
      (await employee.post(`${leave}/encashments`, { leaveTypeId: annual, days: 1, employeeId: p.co.e.B })).status,
    ).toBe(404);
  });
  it("reserves pending days, restores on reject/withdraw, and rejects insufficient balance", async () => {
    const before = await available();
    const r = await request(1);
    expect(await available()).toBe(before - 1);
    await decide(r, "reject");
    expect(await available()).toBe(before);
    const w = await request(1);
    await p.ok(employee.post(`${leave}/encashments/${w.id}/withdraw`), 204);
    expect(await available()).toBe(before);
    expect((await employee.post(`${leave}/encashments`, { leaveTypeId: annual, days: before + 1 })).status).toBe(422);
  });
  it("approval becomes next-run AW with CPF, remains on recompute/adjustment, and is never paid again", async () => {
    const before = await available();
    const r = await request();
    await decide(r, "approve");
    expect(await available()).toBe(before - 2.5);
    const bonus = await run("2026-10", { kind: "off_cycle", offCycleReason: "bonus", employeeIds: [p.co.e.A] });
    await p.ok(p.admin.post(`${payroll}/${bonus.id}/compute`));
    expect((await slip(bonus.id)).input.items.some((i) => i.id.startsWith("encashment:"))).toBe(false);
    const early = await run("2026-10", { payDate: "2026-10-28" });
    await p.ok(p.admin.post(`${payroll}/${early.id}/compute`));
    expect((await slip(early.id)).input.items.some((i) => i.id === `encashment:${r.id}`)).toBe(false);
    const nov = await run("2026-11");
    await p.ok(p.admin.post(`${payroll}/${nov.id}/compute`));
    let d = await slip(nov.id);
    const line = d.result.lines.find((l) => l.label === "Leave encashment (2.5 days)");
    expect(line).toMatchObject({ amountCents: 30_000, wageClass: "AW", cpfLiable: true });
    expect(d.result.working.some((w) => w.text.includes("Daily basic rate"))).toBe(true);
    expect(d.result.totals.awCpfCents).toBe(30_000);
    // 2,600 basic + 200 allowance OW + 300 AW; the encashment rate excludes allowances.
    expect(d.result.totals.cpfEmployeeCents).toBe(62_000);
    expect(d.result.totals.cpfEmployerCents).toBe(52_700);
    await p.ok(p.admin.post(`${payroll}/${nov.id}/compute`));
    await p.ok(p.admin.post(`${payroll}/${nov.id}/submit`));
    await p.ok(decideRun(p.owner, nov.id, "approved"));
    await p.ok(p.admin.post(`${payroll}/${nov.id}/mark-paid`));
    const a = await p.ok<{ id: string }>(
      p.admin.post(`${payroll}/${nov.id}/reopen`, { reason: "Verify encashment carry" }),
      201,
    );
    await p.ok(p.admin.post(`${payroll}/${a.id}/compute`));
    expect((await slip(a.id)).result.totals.netPayableCents).toBe(0);
    const overview = await p.ok<{ changes: { items: { text: string }[] } }>(p.admin.get(`${payroll}/${nov.id}`));
    expect(overview.changes.items.filter((c) => c.text.includes("Leave encashment"))).toHaveLength(1);
    // Later salary changes must not change the approved encashment's snapshotted rate.
    await t.db
      .update(compensationRecords)
      .set({ amountCents: 270_000 })
      .where(eq(compensationRecords.employeeId, p.co.e.A));
    await p.ok(p.admin.post(`${payroll}/${a.id}/compute`));
    d = await slip(a.id);
    expect(d.result.lines.find((l) => l.label === line?.label)?.amountCents).toBe(30_000);
    expect(d.input.items.filter((i) => i.id === `encashment:${r.id}`)).toHaveLength(1);
    const dec = await run("2026-12");
    await p.ok(p.admin.post(`${payroll}/${dec.id}/compute`));
    expect((await slip(dec.id)).input.items.some((i) => i.id === `encashment:${r.id}`)).toBe(false);
  });
  it("pays unused leave in off-cycle final pay as AW, rather than exempt termination compensation", async () => {
    await t.db
      .update(tenures)
      .set({ lastWorkingDay: "2026-10-31", cessationReason: "retrenchment" })
      .where(eq(tenures.employeeId, p.co.e.B));
    const r = await request(2, hr, { employeeId: p.co.e.B });
    await decide(r, "approve");
    const final = await run("2026-10", {
      kind: "off_cycle",
      offCycleReason: "final_pay",
      employeeIds: [p.co.e.B],
      payDate: "2026-10-31",
    });
    await p.ok(p.admin.post(`${payroll}/${final.id}/compute`));
    const d = await slip(final.id, p.co.e.B);
    expect(d.result.lines.find((l) => l.label === "Leave encashment (2 days)")).toMatchObject({
      amountCents: 24_000,
      wageClass: "AW",
      cpfLiable: true,
    });
    expect(d.result.totals.cpfEmployeeCents).toBe(56_800);
    expect(d.result.totals.cpfEmployerCents).toBe(48_300);
  });
  it("rounds the exact daily rate × days once and snapshots it before approval", async () => {
    await t.db
      .update(compensationRecords)
      .set({ amountCents: 240_001 })
      .where(eq(compensationRecords.employeeId, p.co.e.A));
    const r = await request(2.5);
    // 240001 × 12 / (52 × 5) × 2.5 = 27692.423... cents; rounding the daily rate first gives 27693.
    expect(r.amountCents).toBe(27_692);
    await t.db
      .update(compensationRecords)
      .set({ amountCents: 270_000 })
      .where(eq(compensationRecords.employeeId, p.co.e.A));
    await decide(r, "approve");
    const list = await p.ok<{ items: Encashment[] }>(employee.get(`${leave}/encashments`));
    expect(list.items.find((x) => x.id === r.id)).toMatchObject({ amountCents: 27_692, status: "approved" });
  });
  it("never reads another tenant's encashment or accepts their employee/type", async () => {
    const foreignOrg = await seedOrg(p.co.h.deps);
    const foreign = await clientAs(
      p.app,
      p.co.h.deps,
      await seedMember(p.co.h.deps, foreignOrg.id, { roles: ["owner"] }),
    );
    const r = await request(1);
    expect((await foreign.post(`${leave}/encashments/${r.id}/withdraw`)).status).toBe(404);
    expect((await foreign.get(`${leave}/encashments?employeeId=${p.co.e.A}`)).status).toBe(404);
    expect(
      (await foreign.post(`${leave}/encashments`, { leaveTypeId: annual, days: 1, employeeId: p.co.e.A })).status,
    ).toBe(404);
  });
  it("turns a year-end ledger entry into an approval without charging days twice, restoring it on rejection", async () => {
    const id = p.co.h.deps.ids.newId();
    await t.db.insert(leaveLedger).values({
      id,
      orgId: p.co.h.orgId,
      employeeId: p.co.e.A,
      leaveTypeId: annual,
      leaveYear: 2025,
      kind: "encashment",
      unit: "days",
      hundredths: -200,
      sourceRef: "ye:2025:test:encash",
    });
    const r = await request(2, hr, { employeeId: p.co.e.A, ledgerEntryId: id });
    expect(
      (await hr.post(`${leave}/encashments`, { employeeId: p.co.e.A, leaveTypeId: annual, days: 2, ledgerEntryId: id }))
        .status,
    ).toBe(409);
    await decide(r, "reject");
    const rows = await t.db.select().from(leaveLedger).where(eq(leaveLedger.employeeId, p.co.e.A));
    expect(rows.filter((l) => l.leaveYear === 2025).reduce((sum, l) => sum + l.hundredths, 0)).toBe(0);
  });
  it("rolls back the workflow decision when the approval balance re-check fails", async () => {
    const r = await request(0.5);
    const id = p.co.h.deps.ids.newId();
    await t.db.insert(leaveLedger).values({
      id,
      orgId: p.co.h.orgId,
      employeeId: p.co.e.A,
      leaveTypeId: annual,
      leaveYear: 2026,
      kind: "adjustment",
      unit: "days",
      hundredths: -100_000,
    });
    const tasks = await p.ok<{ items: { taskId: string; requestId: string }[] }>(hr.get("/api/v1/approvals/tasks"));
    const task = tasks.items.find((x) => x.requestId === r.approvalRequestId);
    expect((await hr.post(`/api/v1/approvals/tasks/${task?.taskId}/decision`, { decision: "approve" })).status).toBe(
      422,
    );
    const [subject] = await t.db.select().from(leaveEncashments).where(eq(leaveEncashments.id, r.id));
    const [approval] = await t.db.select().from(approvalRequests).where(eq(approvalRequests.id, r.approvalRequestId));
    expect(subject?.status).toBe("pending");
    expect(approval?.status).toBe("pending");
    const ledger = await t.db
      .select()
      .from(leaveLedger)
      .where(eq(leaveLedger.sourceRef, `encashment:${r.id}`));
    expect(ledger).toHaveLength(0);
    await t.db.delete(leaveLedger).where(eq(leaveLedger.id, id));
    await p.ok(employee.post(`${leave}/encashments/${r.id}/withdraw`), 204);
  });
  it("requires an approved explicit average workweek for shift workers rather than assuming five days", async () => {
    await t.db.update(workSchedules).set({ kind: "shift" }).where(eq(workSchedules.id, p.co.structure.scheduleId));
    expect((await employee.post(`${leave}/encashments`, { leaveTypeId: annual, days: 0.5 })).status).toBe(400);
    const r = await request(0.5, employee, { workingDaysPerWeek: 6 });
    expect(r.amountCents).toBe(5_192); // 270000 × 12 / (52 × 6) × 0.5
    await p.ok(employee.post(`${leave}/encashments/${r.id}/withdraw`), 204);
    await t.db.update(workSchedules).set({ kind: "fixed" }).where(eq(workSchedules.id, p.co.structure.scheduleId));
  });
  it("refuses a non-HR approver even when a custom workflow explicitly names them", async () => {
    const member = await seedMember(p.co.h.deps, p.co.h.orgId, { employeeId: p.co.e.B });
    const otherStaff = await clientAs(p.app, p.co.h.deps, member);
    await p.ok(
      p.owner.put("/api/v1/approvals/policies/leave_encashment", {
        policies: [
          {
            name: "Invalid staff approver",
            condition: null,
            steps: [{ approverRule: `member:${member.membershipId}` }],
          },
        ],
      }),
    );
    const r = await request(0.5);
    const tasks = await p.ok<{ items: { taskId: string; requestId: string }[] }>(
      otherStaff.get("/api/v1/approvals/tasks"),
    );
    expect(tasks.items.some((x) => x.requestId === r.approvalRequestId)).toBe(false);
    const [task] = await t.db.select().from(approvalTasks).where(eq(approvalTasks.requestId, r.approvalRequestId));
    expect(task).toBeDefined();
    expect([403, 404]).toContain(
      (await otherStaff.post(`/api/v1/approvals/tasks/${task?.id}/decision`, { decision: "approve" })).status,
    );
    await p.ok(employee.post(`${leave}/encashments/${r.id}/withdraw`), 204);
    await p.ok(
      p.owner.put("/api/v1/approvals/policies/leave_encashment", {
        policies: [{ name: "HR", condition: null, steps: [{ approverRule: "role:hr_admin" }] }],
      }),
    );
  });
  it("excludes CPF on post-cessation encashment when SPR status began after leaving", async () => {
    await t.db
      .update(employees)
      .set({ residencyStatus: "pr", prStartDate: "2026-11-01", sprCpfOption: "gg" })
      .where(eq(employees.id, p.co.e.B));
    const r = await request(0.5, hr, { employeeId: p.co.e.B });
    await decide(r, "approve");
    const final = await run("2026-12", { kind: "off_cycle", offCycleReason: "final_pay", employeeIds: [p.co.e.B] });
    await p.ok(p.admin.post(`${payroll}/${final.id}/compute`));
    const d = await slip(final.id, p.co.e.B);
    expect(d.input.items.find((i) => i.id === `encashment:${r.id}`)).toMatchObject({
      wageClass: "AW",
      cpfLiable: false,
    });
    expect(d.result.lines.find((l) => l.itemId === `encashment:${r.id}`)).toMatchObject({
      amountCents: 6_000,
      cpfLiable: false,
    });
    expect(d.result.totals.cpfEmployeeCents).toBe(0);
    expect(d.result.totals.cpfEmployerCents).toBe(0);
  });
});
