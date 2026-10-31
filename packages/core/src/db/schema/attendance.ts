import { sql } from "drizzle-orm";
import {
  boolean,
  date,
  doublePrecision,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { employees } from "./employees.ts";
import { organisations } from "./organisations.ts";

/**
 * Attendance and overtime (openspec/changes/add-attendance). Conventions as in `organisation.ts`.
 * Day records are computed from punches on read (design decision 3); corrections are punches.
 */

export interface AttendanceOffice {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  radiusMetres: number;
}

export type LocationMode = "off" | "optional" | "required";
export type Enforcement = "flag" | "block";

export const attendanceSettings = pgTable("attendance_settings", {
  orgId: uuid("org_id")
    .primaryKey()
    .references(() => organisations.id, { onDelete: "cascade" }),
  /** `off`: never store location. `optional`: store when the device gives it. `required`: a punch needs one. */
  locationMode: text("location_mode").$type<LocationMode>().notNull().default("off"),
  offices: jsonb("offices").$type<AttendanceOffice[]>().notNull().default([]),
  locationEnforcement: text("location_enforcement").$type<Enforcement>().notNull().default("flag"),
  /** CIDR ranges, e.g. `203.0.113.0/24`. Empty: any network. */
  allowedIps: jsonb("allowed_ips").$type<string[]>().notNull().default([]),
  ipEnforcement: text("ip_enforcement").$type<Enforcement>().notNull().default("flag"),
  /** Shown before the first punch when location is collected (PDPA notification obligation). */
  pdpaNotice: text("pdpa_notice"),
  /** Scheduled start of a working day, `HH:MM` (SGT); per-schedule overrides below. */
  defaultStartTime: text("default_start_time").notNull().default("09:00"),
  scheduleStartTimes: jsonb("schedule_start_times").$type<Record<string, string>>().notNull().default({}),
  /** Unpaid break deducted from a day whose span exceeds 6 hours. */
  breakMinutes: integer("break_minutes").notNull().default(60),
  lateGraceMinutes: integer("late_grace_minutes").notNull().default(5),
  earlyOutGraceMinutes: integer("early_out_grace_minutes").notNull().default(5),
  skewThresholdSeconds: integer("skew_threshold_seconds").notNull().default(120),
  otBlockMinutes: integer("ot_block_minutes").notNull().default(15),
  otMinimumMinutes: integer("ot_minimum_minutes").notNull().default(30),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type PunchKind = "in" | "out";
export type PunchSource = "web" | "mobile_web" | "correction";
export type PunchFlag = "clock_skew" | "late_sync" | "outside_location" | "no_location" | "ip_not_allowed";

export const attendancePunches = pgTable(
  "attendance_punches",
  {
    id: uuid("id").primaryKey(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    employeeId: uuid("employee_id").notNull(),
    kind: text("kind").$type<PunchKind>().notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    source: text("source").$type<PunchSource>().notNull(),
    /** Device clock at the tap. */
    deviceTime: timestamp("device_time", { withTimezone: true }).notNull(),
    /** Device clock when the punch was sent (measures the device clock offset). */
    sentAt: timestamp("sent_at", { withTimezone: true }).notNull(),
    serverTime: timestamp("server_time", { withTimezone: true }).notNull(),
    /** The punch time used for timesheets: tap time corrected by the measured offset. */
    recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull(),
    workDate: date("work_date").notNull(),
    skewSeconds: integer("skew_seconds").notNull(),
    queued: boolean("queued").notNull().default(false),
    latitude: doublePrecision("latitude"),
    longitude: doublePrecision("longitude"),
    accuracyMetres: integer("accuracy_metres"),
    ip: text("ip"),
    flags: jsonb("flags").$type<PunchFlag[]>().notNull().default([]),
    /** Corrections: why the punch was added. */
    reason: text("reason"),
    createdByMembershipId: uuid("created_by_membership_id"),
    voidedAt: timestamp("voided_at", { withTimezone: true }),
    voidedByMembershipId: uuid("voided_by_membership_id"),
    voidReason: text("void_reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("attendance_punches_org_id_id_unique").on(t.orgId, t.id),
    foreignKey({
      name: "attendance_punches_employee_fk",
      columns: [t.orgId, t.employeeId],
      foreignColumns: [employees.orgId, employees.id],
    }).onDelete("cascade"),
    unique("attendance_punches_idempotency").on(t.orgId, t.employeeId, t.idempotencyKey),
    index("attendance_punches_day").on(t.orgId, t.employeeId, t.workDate),
  ],
);

export type OvertimeClaimStatus = "pending" | "approved" | "rejected" | "withdrawn";

export const overtimeClaims = pgTable(
  "overtime_claims",
  {
    id: uuid("id").primaryKey(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    employeeId: uuid("employee_id").notNull(),
    workDate: date("work_date").notNull(),
    computedMinutes: integer("computed_minutes").notNull(),
    claimedMinutes: integer("claimed_minutes").notNull(),
    approvedMinutes: integer("approved_minutes"),
    /** Covered by Employment Act Part 4 on the date (statutory OT); false = contractual OT. */
    statutory: boolean("statutory").notNull(),
    reason: text("reason"),
    status: text("status").$type<OvertimeClaimStatus>().notNull(),
    approvalRequestId: uuid("approval_request_id"),
    createdByMembershipId: uuid("created_by_membership_id").notNull(),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("overtime_claims_org_id_id_unique").on(t.orgId, t.id),
    foreignKey({
      name: "overtime_claims_employee_fk",
      columns: [t.orgId, t.employeeId],
      foreignColumns: [employees.orgId, employees.id],
    }).onDelete("cascade"),
    uniqueIndex("overtime_claims_one_open")
      .on(t.orgId, t.employeeId, t.workDate)
      .where(sql`${t.status} in ('pending', 'approved')`),
    index("overtime_claims_period").on(t.orgId, t.workDate),
  ],
);

export type AttendanceSettingsRow = typeof attendanceSettings.$inferSelect;
export type AttendancePunch = typeof attendancePunches.$inferSelect;
export type OvertimeClaim = typeof overtimeClaims.$inferSelect;
