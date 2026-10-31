import { and, asc, eq, gte, inArray, lte } from "drizzle-orm";
import { orgScope } from "../access/org-scope.ts";
import {
  type AttendancePunch,
  attendancePunches,
  type OvertimeClaim,
  overtimeClaims,
  type PunchFlag,
} from "../db/schema/attendance.ts";
import { leaveRequestDays, leaveRequests, leaveTypes } from "../db/schema/leave.ts";
import type { Db } from "../db/types.ts";
import { addDays } from "../employees/dates.ts";
import { type DayInfo, dayInfo, type EmployeeTime, loadEmployeesTime, scheduleOn } from "../leave/calendar.ts";
import { type PunchView, toPunchView } from "./punch.ts";
import { type AttendanceSettings, loadAttendanceSettings } from "./settings.ts";

/**
 * Daily timesheets, computed on read from punches, the work schedule, holidays and approved leave
 * (spec "Daily timesheets", design decision 3). Nothing here is stored.
 */

export type DayKind = "working" | "half" | "off" | "rest" | "public_holiday" | "leave" | "shift" | "not_employed";

export interface DayLeave {
  session: "full" | "am" | "pm";
  label: string;
}

export interface DayRecord {
  date: string;
  dayType: DayKind;
  holiday: string | null;
  leave: DayLeave | null;
  scheduledMinutes: number;
  /** Scheduled start (HH:MM, SGT) for fixed working days. */
  scheduledStart: string | null;
  firstIn: string | null;
  lastOut: string | null;
  workedMinutes: number;
  breakMinutes: number;
  lateMinutes: number;
  earlyOutMinutes: number;
  /** Punches that have no partner (an in without an out, or an out without an in). */
  missingPunches: number;
  /** Still clocked in (today only). */
  open: boolean;
  flags: PunchFlag[];
  otMinutes: number;
  punches: PunchView[];
  otClaim: {
    id: string;
    status: OvertimeClaim["status"];
    claimedMinutes: number;
    approvedMinutes: number | null;
  } | null;
}

/** Break deducted from a day whose span (first in → last out) exceeds this. */
export const BREAK_AFTER_MINUTES = 6 * 60;

const MIN = 60_000;

export interface ComputeDayInput {
  date: string;
  today: string;
  info: DayInfo;
  /** Approved leave sessions on the date. */
  leave: DayLeave[];
  punches: readonly AttendancePunch[];
  settings: AttendanceSettings;
  scheduleId: string | null;
}

function startTimeFor(settings: AttendanceSettings, scheduleId: string | null): string {
  return (scheduleId && settings.scheduleStartTimes[scheduleId]) || settings.defaultStartTime;
}

/** One day's record (pure). */
export function computeDay(input: ComputeDayInput): DayRecord {
  const { date, info, settings } = input;
  const active = [...input.punches]
    .filter((p) => !p.voidedAt)
    .sort((a, b) => a.recordedAt.getTime() - b.recordedAt.getTime());
  const fullLeave = input.leave.find((l) => l.session === "full") ?? null;
  const halfLeave = fullLeave ? null : (input.leave[0] ?? null);
  let dayType: DayKind;
  if (!info.employed) dayType = "not_employed";
  else if (info.dayType === "shift") dayType = info.holiday ? "public_holiday" : fullLeave ? "leave" : "shift";
  else if (info.dayType === "rest" || info.dayType === "off" || info.dayType === null) dayType = info.dayType ?? "off";
  else if (info.holiday) dayType = "public_holiday";
  else if (fullLeave) dayType = "leave";
  else dayType = info.dayType;

  let scheduled = 0;
  if (dayType === "working" || dayType === "half" || dayType === "shift") {
    scheduled = halfLeave && dayType !== "half" ? Math.round(info.minutes / 2) : halfLeave ? 0 : info.minutes;
  }

  // Pair punches in order.
  let worked = 0;
  let missing = 0;
  let openIn: AttendancePunch | null = null;
  for (const p of active) {
    if (p.kind === "in") {
      if (openIn) missing++;
      openIn = p;
    } else if (openIn) {
      worked += Math.max(0, Math.floor((p.recordedAt.getTime() - openIn.recordedAt.getTime()) / MIN));
      openIn = null;
    } else {
      missing++;
    }
  }
  const open = openIn !== null && date === input.today;
  if (openIn && !open) missing++;
  const firstIn = active.find((p) => p.kind === "in") ?? null;
  const lastOut = [...active].reverse().find((p) => p.kind === "out") ?? null;
  let breakMinutes = 0;
  if (firstIn && lastOut && lastOut.recordedAt > firstIn.recordedAt) {
    const span = (lastOut.recordedAt.getTime() - firstIn.recordedAt.getTime()) / MIN;
    if (span > BREAK_AFTER_MINUTES) breakMinutes = Math.min(settings.breakMinutes, worked);
  }
  worked -= breakMinutes;

  const fixed = dayType === "working" || dayType === "half";
  const startText = fixed && scheduled > 0 ? startTimeFor(settings, input.scheduleId) : null;
  let late = 0;
  let early = 0;
  if (startText) {
    const start = new Date(`${date}T${startText}:00+08:00`).getTime();
    if (firstIn && halfLeave?.session !== "am") {
      const diff = Math.floor((firstIn.recordedAt.getTime() - start) / MIN);
      if (diff > settings.lateGraceMinutes) late = diff;
    }
    if (lastOut && halfLeave?.session !== "pm") {
      const end = start + (scheduled + (scheduled > BREAK_AFTER_MINUTES ? settings.breakMinutes : 0)) * MIN;
      const diff = Math.floor((end - lastOut.recordedAt.getTime()) / MIN);
      if (diff > settings.earlyOutGraceMinutes) early = diff;
    }
  }

  const base =
    dayType === "working" || dayType === "half" || dayType === "shift" ? Math.max(0, worked - scheduled) : worked;
  const otMinutes =
    dayType === "not_employed" || base < settings.otMinimumMinutes || base <= 0
      ? 0
      : Math.floor(base / settings.otBlockMinutes) * settings.otBlockMinutes;

  return {
    date,
    dayType,
    holiday: info.holiday,
    leave: fullLeave ?? halfLeave,
    scheduledMinutes: scheduled,
    scheduledStart: startText,
    firstIn: firstIn?.recordedAt.toISOString() ?? null,
    lastOut: lastOut?.recordedAt.toISOString() ?? null,
    workedMinutes: Math.max(0, worked),
    breakMinutes,
    lateMinutes: late,
    earlyOutMinutes: early,
    missingPunches: missing,
    open,
    flags: [...new Set(active.flatMap((p) => p.flags))],
    otMinutes,
    punches: [...input.punches].sort((a, b) => a.recordedAt.getTime() - b.recordedAt.getTime()).map(toPunchView),
    otClaim: null,
  };
}

export interface TimesheetData {
  times: Map<string, EmployeeTime>;
  days: Map<string, DayRecord[]>;
  settings: AttendanceSettings;
}

/** Day records for several employees over [from, to] (inclusive). */
export async function timesheets(
  db: Db,
  orgId: string,
  employeeIds: readonly string[],
  from: string,
  to: string,
  today: string,
): Promise<TimesheetData> {
  const org = orgScope(db, orgId);
  const settings = await loadAttendanceSettings(db, orgId);
  const times = await loadEmployeesTime(db, orgId, employeeIds);
  const ids = [...times.keys()];
  const days = new Map<string, DayRecord[]>();
  if (!ids.length) return { times, days, settings };
  const punches = await db
    .select()
    .from(attendancePunches)
    .where(
      org.where(
        attendancePunches,
        inArray(attendancePunches.employeeId, ids),
        gte(attendancePunches.workDate, from),
        lte(attendancePunches.workDate, to),
      ),
    )
    .orderBy(asc(attendancePunches.recordedAt));
  const leave = await db
    .select({
      employeeId: leaveRequestDays.employeeId,
      date: leaveRequestDays.date,
      session: leaveRequestDays.session,
      name: leaveTypes.name,
    })
    .from(leaveRequestDays)
    .innerJoin(
      leaveRequests,
      and(eq(leaveRequests.orgId, leaveRequestDays.orgId), eq(leaveRequests.id, leaveRequestDays.requestId)),
    )
    .innerJoin(
      leaveTypes,
      and(eq(leaveTypes.orgId, leaveRequestDays.orgId), eq(leaveTypes.id, leaveRequestDays.leaveTypeId)),
    )
    .where(
      org.where(
        leaveRequestDays,
        inArray(leaveRequestDays.employeeId, ids),
        gte(leaveRequestDays.date, from),
        lte(leaveRequestDays.date, to),
        inArray(leaveRequests.status, ["approved", "cancellation_pending"]),
      ),
    );
  const claims = await db
    .select()
    .from(overtimeClaims)
    .where(
      org.where(
        overtimeClaims,
        inArray(overtimeClaims.employeeId, ids),
        gte(overtimeClaims.workDate, from),
        lte(overtimeClaims.workDate, to),
      ),
    )
    .orderBy(asc(overtimeClaims.createdAt));
  for (const [employeeId, t] of times) {
    const out: DayRecord[] = [];
    for (let d = from; d <= to; d = addDays(d, 1)) {
      const record = computeDay({
        date: d,
        today,
        info: dayInfo(t, d),
        leave: leave
          .filter((l) => l.employeeId === employeeId && l.date === d)
          .map((l) => ({ session: l.session, label: l.name })),
        punches: punches.filter((p) => p.employeeId === employeeId && p.workDate === d),
        settings,
        scheduleId: scheduleOn(t, d)?.schedule.id ?? null,
      });
      const claim = [...claims].reverse().find((c) => c.employeeId === employeeId && c.workDate === d);
      if (claim) {
        record.otClaim = {
          id: claim.id,
          status: claim.status,
          claimedMinutes: claim.claimedMinutes,
          approvedMinutes: claim.approvedMinutes,
        };
      }
      out.push(record);
    }
    days.set(employeeId, out);
  }
  return { times, days, settings };
}

export interface TimesheetTotals {
  daysWorked: number;
  workedMinutes: number;
  lateCount: number;
  lateMinutes: number;
  earlyOutCount: number;
  missingPunches: number;
  otMinutes: number;
  leaveDays: number;
}

export function totalsOf(days: readonly DayRecord[]): TimesheetTotals {
  return {
    daysWorked: days.filter((d) => d.workedMinutes > 0).length,
    workedMinutes: days.reduce((s, d) => s + d.workedMinutes, 0),
    lateCount: days.filter((d) => d.lateMinutes > 0).length,
    lateMinutes: days.reduce((s, d) => s + d.lateMinutes, 0),
    earlyOutCount: days.filter((d) => d.earlyOutMinutes > 0).length,
    missingPunches: days.reduce((s, d) => s + d.missingPunches, 0),
    otMinutes: days.reduce((s, d) => s + d.otMinutes, 0),
    leaveDays: days.reduce((s, d) => s + (d.leave ? (d.leave.session === "full" ? 1 : 0.5) : 0), 0),
  };
}
