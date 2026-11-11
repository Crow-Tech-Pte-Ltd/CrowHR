import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "../../testing/index.ts";
import { decideRun, type PayrollHttp, payrollHttp } from "../../testing/payroll-http.ts";
import { auditEvents } from "../db/schema/audit.ts";
import { notifications } from "../db/schema/notifications.ts";
import { approvalRequests, approvalTasks } from "../db/schema/workflows.ts";

/**
 * Review finding #22: payroll state changes are conditional (UPDATE … WHERE status = expected), so
 * two requests that both read the run before either writes can't both apply. `holdTransactions(n)`
 * makes the race deterministic: the first n transactions wait until all n requests have read the
 * run, then run one after another in arrival order.
 */

let t: TestDb;
let p: PayrollHttp<"A">;
const api = "/api/v1/payroll";
let month = 0;

function holdTransactions(n: number) {
  const db = p.co.h.deps.db as unknown as { transaction: (...args: unknown[]) => Promise<unknown> };
  const original = db.transaction;
  let arrived = 0;
  let release: () => void = () => {};
  const gate = new Promise<void>((r) => {
    release = r;
  });
  const timer = setTimeout(() => release(), 2_000);
  const restore = () => {
    db.transaction = original;
    clearTimeout(timer);
    release();
  };
  db.transaction = async (...args: unknown[]) => {
    arrived += 1;
    if (arrived >= n) restore();
    await gate;
    return original.apply(db, args);
  };
  return restore;
}

async function newRun(): Promise<string> {
  month += 1;
  const m = `2027-${String(month).padStart(2, "0")}`;
  const run = await p.ok<{ id: string }>(
    p.admin.post(`${api}/runs`, { kind: "regular", month: m, payDate: `${m}-25` }),
    201,
  );
  await p.ok(p.admin.post(`${api}/runs/${run.id}/compute`));
  return run.id;
}

async function approvedRun(): Promise<string> {
  const id = await newRun();
  await p.ok(p.admin.post(`${api}/runs/${id}/submit`));
  await p.ok(decideRun(p.owner, id, "approved"));
  return id;
}

async function runOf(id: string) {
  const body = await p.ok<{ run: { status: string; releasedAt: string | null } }>(p.admin.get(`${api}/runs/${id}`));
  return body.run;
}

async function pendingTask(runId: string) {
  const [req] = await t.db.select().from(approvalRequests).where(eq(approvalRequests.subjectId, runId));
  const [task] = await t.db
    .select()
    .from(approvalTasks)
    .where(and(eq(approvalTasks.requestId, req?.id as string), eq(approvalTasks.status, "pending")));
  return task?.id as string;
}

async function auditCount(action: string, targetId: string) {
  const rows = await t.db
    .select({ id: auditEvents.id })
    .from(auditEvents)
    .where(and(eq(auditEvents.action, action), eq(auditEvents.targetId, targetId)));
  return rows.length;
}

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
  ]);
  await p.ok(
    p.admin.put(`${api}/allowance-settings/${p.co.allowances.transport}`, {
      cpfLiable: true,
      prorate: true,
      grossRateIncluded: false,
    }),
  );
}, 60_000);
afterAll(() => t.close());

describe("concurrent payroll transitions", () => {
  it("approve and withdraw: exactly one wins and the run agrees with its request", async () => {
    const id = await newRun();
    await p.ok(p.admin.post(`${api}/runs/${id}/submit`));
    const task = await pendingTask(id);
    const done = holdTransactions(2);
    const [a, w] = await Promise.all([
      p.owner.post(`/api/v1/approvals/tasks/${task}/decision`, { decision: "approve" }),
      p.admin.post(`${api}/runs/${id}/withdraw`),
    ]);
    done();
    expect([w.status, a.status].filter((s) => s === 200)).toHaveLength(1);
    const run = await runOf(id);
    const [req] = await t.db.select().from(approvalRequests).where(eq(approvalRequests.subjectId, id));
    expect(run.status).toBe(w.status === 200 ? "draft" : "approved");
    expect(req?.status).toBe(w.status === 200 ? "withdrawn" : "approved");
  });

  it("adding an item while submitting: never both", async () => {
    const id = await newRun();
    const done = holdTransactions(2);
    const [s, i] = await Promise.all([
      p.admin.post(`${api}/runs/${id}/submit`),
      p.admin.post(`${api}/runs/${id}/items`, {
        employeeId: p.co.e.A,
        kind: "other_earning",
        label: "Late item",
        amountCents: 10_000,
      }),
    ]);
    done();
    expect([s.status, i.status].filter((x) => x < 300)).toHaveLength(1);
    expect([s.status, i.status].filter((x) => x === 409)).toHaveLength(1);
  });

  it("refuses a computation that reaches its write after the run was submitted", async () => {
    const id = await newRun();
    const db = p.co.h.deps.db as unknown as { transaction: (...args: unknown[]) => Promise<unknown> };
    const original = db.transaction;
    let arrived: () => void = () => {};
    const entered = new Promise<void>((r) => {
      arrived = r;
    });
    let resume: () => void = () => {};
    const gate = new Promise<void>((r) => {
      resume = r;
    });
    db.transaction = async (...args: unknown[]) => {
      db.transaction = original;
      arrived();
      await gate;
      return original.apply(db, args);
    };
    const computation = p.admin.post(`${api}/runs/${id}/compute`);
    try {
      await entered;
      await p.ok(p.admin.post(`${api}/runs/${id}/submit`));
    } finally {
      db.transaction = original;
      resume();
    }
    expect((await computation).status).toBe(409);
    expect((await runOf(id)).status).toBe("in_review");
    expect(await auditCount("payroll.run_computed", id)).toBe(1);
  });

  it("mark paid twice: one 200, one 409, one audit event", async () => {
    const id = await approvedRun();
    const done = holdTransactions(2);
    const results = await Promise.all([
      p.admin.post(`${api}/runs/${id}/mark-paid`),
      p.admin.post(`${api}/runs/${id}/mark-paid`),
    ]);
    done();
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(await auditCount("payroll.run_paid", id)).toBe(1);
  });

  it("release twice: released and employees notified once", async () => {
    const id = await approvedRun();
    const done = holdTransactions(2);
    const results = await Promise.all([
      p.admin.post(`${api}/runs/${id}/release`),
      p.admin.post(`${api}/runs/${id}/release`),
    ]);
    done();
    expect(results.map((r) => r.status)).toEqual([200, 200]);
    expect(await auditCount("payslip.released", id)).toBe(1);
    expect((await runOf(id)).releasedAt).not.toBeNull();
    const notes = await t.db.select().from(notifications).where(eq(notifications.kind, "payslip_released"));
    expect(new Set(notes.map((n) => n.subjectId)).size).toBe(notes.length);
  });

  it("release cannot succeed after a concurrent return to draft", async () => {
    const id = await approvedRun();
    const db = p.co.h.deps.db as unknown as { transaction: (...args: unknown[]) => Promise<unknown> };
    const original = db.transaction;
    let arrived: () => void = () => {};
    const entered = new Promise<void>((r) => {
      arrived = r;
    });
    let resume: () => void = () => {};
    const gate = new Promise<void>((r) => {
      resume = r;
    });
    db.transaction = async (...args: unknown[]) => {
      db.transaction = original;
      arrived();
      await gate;
      return original.apply(db, args);
    };
    const releasing = p.admin.post(`${api}/runs/${id}/release`);
    try {
      await entered;
      await p.ok(p.admin.post(`${api}/runs/${id}/return-to-draft`, { reason: "Correct bank details" }));
    } finally {
      db.transaction = original;
      resume();
    }
    expect((await releasing).status).toBe(409);
    expect((await runOf(id)).status).toBe("draft");
    expect(await auditCount("payslip.released", id)).toBe(0);
  });

  it("an approved run with an open adjustment can't return to draft, even when the two race", async () => {
    const id = await approvedRun();
    const adj = await p.ok<{ id: string }>(p.admin.post(`${api}/runs/${id}/reopen`, { reason: "Missed item" }), 201);
    const res = await p.admin.post(`${api}/runs/${id}/return-to-draft`, { reason: "Correct bank details" });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: { message: string } }).error.message).toMatch(/adjustment of this run/);
    expect((await runOf(id)).status).toBe("approved");
    // The adjustment draft can be deleted, and then the run can return to draft.
    expect((await p.admin.delete(`${api}/runs/${adj.id}`)).status).toBe(204);
    const raced = await approvedRun();
    const done = holdTransactions(2);
    const results = await Promise.all([
      p.admin.post(`${api}/runs/${raced}/reopen`, { reason: "First" }),
      p.admin.post(`${api}/runs/${raced}/return-to-draft`, { reason: "Second" }),
    ]);
    done();
    // Never both: either the reopen wins (the run stays approved) or the return does (no adjustment).
    const [reopened, returned] = results.map((r) => r.status);
    expect([reopened, returned].sort()).toEqual(reopened === 201 ? [201, 409] : [200, 409]);
    expect((await runOf(raced)).status).toBe(reopened === 201 ? "approved" : "draft");
  });

  it("two regular runs for one month created at once: one 201, one 409 (not 500)", async () => {
    const done = holdTransactions(2);
    const results = await Promise.all([
      p.admin.post(`${api}/runs`, { kind: "regular", month: "2028-01" }),
      p.admin.post(`${api}/runs`, { kind: "regular", month: "2028-01" }),
    ]);
    done();
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    const lost = results.find((r) => r.status === 409) as Response;
    expect(((await lost.json()) as { error: { message: string } }).error.message).toMatch(
      /already a regular payroll run for January 2028/,
    );
  });

  it("a second item for the same public holiday: 409 that says to edit the first", async () => {
    const id = await newRun();
    const { run } = await p.ok<{ run: { periodStart: string } }>(p.admin.get(`${api}/runs/${id}`));
    const item = {
      employeeId: p.co.e.A,
      kind: "other_earning",
      label: "Public holiday pay",
      amountCents: 18_000,
      wageClass: "OW",
      holidayDate: run.periodStart,
    };
    await p.ok(p.admin.post(`${api}/runs/${id}/items`, item), 201);
    const res = await p.admin.post(`${api}/runs/${id}/items`, item);
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: { message: string } }).error.message).toMatch(/Edit that item/);
  });

  it("a run resubmitted after a rejection is undecided again, so it still blocks returning the month to draft", async () => {
    const regular = await newRun();
    const { run } = await p.ok<{ run: { month: string; periodStart: string } }>(p.admin.get(`${api}/runs/${regular}`));
    const bonus = await p.ok<{ id: string }>(
      p.admin.post(`${api}/runs`, {
        kind: "off_cycle",
        offCycleReason: "bonus",
        month: run.month,
        employeeIds: [p.co.e.A],
      }),
      201,
    );
    await p.ok(
      p.admin.post(`${api}/runs/${bonus.id}/items`, {
        employeeId: p.co.e.A,
        kind: "bonus",
        label: "Bonus",
        amountCents: 50_000,
        wageClass: "AW",
        awPayableDate: run.periodStart,
      }),
      201,
    );
    await p.ok(p.admin.post(`${api}/runs/${bonus.id}/compute`));
    await p.ok(p.admin.post(`${api}/runs/${bonus.id}/submit`));
    await p.ok(decideRun(p.owner, bonus.id, "rejected", "Wrong amount"));
    await p.ok(p.admin.post(`${api}/runs/${regular}/submit`));
    await p.ok(decideRun(p.owner, regular, "approved"));
    await p.ok(p.admin.post(`${api}/runs/${bonus.id}/compute`));
    await p.ok(p.admin.post(`${api}/runs/${bonus.id}/submit`));
    const resubmitted = await p.ok<{ run: { status: string; decidedAt: string | null } }>(
      p.admin.get(`${api}/runs/${bonus.id}`),
    );
    expect(resubmitted.run).toMatchObject({ status: "in_review", decidedAt: null });
    expect((await p.admin.post(`${api}/runs/${regular}/return-to-draft`, { reason: "Bank details" })).status).toBe(409);
  });

  it("two runs of one month can't wait for approval together: the second would ignore the first's CPF", async () => {
    const regular = await newRun();
    const { run } = await p.ok<{ run: { month: string; periodStart: string } }>(p.admin.get(`${api}/runs/${regular}`));
    await p.ok(p.admin.post(`${api}/runs/${regular}/submit`));
    const bonus = await p.ok<{ id: string }>(
      p.admin.post(`${api}/runs`, {
        kind: "off_cycle",
        offCycleReason: "bonus",
        month: run.month,
        employeeIds: [p.co.e.A],
      }),
      201,
    );
    await p.ok(
      p.admin.post(`${api}/runs/${bonus.id}/items`, {
        employeeId: p.co.e.A,
        kind: "commission",
        label: "Commission",
        amountCents: 500_000,
        wageClass: "OW",
      }),
      201,
    );
    await p.ok(p.admin.post(`${api}/runs/${bonus.id}/compute`));
    const res = await p.admin.post(`${api}/runs/${bonus.id}/submit`);
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: { message: string } }).error.message).toMatch(
      /waiting for approval.*recompute this run/,
    );
    // Once the regular run is decided, the bonus run is recomputed with it and can go.
    await p.ok(decideRun(p.owner, regular, "approved"));
    expect((await p.admin.post(`${api}/runs/${bonus.id}/submit`)).status).toBe(409); // stale: recompute first
    await p.ok(p.admin.post(`${api}/runs/${bonus.id}/compute`));
    await p.ok(p.admin.post(`${api}/runs/${bonus.id}/submit`));
  });

  it("reopen twice: one adjustment, one 409", async () => {
    const id = await approvedRun();
    const done = holdTransactions(2);
    const results = await Promise.all([
      p.admin.post(`${api}/runs/${id}/reopen`, { reason: "First" }),
      p.admin.post(`${api}/runs/${id}/reopen`, { reason: "Second" }),
    ]);
    done();
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
  });
});
