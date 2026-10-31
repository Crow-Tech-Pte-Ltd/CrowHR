import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { TestClient } from "../../testing/http.ts";
import { createLeaveWorld, type LeaveWorld } from "../../testing/leave.ts";
import { leaveCalendar, leaveUnpaidSource } from "./outputs.ts";

/** What leave hands to payroll, scheduling and government claims (spec "Payroll and government outputs"). */
describe("leave outputs", () => {
  let w: LeaveWorld;
  beforeEach(async () => {
    w = await createLeaveWorld();
  });
  afterEach(() => w.close());

  const typeId = async (c: TestClient, code: string) =>
    ((await (await c.get("/api/v1/leave/types")).json()) as { items: { id: string; code: string }[] }).items.find(
      (t) => t.code === code,
    )?.id as string;
  const approveAll = async (approver: TestClient) => {
    const tasks = (await (await approver.get("/api/v1/approvals/tasks")).json()) as { items: { taskId: string }[] };
    for (const t of tasks.items) {
      const r = await approver.post(`/api/v1/approvals/tasks/${t.taskId}/decision`, { decision: "approve" });
      expect(r.status, await r.clone().text()).toBe(200);
    }
  };

  it("approved no-pay leave reaches payroll per date in half days", async () => {
    const staff = await w.as("staff");
    const res = await staff.post("/api/v1/leave/requests", {
      leaveTypeId: await typeId(staff, "no_pay"),
      startDate: "2026-11-16",
      endDate: "2026-11-17",
      endSession: "am",
      reason: "Family matter",
    });
    expect(res.status).toBe(201);
    // Pending leave is not fed.
    expect(await leaveUnpaidSource(w.deps).listUnpaid(w.orgId, "2026-11-01", "2026-11-30")).toEqual([]);
    await approveAll(await w.as("manager"));
    const unpaid = await leaveUnpaidSource(w.deps).listUnpaid(w.orgId, "2026-11-01", "2026-11-30");
    expect(unpaid.map((u) => [u.employeeId, u.date, u.days, u.leaveTypeCode])).toEqual([
      [w.emp.staff, "2026-11-16", 1, "no_pay"],
      [w.emp.staff, "2026-11-17", 0.5, "no_pay"],
    ]);
    expect(new Set(unpaid.map((u) => u.sourceId)).size).toBe(2);
    // The same over HTTP, for payroll_admin and owner only.
    const payroll = await w.as("payroll");
    const http = (await (
      await payroll.get("/api/v1/leave/payroll-input?periodStart=2026-11-01&periodEnd=2026-11-30")
    ).json()) as {
      items: { date: string; days: number }[];
    };
    expect(http.items.map((i) => [i.date, i.days])).toEqual([
      ["2026-11-16", 1],
      ["2026-11-17", 0.5],
    ]);
    for (const who of ["staff", "manager", "hr"] as const) {
      const r = await (await w.as(who)).get("/api/v1/leave/payroll-input?periodStart=2026-11-01&periodEnd=2026-11-30");
      expect(r.status, who).toBe(403);
    }
    expect((await leaveUnpaidSource(w.deps).listUnpaid(w.orgId, "2026-12-01", "2026-12-31")).length).toBe(0);

    // Unpaid infant care leave is fed too (per child, child under 2).
    const kid = await staff.post("/api/v1/leave/children", {
      name: "Meera",
      birthDate: "2025-08-01",
      isCitizen: true,
      birthOrder: 1,
    });
    const infant = await staff.post("/api/v1/leave/requests", {
      leaveTypeId: await typeId(staff, "infant_care"),
      startDate: "2026-12-07",
      endDate: "2026-12-07",
      childId: ((await kid.json()) as { id: string }).id,
    });
    expect(infant.status, await infant.clone().text()).toBe(201);
    await approveAll(await w.as("manager"));
    const dec = await leaveUnpaidSource(w.deps).listUnpaid(w.orgId, "2026-12-01", "2026-12-31");
    expect(dec.map((u) => [u.date, u.days, u.leaveTypeCode])).toEqual([["2026-12-07", 1, "infant_care"]]);
  });

  it("LeaveCalendar lists approved and pending days for scheduling", async () => {
    const staff = await w.as("staff");
    await staff.post("/api/v1/leave/requests", {
      leaveTypeId: await typeId(staff, "annual"),
      startDate: "2026-11-10",
      endDate: "2026-11-10",
      startSession: "pm",
    });
    const entries = await leaveCalendar(w.deps).entries(
      w.orgId,
      [w.emp.staff, w.emp.other],
      "2026-11-01",
      "2026-11-30",
    );
    expect(entries).toEqual([{ employeeId: w.emp.staff, date: "2026-11-10", session: "pm", status: "pending" }]);
  });

  it("government-paid report: GPML 1st child splits days 1–40 employer, 41–80 Government; CSV", async () => {
    const farah = await w.as("other");
    const child = await farah.post("/api/v1/leave/children", {
      name: "Nur Iman",
      birthDate: "2026-09-01",
      isCitizen: true,
      birthOrder: 1,
    });
    expect(child.status, await child.clone().text()).toBe(201);
    const childId = ((await child.json()) as { id: string }).id;
    const q = (await (
      await farah.post("/api/v1/leave/quote", {
        leaveTypeId: await typeId(farah, "maternity"),
        startDate: "2026-09-01",
        endDate: "2026-12-21",
        childId,
      })
    ).json()) as { quantity: number; ok: boolean; years: { available: number }[] };
    expect(q).toMatchObject({ quantity: 80, ok: true, years: [{ available: 80 }] });
    const res = await farah.post("/api/v1/leave/requests", {
      leaveTypeId: await typeId(farah, "maternity"),
      startDate: "2026-09-01",
      endDate: "2026-12-21",
      childId,
    });
    expect(res.status, await res.clone().text()).toBe(201);
    // No manager: HR approves.
    await approveAll(await w.as("hr"));
    const hr = await w.as("hr");
    const report = (await (
      await hr.get("/api/v1/leave/reports/government-paid?from=2026-09-01&to=2026-12-31")
    ).json()) as {
      items: Record<string, unknown>[];
    };
    expect(report.items).toEqual([
      expect.objectContaining({
        employeeName: "Farah Hassan",
        scheme: "Government-Paid Maternity Leave",
        child: "Nur Iman",
        days: 80,
        employerDays: 40,
        governmentDays: 40,
        claimBy: "2027-03-21",
      }),
    ]);
    const csv = await hr.get("/api/v1/leave/reports/government-paid.csv?from=2026-09-01&to=2026-12-31");
    expect(csv.headers.get("content-type")).toMatch(/text\/csv/);
    const text = await csv.text();
    expect(text.split("\r\n")[0]).toBe(
      "Employee,Leave type,Scheme,Child,Start,End,Days in period,Employer-paid days,Government-paid days,Unpaid days,Claim by,Claim via",
    );
    expect(text).toMatch(
      /Farah Hassan,Maternity leave,Government-Paid Maternity Leave,Nur Iman,2026-09-01,2026-12-21,80,40,40,0,2027-03-21/,
    );
    // A narrower period counts only its own days, in order within the entitlement.
    const nov = (await (
      await hr.get("/api/v1/leave/reports/government-paid?from=2026-11-01&to=2026-11-30")
    ).json()) as {
      items: { days: number; employerDays: number; governmentDays: number }[];
    };
    expect(nov.items[0]).toMatchObject({ days: 21, employerDays: 0, governmentDays: 21 });
    expect(
      (await (await w.as("manager")).get("/api/v1/leave/reports/government-paid?from=2026-09-01&to=2026-12-31")).status,
    ).toBe(403);
    expect(
      (await (await w.as("payroll")).get("/api/v1/leave/reports/government-paid?from=2026-09-01&to=2026-12-31")).status,
    ).toBe(200);
  });
});
