import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { punch } from "../../testing/attendance.ts";
import { createLeaveWorld, type LeaveWorld } from "../../testing/leave.ts";
import type { AttendancePunch } from "../db/schema/attendance.ts";
import { leaveRequestDays, leaveRequests, leaveTypes } from "../db/schema/leave.ts";
import type { DayInfo } from "../leave/calendar.ts";
import { ensureLeaveSetup } from "../leave/defaults.ts";
import { defaultSettings } from "./settings.ts";
import { computeDay, timesheets, totalsOf } from "./timesheet.ts";

const DATE = "2026-11-12";
const working: DayInfo = {
  date: DATE,
  employed: true,
  scheduleKind: "fixed",
  dayType: "working",
  minutes: 480,
  holiday: null,
};

let n = 0;
/** A punch at `hhmm` SGT on DATE (or `date`). */
function p(kind: "in" | "out", hhmm: string, extra: Partial<AttendancePunch> = {}, date = DATE): AttendancePunch {
  const at = new Date(`${date}T${hhmm}:00+08:00`);
  n += 1;
  return {
    id: `00000000-0000-7000-8000-${String(n).padStart(12, "0")}`,
    orgId: "00000000-0000-7000-8000-000000000000",
    employeeId: "00000000-0000-7000-8000-000000000001",
    kind,
    idempotencyKey: `k${n}`,
    source: "web",
    deviceTime: at,
    sentAt: at,
    serverTime: at,
    recordedAt: at,
    workDate: date,
    skewSeconds: 0,
    queued: false,
    latitude: null,
    longitude: null,
    accuracyMetres: null,
    ip: null,
    flags: [],
    reason: null,
    createdByMembershipId: null,
    voidedAt: null,
    voidedByMembershipId: null,
    voidReason: null,
    createdAt: at,
    ...extra,
  };
}

const day = (punches: AttendancePunch[], over: Partial<Parameters<typeof computeDay>[0]> = {}) =>
  computeDay({
    date: DATE,
    today: "2026-11-20",
    info: working,
    leave: [],
    punches,
    settings: defaultSettings(),
    scheduleId: null,
    ...over,
  });

describe("timesheet day computation", () => {
  it("lateness beyond the grace period, break deduction and no OT on a normal day", () => {
    const r = day([p("in", "09:12"), p("out", "18:05")]);
    expect(r).toMatchObject({
      dayType: "working",
      scheduledMinutes: 480,
      scheduledStart: "09:00",
      lateMinutes: 12,
      earlyOutMinutes: 0,
      breakMinutes: 60,
      workedMinutes: 473,
      otMinutes: 0,
      missingPunches: 0,
    });
    expect(day([p("in", "09:04"), p("out", "18:00")]).lateMinutes).toBe(0);
  });

  it("early out after the grace period; short days have no break", () => {
    expect(day([p("in", "09:00"), p("out", "17:30")]).earlyOutMinutes).toBe(30);
    expect(day([p("in", "09:00"), p("out", "17:57")]).earlyOutMinutes).toBe(0);
    const short = day([p("in", "09:00"), p("out", "13:00")]);
    expect([short.breakMinutes, short.workedMinutes]).toEqual([0, 240]);
  });

  it("OT beyond the schedule rounds down to the block and ignores less than the minimum", () => {
    expect(day([p("in", "09:00"), p("out", "20:10")]).otMinutes).toBe(120);
    expect(day([p("in", "09:00"), p("out", "18:25")]).otMinutes).toBe(0);
    const s = { ...defaultSettings(), otBlockMinutes: 30 };
    expect(day([p("in", "09:00"), p("out", "20:10")], { settings: s }).otMinutes).toBe(120);
  });

  it("every minute on a rest day, off day or public holiday is OT", () => {
    const rest = day([p("in", "10:00"), p("out", "14:00")], { info: { ...working, dayType: "rest", minutes: 0 } });
    expect([rest.dayType, rest.otMinutes, rest.lateMinutes]).toEqual(["rest", 240, 0]);
    const ph = day([p("in", "09:00"), p("out", "12:00")], { info: { ...working, holiday: "Deepavali (in lieu)" } });
    expect([ph.dayType, ph.scheduledMinutes, ph.otMinutes, ph.holiday]).toEqual([
      "public_holiday",
      0,
      180,
      "Deepavali (in lieu)",
    ]);
  });

  it("missing punches, still clocked in today, out without in, voided punches ignored", () => {
    expect(day([p("in", "09:00")]).missingPunches).toBe(1);
    const today = day([p("in", "09:00")], { today: DATE });
    expect([today.open, today.missingPunches]).toEqual([true, 0]);
    expect(day([p("out", "18:00")]).missingPunches).toBe(1);
    expect(day([p("in", "08:00"), p("in", "09:00"), p("out", "18:00")]).missingPunches).toBe(1);
    const voided = day([p("in", "07:00", { voidedAt: new Date() }), p("in", "09:00"), p("out", "18:00")]);
    expect([voided.lateMinutes, voided.missingPunches, voided.punches.length]).toEqual([0, 0, 3]);
  });

  it("leave: a full day is a leave day; morning leave skips the lateness check", () => {
    const full = day([], { leave: [{ session: "full", label: "Annual leave" }] });
    expect([full.dayType, full.scheduledMinutes]).toEqual(["leave", 0]);
    const am = day([p("in", "13:30"), p("out", "18:00")], { leave: [{ session: "am", label: "Annual leave" }] });
    expect([am.dayType, am.scheduledMinutes, am.lateMinutes, am.leave?.session]).toEqual(["working", 240, 0, "am"]);
    expect(day([], { info: { ...working, employed: false } }).dayType).toBe("not_employed");
    expect(day([], { info: { ...working, dayType: "shift", scheduleKind: "shift" } }).dayType).toBe("shift");
  });

  it("uses the start time set for the schedule", () => {
    const s = { ...defaultSettings(), scheduleStartTimes: { "sched-1": "08:30" } };
    expect(day([p("in", "08:45"), p("out", "17:30")], { settings: s, scheduleId: "sched-1" }).lateMinutes).toBe(15);
  });
});

describe("timesheets over a week", () => {
  let w: LeaveWorld;
  beforeAll(async () => {
    w = await createLeaveWorld({ now: "2026-11-14T02:00:00.000Z" });
    await ensureLeaveSetup(w.deps, w.orgId);
    const [annual] = await w.deps.db
      .select()
      .from(leaveTypes)
      .where(and(eq(leaveTypes.orgId, w.orgId), eq(leaveTypes.code, "annual")));
    const requestId = w.deps.ids.newId();
    await w.deps.db.insert(leaveRequests).values({
      id: requestId,
      orgId: w.orgId,
      employeeId: w.emp.staff,
      leaveTypeId: annual?.id as string,
      startDate: "2026-11-11",
      endDate: "2026-11-11",
      startSession: "full",
      endSession: "full",
      unit: "days",
      hundredths: 100,
      status: "approved",
      requestedByMembershipId: w.m.staff.membershipId,
    });
    await w.deps.db.insert(leaveRequestDays).values({
      id: w.deps.ids.newId(),
      orgId: w.orgId,
      requestId,
      employeeId: w.emp.staff,
      leaveTypeId: annual?.id as string,
      date: "2026-11-11",
      session: "full",
      hundredths: 100,
      leaveYear: 2026,
    });
    const staff = await w.as("staff");
    const sent = "2026-11-14T02:00:00.000Z";
    await punch(staff, "in", "2026-11-10T01:10:00.000Z", { sentAt: sent, queued: true }); // Tue 09:10, late 10
    await punch(staff, "out", "2026-11-10T10:00:00.000Z", { sentAt: sent, queued: true }); // 18:00
    await punch(staff, "in", "2026-11-12T01:00:00.000Z", { sentAt: sent, queued: true }); // Thu 09:00
    await punch(staff, "out", "2026-11-12T12:30:00.000Z", { sentAt: sent, queued: true }); // 20:30 → 690 − 60 break − 480 = 150 OT
    await punch(staff, "in", "2026-11-13T01:00:00.000Z", { sentAt: sent, queued: true }); // Fri, no out
  });
  afterAll(() => w.close());

  it("labels holidays, leave, off and rest days and totals the week", async () => {
    const sheet = await timesheets(w.deps.db, w.orgId, [w.emp.staff], "2026-11-09", "2026-11-15", "2026-11-14");
    const days = sheet.days.get(w.emp.staff) ?? [];
    expect(days.map((d) => d.dayType)).toEqual([
      "public_holiday",
      "working",
      "leave",
      "working",
      "working",
      "off",
      "rest",
    ]);
    expect(days[0]?.holiday).toBe("Deepavali (in lieu)");
    expect(days[2]?.leave).toEqual({ session: "full", label: "Annual leave" });
    expect(days[1]).toMatchObject({ lateMinutes: 10, workedMinutes: 470 });
    expect(days[3]?.otMinutes).toBe(150);
    expect(days[4]?.missingPunches).toBe(1);
    expect(totalsOf(days)).toMatchObject({
      daysWorked: 2,
      lateCount: 1,
      lateMinutes: 10,
      missingPunches: 1,
      otMinutes: 150,
      leaveDays: 1,
    });
  });

  it("the HTTP timesheet is scoped: own and the manager's reports, 404 for others", async () => {
    const own = await (await w.as("staff")).get("/api/v1/attendance/timesheet?from=2026-11-09&to=2026-11-15");
    expect(own.status).toBe(200);
    const mgr = await (await w.as("manager")).get(
      `/api/v1/attendance/timesheet?employeeId=${w.emp.staff}&from=2026-11-09&to=2026-11-15`,
    );
    expect(mgr.status).toBe(200);
    const other = await (await w.as("other")).get(
      `/api/v1/attendance/timesheet?employeeId=${w.emp.staff}&from=2026-11-09&to=2026-11-15`,
    );
    expect(other.status).toBe(404);
    const team = (await (
      await (await w.as("manager")).get("/api/v1/attendance/team?from=2026-11-09&to=2026-11-15")
    ).json()) as {
      items: { employee: { name: string } }[];
    };
    expect(team.items.map((i) => i.employee.name)).toEqual([
      "Ahmad Ismail",
      "Daniel Goh",
      "Ravi Kumar",
      "Siti Rahmah",
      "Wong Kai Wen",
    ]);
    const tooLong = await (await w.as("staff")).get("/api/v1/attendance/timesheet?from=2026-09-01&to=2026-11-15");
    expect(tooLong.status).toBe(400);
  });
});
