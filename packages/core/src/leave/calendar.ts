import {
  type PublicHoliday,
  publicHolidays,
  publicHolidayTreatment,
  RulesNotAvailableError,
  type WorkPattern,
} from "@crowhr/sg-rules";
import { and, asc, gte, inArray, lte } from "drizzle-orm";
import { orgScope } from "../access/org-scope.ts";
import { employees, employmentRecords, type Gender, tenures } from "../db/schema/employees.ts";
import { type LeaveSession, type LeaveSettingsRow, type LeaveUnit, leaveHolidays } from "../db/schema/leave.ts";
import { type WorkDayType, type WorkWeek, workSchedules, workScheduleVersions } from "../db/schema/organisation.ts";
import type { Db } from "../db/types.ts";
import { addDays } from "../employees/dates.ts";
import { displayName } from "../employees/records.ts";
import { AppError } from "../errors.ts";
import { loadLeaveSettings } from "./defaults.ts";

/**
 * The working-day calculator (design decision 4): which dates an employee works, which public
 * holidays apply to them (with MOM's substitution rules), and how many days or hours a leave
 * request counts. Shared by the quote, applications, calendar, payroll feed, reports and attendance.
 */

export interface ScheduleVersionLite {
  effectiveFrom: string;
  effectiveTo: string | null;
  days: WorkWeek | null;
  weeklyMinutes: number;
}

export interface ScheduleLite {
  id: string;
  name: string;
  kind: "fixed" | "shift";
  isDefault: boolean;
  versions: ScheduleVersionLite[];
}

export interface EmploymentLite {
  effectiveFrom: string;
  effectiveTo: string | null;
  employmentType: "full_time" | "part_time" | "contract" | "intern";
  workScheduleId: string;
  isWorkman: boolean;
  eaCovered: boolean;
  managerEmployeeId: string | null;
  departmentId: string;
}

export interface EmployeeTime {
  orgId: string;
  employeeId: string;
  name: string;
  gender: Gender | null;
  tenures: { hireDate: string; lastWorkingDay: string | null }[];
  employment: EmploymentLite[];
  schedules: Map<string, ScheduleLite>;
  orgHolidays: { date: string; name: string }[];
  settings: LeaveSettingsRow;
  /** Memo: year → (date → holiday name) for this employee. */
  holidayMemo: Map<number, Map<string, string>>;
  warnings: Set<string>;
}

const within = (r: { effectiveFrom: string; effectiveTo: string | null }, date: string) =>
  r.effectiveFrom <= date && (r.effectiveTo === null || date < r.effectiveTo);

/** Loads the employment, schedule and holiday facts for several employees in a few queries. */
export async function loadEmployeesTime(
  db: Db,
  orgId: string,
  employeeIds: readonly string[],
): Promise<Map<string, EmployeeTime>> {
  const out = new Map<string, EmployeeTime>();
  if (!employeeIds.length) return out;
  const org = orgScope(db, orgId);
  const ids = [...new Set(employeeIds)];
  const people = await db
    .select({
      id: employees.id,
      legalName: employees.legalName,
      preferredName: employees.preferredName,
      gender: employees.gender,
    })
    .from(employees)
    .where(org.where(employees, inArray(employees.id, ids)));
  if (!people.length) return out;
  const found = people.map((p) => p.id);
  const tenureRows = await db
    .select()
    .from(tenures)
    .where(org.where(tenures, inArray(tenures.employeeId, found)))
    .orderBy(asc(tenures.hireDate));
  const records = await db
    .select()
    .from(employmentRecords)
    .where(org.where(employmentRecords, inArray(employmentRecords.employeeId, found)))
    .orderBy(asc(employmentRecords.effectiveFrom));
  const schedules = await loadSchedules(db, orgId);
  const holidays = await db.select().from(leaveHolidays).where(org.where(leaveHolidays));
  const settings = await loadLeaveSettings(db, orgId);
  for (const p of people) {
    out.set(p.id, {
      orgId,
      employeeId: p.id,
      name: displayName(p),
      gender: p.gender ?? null,
      tenures: tenureRows
        .filter((t) => t.employeeId === p.id)
        .map((t) => ({ hireDate: t.hireDate, lastWorkingDay: t.lastWorkingDay })),
      employment: records
        .filter((r) => r.employeeId === p.id)
        .map((r) => ({
          effectiveFrom: r.effectiveFrom,
          effectiveTo: r.effectiveTo,
          employmentType: r.employmentType,
          workScheduleId: r.workScheduleId,
          isWorkman: r.isWorkman,
          eaCovered: r.eaCovered,
          managerEmployeeId: r.managerEmployeeId,
          departmentId: r.departmentId,
        })),
      schedules,
      orgHolidays: holidays.map((h) => ({ date: h.date, name: h.name })),
      settings,
      holidayMemo: new Map(),
      warnings: new Set(),
    });
  }
  return out;
}

export async function loadEmployeeTime(db: Db, orgId: string, employeeId: string): Promise<EmployeeTime> {
  const found = (await loadEmployeesTime(db, orgId, [employeeId])).get(employeeId);
  if (!found) throw new AppError("not_found", "That employee record doesn't exist or you can't see it.");
  return found;
}

export async function loadSchedules(db: Db, orgId: string): Promise<Map<string, ScheduleLite>> {
  const org = orgScope(db, orgId);
  const rows = await db.select().from(workSchedules).where(org.where(workSchedules));
  const versions = await db
    .select()
    .from(workScheduleVersions)
    .where(org.where(workScheduleVersions))
    .orderBy(asc(workScheduleVersions.effectiveFrom));
  return new Map(
    rows.map((s) => [
      s.id,
      {
        id: s.id,
        name: s.name,
        kind: s.kind,
        isDefault: s.isDefault,
        versions: versions
          .filter((v) => v.scheduleId === s.id)
          .map((v) => ({
            effectiveFrom: v.effectiveFrom,
            effectiveTo: v.effectiveTo,
            days: v.days,
            weeklyMinutes: v.weeklyMinutes,
          })),
      },
    ]),
  );
}

// ---------------------------------------------------------------------------------------------
// Facts per date
// ---------------------------------------------------------------------------------------------

/** The tenure covering `date`, or null. */
export function tenureOn(t: EmployeeTime, date: string) {
  return t.tenures.find((x) => x.hireDate <= date && (x.lastWorkingDay === null || date <= x.lastWorkingDay)) ?? null;
}

/** The latest tenure that started on or before `date` (for entitlement after a leaving date). */
export function latestTenureBy(t: EmployeeTime, date: string) {
  return [...t.tenures].reverse().find((x) => x.hireDate <= date) ?? null;
}

export function employmentOn(t: EmployeeTime, date: string): EmploymentLite | null {
  return t.employment.find((r) => within(r, date)) ?? null;
}

/** The record in force on `date`, or the nearest one (first record before the hire date, last after). */
export function employmentNear(t: EmployeeTime, date: string): EmploymentLite | null {
  return (
    employmentOn(t, date) ??
    (date < (t.employment[0]?.effectiveFrom ?? "") ? t.employment[0] : t.employment.at(-1)) ??
    null
  );
}

export interface ScheduleOn {
  schedule: ScheduleLite;
  version: ScheduleVersionLite;
}

export function scheduleOn(t: EmployeeTime, date: string): ScheduleOn | null {
  const emp = employmentNear(t, date);
  if (!emp) return null;
  const schedule = t.schedules.get(emp.workScheduleId);
  if (!schedule) return null;
  const version =
    schedule.versions.find((v) => within(v, date)) ??
    (date < (schedule.versions[0]?.effectiveFrom ?? "") ? schedule.versions[0] : schedule.versions.at(-1));
  return version ? { schedule, version } : null;
}

/** Monday-first index of an ISO date (0 = Monday … 6 = Sunday). */
export function mondayIndex(date: string): number {
  const d = new Date(`${date}T00:00:00Z`).getUTCDay();
  return (d + 6) % 7;
}

/** sg-rules work pattern (Sunday first, 1 / 0.5 / 0) and rest weekday (0 = Sunday) of a fixed week. */
export function patternOf(days: WorkWeek): { pattern: WorkPattern; restDay: number; workingDaysPerWeek: number } {
  const value = (t: WorkDayType): number => (t === "working" ? 1 : t === "half" ? 0.5 : 0);
  const sundayFirst = [days[6], days[0], days[1], days[2], days[3], days[4], days[5]].map((d) =>
    value(d?.type ?? "off"),
  );
  const restMonday = days.findIndex((d) => d.type === "rest");
  const restDay = restMonday < 0 ? 0 : (restMonday + 1) % 7;
  return {
    pattern: sundayFirst as unknown as WorkPattern,
    restDay,
    workingDaysPerWeek: sundayFirst.reduce((a, b) => a + b, 0),
  };
}

/** Working days per week for parental leave conversions (shift schedules: 5, with a warning). */
export function workingDaysPerWeekOn(t: EmployeeTime, date: string): number {
  const s = scheduleOn(t, date);
  if (!s?.version.days) {
    t.warnings.add("Shift schedules have no fixed week, so parental leave assumes a 5-day week.");
    return 5;
  }
  const w = patternOf(s.version.days).workingDaysPerWeek;
  return w > 0 ? w : 5;
}

function gazetted(t: EmployeeTime, year: number, warn = true): PublicHoliday[] {
  try {
    return [...publicHolidays(year)];
  } catch (err) {
    if (err instanceof RulesNotAvailableError) {
      if (warn)
        t.warnings.add(`Singapore public holidays for ${year} aren't published yet, so none are excluded for ${year}.`);
      return [];
    }
    throw err;
  }
}

function nextWorkingDate(t: EmployeeTime, from: string): string {
  let d = addDays(from, 1);
  for (let i = 0; i < 14; i++) {
    const s = scheduleOn(t, d);
    const type = s?.version.days?.[mondayIndex(d)]?.type;
    if (!s?.version.days || type === "working" || type === "half") return d;
    d = addDays(d, 1);
  }
  return d;
}

/**
 * The employee's public holidays in `year` (date → name), after MOM substitution:
 * - holiday on a working day: that day;
 * - Sunday holiday and Sunday rest day: the gazetted Monday;
 * - holiday on another rest day: the next working day;
 * - holiday on an off day: none (extra pay), or the next working day when the org chooses.
 * Shift schedules (no fixed week): the holiday date itself.
 */
export function holidaysFor(t: EmployeeTime, year: number): Map<string, string> {
  const memo = t.holidayMemo.get(year);
  if (memo) return memo;
  const out = new Map<string, string>();
  const add = (date: string, name: string) => {
    if (!out.has(date)) out.set(date, name);
  };
  // Look at the previous year too: a holiday on 31 Dec can move into January.
  const all: PublicHoliday[] = [
    ...gazetted(t, year - 1, false).filter((h) => h.date >= `${year - 1}-12-25`),
    ...gazetted(t, year),
    ...t.orgHolidays.filter((h) => h.date >= `${year - 1}-12-25` && h.date <= `${year}-12-31`),
  ];
  for (const h of all) {
    const s = scheduleOn(t, h.date);
    if (!s?.version.days) {
      add(h.date, h.name);
      continue;
    }
    const { pattern, restDay } = patternOf(s.version.days);
    const r = publicHolidayTreatment({ holiday: h, restDay, pattern });
    if (r.treatment === "PAID_HOLIDAY") add(h.date, h.name);
    else if (r.substituteDate) add(r.substituteDate, `${h.name} (in lieu)`);
    else if (t.settings.offDayHoliday === "next_working_day") add(nextWorkingDate(t, h.date), `${h.name} (in lieu)`);
  }
  const inYear = new Map([...out].filter(([d]) => d.startsWith(`${year}-`)));
  t.holidayMemo.set(year, inYear);
  return inYear;
}

export interface DayInfo {
  date: string;
  employed: boolean;
  scheduleKind: "fixed" | "shift" | null;
  dayType: WorkDayType | "shift" | null;
  /** Scheduled minutes for the day (shift schedules: a fifth of the weekly minutes). */
  minutes: number;
  /** The public holiday applying to the employee on this date, if any. */
  holiday: string | null;
}

export function dayInfo(t: EmployeeTime, date: string): DayInfo {
  const employed = tenureOn(t, date) !== null;
  const s = scheduleOn(t, date);
  const holiday = holidaysFor(t, Number(date.slice(0, 4))).get(date) ?? null;
  if (!s) return { date, employed, scheduleKind: null, dayType: null, minutes: 0, holiday };
  if (!s.version.days) {
    return {
      date,
      employed,
      scheduleKind: "shift",
      dayType: "shift",
      minutes: Math.round(s.version.weeklyMinutes / 5),
      holiday,
    };
  }
  const day = s.version.days[mondayIndex(date)];
  return {
    date,
    employed,
    scheduleKind: "fixed",
    dayType: day?.type ?? "off",
    minutes: day?.minutes ?? 0,
    holiday,
  };
}

// ---------------------------------------------------------------------------------------------
// Counting a leave request
// ---------------------------------------------------------------------------------------------

export interface CountInput {
  startDate: string;
  endDate: string;
  startSession: LeaveSession;
  endSession: LeaveSession;
  dayCounting: "working_days" | "working_days_including_holidays";
  unit: LeaveUnit;
}

export interface CountedDay {
  date: string;
  session: LeaveSession;
  /** Hundredths of the unit charged for the date (0 when not counted). */
  hundredths: number;
  leaveYear: number;
  dayType: DayInfo["dayType"];
  holiday: string | null;
  /** Why a date is not counted, e.g. "Rest day", "Public holiday: Deepavali (in lieu)". */
  note: string | null;
}

export interface CountResult {
  days: CountedDay[];
  totalHundredths: number;
  byYear: Map<number, number>;
  /** Problems that block the application (outside employment, bad sessions). */
  errors: { path: string; message: string }[];
  warnings: string[];
}

export const MAX_LEAVE_SPAN_DAYS = 200;

/** The session of `date` within the request (full, or the half at either end). */
export function sessionOn(
  input: Pick<CountInput, "startDate" | "endDate" | "startSession" | "endSession">,
  date: string,
): LeaveSession {
  if (input.startDate === input.endDate) return input.startSession;
  if (date === input.startDate) return input.startSession === "pm" ? "pm" : "full";
  if (date === input.endDate) return input.endSession === "am" ? "am" : "full";
  return "full";
}

export function countLeave(t: EmployeeTime, input: CountInput): CountResult {
  const errors: CountResult["errors"] = [];
  const days: CountedDay[] = [];
  const byYear = new Map<number, number>();
  if (input.endDate < input.startDate) {
    errors.push({
      path: "endDate",
      message: "The end date is before the start date. Pick an end date on or after it.",
    });
    return { days, totalHundredths: 0, byYear, errors, warnings: [] };
  }
  if (input.startDate !== input.endDate) {
    if (input.startSession === "am") {
      errors.push({
        path: "startSession",
        message: "A leave of several days can start in the afternoon (PM) or for the full day, not the morning only.",
      });
    }
    if (input.endSession === "pm") {
      errors.push({
        path: "endSession",
        message: "A leave of several days can end in the morning (AM) or for the full day, not the afternoon only.",
      });
    }
  }
  let outside = 0;
  let shift = false;
  for (let d = input.startDate, i = 0; d <= input.endDate; d = addDays(d, 1), i++) {
    if (i >= MAX_LEAVE_SPAN_DAYS) {
      errors.push({
        path: "endDate",
        message: `A single application can cover at most ${MAX_LEAVE_SPAN_DAYS} calendar days. Split it into two.`,
      });
      break;
    }
    const info = dayInfo(t, d);
    const session = sessionOn(input, d);
    const year = Number(d.slice(0, 4));
    let note: string | null = null;
    let fraction = 0; // of the scheduled day
    if (!info.employed) {
      outside++;
      note = "Not employed on this date";
    } else if (info.dayType === "shift") {
      shift = true;
      if (info.holiday && input.dayCounting === "working_days") note = `Public holiday: ${info.holiday}`;
      else fraction = session === "full" ? 1 : 0.5;
    } else if (info.dayType === "rest" || info.dayType === "off" || info.dayType === null) {
      note = info.dayType === "rest" ? "Rest day" : "Off day";
    } else if (info.holiday && input.dayCounting === "working_days") {
      note = `Public holiday: ${info.holiday}`;
    } else if (info.dayType === "half") {
      // A half working day is a morning: the afternoon session has nothing to take.
      fraction = session === "pm" ? 0 : 1;
      if (fraction === 0) note = "Half working day (morning only)";
    } else {
      fraction = session === "full" ? 1 : 0.5;
    }
    let hundredths = 0;
    if (fraction > 0) {
      if (input.unit === "hours") {
        hundredths = Math.round((info.minutes * fraction * 100) / 60);
      } else {
        const dayUnits = info.dayType === "half" ? 0.5 : 1;
        hundredths = Math.round(dayUnits * fraction * 100);
      }
    }
    if (hundredths > 0) byYear.set(year, (byYear.get(year) ?? 0) + hundredths);
    days.push({ date: d, session, hundredths, leaveYear: year, dayType: info.dayType, holiday: info.holiday, note });
  }
  if (outside > 0) {
    errors.push({
      path: "startDate",
      message:
        "Some of these dates are outside the employee's employment (before the hire date or after the last day). Change the dates.",
    });
  }
  const warnings = [...t.warnings];
  if (shift) {
    warnings.push(
      "This employee is on a shift schedule, so every day except public holidays is counted. Check the roster and exclude rest days.",
    );
  }
  const totalHundredths = days.reduce((s, d) => s + d.hundredths, 0);
  return { days, totalHundredths, byYear, errors, warnings };
}

/** Dates in [from, to] (inclusive) for range queries. */
export function datesBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

/** Org holidays in a range (admin list). */
export async function orgHolidaysBetween(db: Db, orgId: string, from: string, to: string) {
  const org = orgScope(db, orgId);
  return db
    .select()
    .from(leaveHolidays)
    .where(org.where(leaveHolidays, and(gte(leaveHolidays.date, from), lte(leaveHolidays.date, to))))
    .orderBy(asc(leaveHolidays.date));
}
