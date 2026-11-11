import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createLeaveWorld, type LeaveWorld } from "../../testing/leave.ts";
import { leaveChildren, leaveEncashments, leaveLedger, leaveRequestDays, leaveRequests } from "../db/schema/leave.ts";
import { balancesFor, loadBalanceFacts } from "./balances.ts";
import { loadEmployeesTime, loadEmployeeTime } from "./calendar.ts";
import { listTypes } from "./service.ts";

/**
 * `loadBalanceFacts` (the balances report and screen) must give exactly the balances of the
 * per-employee queries: carry-forward with expiry, adjustments, taken and restored days, pending
 * requests, pending encashments, per-child types across years, the outpatient/hospitalisation
 * pool and no-pay months excluded from service.
 */
describe("batched leave balances", () => {
  let w: LeaveWorld;
  beforeEach(async () => {
    w = await createLeaveWorld();
  });
  afterEach(() => w.close());

  it("equal the per-employee queries for every employee, year and type", async () => {
    const db = w.deps.db;
    const types = await listTypes(w.deps, w.orgId);
    const typeId = (code: string) => types.find((t) => t.code === code)?.id as string;
    const staff = await w.as("staff");
    const pdf = { filename: "mc.pdf", contentType: "application/pdf", dataBase64: btoa("%PDF-1.4\n%fake mc\n") };
    const apply = async (
      c: Awaited<ReturnType<LeaveWorld["as"]>>,
      code: string,
      startDate: string,
      endDate = startDate,
    ) => {
      const res = await c.post("/api/v1/leave/requests", {
        leaveTypeId: typeId(code),
        startDate,
        endDate,
        ...(code === "sick_outpatient" ? { attachments: [pdf] } : {}),
      });
      expect(res.status, await res.clone().text()).toBe(201);
    };
    await apply(staff, "annual", "2026-11-10", "2026-11-11");
    await apply(staff, "sick_outpatient", "2026-11-17");
    await apply(await w.as("newbie"), "annual", "2026-12-30", "2027-01-05");
    const ledger = (
      employeeId: string,
      code: string,
      kind: (typeof leaveLedger.$inferInsert)["kind"],
      hundredths: number,
      leaveYear = 2026,
      extra: Partial<typeof leaveLedger.$inferInsert> = {},
    ) => ({
      id: w.deps.ids.newId(),
      orgId: w.orgId,
      employeeId,
      leaveTypeId: typeId(code),
      leaveYear,
      kind,
      unit: "days" as const,
      hundredths,
      ...extra,
    });
    const childId = w.deps.ids.newId();
    await db.insert(leaveChildren).values({
      id: childId,
      orgId: w.orgId,
      employeeId: w.emp.manager,
      name: "Wong Xin Yi",
      birthDate: "2022-04-01",
      isCitizen: true,
      birthOrder: 1,
    });
    await db
      .insert(leaveLedger)
      .values([
        ledger(w.emp.staff, "annual", "carry_forward", 500, 2026, { expiresOn: "2026-06-30" }),
        ledger(w.emp.staff, "annual", "carry_forward", 150, 2026, { expiresOn: "2026-12-31" }),
        ledger(w.emp.staff, "annual", "expiry", -200),
        ledger(w.emp.staff, "annual", "adjustment", 100),
        ledger(w.emp.staff, "annual", "taken", -300),
        ledger(w.emp.staff, "annual", "restored", 100),
        ledger(w.emp.staff, "annual", "taken", -400, 2025),
        ledger(w.emp.staff, "hospitalisation", "taken", -200),
        ledger(w.emp.staff, "sick_outpatient", "taken", -300),
        ledger(w.emp.manager, "childcare", "taken", -200, 2025, { childId }),
        ledger(w.emp.manager, "childcare", "taken", -100, 2026, { childId }),
        ledger(w.emp.other, "annual", "forfeit", -100),
      ]);
    await db.insert(leaveEncashments).values({
      id: w.deps.ids.newId(),
      orgId: w.orgId,
      employeeId: w.emp.other,
      leaveTypeId: typeId("annual"),
      leaveYear: 2026,
      unit: "days",
      hundredths: 150,
      amountCents: 12_000,
      rateText: "S$80.00 a day",
      rateDate: "2026-10-31",
      status: "pending",
      requestedByMembershipId: w.m.other.membershipId,
    });
    // Approved no-pay leave for every working day of August 2026: a whole month out of the newbie's
    // first-year service, so their pro-rated annual leave drops.
    const newbieAnnual = async () =>
      (await balancesFor(db, await loadEmployeeTime(db, w.orgId, w.emp.newbie), types, 2026, "2026-10-31")).find(
        (b) => b.code === "annual",
      )?.entitlement;
    const fullService = await newbieAnnual();
    const noPay = w.deps.ids.newId();
    await db.insert(leaveRequests).values({
      id: noPay,
      orgId: w.orgId,
      employeeId: w.emp.newbie,
      leaveTypeId: typeId("no_pay"),
      startDate: "2026-08-03",
      endDate: "2026-08-31",
      startSession: "full",
      endSession: "full",
      unit: "days",
      hundredths: 2100,
      status: "approved",
      requestedByMembershipId: w.m.newbie.membershipId,
    });
    const days: (typeof leaveRequestDays.$inferInsert)[] = [];
    for (let d = 1; d <= 31; d++) {
      const date = `2026-08-${String(d).padStart(2, "0")}`;
      const dow = new Date(`${date}T00:00:00Z`).getUTCDay();
      if (dow === 0 || dow === 6) continue;
      days.push({
        id: w.deps.ids.newId(),
        orgId: w.orgId,
        requestId: noPay,
        employeeId: w.emp.newbie,
        leaveTypeId: typeId("no_pay"),
        date,
        session: "full",
        hundredths: 100,
        leaveYear: 2026,
      });
    }
    await db.insert(leaveRequestDays).values(days);
    expect(await newbieAnnual()).toBeLessThan(fullService as number);

    const ids = Object.values(w.emp);
    const times = await loadEmployeesTime(db, w.orgId, ids);
    let compared = 0;
    for (const [year, asOf] of [
      [2026, "2026-10-31"],
      [2026, "2026-04-15"],
      [2025, "2026-01-01"],
      [2027, "2027-01-01"],
    ] as const) {
      const facts = await loadBalanceFacts(db, w.orgId, ids, year, asOf);
      for (const t of times.values()) {
        const direct = await balancesFor(db, t, types, year, asOf);
        const batched = await balancesFor(db, t, types, year, asOf, facts);
        expect(batched, `${t.employeeId} ${year} ${asOf}`).toEqual(direct);
        compared += direct.length;
      }
    }
    expect(compared).toBeGreaterThan(100);
    // The data above is visible in the balances (so the comparison is not of empty rows).
    const facts = await loadBalanceFacts(db, w.orgId, ids, 2026, "2026-10-31");
    const staffAnnual = (
      await balancesFor(db, await loadEmployeeTime(db, w.orgId, w.emp.staff), types, 2026, "2026-10-31", facts)
    ).find((b) => b.code === "annual");
    expect(staffAnnual).toMatchObject({
      carriedForward: 650,
      expired: 200,
      adjustments: 100,
      taken: 200,
      pending: 200,
    });
    expect(staffAnnual?.carryExpiresOn).toBe("2026-12-31");
    const otherAnnual = (
      await balancesFor(db, await loadEmployeeTime(db, w.orgId, w.emp.other), types, 2026, "2026-10-31", facts)
    ).find((b) => b.code === "annual");
    expect(otherAnnual).toMatchObject({ pending: 150, expired: 100 });
    const childcare = (
      await balancesFor(db, await loadEmployeeTime(db, w.orgId, w.emp.manager), types, 2026, "2026-10-31", facts)
    ).find((b) => b.code === "childcare");
    expect(childcare).toMatchObject({ taken: 100 });
  });

  it("answers for nobody without querying", async () => {
    const facts = await loadBalanceFacts(w.deps.db, w.orgId, [], 2026, "2026-10-31");
    expect(facts.covers(w.emp.staff, 2026)).toBe(false);
  });
});
