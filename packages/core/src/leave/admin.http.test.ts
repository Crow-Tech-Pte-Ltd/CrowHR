import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { TestClient } from "../../testing/http.ts";
import { createLeaveWorld, type LeaveWorld } from "../../testing/leave.ts";
import { auditEvents } from "../db/schema/audit.ts";

/** Settings → Leave policies, holidays, settings and balance adjustments. */
describe("leave administration", () => {
  let w: LeaveWorld;
  beforeEach(async () => {
    w = await createLeaveWorld();
  });
  afterEach(() => w.close());

  const policies = async (c: TestClient) =>
    (
      (await (await c.get("/api/v1/leave/policies")).json()) as {
        items: { id: string; code: string; kind: string; policy: Record<string, unknown>; archived: boolean }[];
      }
    ).items;
  const audits = (action: string) =>
    w.deps.db
      .select()
      .from(auditEvents)
      .where(and(eq(auditEvents.orgId, w.orgId), eq(auditEvents.action, action)));

  it("policies are preconfigured, editable above the statutory floor only", async () => {
    const hr = await w.as("hr");
    const items = await policies(hr);
    const annual = items.find((p) => p.code === "annual");
    expect(annual).toMatchObject({
      kind: "statutory",
      policy: { entitlement: { basis: "statutory" }, minServiceMonths: 3 },
    });
    const low = await hr.patch(`/api/v1/leave/policies/${annual?.id}`, {
      policy: { ...annual?.policy, entitlement: { basis: "fixed", days: 5 } },
    });
    expect(low.status).toBe(422);
    const err = (await low.json()) as { error: { code: string; message: string } };
    expect(err.error).toMatchObject({ code: "below_statutory" });
    expect(err.error.message).toMatch(/at least 7 days/);
    const generous = await hr.patch(`/api/v1/leave/policies/${annual?.id}`, {
      policy: {
        ...annual?.policy,
        entitlement: {
          basis: "by_service",
          steps: [
            { fromServiceYear: 1, days: 14 },
            { fromServiceYear: 5, days: 18 },
          ],
        },
      },
    });
    expect(generous.status).toBe(200);
    const staff = await w.as("staff");
    const b = (await (await staff.get("/api/v1/leave/balances")).json()) as {
      items: { code: string; available: number }[];
    };
    expect(b.items.find((x) => x.code === "annual")?.available).toBe(14);
    expect(await audits("leave.policy_updated")).toHaveLength(1);
    // Statutory types can't be archived; employees and managers can't read or edit policies.
    expect((await hr.post(`/api/v1/leave/policies/${annual?.id}/archive`, { archived: true })).status).toBe(422);
    expect((await staff.get("/api/v1/leave/policies")).status).toBe(403);
    expect((await (await w.as("manager")).patch(`/api/v1/leave/policies/${annual?.id}`, { name: "x" })).status).toBe(
      403,
    );
  });

  it("company types: create, apply, archive", async () => {
    const hr = await w.as("hr");
    const res = await hr.post("/api/v1/leave/policies", {
      code: "birthday",
      name: "Birthday leave",
      policy: {
        entitlement: { basis: "fixed", days: 1 },
        minServiceMonths: 0,
        prorate: false,
        accrual: "upfront",
        carryForward: null,
        encashable: false,
      },
    });
    expect(res.status, await res.clone().text()).toBe(201);
    const created = (await res.json()) as { id: string; kind: string };
    expect(created.kind).toBe("company");
    const again = await hr.post("/api/v1/leave/policies", {
      code: "birthday",
      name: "Again",
      policy: {
        entitlement: { basis: "fixed", days: 1 },
        minServiceMonths: 0,
        prorate: false,
        accrual: "upfront",
        carryForward: null,
        encashable: false,
      },
    });
    expect(again.status).toBe(409);
    const newbie = await w.as("newbie");
    const apply = await newbie.post("/api/v1/leave/requests", {
      leaveTypeId: created.id,
      startDate: "2026-11-11",
      endDate: "2026-11-11",
    });
    expect(apply.status).toBe(201);
    expect((await hr.post(`/api/v1/leave/policies/${created.id}/archive`, { archived: true })).status).toBe(200);
    const types = (await (await newbie.get("/api/v1/leave/types")).json()) as { items: { code: string }[] };
    expect(types.items.some((t) => t.code === "birthday")).toBe(false);
  });

  it("ad-hoc holidays change the count; settings change the off-day rule", async () => {
    const hr = await w.as("hr");
    const staff = await w.as("staff");
    const types = (await (await staff.get("/api/v1/leave/types")).json()) as { items: { id: string; code: string }[] };
    const annual = types.items.find((t) => t.code === "annual")?.id;
    const quote = async (startDate: string, endDate: string) =>
      (
        (await (await staff.post("/api/v1/leave/quote", { leaveTypeId: annual, startDate, endDate })).json()) as {
          quantity: number;
        }
      ).quantity;
    expect(await quote("2026-12-23", "2026-12-24")).toBe(2);
    const add = await hr.post("/api/v1/leave/holidays", { date: "2026-12-24", name: "Polling Day" });
    expect(add.status).toBe(201);
    const holidayId = ((await add.json()) as { id: string }).id;
    expect(await quote("2026-12-23", "2026-12-24")).toBe(1);
    expect((await hr.post("/api/v1/leave/holidays", { date: "2026-12-24", name: "Twice" })).status).toBe(409);
    const list = (await (await staff.get("/api/v1/leave/holidays?year=2026")).json()) as {
      items: { date: string; name: string; source: string }[];
    };
    expect(list.items).toHaveLength(12);
    expect(list.items.find((h) => h.date === "2026-12-24")).toMatchObject({ source: "organisation" });
    expect((await hr.delete(`/api/v1/leave/holidays/${holidayId}`)).status).toBe(204);
    expect(await quote("2026-12-23", "2026-12-24")).toBe(2);

    // Saturday Hari Raya Puasa: the next working day off when the org chooses.
    expect(await quote("2026-03-23", "2026-03-23")).toBe(1);
    const settings = (await (await hr.get("/api/v1/leave/settings")).json()) as Record<string, unknown>;
    expect(settings).toEqual({
      offDayHoliday: "extra_pay",
      unpaidServiceRule: "whole_month",
      fullTimeScheduleId: null,
    });
    expect((await hr.put("/api/v1/leave/settings", { ...settings, offDayHoliday: "next_working_day" })).status).toBe(
      200,
    );
    expect(await quote("2026-03-23", "2026-03-23")).toBe(0);
  });

  it("balance adjustments are audited; nobody adjusts their own; managers can't", async () => {
    const hr = await w.as("hr");
    const types = (await (await hr.get("/api/v1/leave/types")).json()) as { items: { id: string; code: string }[] };
    const annual = types.items.find((t) => t.code === "annual")?.id;
    const res = await hr.post("/api/v1/leave/adjustments", {
      employeeId: w.emp.staff,
      leaveTypeId: annual,
      year: 2026,
      amount: 1.5,
      reason: "Long service award",
    });
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ quantity: 1.5, unit: "days" });
    const staff = await w.as("staff");
    const b = (await (await staff.get("/api/v1/leave/balances")).json()) as {
      items: { code: string; available: number; adjustments: number }[];
    };
    expect(b.items.find((x) => x.code === "annual")).toMatchObject({ available: 10.5, adjustments: 1.5 });
    const [event] = await audits("leave.balance_adjusted");
    expect(event?.meta).toMatchObject({ amount: 1.5, reason: "Long service award", type: "annual" });
    const own = await hr.post("/api/v1/leave/adjustments", {
      employeeId: w.emp.hr,
      leaveTypeId: annual,
      year: 2026,
      amount: 1,
      reason: "Treat myself",
    });
    expect(own.status).toBe(403);
    expect(((await own.json()) as { error: { code: string } }).error.code).toBe("self_change_requires_approval");
    const manager = await w.as("manager");
    expect(
      (
        await manager.post("/api/v1/leave/adjustments", {
          employeeId: w.emp.staff,
          leaveTypeId: annual,
          year: 2026,
          amount: 1,
          reason: "Nice",
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await hr.post("/api/v1/leave/adjustments", {
          employeeId: w.emp.staff,
          leaveTypeId: annual,
          year: 2026,
          amount: 0.3,
          reason: "Odd",
        })
      ).status,
    ).toBe(400);
    // A per-child type is counted per child: an adjustment without one would change nothing.
    const paternity = types.items.find((t) => t.code === "paternity")?.id;
    const noChild = await hr.post("/api/v1/leave/adjustments", {
      employeeId: w.emp.staff,
      leaveTypeId: paternity,
      year: 2026,
      amount: 5,
      reason: "Extra week",
    });
    expect(noChild.status).toBe(400);
    expect(
      ((await noChild.json()) as { error: { details: { issues: { path: string }[] } } }).error.details.issues,
    ).toEqual([expect.objectContaining({ path: "childId" })]);
  });

  it("children: employees add their own; HR for anyone; colleagues can't", async () => {
    const staff = await w.as("staff");
    const add = await staff.post("/api/v1/leave/children", {
      name: "Arjun",
      birthDate: "2022-03-03",
      isCitizen: true,
      birthOrder: 1,
    });
    expect(add.status).toBe(201);
    const id = ((await add.json()) as { id: string }).id;
    expect(
      (await staff.post("/api/v1/leave/children", { name: "No date", isCitizen: true, birthOrder: 2 })).status,
    ).toBe(400);
    const hr = await w.as("hr");
    const upd = await hr.put(`/api/v1/leave/children/${id}`, {
      name: "Arjun K",
      birthDate: "2022-03-03",
      isCitizen: true,
      birthOrder: 1,
    });
    expect(upd.status).toBe(200);
    const other = await w.as("other");
    expect((await other.get(`/api/v1/leave/children?employeeId=${w.emp.staff}`)).status).toBe(404);
    expect(
      (
        await other.post("/api/v1/leave/children", {
          employeeId: w.emp.staff,
          name: "X",
          birthDate: "2022-01-01",
          isCitizen: true,
          birthOrder: 1,
        })
      ).status,
    ).toBe(404);
    const b = (await (await staff.get("/api/v1/leave/balances")).json()) as {
      items: { code: string; available: number }[];
    };
    expect(b.items.find((x) => x.code === "childcare")?.available).toBe(6);
  });
});
