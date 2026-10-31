import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createLeaveWorld, type LeaveWorld } from "../../testing/leave.ts";
import { type OvertimeClaimStatus, overtimeClaims } from "../db/schema/attendance.ts";
import { attendanceOvertimeSource } from "./outputs.ts";

/** Payroll's OvertimeSource (spec "Payroll overtime feed"). */
describe("attendanceOvertimeSource", () => {
  let w: LeaveWorld;
  const ids: Record<string, string> = {};
  beforeAll(async () => {
    w = await createLeaveWorld();
    const add = async (
      key: string,
      employeeId: string,
      workDate: string,
      status: OvertimeClaimStatus,
      minutes: number,
      approved: number | null,
    ) => {
      ids[key] = w.deps.ids.newId();
      await w.deps.db.insert(overtimeClaims).values({
        id: ids[key] as string,
        orgId: w.orgId,
        employeeId,
        workDate,
        computedMinutes: minutes,
        claimedMinutes: minutes,
        approvedMinutes: approved,
        statutory: true,
        status,
        createdByMembershipId: w.m.staff.membershipId,
      });
    };
    await add("staffNov", w.emp.staff, "2026-11-12", "approved", 90, 90);
    await add("staffNovEnd", w.emp.staff, "2026-11-30", "approved", 60, 45);
    await add("staffDec", w.emp.staff, "2026-12-01", "approved", 60, 60);
    await add("pending", w.emp.newbie, "2026-11-13", "pending", 60, null);
    await add("rejected", w.emp.newbie, "2026-11-14", "rejected", 60, null);
    await add("otherOct", w.emp.other, "2026-10-31", "approved", 30, 30);
  });
  afterAll(() => w.close());

  it("lists approved claims dated in the period, with stable ids and approved minutes", async () => {
    const source = attendanceOvertimeSource(w.deps);
    const nov = await source.listApproved(w.orgId, "2026-11-01", "2026-11-30");
    expect(nov).toEqual([
      {
        sourceId: ids.staffNov,
        employeeId: w.emp.staff,
        minutes: 90,
        periodStart: "2026-11-12",
        periodEnd: "2026-11-12",
      },
      {
        sourceId: ids.staffNovEnd,
        employeeId: w.emp.staff,
        minutes: 45,
        periodStart: "2026-11-30",
        periodEnd: "2026-11-30",
      },
    ]);
    // Same input, same output (idempotent import).
    expect(await source.listApproved(w.orgId, "2026-11-01", "2026-11-30")).toEqual(nov);
    expect((await source.listApproved(w.orgId, "2026-10-31", "2026-10-31")).map((o) => o.sourceId)).toEqual([
      ids.otherOct,
    ]);
  });

  it("never returns another organisation's OT", async () => {
    const source = attendanceOvertimeSource(w.deps);
    expect(await source.listApproved(w.deps.ids.newId(), "2026-01-01", "2026-12-31")).toEqual([]);
  });

  it("the HTTP feed is for payroll admins and owners only", async () => {
    const path = "/api/v1/attendance/payroll-overtime?periodStart=2026-11-01&periodEnd=2026-11-30";
    expect((await (await w.as("payroll")).get(path)).status).toBe(200);
    expect((await (await w.as("owner")).get(path)).status).toBe(200);
    expect((await (await w.as("hr")).get(path)).status).toBe(403);
    expect((await (await w.as("manager")).get(path)).status).toBe(403);
  });
});
