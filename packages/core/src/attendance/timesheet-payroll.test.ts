import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setTimesheetApproval } from "../../testing/attendance.ts";
import { createLeaveWorld, type LeaveWorld } from "../../testing/leave.ts";
import { attendancePunches, attendanceTimesheets, overtimeClaims } from "../db/schema/attendance.ts";
import { departments } from "../db/schema/organisation.ts";
import { buildActor } from "../employees/access.ts";
import { ctxFor, hire } from "../employees/lifecycle.ts";
import { defaultPeoplePorts } from "../employees/ports.ts";
import { createWorkSchedule } from "../organisation/work-schedules.ts";
import { hirePayload } from "../testing/people-harness.ts";
import { attendanceDaysWorkedSource, attendanceOvertimeSource } from "./outputs.ts";

/**
 * Payroll from approved timesheets (add-timesheet-approval spec "Payroll from approved
 * timesheets"): attendance's overtime and days-worked feeds, limited and not limited.
 */
describe("payroll feeds limited to approved timesheets", () => {
  let w: LeaveWorld;
  let crewA: string;
  let crewB: string;
  let claimStaff: string;
  let claimSatRest: string;
  beforeAll(async () => {
    w = await createLeaveWorld({ now: "2026-11-13T02:00:00.000Z" });
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
    crewA = await hireShift("Lee Wei Ming");
    crewB = await hireShift("Ong Hui Min");
    for (const employeeId of [crewA, crewB]) {
      for (const date of ["2026-10-05", "2026-10-06", "2026-10-20"]) {
        for (const [kind, hhmm] of [
          ["in", "09:00"],
          ["out", "18:00"],
        ] as const) {
          const t = new Date(`${date}T${hhmm}:00+08:00`);
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
        }
      }
    }
    const claim = async (employeeId: string, workDate: string) => {
      const id = w.deps.ids.newId();
      await w.deps.db.insert(overtimeClaims).values({
        id,
        orgId: w.orgId,
        employeeId,
        workDate,
        computedMinutes: 90,
        claimedMinutes: 90,
        approvedMinutes: 90,
        statutory: true,
        status: "approved",
        createdByMembershipId: w.m.manager.membershipId,
      });
      return id;
    };
    claimStaff = await claim(w.emp.staff, "2026-10-12");
    claimSatRest = await claim(w.emp.satRest, "2026-10-14");
  });
  afterAll(() => w.close());

  const approvedSheet = (employeeId: string, periodStart: string, periodEnd: string) =>
    w.deps.db.insert(attendanceTimesheets).values({
      id: w.deps.ids.newId(),
      orgId: w.orgId,
      employeeId,
      periodStart,
      periodEnd,
      status: "approved",
      submittedByMembershipId: w.m.manager.membershipId,
      submittedAt: new Date("2026-11-02T02:00:00.000Z"),
      submittedTotals: {
        daysWorked: 3,
        workedMinutes: 1440,
        lateCount: 0,
        lateMinutes: 0,
        earlyOutCount: 0,
        missingPunches: 0,
        otMinutes: 0,
        leaveDays: 0,
      },
      decidedAt: new Date("2026-11-03T02:00:00.000Z"),
    });
  const overtime = () => attendanceOvertimeSource(w.deps).listApproved(w.orgId, "2026-10-01", "2026-10-31");
  const daysWorked = () => attendanceDaysWorkedSource(w.deps).listDaysWorked(w.orgId, "2026-10-01", "2026-10-31");

  it("not limited: both feeds are unchanged by timesheet approval", async () => {
    await setTimesheetApproval(await w.as("hr"), { approval: true });
    expect((await overtime()).map((o) => o.sourceId).sort()).toEqual([claimStaff, claimSatRest].sort());
    expect((await daysWorked()).map((d) => d.employeeId).sort()).toEqual([crewA, crewB].sort());
  });

  it("limited: only what approved timesheets cover; approved later, it is listed", async () => {
    const hr = await w.as("hr");
    await setTimesheetApproval(hr, { approval: true, payrollApprovedOnly: true });
    expect(await overtime()).toEqual([]);
    expect(await daysWorked()).toEqual([]);

    await approvedSheet(w.emp.staff, "2026-10-01", "2026-10-31");
    await approvedSheet(crewA, "2026-10-01", "2026-10-31");
    // Ong Hui Min's first half of October only: the pay period isn't covered.
    await approvedSheet(crewB, "2026-10-01", "2026-10-15");
    expect(await overtime()).toEqual([
      {
        sourceId: claimStaff,
        employeeId: w.emp.staff,
        minutes: 90,
        periodStart: "2026-10-12",
        periodEnd: "2026-10-12",
      },
    ]);
    expect(await daysWorked()).toEqual([
      {
        sourceId: `days-worked:${crewA}:2026-10-01:2026-10-31`,
        employeeId: crewA,
        daysWorked: 3,
        periodStart: "2026-10-01",
        periodEnd: "2026-10-31",
      },
    ]);
    // Payroll reads overtime from the start of time to the period end: November's run picks up
    // October's overtime once its timesheet is approved.
    await approvedSheet(w.emp.satRest, "2026-10-01", "2026-10-31");
    const november = await attendanceOvertimeSource(w.deps).listApproved(w.orgId, "0001-01-01", "2026-11-30");
    expect(november.map((o) => o.sourceId).sort()).toEqual([claimStaff, claimSatRest].sort());
    // The HTTP feed answers the same.
    const feed = (await (
      await (
        await w.as("payroll")
      ).get("/api/v1/attendance/payroll-overtime?periodStart=2026-10-01&periodEnd=2026-10-31")
    ).json()) as { items: { sourceId: string }[] };
    expect(feed.items.map((i) => i.sourceId).sort()).toEqual([claimStaff, claimSatRest].sort());

    // Turning approval off turns the limit off with it.
    await setTimesheetApproval(hr, { approval: false });
    expect((await daysWorked()).map((d) => d.employeeId).sort()).toEqual([crewA, crewB].sort());
  });
});
