import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createLeaveWorld, type LeaveWorld } from "../../testing/leave.ts";

/** Security review #18: children records are family data, not part of a manager's leave view. */
let w: LeaveWorld;
beforeAll(async () => {
  w = await createLeaveWorld();
}, 60_000);
afterAll(() => w.close());

describe("GET /leave/children", () => {
  it("a manager can't read a report's children; HR and the employee can", async () => {
    const hr = await w.as("hr");
    const add = await hr.post("/api/v1/leave/children", {
      employeeId: w.emp.staff,
      name: "Baby Ravi",
      birthDate: "2026-09-01",
      isCitizen: true,
      birthOrder: 2,
    });
    expect(add.status).toBe(201);
    const nobody = await hr.post("/api/v1/leave/children", {
      employeeId: w.deps.ids.newId(),
      name: "Nobody's Baby",
      birthDate: "2026-09-01",
      isCitizen: true,
      birthOrder: 1,
    });
    expect(nobody.status).toBe(404);
    const manager = await w.as("manager");
    const res = await manager.get(`/api/v1/leave/children?employeeId=${w.emp.staff}`);
    expect(res.status).toBe(404); // out of scope, like a missing record
    expect(await res.text()).not.toContain("Baby Ravi");

    const byHr = (await (await hr.get(`/api/v1/leave/children?employeeId=${w.emp.staff}`)).json()) as {
      items: { name: string }[];
    };
    expect(byHr.items.map((c) => c.name)).toEqual(["Baby Ravi"]);
    const staff = await w.as("staff");
    const own = (await (await staff.get("/api/v1/leave/children")).json()) as { items: { name: string }[] };
    expect(own.items.map((c) => c.name)).toEqual(["Baby Ravi"]);
  });
  it("a manager gets eligibility without a child's name in leave lists, details or approval summaries", async () => {
    const staff = await w.as("staff");
    const childResponse = await staff.post("/api/v1/leave/children", {
      name: "Private Child",
      birthDate: "2025-08-01",
      isCitizen: true,
      birthOrder: 1,
    });
    expect(childResponse.status).toBe(201);
    const child = await childResponse.json();
    const types = await (await staff.get("/api/v1/leave/types")).json();
    const type = types.items.find((t: { code: string }) => t.code === "infant_care");
    const applied = await staff.post("/api/v1/leave/requests", {
      leaveTypeId: type.id,
      startDate: "2026-12-07",
      endDate: "2026-12-07",
      childId: child.id,
    });
    expect(applied.status).toBe(201);
    const request = await applied.json();
    expect(request.child?.name).toBe("Private Child");
    const manager = await w.as("manager");
    for (const url of [
      "/api/v1/leave/requests",
      `/api/v1/leave/requests/${request.id}`,
      `/api/v1/approvals/requests/${request.approvalRequestId}`,
    ]) {
      const response = await manager.get(url);
      expect(response.status).toBe(200);
      const text = await response.text();
      expect(text).not.toContain("Private Child");
      expect(text).not.toContain(child.id);
    }
    const hr = await w.as("hr");
    expect((await (await hr.get(`/api/v1/leave/requests/${request.id}`)).json()).child?.name).toBe("Private Child");
  });
});
