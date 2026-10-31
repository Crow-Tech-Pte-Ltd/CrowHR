import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createLeaveWorld, type LeaveWorld } from "../../testing/leave.ts";
import { attendancePunches } from "../db/schema/attendance.ts";
import { leaveRequestDays, leaveRequests, leaveTypes } from "../db/schema/leave.ts";
import { departments } from "../db/schema/organisation.ts";
import { buildActor } from "../employees/access.ts";
import { ctxFor, hire } from "../employees/lifecycle.ts";
import { defaultPeoplePorts } from "../employees/ports.ts";
import { ensureLeaveSetup } from "../leave/defaults.ts";
import { createWorkSchedule } from "../organisation/work-schedules.ts";
import { hirePayload } from "../testing/people-harness.ts";
import { attendanceDaysWorkedSource } from "./outputs.ts";

/** Days worked for rostered staff, for payroll's incomplete-month formula (EA s 20A). */
describe("attendanceDaysWorkedSource", () => {
  let w: LeaveWorld;
  let rostered: string;
  let idle: string;
  beforeAll(async () => {
    w = await createLeaveWorld();
    const ports = defaultPeoplePorts(w.deps);
    const owner = buildActor({
      db: w.deps.db,
      orgId: w.orgId,
      userId: w.m.owner.userId,
      requestId: null,
      roles: ["owner"],
      employeeId: null,
      today: "2026-10-31",
    });
    const shift = await createWorkSchedule(w.deps, ports, owner, {
      name: "Outlet roster",
      kind: "shift",
      weeklyMinutes: 44 * 60,
    });
    const [dept] = await w.deps.db.select().from(departments);
    const structure = {
      departments: { sales: dept?.id, ops: dept?.id, finance: dept?.id },
      scheduleId: shift.id,
      locationId: null,
    };
    const hireShift = async (name: string) =>
      (
        await hire(
          ctxFor(w.deps, ports, owner),
          hirePayload(structure as never, {
            person: { legalName: name },
            job: { hireDate: "2025-03-03", jobTitle: "Crew", workScheduleId: shift.id, locationId: null },
          }),
        )
      ).employeeId;
    rostered = await hireShift("Lee Wei Ming");
    idle = await hireShift("Ong Hui Min");
    const at = (iso: string) => new Date(iso);
    const add = async (employeeId: string, date: string, kind: "in" | "out", time: string) => {
      const t = at(`${date}T${time}:00+08:00`);
      await w.deps.db.insert(attendancePunches).values({
        id: w.deps.ids.newId(),
        orgId: w.orgId,
        employeeId,
        kind,
        idempotencyKey: `${employeeId}-${date}-${kind}`,
        source: "web",
        deviceTime: t,
        sentAt: t,
        serverTime: t,
        recordedAt: t,
        workDate: date,
        skewSeconds: 0,
      });
    };
    for (const d of ["2026-11-02", "2026-11-03", "2026-11-04"]) {
      await add(rostered, d, "in", "09:00");
      await add(rostered, d, "out", "18:00");
    }
    // An office (fixed-week) employee who clocks in is not listed: payroll counts their days itself.
    await add(w.emp.staff, "2026-11-02", "in", "09:00");
    // Half a day of paid annual leave on 5 Nov, and a no-pay day on 6 Nov (excluded).
    await ensureLeaveSetup(w.deps, w.orgId);
    const types = await w.deps.db.select().from(leaveTypes);
    const leave = async (code: string, date: string, hundredths: number) => {
      const type = types.find((t) => t.code === code && t.orgId === w.orgId);
      const id = w.deps.ids.newId();
      await w.deps.db.insert(leaveRequests).values({
        id,
        orgId: w.orgId,
        employeeId: rostered,
        leaveTypeId: type?.id as string,
        startDate: date,
        endDate: date,
        startSession: hundredths === 50 ? "am" : "full",
        endSession: hundredths === 50 ? "am" : "full",
        unit: "days",
        hundredths,
        status: "approved",
        requestedByMembershipId: w.m.owner.membershipId,
      });
      await w.deps.db.insert(leaveRequestDays).values({
        id: w.deps.ids.newId(),
        orgId: w.orgId,
        requestId: id,
        employeeId: rostered,
        leaveTypeId: type?.id as string,
        date,
        session: hundredths === 50 ? "am" : "full",
        hundredths,
        leaveYear: 2026,
      });
    };
    await leave("annual", "2026-11-05", 50);
    await leave("no_pay", "2026-11-06", 100);
  });
  afterAll(() => w.close());

  it("counts worked days, public holidays and paid leave; only rostered staff who clock in", async () => {
    const rows = await attendanceDaysWorkedSource(w.deps).listDaysWorked(w.orgId, "2026-11-01", "2026-11-30");
    expect(rows).toEqual([
      {
        sourceId: `days-worked:${rostered}:2026-11-01:2026-11-30`,
        employeeId: rostered,
        // 3 worked + Deepavali (8 Nov) + half a day of annual leave.
        daysWorked: 4.5,
        periodStart: "2026-11-01",
        periodEnd: "2026-11-30",
      },
    ]);
    expect(rows.some((r) => r.employeeId === idle || r.employeeId === w.emp.staff)).toBe(false);
    expect(await attendanceDaysWorkedSource(w.deps).listDaysWorked(w.orgId, "2026-12-01", "2026-12-31")).toEqual([]);
  });
});
