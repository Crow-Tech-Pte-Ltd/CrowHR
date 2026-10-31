import type { LeaveChild, LeaveType } from "../db/schema/leave.ts";
import type { WorkWeek } from "../db/schema/organisation.ts";
import type { EmployeeTime, EmploymentLite, ScheduleLite } from "./calendar.ts";
import { DEFAULT_LEAVE_TYPES } from "./defaults.ts";

/** Pure fixtures for calculator tests (no database). */

export const MON_FRI: WorkWeek = [
  { type: "working", minutes: 480 },
  { type: "working", minutes: 480 },
  { type: "working", minutes: 480 },
  { type: "working", minutes: 480 },
  { type: "working", minutes: 480 },
  { type: "off", minutes: 0 },
  { type: "rest", minutes: 0 },
];

export const MON_FRI_SAT_HALF: WorkWeek = [
  ...MON_FRI.slice(0, 5),
  { type: "half", minutes: 240 },
  { type: "rest", minutes: 0 },
];

export const SUN_FRI_SAT_REST: WorkWeek = [
  ...MON_FRI.slice(0, 5),
  { type: "rest", minutes: 0 },
  { type: "working", minutes: 480 },
];

export function schedule(
  id: string,
  days: WorkWeek | null,
  opts: { isDefault?: boolean; weeklyMinutes?: number } = {},
): ScheduleLite {
  return {
    id,
    name: id,
    kind: days ? "fixed" : "shift",
    isDefault: opts.isDefault ?? false,
    versions: [
      {
        effectiveFrom: "1970-01-01",
        effectiveTo: null,
        days,
        weeklyMinutes: opts.weeklyMinutes ?? (days ? days.reduce((s, d) => s + d.minutes, 0) : 2400),
      },
    ],
  };
}

export function employee(input: {
  hireDate?: string;
  lastWorkingDay?: string | null;
  days?: WorkWeek | null;
  employmentType?: EmploymentLite["employmentType"];
  gender?: "female" | "male";
  offDayHoliday?: "extra_pay" | "next_working_day";
  orgHolidays?: { date: string; name: string }[];
  extraSchedules?: ScheduleLite[];
}): EmployeeTime {
  const own = schedule("own", input.days === undefined ? MON_FRI : input.days, {
    isDefault: !input.extraSchedules?.length,
  });
  const schedules = new Map([own, ...(input.extraSchedules ?? [])].map((s) => [s.id, s]));
  return {
    orgId: "00000000-0000-7000-8000-000000000001",
    employeeId: "00000000-0000-7000-8000-000000000002",
    name: "Test Person",
    gender: input.gender ?? "male",
    tenures: [{ hireDate: input.hireDate ?? "2024-01-02", lastWorkingDay: input.lastWorkingDay ?? null }],
    employment: [
      {
        effectiveFrom: input.hireDate ?? "2024-01-02",
        effectiveTo: null,
        employmentType: input.employmentType ?? "full_time",
        workScheduleId: "own",
        isWorkman: false,
        isManagerOrExecutive: false,
        eaCovered: true,
        managerEmployeeId: null,
        departmentId: "00000000-0000-7000-8000-000000000003",
        locationId: null,
      },
    ],
    schedules,
    orgHolidays: input.orgHolidays ?? [],
    settings: {
      orgId: "00000000-0000-7000-8000-000000000001",
      offDayHoliday: input.offDayHoliday ?? "extra_pay",
      unpaidServiceRule: "whole_month",
      fullTimeScheduleId: null,
      updatedAt: new Date(0),
    },
    holidayMemo: new Map(),
    warnings: new Set(),
  };
}

export function leaveType(code: string, overrides: Partial<LeaveType> = {}): LeaveType {
  const d = DEFAULT_LEAVE_TYPES.find((t) => t.code === code);
  if (!d) throw new Error(`no default type ${code}`);
  return {
    id: `00000000-0000-7000-8000-0000000001${String(DEFAULT_LEAVE_TYPES.indexOf(d)).padStart(2, "0")}`,
    orgId: "00000000-0000-7000-8000-000000000001",
    archivedAt: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    ...d,
    ...overrides,
  };
}

export function child(overrides: Partial<LeaveChild> = {}): LeaveChild {
  return {
    id: "00000000-0000-7000-8000-000000000009",
    orgId: "00000000-0000-7000-8000-000000000001",
    employeeId: "00000000-0000-7000-8000-000000000002",
    name: "Baby",
    birthDate: "2026-06-01",
    expectedDeliveryDate: null,
    isCitizen: true,
    birthOrder: 1,
    stillborn: false,
    adoptionIntentDate: null,
    marriedToMother: true,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    ...overrides,
  };
}
