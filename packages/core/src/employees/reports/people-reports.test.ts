import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createLeaveWorld, type LeaveWorld } from "../../../testing/leave.ts";
import { leaverCategory, tenthsOfPercent, turnoverTenths } from "./source.ts";

/** People report formulas and the work-pass expiry list (add-reporting tasks 3.1–3.3). */
describe("people report formulas", () => {
  it("turnover: 40 at the start, 44 at the end, 6 leavers → 14.3%", () => {
    expect(turnoverTenths(6, 40, 44)).toBe(143);
    expect(turnoverTenths(0, 0, 0)).toBeNull();
    expect(turnoverTenths(1, 0, 1)).toBe(2000);
    // Half-up at the boundary: 1 ÷ 8 × 100 = 12.5 exactly (avg 8 from 8 + 8).
    expect(turnoverTenths(1, 8, 8)).toBe(125);
    // 1 ÷ 6 × 100 = 16.666… → 16.7.
    expect(turnoverTenths(1, 6, 6)).toBe(167);
  });

  it("percent of total to 1 decimal place, half-up", () => {
    expect(tenthsOfPercent(1, 7)).toBe(143);
    expect(tenthsOfPercent(6, 7)).toBe(857);
    expect(tenthsOfPercent(1, 8)).toBe(125);
    expect(tenthsOfPercent(1, 0)).toBeNull();
  });

  it("splits leavers into voluntary, involuntary and other", () => {
    expect(leaverCategory("resignation")).toBe("voluntary");
    expect(leaverCategory("retirement")).toBe("voluntary");
    expect(leaverCategory("dismissal")).toBe("involuntary");
    expect(leaverCategory("retrenchment")).toBe("involuntary");
    expect(leaverCategory("contract_end")).toBe("involuntary");
    expect(leaverCategory("death")).toBe("other");
    expect(leaverCategory("mutual_agreement")).toBe("other");
    expect(leaverCategory(null)).toBe("other");
  });
});

describe("work pass expiry report", () => {
  let w: LeaveWorld;
  beforeAll(async () => {
    w = await createLeaveWorld({ now: "2026-10-31T01:00:00.000Z" });
    const hr = await w.as("hr");
    const add = async (emp: string, passType: string, expiresOn: string, passNumber: string) => {
      const res = await hr.post(`/api/v1/employees/${emp}/work-passes`, {
        passType,
        passNumber,
        issuedOn: "2024-01-02",
        expiresOn,
      });
      expect(res.status, await res.clone().text()).toBe(201);
    };
    await add(w.emp.satRest, "WP", "2026-10-20", "G1234567X");
    await add(w.emp.partTimer, "S_PASS", "2026-11-30", "G7654321N");
    // Renewed: the old pass is not listed, the new one is outside the window.
    await add(w.emp.staff, "S_PASS", "2026-11-05", "G1111111K");
    await add(w.emp.staff, "S_PASS", "2028-11-05", "G2222222L");
  });
  afterAll(() => w.close());

  it("lists current passes soonest first, flags expired and expiring, masks numbers", async () => {
    const body = (await (await (await w.as("hr")).get("/api/v1/reports/people.work_pass_expiry")).json()) as {
      rows: Record<string, unknown>[];
    };
    expect(body.rows.map((r) => [r.name, r.expiresOn, r.daysLeft, r.state])).toEqual([
      ["Ahmad Ismail", "2026-10-20", -11, "Expired"],
      ["Daniel Goh", "2026-11-30", 30, "Expiring"],
    ]);
    expect(String(body.rows[0]?.passNumber)).not.toContain("1234567");
  });

  it("is for owners, hr_admins and payroll_admins only", async () => {
    expect((await (await w.as("owner")).get("/api/v1/reports/people.work_pass_expiry")).status).toBe(200);
    expect((await (await w.as("payroll")).get("/api/v1/reports/people.work_pass_expiry")).status).toBe(200);
    expect((await (await w.as("manager")).get("/api/v1/reports/people.work_pass_expiry")).status).toBe(403);
    // Employees hold work_pass:read for their own pass only: reports never run at own scope.
    expect((await (await w.as("staff")).get("/api/v1/reports/people.work_pass_expiry")).status).toBe(403);
  });
});
