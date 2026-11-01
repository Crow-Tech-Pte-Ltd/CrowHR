import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  bigint,
  boolean,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { employees } from "./employees.ts";
import { workSchedules } from "./organisation.ts";
import { organisations } from "./organisations.ts";

/**
 * Leave (openspec/changes/add-leave). Conventions as in `organisation.ts`: `org_id` everywhere,
 * `unique (org_id, id)` and composite foreign keys so the database rejects cross-organisation
 * references.
 *
 * Quantities are integers in **hundredths of the unit** (`hundredths`): 1 day = 100, half a day
 * = 50, 25.5 hours = 2550. The unit (`days` or `hours`) is stored next to every quantity because
 * part-time employees hold some balances in hours.
 */

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
};

const orgId = () =>
  uuid("org_id")
    .notNull()
    .references(() => organisations.id, { onDelete: "cascade" });

const employeeFk = (name: string, t: { orgId: AnyPgColumn; employeeId: AnyPgColumn }) =>
  foreignKey({ name, columns: [t.orgId, t.employeeId], foreignColumns: [employees.orgId, employees.id] }).onDelete(
    "cascade",
  );

export type LeaveUnit = "days" | "hours";
export type LeaveSession = "full" | "am" | "pm";

/** Statutory behaviours the code knows. Company types have none. */
export type StatutoryLeaveCode =
  | "annual"
  | "sick_outpatient"
  | "hospitalisation"
  | "maternity"
  | "paternity"
  | "shared_parental"
  | "childcare"
  | "extended_childcare"
  | "infant_care"
  | "adoption"
  | "ns"
  | "no_pay";

export type LeaveDayCounting = "working_days" | "working_days_including_holidays";
export type LeaveAttachmentRule = "none" | "optional" | "required";

export type LeaveEntitlementBasis =
  /** The statutory scale or rule for the type (annual, sick, parental…). */
  | { basis: "statutory" }
  /** Days per leave year (never below statutory for statutory types). */
  | { basis: "fixed"; days: number }
  /** Days per leave year by service year (1-based); the last step applies to later years. */
  | { basis: "by_service"; steps: { fromServiceYear: number; days: number }[] }
  /** No balance: any number of days may be applied for (NS, no-pay). */
  | { basis: "unlimited" };

export interface LeavePolicy {
  entitlement: LeaveEntitlementBasis;
  /** Completed months of service before the type can be used (statutory minimum 3 where it applies). */
  minServiceMonths: number;
  /** Pro-rate by completed months in the first calendar year of service and in the year of leaving. */
  prorate: boolean;
  /** `upfront`: the year's days on 1 Jan (or on eligibility); `monthly`: earned month by month. */
  accrual: "upfront" | "monthly";
  /** Null: nothing carries forward. `maxDays` null: all unused days carry. */
  carryForward: { maxDays: number | null; expiresAfterMonths: number | null } | null;
  /** Unused days beyond the carry-forward cap are marked for encashment instead of forfeited. */
  encashable: boolean;
  /** Employee self-service requests; absent in older policies means disabled. */
  employeeEncashmentRequests?: boolean;
}

export const leaveTypes = pgTable(
  "leave_types",
  {
    id: uuid("id").primaryKey(),
    orgId: orgId(),
    code: text("code").notNull(),
    name: text("name").notNull(),
    statutoryCode: text("statutory_code").$type<StatutoryLeaveCode>(),
    paid: boolean("paid").notNull(),
    dayCounting: text("day_counting").$type<LeaveDayCounting>().notNull(),
    halfDays: boolean("half_days").notNull(),
    attachment: text("attachment").$type<LeaveAttachmentRule>().notNull(),
    attachmentLabel: text("attachment_label"),
    /** Colleagues outside the viewer's scope see "On leave" instead of the type. */
    sensitive: boolean("sensitive").notNull(),
    policy: jsonb("policy").$type<LeavePolicy>().notNull(),
    sortOrder: smallint("sort_order").notNull().default(100),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [unique("leave_types_org_id_id_unique").on(t.orgId, t.id), unique("leave_types_org_code").on(t.orgId, t.code)],
);

export type OffDayHolidayRule = "extra_pay" | "next_working_day";
export type UnpaidServiceRule = "none" | "whole_month" | "any_day";

export const leaveSettings = pgTable(
  "leave_settings",
  {
    orgId: uuid("org_id")
      .primaryKey()
      .references(() => organisations.id, { onDelete: "cascade" }),
    /** A public holiday on an off day (e.g. Saturday in a 5-day week): extra pay (default) or the next working day off. */
    offDayHoliday: text("off_day_holiday").$type<OffDayHolidayRule>().notNull().default("extra_pay"),
    /** Which months of no-pay leave stop counting as service (MOM excludes unpaid leave from service). */
    unpaidServiceRule: text("unpaid_service_rule").$type<UnpaidServiceRule>().notNull().default("whole_month"),
    /** The comparable full-timer's schedule for part-time hours; null = the org's default schedule. */
    fullTimeScheduleId: uuid("full_time_schedule_id"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: "leave_settings_schedule_fk",
      columns: [t.orgId, t.fullTimeScheduleId],
      foreignColumns: [workSchedules.orgId, workSchedules.id],
    }),
  ],
);

/** Ad-hoc public holidays (Polling Day, s 35 Parliamentary Elections Act) added by admins. */
export const leaveHolidays = pgTable(
  "leave_holidays",
  {
    id: uuid("id").primaryKey(),
    orgId: orgId(),
    date: date("date").notNull(),
    name: text("name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("leave_holidays_org_id_id_unique").on(t.orgId, t.id),
    unique("leave_holidays_org_date").on(t.orgId, t.date),
  ],
);

/** An employee's child, for maternity, paternity, shared parental, adoption, childcare and infant care. */
export const leaveChildren = pgTable(
  "leave_children",
  {
    id: uuid("id").primaryKey(),
    orgId: orgId(),
    employeeId: uuid("employee_id").notNull(),
    name: text("name").notNull(),
    birthDate: date("birth_date"),
    expectedDeliveryDate: date("expected_delivery_date"),
    /** Singapore citizen, or will become one within 12 months (declared). */
    isCitizen: boolean("is_citizen").notNull(),
    /** 1-based order among this parent's children (funding: 1st/2nd vs 3rd and later). */
    birthOrder: smallint("birth_order").notNull(),
    stillborn: boolean("stillborn").notNull().default(false),
    adoptionIntentDate: date("adoption_intent_date"),
    /** Father: married to the mother between conception and birth or within 12 months after. */
    marriedToMother: boolean("married_to_mother"),
    ...timestamps,
  },
  (t) => [
    unique("leave_children_org_id_id_unique").on(t.orgId, t.id),
    employeeFk("leave_children_employee_fk", t),
    index("leave_children_employee").on(t.orgId, t.employeeId),
  ],
);

export type LeaveRequestStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "withdrawn"
  | "cancellation_pending"
  | "cancelled";

export const leaveRequests = pgTable(
  "leave_requests",
  {
    id: uuid("id").primaryKey(),
    orgId: orgId(),
    employeeId: uuid("employee_id").notNull(),
    leaveTypeId: uuid("leave_type_id").notNull(),
    childId: uuid("child_id"),
    startDate: date("start_date").notNull(),
    endDate: date("end_date").notNull(),
    startSession: text("start_session").$type<LeaveSession>().notNull(),
    endSession: text("end_session").$type<LeaveSession>().notNull(),
    unit: text("unit").$type<LeaveUnit>().notNull(),
    hundredths: integer("hundredths").notNull(),
    reason: text("reason"),
    status: text("status").$type<LeaveRequestStatus>().notNull(),
    approvalRequestId: uuid("approval_request_id"),
    cancellationRequestId: uuid("cancellation_request_id"),
    requestedByMembershipId: uuid("requested_by_membership_id").notNull(),
    onBehalf: boolean("on_behalf").notNull().default(false),
    cancelReason: text("cancel_reason"),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    unique("leave_requests_org_id_id_unique").on(t.orgId, t.id),
    employeeFk("leave_requests_employee_fk", t),
    foreignKey({
      name: "leave_requests_type_fk",
      columns: [t.orgId, t.leaveTypeId],
      foreignColumns: [leaveTypes.orgId, leaveTypes.id],
    }),
    foreignKey({
      name: "leave_requests_child_fk",
      columns: [t.orgId, t.childId],
      foreignColumns: [leaveChildren.orgId, leaveChildren.id],
    }),
    index("leave_requests_employee").on(t.orgId, t.employeeId, t.startDate),
  ],
);

/** One row per counted date of a request (drives overlaps, calendars, payroll and reports). */
export const leaveRequestDays = pgTable(
  "leave_request_days",
  {
    id: uuid("id").primaryKey(),
    orgId: orgId(),
    requestId: uuid("request_id").notNull(),
    employeeId: uuid("employee_id").notNull(),
    leaveTypeId: uuid("leave_type_id").notNull(),
    date: date("date").notNull(),
    session: text("session").$type<LeaveSession>().notNull(),
    hundredths: integer("hundredths").notNull(),
    leaveYear: integer("leave_year").notNull(),
  },
  (t) => [
    unique("leave_request_days_org_id_id_unique").on(t.orgId, t.id),
    foreignKey({
      name: "leave_request_days_request_fk",
      columns: [t.orgId, t.requestId],
      foreignColumns: [leaveRequests.orgId, leaveRequests.id],
    }).onDelete("cascade"),
    employeeFk("leave_request_days_employee_fk", t),
    index("leave_request_days_employee_date").on(t.orgId, t.employeeId, t.date),
    index("leave_request_days_date").on(t.orgId, t.date),
  ],
);

export const leaveAttachments = pgTable(
  "leave_attachments",
  {
    id: uuid("id").primaryKey(),
    orgId: orgId(),
    requestId: uuid("request_id").notNull(),
    fileKey: text("file_key").notNull(),
    filename: text("filename").notNull(),
    contentType: text("content_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    uploadedByMembershipId: uuid("uploaded_by_membership_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("leave_attachments_org_id_id_unique").on(t.orgId, t.id),
    foreignKey({
      name: "leave_attachments_request_fk",
      columns: [t.orgId, t.requestId],
      foreignColumns: [leaveRequests.orgId, leaveRequests.id],
    }).onDelete("cascade"),
  ],
);

export type LeaveLedgerKind =
  | "carry_forward"
  | "expiry"
  | "forfeit"
  | "encashment"
  | "adjustment"
  | "taken"
  | "restored";

/** Signed balance movements. Entitlement itself is computed (design decision 2). */
export const leaveLedger = pgTable(
  "leave_ledger",
  {
    id: uuid("id").primaryKey(),
    orgId: orgId(),
    employeeId: uuid("employee_id").notNull(),
    leaveTypeId: uuid("leave_type_id").notNull(),
    leaveYear: integer("leave_year").notNull(),
    childId: uuid("child_id"),
    kind: text("kind").$type<LeaveLedgerKind>().notNull(),
    unit: text("unit").$type<LeaveUnit>().notNull(),
    hundredths: integer("hundredths").notNull(),
    requestId: uuid("request_id"),
    /** De-duplication key for jobs: `ye:<year>:<employee>:<type>:<in|out|forfeit|encash>`, `exp:<carry row id>`. */
    sourceRef: text("source_ref"),
    /** Carry-forward rows: the date the carried days expire (exclusive). */
    expiresOn: date("expires_on"),
    reason: text("reason"),
    createdByMembershipId: uuid("created_by_membership_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("leave_ledger_org_id_id_unique").on(t.orgId, t.id),
    employeeFk("leave_ledger_employee_fk", t),
    foreignKey({
      name: "leave_ledger_type_fk",
      columns: [t.orgId, t.leaveTypeId],
      foreignColumns: [leaveTypes.orgId, leaveTypes.id],
    }),
    foreignKey({
      name: "leave_ledger_request_fk",
      columns: [t.orgId, t.requestId],
      foreignColumns: [leaveRequests.orgId, leaveRequests.id],
    }),
    index("leave_ledger_balance").on(t.orgId, t.employeeId, t.leaveTypeId, t.leaveYear),
    uniqueIndex("leave_ledger_request_once")
      .on(t.requestId, t.kind, t.leaveYear)
      .where(sql`${t.requestId} is not null`),
    uniqueIndex("leave_ledger_source_once").on(t.orgId, t.sourceRef).where(sql`${t.sourceRef} is not null`),
  ],
);

/** One row per organisation and closed leave year: the year-end sweep claims it once (design decision 9). */
export const leaveYearClosings = pgTable(
  "leave_year_closings",
  {
    orgId: uuid("org_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    year: integer("year").notNull(),
    closedAt: timestamp("closed_at", { withTimezone: true }).notNull().defaultNow(),
    employees: integer("employees").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.orgId, t.year] })],
);

export type LeaveType = typeof leaveTypes.$inferSelect;
export type LeaveRequest = typeof leaveRequests.$inferSelect;
export type LeaveRequestDay = typeof leaveRequestDays.$inferSelect;
export type LeaveChild = typeof leaveChildren.$inferSelect;
export type LeaveLedgerEntry = typeof leaveLedger.$inferSelect;
export type LeaveSettingsRow = typeof leaveSettings.$inferSelect;

/** Approved requests feed payroll via payroll_feed_reservations (no independent paid flag). */
export const leaveEncashments = pgTable(
  "leave_encashments",
  {
    id: uuid("id").primaryKey(),
    orgId: orgId(),
    employeeId: uuid("employee_id").notNull(),
    leaveTypeId: uuid("leave_type_id").notNull(),
    leaveYear: integer("leave_year").notNull(),
    unit: text("unit").$type<LeaveUnit>().notNull(),
    hundredths: integer("hundredths").notNull(),
    /** Existing year-end movement, already deducted. One request per movement, ever. */
    ledgerEntryId: uuid("ledger_entry_id"),
    amountCents: bigint("amount_cents", { mode: "number" }).notNull(),
    rateText: text("rate_text").notNull(),
    rateDate: date("rate_date").notNull(),
    status: text("status").$type<"pending" | "approved" | "rejected" | "withdrawn">().notNull(),
    approvalRequestId: uuid("approval_request_id"),
    requestedByMembershipId: uuid("requested_by_membership_id").notNull(),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    unique("leave_encashments_org_id_id_unique").on(t.orgId, t.id),
    unique("leave_encashments_ledger_once").on(t.orgId, t.ledgerEntryId),
    employeeFk("leave_encashments_employee_fk", t),
    foreignKey({
      name: "leave_encashments_type_fk",
      columns: [t.orgId, t.leaveTypeId],
      foreignColumns: [leaveTypes.orgId, leaveTypes.id],
    }),
    foreignKey({
      name: "leave_encashments_ledger_fk",
      columns: [t.orgId, t.ledgerEntryId],
      foreignColumns: [leaveLedger.orgId, leaveLedger.id],
    }),
    index("leave_encashments_balance").on(t.orgId, t.employeeId, t.leaveYear),
  ],
);
export type LeaveEncashment = typeof leaveEncashments.$inferSelect;
