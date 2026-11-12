import { eq } from "drizzle-orm";
import { z } from "zod";
import { type AuditContext, diffFields, recordAudit } from "../audit/audit.ts";
import { type AttendanceSettingsRow, attendanceSettings } from "../db/schema/attendance.ts";
import type { Db } from "../db/types.ts";
import type { AppDeps } from "../deps.ts";
import { AppError } from "../errors.ts";
import { parseCidr } from "./network.ts";

/** Settings → Attendance (one row per organisation; defaults on read). */

/** Shown before the first punch when the organisation collects location (PDPA notification obligation). */
export const DEFAULT_PDPA_NOTICE =
  "When you clock in or out, we record your device's location and the network you are on, only to check that you are at an approved work location. It is kept with your attendance records, seen by your manager and HR, and not used for anything else.";

export type AttendanceSettings = Omit<AttendanceSettingsRow, "orgId" | "updatedAt">;

export function defaultSettings(): AttendanceSettings {
  return {
    locationMode: "off",
    offices: [],
    locationEnforcement: "flag",
    allowedIps: [],
    ipEnforcement: "flag",
    pdpaNotice: null,
    defaultStartTime: "09:00",
    scheduleStartTimes: {},
    breakMinutes: 60,
    lateGraceMinutes: 5,
    earlyOutGraceMinutes: 5,
    skewThresholdSeconds: 120,
    otBlockMinutes: 15,
    otMinimumMinutes: 30,
    timesheetApproval: false,
    timesheetPeriod: "monthly",
    timesheetSubmitter: "employee",
    payrollApprovedTimesheetsOnly: false,
  };
}

export async function loadAttendanceSettings(db: Db, orgId: string): Promise<AttendanceSettings> {
  const [row] = await db.select().from(attendanceSettings).where(eq(attendanceSettings.orgId, orgId));
  if (!row) return defaultSettings();
  const { orgId: _o, updatedAt: _u, ...rest } = row;
  return rest;
}

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use the 24-hour format HH:MM, like 09:00.");

/** Timesheet approval (add-timesheet-approval spec "Timesheet approval setting"). */
export const timesheetSettings = z.object({
  /** Off by default: nothing is submitted, approved or locked. */
  approval: z.boolean(),
  period: z.enum(["monthly", "semi_monthly", "weekly"]).meta({
    description: "`monthly`: calendar month; `semi_monthly`: 1st–15th and 16th–end; `weekly`: Monday–Sunday.",
  }),
  submittedBy: z.enum(["employee", "manager"]).meta({
    description: "`employee`: employees submit their own; `manager`: their manager (or HR) submits.",
  }),
  /** Payroll's attendance feeds pass only overtime and days worked inside approved timesheets. */
  payrollApprovedOnly: z.boolean(),
});
export type TimesheetSettings = z.output<typeof timesheetSettings>;

export function timesheetSettingsOf(s: AttendanceSettings): TimesheetSettings {
  return {
    approval: s.timesheetApproval,
    period: s.timesheetPeriod,
    submittedBy: s.timesheetSubmitter,
    payrollApprovedOnly: s.timesheetApproval && s.payrollApprovedTimesheetsOnly,
  };
}

export const settingsInput = z.object({
  locationMode: z.enum(["off", "optional", "required"]),
  offices: z
    .array(
      z.object({
        id: z.string().min(1).max(64).optional(),
        name: z.string().trim().min(1, "Name the office, like Tanjong Pagar outlet.").max(80),
        latitude: z.number().min(-90).max(90),
        longitude: z.number().min(-180).max(180),
        radiusMetres: z.int().min(20, "Use a radius of at least 20 m.").max(5_000, "Use a radius of at most 5 km."),
      }),
    )
    .max(50),
  locationEnforcement: z.enum(["flag", "block"]),
  allowedIps: z
    .array(
      z
        .string()
        .trim()
        .refine((s) => parseCidr(s) !== null, "Use an IP address or range like 203.0.113.0/24."),
    )
    .max(50),
  ipEnforcement: z.enum(["flag", "block"]),
  pdpaNotice: z.string().trim().max(2_000).nullable(),
  defaultStartTime: time,
  scheduleStartTimes: z.record(z.uuid(), time),
  breakMinutes: z.int().min(0).max(240),
  lateGraceMinutes: z.int().min(0).max(120),
  earlyOutGraceMinutes: z.int().min(0).max(120),
  skewThresholdSeconds: z.int().min(10).max(3_600),
  otBlockMinutes: z.int().min(1).max(60),
  otMinimumMinutes: z.int().min(0).max(240),
  timesheets: timesheetSettings.optional().meta({
    description: "Timesheet approval. Leave it out to keep the current settings (clients that predate it).",
  }),
});

export const settingsView = settingsInput.extend({
  offices: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      latitude: z.number(),
      longitude: z.number(),
      radiusMetres: z.number(),
    }),
  ),
  timesheets: timesheetSettings,
  /** The notice employees see (the default when none is set). */
  effectivePdpaNotice: z.string(),
});

export function toSettingsView(s: AttendanceSettings): z.input<typeof settingsView> {
  const {
    timesheetApproval: _a,
    timesheetPeriod: _p,
    timesheetSubmitter: _s,
    payrollApprovedTimesheetsOnly: _o,
    ...rest
  } = s;
  return { ...rest, timesheets: timesheetSettingsOf(s), effectivePdpaNotice: s.pdpaNotice || DEFAULT_PDPA_NOTICE };
}

export async function saveAttendanceSettings(
  deps: AppDeps,
  audit: AuditContext,
  orgId: string,
  input: z.output<typeof settingsInput>,
): Promise<AttendanceSettings> {
  if (input.locationMode === "off" && input.offices.length && input.locationEnforcement === "block") {
    throw new AppError(
      "validation_failed",
      "Office checks need location. Turn location on or set offices to flag only.",
      {
        issues: [{ path: "locationMode", message: "Choose Optional or Required to check offices." }],
      },
    );
  }
  if (input.timesheets?.payrollApprovedOnly && !input.timesheets.approval) {
    throw new AppError("validation_failed", "Payroll can use approved timesheets only when timesheet approval is on.", {
      issues: [{ path: "timesheets.payrollApprovedOnly", message: "Turn timesheet approval on first." }],
    });
  }
  const { timesheets, ...flat } = input;
  return deps.db.transaction(async (tx) => {
    const before = await loadAttendanceSettings(tx, orgId);
    // Clients that predate timesheet approval leave it out: keep what is stored.
    const ts = timesheets ?? timesheetSettingsOf(before);
    const next: AttendanceSettings = {
      ...flat,
      offices: input.offices.map((o) => ({ ...o, id: o.id ?? deps.ids.newId() })),
      pdpaNotice: input.pdpaNotice || null,
      timesheetApproval: ts.approval,
      timesheetPeriod: ts.period,
      timesheetSubmitter: ts.submittedBy,
      payrollApprovedTimesheetsOnly: ts.approval && ts.payrollApprovedOnly,
    };
    const now = deps.clock.now();
    await tx
      .insert(attendanceSettings)
      .values({ orgId, ...next, updatedAt: now })
      .onConflictDoUpdate({ target: attendanceSettings.orgId, set: { ...next, updatedAt: now } });
    await recordAudit(tx, deps, audit, {
      action: "attendance.settings_updated",
      targetType: "organisation",
      targetId: orgId,
      diff: diffFields(
        {
          ...before,
          offices: JSON.stringify(before.offices),
          allowedIps: JSON.stringify(before.allowedIps),
          scheduleStartTimes: JSON.stringify(before.scheduleStartTimes),
        },
        {
          ...next,
          offices: JSON.stringify(next.offices),
          allowedIps: JSON.stringify(next.allowedIps),
          scheduleStartTimes: JSON.stringify(next.scheduleStartTimes),
        },
      ),
    });
    return next;
  });
}
