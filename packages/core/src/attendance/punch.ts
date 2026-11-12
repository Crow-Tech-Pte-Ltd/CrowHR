import { desc, eq, isNull, lt } from "drizzle-orm";
import { z } from "zod";
import { orgScope } from "../access/org-scope.ts";
import { singaporeDate } from "../access/scope.ts";
import { type AuditContext, recordAudit } from "../audit/audit.ts";
import {
  type AttendancePunch,
  attendancePunches,
  type PunchFlag,
  type PunchKind,
  type PunchSource,
} from "../db/schema/attendance.ts";
import type { Db } from "../db/types.ts";
import type { AppDeps } from "../deps.ts";
import { addDays } from "../employees/dates.ts";
import { AppError } from "../errors.ts";
import { approvedCovering, punchLockedError } from "./locks.ts";
import { distanceMetres, ipAllowed } from "./network.ts";
import { OVERNIGHT_CUTOFF_HOUR } from "./periods.ts";
import { type AttendanceSettings, loadAttendanceSettings } from "./settings.ts";

/**
 * Punches (spec "Punches with device and server time", design decisions 1–2).
 *
 * recordedAt = deviceTime + (serverTime − sentAt): the device's clock error is measured when the
 * punch arrives, so a queued punch from a device with a wrong clock still lands at the right time.
 *
 * Native apps also send `elapsedMs`, the time between the tap and sending from the phone's
 * monotonic clock (which changing the clock doesn't move). Then recordedAt = serverTime − elapsedMs,
 * so a clock changed while the phone was offline can't move the punch either, and the difference
 * from `deviceTime` is reported as skew.
 */

const DAY_MS = 86_400_000;
/** Punches recorded more than this long ago (or in the future) are refused. */
export const MAX_PUNCH_AGE_MS = 7 * DAY_MS;
/** A punch that reaches the server this long after the tap is flagged `late_sync`. */
export const LATE_SYNC_MS = 10 * 60_000;
export { OVERNIGHT_CUTOFF_HOUR };
/** Location accuracy (metres) credited towards an office radius, at most. */
export const MAX_ACCURACY_SLACK_METRES = 50;

export const punchInput = z.object({
  kind: z.enum(["in", "out"]),
  idempotencyKey: z
    .string()
    .trim()
    .min(8, "Send a unique key of 8–100 characters per punch.")
    .max(100)
    .regex(/^[A-Za-z0-9._:-]+$/, "Use letters, digits and . _ : - in the key."),
  deviceTime: z.iso.datetime({ offset: true, message: "Send the tap time as an ISO 8601 timestamp." }),
  sentAt: z.iso.datetime({ offset: true, message: "Send the sending time as an ISO 8601 timestamp." }),
  queued: z.boolean().default(false),
  source: z.enum(["web", "mobile_web", "ios", "android"]).default("web"),
  elapsedMs: z
    .number()
    .int()
    .min(0)
    .max(MAX_PUNCH_AGE_MS + DAY_MS)
    .optional()
    .meta({
      description:
        "Native apps: milliseconds between the tap and sending, from the device's monotonic clock. Leave out if the device restarted in between.",
    }),
  location: z
    .object({
      latitude: z.number().min(-90).max(90),
      longitude: z.number().min(-180).max(180),
      accuracyMetres: z.number().min(0).max(100_000).optional(),
    })
    .nullish(),
});
export type PunchInput = z.output<typeof punchInput>;

export const punchView = z.object({
  id: z.uuid(),
  employeeId: z.uuid(),
  kind: z.enum(["in", "out"]),
  source: z.enum(["web", "mobile_web", "ios", "android", "correction"]),
  deviceTime: z.string(),
  sentAt: z.string(),
  serverTime: z.string(),
  recordedAt: z.string(),
  workDate: z.string(),
  skewSeconds: z.number(),
  queued: z.boolean(),
  status: z.enum(["accepted", "flagged"]),
  flags: z.array(z.enum(["clock_skew", "late_sync", "outside_location", "no_location", "ip_not_allowed"])),
  location: z.object({ latitude: z.number(), longitude: z.number(), accuracyMetres: z.number().nullable() }).nullable(),
  reason: z.string().nullable(),
  voided: z.boolean(),
  voidReason: z.string().nullable(),
});
export type PunchView = z.input<typeof punchView>;

export function toPunchView(p: AttendancePunch): PunchView {
  return {
    id: p.id,
    employeeId: p.employeeId,
    kind: p.kind,
    source: p.source,
    deviceTime: p.deviceTime.toISOString(),
    sentAt: p.sentAt.toISOString(),
    serverTime: p.serverTime.toISOString(),
    recordedAt: p.recordedAt.toISOString(),
    workDate: p.workDate,
    skewSeconds: p.skewSeconds,
    queued: p.queued,
    status: p.flags.length ? "flagged" : "accepted",
    flags: p.flags,
    location:
      p.latitude !== null && p.longitude !== null
        ? { latitude: p.latitude, longitude: p.longitude, accuracyMetres: p.accuracyMetres }
        : null,
    reason: p.reason,
    voided: p.voidedAt !== null,
    voidReason: p.voidReason,
  };
}

/** SGT hour of an instant. */
const sgHour = (at: Date) => new Date(at.getTime() + 8 * 3_600_000).getUTCHours();

/**
 * The work date of a punch: its SGT date, except that an `out` before 04:00 closes an open `in`
 * from the previous day (overnight work).
 */
export async function workDateFor(
  db: Db,
  orgId: string,
  employeeId: string,
  kind: PunchKind,
  at: Date,
): Promise<string> {
  const date = singaporeDate(at);
  if (kind !== "out" || sgHour(at) >= OVERNIGHT_CUTOFF_HOUR) return date;
  const [last] = await db
    .select()
    .from(attendancePunches)
    .where(
      orgScope(db, orgId).where(
        attendancePunches,
        eq(attendancePunches.employeeId, employeeId),
        isNull(attendancePunches.voidedAt),
        lt(attendancePunches.recordedAt, at),
      ),
    )
    .orderBy(desc(attendancePunches.recordedAt))
    .limit(1);
  const previous = addDays(date, -1);
  return last?.kind === "in" && last.workDate === previous ? previous : date;
}

interface Checked {
  flags: PunchFlag[];
  location: { latitude: number; longitude: number; accuracyMetres: number | null } | null;
}

/** Location and network controls (spec "Location and network controls"). Throws in block mode. */
export function checkControls(settings: AttendanceSettings, input: PunchInput, ip: string | null): Checked {
  const flags: PunchFlag[] = [];
  // Location is stored only when the organisation collects it (PDPA).
  const location =
    settings.locationMode !== "off" && input.location
      ? {
          latitude: input.location.latitude,
          longitude: input.location.longitude,
          accuracyMetres:
            input.location.accuracyMetres === undefined ? null : Math.round(input.location.accuracyMetres),
        }
      : null;
  if (settings.locationMode === "required" && !location) {
    if (settings.locationEnforcement === "block") {
      throw new AppError(
        "outside_location",
        "Your company needs your location to clock in. Allow location for Crow HR in your browser or phone settings, then clock in again.",
        { reason: "no_location" },
      );
    }
    flags.push("no_location");
  }
  if (location && settings.offices.length) {
    const slack = Math.min(location.accuracyMetres ?? 0, MAX_ACCURACY_SLACK_METRES);
    const nearest = settings.offices
      .map((o) => ({ office: o, distance: distanceMetres(location, o) }))
      .sort((a, b) => a.distance - b.distance)[0];
    const inside = settings.offices.some((o) => distanceMetres(location, o) - slack <= o.radiusMetres);
    if (!inside && nearest) {
      if (settings.locationEnforcement === "block") {
        const d = nearest.distance;
        const far = d >= 1_000 ? `${(d / 1_000).toFixed(1)} km` : `${Math.round(d)} m`;
        throw new AppError(
          "outside_location",
          `You're ${far} from ${nearest.office.name}; clocking in is allowed within ${nearest.office.radiusMetres} m. Move closer, or ask your manager to add the punch.`,
          {
            nearestOffice: nearest.office.name,
            distanceMetres: Math.round(d),
            radiusMetres: nearest.office.radiusMetres,
          },
        );
      }
      flags.push("outside_location");
    }
  }
  if (!ipAllowed(ip, settings.allowedIps)) {
    if (settings.ipEnforcement === "block") {
      throw new AppError(
        "ip_not_allowed",
        "You can only clock in from the office network. Connect to the office Wi-Fi, or ask your manager to add the punch.",
      );
    }
    flags.push("ip_not_allowed");
  }
  return { flags, location };
}

async function findByKey(db: Db, orgId: string, employeeId: string, key: string) {
  const [row] = await db
    .select()
    .from(attendancePunches)
    .where(
      orgScope(db, orgId).where(
        attendancePunches,
        eq(attendancePunches.employeeId, employeeId),
        eq(attendancePunches.idempotencyKey, key),
      ),
    );
  return row ?? null;
}

export interface RecordPunchResult {
  punch: AttendancePunch;
  replayed: boolean;
}

/** Records the caller's own punch. A retried idempotency key returns the stored punch. */
export async function recordPunch(
  deps: AppDeps,
  audit: AuditContext,
  input: { orgId: string; employeeId: string; membershipId: string; ip: string | null; punch: PunchInput },
): Promise<RecordPunchResult> {
  const { orgId, employeeId, punch } = input;
  const existing = await findByKey(deps.db, orgId, employeeId, punch.idempotencyKey);
  if (existing) return { punch: existing, replayed: true };
  const serverTime = deps.clock.now();
  const deviceTime = new Date(punch.deviceTime);
  const sentAt = new Date(punch.sentAt);
  const elapsed = punch.elapsedMs;
  const recordedAt =
    elapsed === undefined
      ? new Date(deviceTime.getTime() + serverTime.getTime() - sentAt.getTime())
      : new Date(serverTime.getTime() - elapsed);
  const offsetMs = recordedAt.getTime() - deviceTime.getTime();
  if (elapsed === undefined && deviceTime.getTime() > sentAt.getTime() + 60_000) {
    throw new AppError(
      "punch_rejected",
      "The punch was tapped after it was sent, so its time can't be trusted. Clock in again.",
    );
  }
  if (serverTime.getTime() - recordedAt.getTime() > MAX_PUNCH_AGE_MS) {
    throw new AppError(
      "punch_rejected",
      "This punch is more than 7 days old, so it can't be recorded automatically. Ask your manager to add it to your timesheet.",
    );
  }
  if (recordedAt.getTime() - serverTime.getTime() > 60_000) {
    throw new AppError("punch_rejected", "This punch is in the future. Check your device's clock and try again.");
  }
  const settings = await loadAttendanceSettings(deps.db, orgId);
  const checked = checkControls(settings, punch, input.ip);
  const skewSeconds = Math.round(offsetMs / 1_000);
  const flags: PunchFlag[] = [];
  if (Math.abs(skewSeconds) > settings.skewThresholdSeconds) flags.push("clock_skew");
  if (serverTime.getTime() - recordedAt.getTime() > LATE_SYNC_MS) flags.push("late_sync");
  flags.push(...checked.flags);
  return deps.db.transaction(async (tx) => {
    const id = deps.ids.newId();
    const workDate = await workDateFor(tx, orgId, employeeId, punch.kind, recordedAt);
    if (settings.timesheetApproval) {
      const locked = await approvedCovering(tx, orgId, employeeId, workDate);
      if (locked) throw punchLockedError(locked);
    }
    const [row] = await tx
      .insert(attendancePunches)
      .values({
        id,
        orgId,
        employeeId,
        kind: punch.kind,
        idempotencyKey: punch.idempotencyKey,
        source: punch.source as PunchSource,
        deviceTime,
        sentAt,
        serverTime,
        recordedAt,
        workDate,
        skewSeconds,
        queued: punch.queued,
        latitude: checked.location?.latitude ?? null,
        longitude: checked.location?.longitude ?? null,
        accuracyMetres: checked.location?.accuracyMetres ?? null,
        ip: input.ip,
        flags,
        createdByMembershipId: input.membershipId,
      })
      .onConflictDoNothing()
      .returning();
    if (!row) {
      // A concurrent retry with the same key won the insert.
      const again = await findByKey(tx, orgId, employeeId, punch.idempotencyKey);
      if (!again) throw new Error("punch insert conflicted but no row was found");
      return { punch: again, replayed: true };
    }
    await recordAudit(tx, deps, audit, {
      action: "attendance.punched",
      targetType: "attendance_punch",
      targetId: id,
      meta: { employeeId, kind: punch.kind, queued: punch.queued, flags },
    });
    return { punch: row, replayed: false };
  });
}

/** Today's punches and whether the employee is clocked in (the clock-in screen). */
export async function punchStatus(db: Db, orgId: string, employeeId: string, now: Date) {
  const today = singaporeDate(now);
  const yesterday = addDays(today, -1);
  const rows = await db
    .select()
    .from(attendancePunches)
    .where(
      orgScope(db, orgId).where(
        attendancePunches,
        eq(attendancePunches.employeeId, employeeId),
        isNull(attendancePunches.voidedAt),
      ),
    )
    .orderBy(desc(attendancePunches.recordedAt))
    .limit(40);
  const last = rows[0] ?? null;
  // Yesterday's punches belong on today's screen only while that shift is still open (overnight
  // work) and a clock-out can still close it, i.e. before the 04:00 cut-off; once clocked out, or
  // after the cut-off, they are yesterday's (a clock-out then starts a new day).
  const overnight = last?.kind === "in" && last.workDate === yesterday && sgHour(now) < OVERNIGHT_CUTOFF_HOUR;
  const todays = rows.filter((r) => r.workDate === today || (overnight && r.workDate === yesterday));
  return {
    clockedIn: last?.kind === "in" && (last.workDate === today || overnight),
    lastPunch: last,
    today: todays.reverse(),
  };
}

export async function loadPunch(db: Db, orgId: string, id: string): Promise<AttendancePunch> {
  const row = await orgScope(db, orgId).findById(attendancePunches, id);
  if (!row) throw new AppError("not_found", "That punch doesn't exist or you can't see it.");
  return row;
}
