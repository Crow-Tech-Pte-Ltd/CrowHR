import { queryOptions } from "@tanstack/react-query";
import { apiGet } from "../lib/api.ts";

/** Wire shapes of `/api/v1/attendance` (mirror packages/core/src/attendance/routes.ts and friends). */
export type PunchFlag = "clock_skew" | "late_sync" | "outside_location" | "no_location" | "ip_not_allowed";

export interface Punch {
  id: string;
  employeeId: string;
  kind: "in" | "out";
  source: "web" | "mobile_web" | "ios" | "android" | "correction";
  deviceTime: string;
  sentAt: string;
  serverTime: string;
  recordedAt: string;
  workDate: string;
  skewSeconds: number;
  queued: boolean;
  status: "accepted" | "flagged";
  flags: PunchFlag[];
  location: { latitude: number; longitude: number; accuracyMetres: number | null } | null;
  reason: string | null;
  voided: boolean;
  voidReason: string | null;
}

export interface Status {
  employeeId: string | null;
  serverTime: string;
  clockedIn: boolean;
  lastPunch: Punch | null;
  today: Punch[];
  location: {
    mode: "off" | "optional" | "required";
    pdpaNotice: string | null;
    offices: { name: string; radiusMetres: number }[];
  };
  networkRestricted: boolean;
  timesheets: Pick<TimesheetSettings, "approval" | "period" | "submittedBy">;
}

/** Settings → Attendance → Timesheet approval (add-timesheet-approval). */
export interface TimesheetSettings {
  approval: boolean;
  period: "monthly" | "semi_monthly" | "weekly";
  submittedBy: "employee" | "manager";
  payrollApprovedOnly: boolean;
}

export type DayType = "working" | "half" | "off" | "rest" | "public_holiday" | "leave" | "shift" | "not_employed";

export interface DayRecord {
  date: string;
  dayType: DayType;
  holiday: string | null;
  leave: { session: "full" | "am" | "pm"; label: string } | null;
  scheduledMinutes: number;
  scheduledStart: string | null;
  firstIn: string | null;
  lastOut: string | null;
  workedMinutes: number;
  breakMinutes: number;
  lateMinutes: number;
  earlyOutMinutes: number;
  missingPunches: number;
  open: boolean;
  flags: PunchFlag[];
  otMinutes: number;
  punches: Punch[];
  otClaim: {
    id: string;
    status: "pending" | "approved" | "rejected" | "withdrawn";
    claimedMinutes: number;
    approvedMinutes: number | null;
  } | null;
  /** Inside an approved timesheet: punches, manager corrections and new OT claims are refused. */
  locked: boolean;
}

export interface Totals {
  daysWorked: number;
  workedMinutes: number;
  lateCount: number;
  lateMinutes: number;
  earlyOutCount: number;
  missingPunches: number;
  otMinutes: number;
  leaveDays: number;
}

export interface Sheet {
  employee: { id: string; name: string };
  days: DayRecord[];
  totals: Totals;
}

export interface Claim {
  id: string;
  employee: { id: string; name: string };
  date: string;
  computedMinutes: number;
  claimedMinutes: number;
  approvedMinutes: number | null;
  statutory: boolean;
  reason: string | null;
  status: "pending" | "approved" | "rejected" | "withdrawn";
  approvalRequestId: string | null;
  createdAt: string;
  decidedAt: string | null;
}

export interface Office {
  id?: string;
  name: string;
  latitude: number;
  longitude: number;
  radiusMetres: number;
}

export interface AttendanceSettings {
  locationMode: "off" | "optional" | "required";
  offices: Office[];
  locationEnforcement: "flag" | "block";
  allowedIps: string[];
  ipEnforcement: "flag" | "block";
  pdpaNotice: string | null;
  defaultStartTime: string;
  scheduleStartTimes: Record<string, string>;
  breakMinutes: number;
  lateGraceMinutes: number;
  earlyOutGraceMinutes: number;
  skewThresholdSeconds: number;
  otBlockMinutes: number;
  otMinimumMinutes: number;
  timesheets: TimesheetSettings;
  effectivePdpaNotice?: string;
}

export type TimesheetStatus = "submitted" | "approved" | "returned" | "withdrawn" | "reopened";

export interface Timesheet {
  id: string;
  employee: { id: string; name: string };
  periodStart: string;
  periodEnd: string;
  periodLabel: string;
  status: TimesheetStatus;
  submittedAt: string;
  submittedBy: string;
  submittedTotals: Totals;
  approvedTotals: Totals | null;
  decidedAt: string | null;
  decidedBy: string | null;
  comment: string | null;
  reopenedAt: string | null;
  reopenedBy: string | null;
  reopenReason: string | null;
  approvalRequestId: string | null;
}

export interface PeriodRef {
  start: string;
  end: string;
  label: string;
}

export interface TimesheetRow {
  employee: { id: string; name: string };
  totals: Totals;
  status: TimesheetStatus | "not_submitted";
  timesheet: Timesheet | null;
  taskId: string | null;
  canSubmit: boolean;
  canWithdraw: boolean;
  canReopen: boolean;
}

export interface TimesheetOverview {
  settings: TimesheetSettings;
  period: PeriodRef;
  previous: PeriodRef;
  next: PeriodRef;
  over: boolean;
  submittableFrom: string;
  items: TimesheetRow[];
}

export interface SummaryRow {
  employeeId: string;
  name: string;
  daysWorked: number;
  workedMinutes: number;
  lateCount: number;
  lateMinutes: number;
  earlyOutCount: number;
  missingPunches: number;
  computedOtMinutes: number;
  approvedOtMinutes: number;
  leaveDays: number;
}

const qs = (o: Record<string, string | undefined>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) if (v) p.set(k, v);
  const s = p.toString();
  return s ? `?${s}` : "";
};

export const attKeys = {
  all: ["attendance"] as const,
  me: ["attendance", "me"] as const,
  sheet: (employeeId: string | undefined, from: string, to: string) =>
    ["attendance", "sheet", employeeId ?? "me", from, to] as const,
  team: (from: string, to: string) => ["attendance", "team", from, to] as const,
  settings: ["attendance", "settings"] as const,
  summary: (from: string, to: string) => ["attendance", "summary", from, to] as const,
  timesheets: (date: string, employeeId: string | undefined) =>
    ["attendance", "timesheets", date, employeeId ?? "all"] as const,
  timesheet: (id: string) => ["attendance", "timesheet-record", id] as const,
};

/** Each person's timesheet status for the period containing `date`. */
export const timesheetsQuery = (date: string, employeeId?: string) =>
  queryOptions({
    queryKey: attKeys.timesheets(date, employeeId),
    queryFn: () => apiGet<TimesheetOverview>(`/api/v1/attendance/timesheets${qs({ date, employeeId })}`),
  });

export const timesheetRecordQuery = (id: string) =>
  queryOptions({
    queryKey: attKeys.timesheet(id),
    queryFn: () => apiGet<Timesheet>(`/api/v1/attendance/timesheets/${id}`),
  });

export const TIMESHEET_STATUS: Record<
  TimesheetRow["status"],
  { label: string; tone: "neutral" | "info" | "success" | "warning" | "danger" }
> = {
  not_submitted: { label: "Not submitted", tone: "neutral" },
  submitted: { label: "Waiting for approval", tone: "info" },
  approved: { label: "Approved", tone: "success" },
  returned: { label: "Returned", tone: "danger" },
  withdrawn: { label: "Withdrawn", tone: "neutral" },
  reopened: { label: "Reopened", tone: "warning" },
};

export const PERIOD_LABEL: Record<TimesheetSettings["period"], string> = {
  monthly: "Calendar month",
  semi_monthly: "Half month (1st–15th, 16th–end)",
  weekly: "Week (Monday–Sunday)",
};

export const statusQuery = queryOptions({
  queryKey: attKeys.me,
  queryFn: () => apiGet<Status>("/api/v1/attendance/me"),
  refetchInterval: 60_000,
});

export const sheetQuery = (from: string, to: string, employeeId?: string) =>
  queryOptions({
    queryKey: attKeys.sheet(employeeId, from, to),
    queryFn: () => apiGet<Sheet>(`/api/v1/attendance/timesheet${qs({ employeeId, from, to })}`),
  });

export const teamQuery = (from: string, to: string) =>
  queryOptions({
    queryKey: attKeys.team(from, to),
    queryFn: () => apiGet<{ items: Sheet[] }>(`/api/v1/attendance/team${qs({ from, to })}`),
  });

export const settingsQuery = queryOptions({
  queryKey: attKeys.settings,
  queryFn: () => apiGet<AttendanceSettings>("/api/v1/attendance/settings"),
});

export const summaryQuery = (from: string, to: string) =>
  queryOptions({
    queryKey: attKeys.summary(from, to),
    queryFn: () => apiGet<{ items: SummaryRow[] }>(`/api/v1/attendance/reports/summary${qs({ from, to })}`),
  });

export const summaryCsvHref = (from: string, to: string) => `/api/v1/attendance/reports/summary.csv${qs({ from, to })}`;

export const FLAG_TEXT: Record<PunchFlag, string> = {
  clock_skew: "Device clock was off; corrected to server time",
  late_sync: "Sent late (offline); kept the time you tapped",
  outside_location: "Away from the office",
  no_location: "No location shared",
  ip_not_allowed: "Not on the office network",
};

/** "08:58" in Singapore time. */
export function sgTime(iso: string, seconds = false): string {
  const d = new Date(new Date(iso).getTime() + 8 * 3_600_000).toISOString();
  return seconds ? d.slice(11, 19) : d.slice(11, 16);
}

/** "7h 45m", "45m", "0m". */
export function duration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h ? (m ? `${h}h ${m}m` : `${h}h`) : `${m}m`;
}
