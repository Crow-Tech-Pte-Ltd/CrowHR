import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { TestClient } from "../../testing/http.ts";
import { createLeaveWorld, type LeaveWorld } from "../../testing/leave.ts";
import { leaveLedger, leaveYearClosings } from "../db/schema/leave.ts";
import { tick } from "../jobs/tick.ts";

/** Year-end carry-forward, forfeit and expiry on the workflows tick (spec "Year-end processing"). */
describe("leave year end", () => {
  let w: LeaveWorld;
  beforeEach(async () => {
    w = await createLeaveWorld();
  });
  afterEach(() => w.close());

  const annualOf = async (c: TestClient, year?: number) => {
    const b = (await (await c.get(`/api/v1/leave/balances${year ? `?year=${year}` : ""}`)).json()) as {
      items: {
        code: string;
        available: number;
        carriedForward: number;
        expired: number;
        carryExpiresOn: string | null;
      }[];
    };
    return b.items.find((x) => x.code === "annual");
  };
  const ledger = (employeeId: string) =>
    w.deps.db
      .select()
      .from(leaveLedger)
      .where(and(eq(leaveLedger.orgId, w.orgId), eq(leaveLedger.employeeId, employeeId)));

  it("does not close a year the organisation didn't use Crow HR leave in", async () => {
    await (await w.as("staff")).get("/api/v1/leave/types");
    await tick(w.deps, w.clock.now());
    expect(await w.deps.db.select().from(leaveYearClosings)).toEqual([]);
  });

  it("carries up to the cap, forfeits the rest, keeps the Part 4 floor, expires carried days first, once", async () => {
    const hr = await w.as("hr");
    const policies = (await (await hr.get("/api/v1/leave/policies")).json()) as {
      items: { id: string; code: string; policy: Record<string, unknown> }[];
    };
    const annual = policies.items.find((p) => p.code === "annual");
    const patch = await hr.patch(`/api/v1/leave/policies/${annual?.id}`, {
      policy: { ...annual?.policy, carryForward: { maxDays: 5, expiresAfterMonths: 3 } },
    });
    expect(patch.status).toBe(200);

    // 1 Jan 2027: close 2026.
    w.clock.set("2027-01-01T01:00:00.000Z");
    const report = await tick(w.deps, w.clock.now());
    expect(report.errors).toEqual([]);
    expect(report.transitions.leave_year_end).toBeGreaterThanOrEqual(1);

    // Manager (S$4,000, not Part 4; service year 6 in 2026, 7 in 2027): 12 days unused → 5 carried, 7 forfeited.
    const mgr = await ledger(w.emp.manager);
    expect(mgr.map((l) => [l.leaveYear, l.kind, l.hundredths]).sort()).toEqual(
      [
        [2026, "carry_forward", -500],
        [2026, "forfeit", -700],
        [2027, "carry_forward", 500],
      ].sort(),
    );
    expect(mgr.find((l) => l.hundredths === 500)?.expiresOn).toBe("2027-04-01");
    // Staff (S$2,400 non-workman: Part 4): all 9 unused statutory days carry, despite the 5-day cap.
    const staffRows = await ledger(w.emp.staff);
    expect(staffRows.find((l) => l.leaveYear === 2027 && l.kind === "carry_forward")?.hundredths).toBe(900);
    expect(staffRows.some((l) => l.kind === "forfeit")).toBe(false);

    const manager = await w.as("manager");
    expect(await annualOf(manager)).toMatchObject({ carriedForward: 5, available: 18, carryExpiresOn: "2027-04-01" });
    expect(await annualOf(manager, 2026)).toMatchObject({ available: 0 });

    // Takes 3 days in February (approved by HR: no manager above him).
    w.clock.set("2027-01-15T01:00:00.000Z");
    const m2 = await w.as("manager");
    const types = (await (await m2.get("/api/v1/leave/types")).json()) as { items: { id: string; code: string }[] };
    const req = await m2.post("/api/v1/leave/requests", {
      leaveTypeId: types.items.find((t) => t.code === "annual")?.id,
      startDate: "2027-02-15",
      endDate: "2027-02-17",
    });
    expect(req.status).toBe(201);
    const hr2 = await w.as("hr");
    const tasks = (await (await hr2.get("/api/v1/approvals/tasks")).json()) as { items: { taskId: string }[] };
    expect(
      (await hr2.post(`/api/v1/approvals/tasks/${tasks.items[0]?.taskId}/decision`, { decision: "approve" })).status,
    ).toBe(200);

    // 1 Apr 2027: 5 carried − 3 taken = 2 expire. Running again changes nothing.
    w.clock.set("2027-04-01T01:00:00.000Z");
    await tick(w.deps, w.clock.now());
    await tick(w.deps, w.clock.now());
    const expiry = (await ledger(w.emp.manager)).filter((l) => l.kind === "expiry");
    expect(expiry.map((l) => l.hundredths)).toEqual([-200]);
    const after = await annualOf(await w.as("manager"));
    expect(after).toMatchObject({ carriedForward: 5, expired: 2, available: 13 });
    expect(await w.deps.db.select().from(leaveYearClosings)).toHaveLength(1);
  });

  it("expires last year's carry before closing that year, and keeps Part IV carry for 12 months", async () => {
    const hr = await w.as("hr");
    const policies = (await (await hr.get("/api/v1/leave/policies")).json()) as {
      items: { id: string; code: string; policy: Record<string, unknown> }[];
    };
    const annual = policies.items.find((p) => p.code === "annual");
    if (!annual) throw new Error("Annual leave policy missing");
    await hr.patch(`/api/v1/leave/policies/${annual.id}`, {
      policy: { ...annual.policy, carryForward: { maxDays: 5, expiresAfterMonths: 3 } },
    });
    w.clock.set("2027-01-01T01:00:00Z");
    await tick(w.deps, w.clock.now());
    const staff = await ledger(w.emp.staff);
    expect(staff.find((l) => l.leaveYear === 2027 && l.hundredths > 0)?.expiresOn).toBe("2028-01-01");
    // No ticks for a year: carry that expired during 2027 must not be re-carried into 2028.
    w.clock.set("2028-01-01T01:00:00Z");
    const result = await tick(w.deps, w.clock.now());
    expect(result.errors).toEqual([]);
    const manager = await ledger(w.emp.manager);
    expect(manager.find((l) => l.kind === "expiry" && l.leaveYear === 2027)?.hundredths).toBe(-500);
    // 2027 has 13 days entitlement; 5 carry and 8 forfeit. The old five are already expired.
    expect(manager.find((l) => l.kind === "forfeit" && l.leaveYear === 2027)?.hundredths).toBe(-800);
  });

  it("marks the excess for encashment when the policy allows", async () => {
    const hr = await w.as("hr");
    const policies = (await (await hr.get("/api/v1/leave/policies")).json()) as {
      items: { id: string; code: string; policy: Record<string, unknown> }[];
    };
    const annual = policies.items.find((p) => p.code === "annual");
    await hr.patch(`/api/v1/leave/policies/${annual?.id}`, {
      policy: { ...annual?.policy, carryForward: { maxDays: 2, expiresAfterMonths: null }, encashable: true },
    });
    w.clock.set("2027-01-01T01:00:00.000Z");
    await tick(w.deps, w.clock.now());
    const rows = await ledger(w.emp.manager);
    expect(rows.find((l) => l.kind === "encashment")?.hundredths).toBe(-1000);
    expect(rows.find((l) => l.leaveYear === 2027 && l.kind === "carry_forward")?.expiresOn).toBeNull();
  });

  it("carry that never expires by policy doesn't expire for Part 4 staff either", async () => {
    const hr = await w.as("hr");
    const policies = (await (await hr.get("/api/v1/leave/policies")).json()) as {
      items: { id: string; code: string; policy: Record<string, unknown> }[];
    };
    const annual = policies.items.find((p) => p.code === "annual");
    const res = await hr.patch(`/api/v1/leave/policies/${annual?.id}`, {
      policy: { ...annual?.policy, carryForward: { maxDays: null, expiresAfterMonths: null } },
    });
    expect(res.status, await res.clone().text()).toBe(200);
    w.clock.set("2027-01-01T01:00:00.000Z");
    await tick(w.deps, w.clock.now());
    // Ravi (S$2,400, Part 4) and the manager (not Part 4): both carries are open-ended.
    for (const employee of [w.emp.staff, w.emp.manager]) {
      const carry = (await ledger(employee)).find((l) => l.leaveYear === 2027 && l.kind === "carry_forward");
      expect(carry?.hundredths, employee).toBeGreaterThan(0);
      expect(carry?.expiresOn, employee).toBeNull();
    }
  });
});
