import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  boolean,
  date,
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
import { departments, locations } from "./organisation.ts";
import { organisations } from "./organisations.ts";

/**
 * Shift scheduling (openspec/changes/add-scheduling). Conventions as in `organisation.ts`:
 * `org_id` everywhere, `unique (org_id, id)` and composite foreign keys.
 *
 * Managers edit `roster_shifts` (the working copy). Publishing copies it into `published_shifts`
 * (same ids), which is all that employees, attendance, leave and payroll ever read (design
 * decision 3).
 */

const orgId = () =>
  uuid("org_id")
    .notNull()
    .references(() => organisations.id, { onDelete: "cascade" });

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
};

/** Restrained colour tokens (AGENTS.md design language): a thin marker, never a filled cell. */
export const SHIFT_COLOURS = ["plain", "kuning", "biru", "oren", "ink"] as const;
export type ShiftColour = (typeof SHIFT_COLOURS)[number];

export const shiftTemplates = pgTable(
  "shift_templates",
  {
    id: uuid("id").primaryKey(),
    orgId: orgId(),
    locationId: uuid("location_id"),
    name: text("name").notNull(),
    code: text("code").notNull(),
    /** `HH:MM` (SGT). An end at or before the start ends the next day. */
    startTime: text("start_time").notNull(),
    endTime: text("end_time").notNull(),
    breakMinutes: integer("break_minutes").notNull().default(0),
    colour: text("colour").$type<ShiftColour>().notNull().default("plain"),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    unique("shift_templates_org_id_id_unique").on(t.orgId, t.id),
    foreignKey({
      name: "shift_templates_location_fk",
      columns: [t.orgId, t.locationId],
      foreignColumns: [locations.orgId, locations.id],
    }),
    uniqueIndex("shift_templates_active_code_unique")
      .on(t.orgId, sql`lower(${t.code})`)
      .where(sql`${t.archivedAt} is null`),
  ],
);

export type RosterStatus = "draft" | "published";

export const rosters = pgTable(
  "rosters",
  {
    id: uuid("id").primaryKey(),
    orgId: orgId(),
    locationId: uuid("location_id"),
    departmentId: uuid("department_id"),
    /** `<locationId|*>:<departmentId|*>`: one roster per scope and week. */
    scopeKey: text("scope_key").notNull(),
    /** Monday of the ISO week. */
    weekStart: date("week_start").notNull(),
    status: text("status").$type<RosterStatus>().notNull().default("draft"),
    /** Incremented by each publish and each approved swap. */
    version: integer("version").notNull().default(0),
    /** The working copy differs from the published copy. */
    hasChanges: boolean("has_changes").notNull().default(false),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    publishedByMembershipId: uuid("published_by_membership_id"),
    createdByMembershipId: uuid("created_by_membership_id"),
    ...timestamps,
  },
  (t) => [
    unique("rosters_org_id_id_unique").on(t.orgId, t.id),
    unique("rosters_scope_week_unique").on(t.orgId, t.scopeKey, t.weekStart),
    foreignKey({
      name: "rosters_location_fk",
      columns: [t.orgId, t.locationId],
      foreignColumns: [locations.orgId, locations.id],
    }),
    foreignKey({
      name: "rosters_department_fk",
      columns: [t.orgId, t.departmentId],
      foreignColumns: [departments.orgId, departments.id],
    }),
    index("rosters_week").on(t.orgId, t.weekStart),
  ],
);

export type ShiftKind = "shift" | "rest";

/** Columns shared by the working and the published copy. */
function shiftColumns() {
  return {
    id: uuid("id").primaryKey(),
    orgId: orgId(),
    rosterId: uuid("roster_id").notNull(),
    /** Null: an open shift anyone eligible may ask to pick up. */
    employeeId: uuid("employee_id"),
    kind: text("kind").$type<ShiftKind>().notNull().default("shift"),
    /** The roster day the shift starts on. */
    date: date("date").notNull(),
    startsAt: timestamp("starts_at", { withTimezone: true }),
    endsAt: timestamp("ends_at", { withTimezone: true }),
    breakMinutes: integer("break_minutes").notNull().default(0),
    templateId: uuid("template_id"),
    note: text("note"),
  };
}

type ShiftCols = { orgId: AnyPgColumn; rosterId: AnyPgColumn; employeeId: AnyPgColumn; templateId: AnyPgColumn };
const shiftFks = (prefix: string, t: ShiftCols) => [
  foreignKey({
    name: `${prefix}_roster_fk`,
    columns: [t.orgId, t.rosterId],
    foreignColumns: [rosters.orgId, rosters.id],
  }).onDelete("cascade"),
  foreignKey({
    name: `${prefix}_employee_fk`,
    columns: [t.orgId, t.employeeId],
    foreignColumns: [employees.orgId, employees.id],
  }).onDelete("cascade"),
  foreignKey({
    name: `${prefix}_template_fk`,
    columns: [t.orgId, t.templateId],
    foreignColumns: [shiftTemplates.orgId, shiftTemplates.id],
  }),
];

export const rosterShifts = pgTable(
  "roster_shifts",
  {
    ...shiftColumns(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("roster_shifts_org_id_id_unique").on(t.orgId, t.id),
    ...shiftFks("roster_shifts", t),
    index("roster_shifts_roster").on(t.orgId, t.rosterId),
    index("roster_shifts_employee").on(t.orgId, t.employeeId, t.date),
  ],
);

export const publishedShifts = pgTable(
  "published_shifts",
  {
    ...shiftColumns(),
    /** The roster version that published this row. */
    version: integer("version").notNull(),
    publishedAt: timestamp("published_at", { withTimezone: true }).notNull(),
  },
  (t) => [
    unique("published_shifts_org_id_id_unique").on(t.orgId, t.id),
    ...shiftFks("published_shifts", t),
    index("published_shifts_roster").on(t.orgId, t.rosterId),
    index("published_shifts_employee").on(t.orgId, t.employeeId, t.date),
  ],
);

export interface Acknowledgement {
  shiftId: string;
  kind: string;
}

export interface PublishChange {
  employeeId: string;
  before: string[];
  after: string[];
}

export const rosterPublications = pgTable(
  "roster_publications",
  {
    id: uuid("id").primaryKey(),
    orgId: orgId(),
    rosterId: uuid("roster_id").notNull(),
    version: integer("version").notNull(),
    publishedByMembershipId: uuid("published_by_membership_id").notNull(),
    acknowledged: jsonb("acknowledged").$type<Acknowledgement[]>().notNull().default([]),
    changes: jsonb("changes").$type<PublishChange[]>().notNull().default([]),
    publishedAt: timestamp("published_at", { withTimezone: true }).notNull(),
  },
  (t) => [
    unique("roster_publications_org_id_id_unique").on(t.orgId, t.id),
    foreignKey({
      name: "roster_publications_roster_fk",
      columns: [t.orgId, t.rosterId],
      foreignColumns: [rosters.orgId, rosters.id],
    }).onDelete("cascade"),
  ],
);

export type SwapKind = "swap" | "giveaway" | "pickup";
export type SwapStatus =
  | "pending_peer"
  | "pending_approval"
  | "approved"
  | "rejected"
  | "declined"
  | "cancelled"
  | "expired";
export const OPEN_SWAP_STATUSES: readonly SwapStatus[] = ["pending_peer", "pending_approval"];

export const shiftSwaps = pgTable(
  "shift_swaps",
  {
    id: uuid("id").primaryKey(),
    orgId: orgId(),
    rosterId: uuid("roster_id").notNull(),
    kind: text("kind").$type<SwapKind>().notNull(),
    /** The shift offered (swap, give-away) or asked for (pickup). */
    shiftId: uuid("shift_id").notNull(),
    requesterEmployeeId: uuid("requester_employee_id").notNull(),
    /** The colleague (swap, give-away). */
    peerEmployeeId: uuid("peer_employee_id"),
    /** The colleague's shift taken in exchange (swap). */
    peerShiftId: uuid("peer_shift_id"),
    status: text("status").$type<SwapStatus>().notNull(),
    approvalRequestId: uuid("approval_request_id"),
    note: text("note"),
    createdByMembershipId: uuid("created_by_membership_id").notNull(),
    /** The earlier shift's start: the request expires then. */
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    reason: text("reason"),
    ...timestamps,
  },
  (t) => [
    unique("shift_swaps_org_id_id_unique").on(t.orgId, t.id),
    foreignKey({
      name: "shift_swaps_roster_fk",
      columns: [t.orgId, t.rosterId],
      foreignColumns: [rosters.orgId, rosters.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "shift_swaps_shift_fk",
      columns: [t.orgId, t.shiftId],
      foreignColumns: [rosterShifts.orgId, rosterShifts.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "shift_swaps_peer_shift_fk",
      columns: [t.orgId, t.peerShiftId],
      foreignColumns: [rosterShifts.orgId, rosterShifts.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "shift_swaps_requester_fk",
      columns: [t.orgId, t.requesterEmployeeId],
      foreignColumns: [employees.orgId, employees.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "shift_swaps_peer_fk",
      columns: [t.orgId, t.peerEmployeeId],
      foreignColumns: [employees.orgId, employees.id],
    }).onDelete("cascade"),
    uniqueIndex("shift_swaps_one_open")
      .on(t.orgId, t.shiftId)
      .where(sql`${t.status} in ('pending_peer', 'pending_approval')`),
    index("shift_swaps_peer").on(t.orgId, t.peerEmployeeId, t.status),
  ],
);

export type ShiftTemplate = typeof shiftTemplates.$inferSelect;
export type Roster = typeof rosters.$inferSelect;
export type RosterShift = typeof rosterShifts.$inferSelect;
export type PublishedShift = typeof publishedShifts.$inferSelect;
export type ShiftSwap = typeof shiftSwaps.$inferSelect;
