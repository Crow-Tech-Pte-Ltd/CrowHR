import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setTimesheetApproval } from "../../testing/attendance.ts";
import { clientAs, createTestDb, seedMember, seedOrg, type TestDb } from "../../testing/index.ts";
import { decideRun, type PayrollHttp, payrollHttp } from "../../testing/payroll-http.ts";
import { attendanceHoursWorkedSource } from "../attendance/outputs.ts";
import { attendanceTimesheets, type TimesheetTotalsSnapshot } from "../db/schema/attendance.ts";
import { compensationRecords, tenures } from "../db/schema/employees.ts";
import { leaveRequestDays, leaveRequests } from "../db/schema/leave.ts";
import { eachDay } from "./engine/dates.ts";
import type { PayInput, PayResult } from "./engine/types.ts";

const person = {
  key: "crew" as const,
  name: "Lim Mei Ling",
  dob: "1991-05-06",
  residency: "citizen" as const,
  hireDate: "2026-10-01",
  basicCents: 2_000,
};
const api = "/api/v1/payroll/runs";
const totals: TimesheetTotalsSnapshot = {
  daysWorked: 0,
  workedMinutes: 0,
  lateCount: 0,
  lateMinutes: 0,
  earlyOutCount: 0,
  missingPunches: 0,
  otMinutes: 0,
  leaveDays: 0,
};

describe("approved hours in payroll", () => {
  let t: TestDb;
  let p: PayrollHttp<"crew">;
  let memberId: string;
  const now = new Date("2026-11-09T02:00:00Z");
  beforeEach(async () => {
    t = await createTestDb();
    p = await payrollHttp(t, [person], { clock: { now: () => now } });
    await t.db
      .update(compensationRecords)
      .set({ payBasis: "hourly" })
      .where(and(eq(compensationRecords.orgId, p.co.h.orgId), eq(compensationRecords.employeeId, p.co.e.crew)));
    memberId = (await seedMember(p.co.h.deps, p.co.h.orgId, { employeeId: p.co.e.crew })).membershipId;
    await setTimesheetApproval(p.owner, { approval: true, payrollApprovedOnly: true });
  });
  afterEach(() => t.close());

  async function approveSheet(
    start: string,
    end: string,
    days: Record<string, { minutes: number; review?: "missing_punches" | "overtime" | "special_day" | "leave" }> = {},
    legacy = false,
  ) {
    const id = p.co.h.deps.ids.newId();
    const approvedTotals = legacy
      ? totals
      : {
          ...totals,
          payrollDays: [...eachDay(start, end)].map((date) => ({
            date,
            workedMinutes: days[date]?.minutes ?? 0,
            review: days[date]?.review ?? null,
          })),
        };
    await t.db.insert(attendanceTimesheets).values({
      id,
      orgId: p.co.h.orgId,
      employeeId: p.co.e.crew,
      periodStart: start,
      periodEnd: end,
      status: "approved",
      submittedByMembershipId: memberId,
      submittedAt: now,
      submittedTotals: totals,
      decidedAt: now,
      approvedTotals,
    });
    return id;
  }

  async function createRun(body: Record<string, unknown> = {}) {
    const { id } = await p.ok<{ id: string }>(
      p.admin.post(api, { kind: "regular", month: "2026-10", payDate: "2026-11-02", ...body }),
      201,
    );
    return id;
  }

  async function compute(id: string) {
    await p.ok(p.admin.post(`${api}/${id}/compute`));
    return p.ok<{ input: PayInput; result: PayResult }>(p.admin.get(`${api}/${id}/employees/${p.co.e.crew}`));
  }

  it("prices approved dates at the rate then in effect and manual hours replace the whole feed", async () => {
    const [old] = await t.db
      .update(compensationRecords)
      .set({ effectiveTo: "2026-10-16" })
      .where(and(eq(compensationRecords.orgId, p.co.h.orgId), eq(compensationRecords.employeeId, p.co.e.crew)))
      .returning();
    if (!old) throw new Error("Expected a compensation record");
    await t.db.insert(compensationRecords).values({
      ...old,
      id: p.co.h.deps.ids.newId(),
      effectiveFrom: "2026-10-16",
      effectiveTo: null,
      amountCents: 2_400,
    });
    await approveSheet("2026-09-28", "2026-10-15", { "2026-10-05": { minutes: 120 } });
    await approveSheet("2026-10-16", "2026-11-02", { "2026-10-20": { minutes: 180 } });
    const run = await createRun();
    const fed = await compute(run);
    expect(fed.input.items.filter((i) => i.kind === "hours")).toMatchObject([
      { source: "attendance", date: "2026-10-05", minutes: 120 },
      { source: "attendance", date: "2026-10-20", minutes: 180 },
    ]);
    expect(fed.result.totals.basicCents).toBe(11_200);
    await p.ok(
      p.admin.post(`${api}/${run}/items`, {
        employeeId: p.co.e.crew,
        kind: "hours",
        label: "Reviewed hours",
        date: "2026-10-20",
        minutes: 60,
      }),
      201,
    );
    const manual = await compute(run);
    expect(manual.input.items.filter((i) => i.kind === "hours")).toMatchObject([{ source: "manual", minutes: 60 }]);
    expect(manual.result.totals.basicCents).toBe(2_400);
  });

  it("reopening an approval makes a computed run stale and removes the hours", async () => {
    const sheetId = await approveSheet("2026-10-01", "2026-10-31", { "2026-10-06": { minutes: 60 } });
    const run = await createRun();
    expect((await compute(run)).result.hourly?.minutes).toBe(60);
    await p.ok(p.owner.post(`/api/v1/attendance/timesheets/${sheetId}/reopen`, { reason: "Correct the punches" }));
    await p.ok(p.admin.post(`${api}/${run}/submit`), 409);
    const reopened = await compute(run);
    expect(reopened.input.items.filter((i) => i.kind === "hours")).toEqual([]);
    expect(reopened.result.issues).toContainEqual(
      expect.objectContaining({ code: "HOURS_MISSING", message: expect.stringMatching(/approved timesheet/i) }),
    );
  });

  it("records approved zero hours and limits final-pay coverage to employed days", async () => {
    await t.db
      .update(tenures)
      .set({ lastWorkingDay: "2026-10-15", cessationReason: "resignation" })
      .where(and(eq(tenures.orgId, p.co.h.orgId), eq(tenures.employeeId, p.co.e.crew)));
    const sheet = await approveSheet("2026-10-01", "2026-10-15");
    const run = await createRun({
      kind: "off_cycle",
      offCycleReason: "final_pay",
      employeeIds: [p.co.e.crew],
    });
    const { result } = await compute(run);
    expect(result.hourly?.minutes).toBe(0);
    expect(result.issues.map((i) => i.code)).not.toContain("HOURS_MISSING");
    await p.ok(p.admin.post(`${api}/${run}/submit`));
    await p.ok(decideRun(p.owner, run, "approved"));
    await p.ok(
      p.owner.post(`/api/v1/attendance/timesheets/${sheet}/reopen`, { reason: "Review approved hours later" }),
    );
    const stored = await p.ok<{ result: PayResult }>(p.admin.get(`${api}/${run}/employees/${p.co.e.crew}`));
    expect(stored.result).toEqual(result);
  });

  it("omits partial or legacy approvals and exceptional days, identifying the reason", async () => {
    const run = await createRun();
    await approveSheet("2026-10-01", "2026-10-15");
    const hasManualReason = async (reason: RegExp) => {
      const { input, result } = await compute(run);
      expect(input.items.filter((i) => i.kind === "hours")).toEqual([]);
      expect(result.issues.filter((i) => i.code === "HOURS_MISSING")).toEqual([
        expect.objectContaining({ severity: "blocking", message: expect.stringMatching(reason) }),
      ]);
    };
    await hasManualReason(/16 Oct 2026.*approved timesheet/i);
    const legacyId = await approveSheet("2026-10-16", "2026-10-31", {}, true);
    await hasManualReason(/16 Oct 2026.*daily/i);
    await p.ok(p.owner.post(`/api/v1/attendance/timesheets/${legacyId}/reopen`, { reason: "Approve daily detail" }));
    await approveSheet("2026-10-16", "2026-10-31", {
      "2026-10-16": { minutes: 60, review: "overtime" },
      "2026-10-17": { minutes: 0, review: "missing_punches" },
    });
    await hasManualReason(/16 Oct 2026.*overtime/i);
  });

  it("does not receive approved hours from another organisation", async () => {
    await approveSheet("2026-10-01", "2026-10-31", { "2026-10-06": { minutes: 120 } });
    const deps = p.co.h.deps;
    const other = await seedOrg(deps);
    const owner = await clientAs(p.app, deps, await seedMember(deps, other.id, { roles: ["owner"] }));
    await setTimesheetApproval(owner, { approval: true, payrollApprovedOnly: true });
    const source = attendanceHoursWorkedSource(deps);
    expect(await source.listApproved(other.id, [p.co.e.crew], "2026-10-01", "2026-10-31")).toEqual([]);
  });

  it("asks for review when leave is approved after time was signed off", async () => {
    const { items } = await p.ok<{ items: { id: string; code: string }[] }>(p.owner.get("/api/v1/leave/types"));
    const annual = items.find((item) => item.code === "annual");
    if (!annual) throw new Error("Expected annual leave type");
    const orgId = p.co.h.orgId;
    const employeeId = p.co.e.crew;
    const date = "2026-10-08";
    await approveSheet("2026-10-01", "2026-10-31", { "2026-10-06": { minutes: 120 } });
    const run = await createRun();
    expect((await compute(run)).result.hourly?.minutes).toBe(120);

    // Leave and attendance have separate approval workflows.
    const requestId = p.co.h.deps.ids.newId();
    await t.db.insert(leaveRequests).values({
      id: requestId,
      orgId,
      employeeId,
      leaveTypeId: annual.id,
      startDate: date,
      endDate: date,
      startSession: "full",
      endSession: "full",
      unit: "hours",
      hundredths: 400,
      status: "approved",
      requestedByMembershipId: memberId,
      decidedAt: now,
    });
    await t.db.insert(leaveRequestDays).values({
      id: p.co.h.deps.ids.newId(),
      orgId,
      requestId,
      employeeId,
      leaveTypeId: annual.id,
      date,
      session: "full",
      hundredths: 400,
      leaveYear: 2026,
    });
    await p.ok(p.admin.post(`${api}/${run}/submit`), 409);
    const revised = await compute(run);
    expect(revised.result.issues).toContainEqual(
      expect.objectContaining({ code: "HOURS_MISSING", message: expect.stringMatching(/8 Oct 2026.*leave.*review/i) }),
    );
  });
});
