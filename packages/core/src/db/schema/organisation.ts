import { sql } from "drizzle-orm";
import {
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
import { organisations } from "./organisations.ts";

/**
 * Organisation structure (add-organisation-and-people).
 *
 * Conventions shared by every tenant table in this file and `employees.ts`:
 * - `org_id` is NOT NULL and references `organisations`;
 * - each table has `unique (org_id, id)` so other tenant tables can use
 *   composite foreign keys `(org_id, x_id) → (org_id, id)`, which makes the
 *   database itself reject cross-organisation references;
 * - "archive, never delete": lists carry `archived_at`.
 */

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
};

/**
 * One row per organisation: the legal entity's profile (one UEN, one CSN per
 * org in v1). Kept as a 1:1 table keyed by `org_id` rather than extra columns
 * on `organisations` so that this workstream does not edit the foundation's
 * table file.
 */
export const companyProfiles = pgTable("company_profiles", {
  orgId: uuid("org_id")
    .primaryKey()
    .references(() => organisations.id, { onDelete: "cascade" }),
  legalName: text("legal_name").notNull(),
  tradingName: text("trading_name"),
  uen: text("uen").notNull(),
  csn: text("csn"),
  addressBlock: text("address_block"),
  addressStreet: text("address_street"),
  addressUnit: text("address_unit"),
  addressBuilding: text("address_building"),
  postalCode: text("postal_code"),
  /** FileStore key of the uploaded logo (PNG or SVG, ≤ 1 MB). */
  logoFileKey: text("logo_file_key"),
  logoContentType: text("logo_content_type"),
  ...timestamps,
});

export const departments = pgTable(
  "departments",
  {
    id: uuid("id").primaryKey(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    code: text("code"),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    unique("departments_org_id_id_unique").on(t.orgId, t.id),
    uniqueIndex("departments_active_name_unique")
      .on(t.orgId, sql`lower(${t.name})`)
      .where(sql`${t.archivedAt} is null`),
  ],
);

export const teams = pgTable(
  "teams",
  {
    id: uuid("id").primaryKey(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    departmentId: uuid("department_id"),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    unique("teams_org_id_id_unique").on(t.orgId, t.id),
    uniqueIndex("teams_active_name_unique").on(t.orgId, sql`lower(${t.name})`).where(sql`${t.archivedAt} is null`),
    foreignKey({
      name: "teams_department_fk",
      columns: [t.orgId, t.departmentId],
      foreignColumns: [departments.orgId, departments.id],
    }),
  ],
);

export const locations = pgTable(
  "locations",
  {
    id: uuid("id").primaryKey(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    address: text("address"),
    postalCode: text("postal_code"),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    unique("locations_org_id_id_unique").on(t.orgId, t.id),
    uniqueIndex("locations_active_name_unique").on(t.orgId, sql`lower(${t.name})`).where(sql`${t.archivedAt} is null`),
  ],
);

export const costCentres = pgTable(
  "cost_centres",
  {
    id: uuid("id").primaryKey(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    code: text("code").notNull(),
    name: text("name").notNull(),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    unique("cost_centres_org_id_id_unique").on(t.orgId, t.id),
    uniqueIndex("cost_centres_active_code_unique")
      .on(t.orgId, sql`lower(${t.code})`)
      .where(sql`${t.archivedAt} is null`),
    uniqueIndex("cost_centres_active_name_unique")
      .on(t.orgId, sql`lower(${t.name})`)
      .where(sql`${t.archivedAt} is null`),
  ],
);

export type WorkScheduleKind = "fixed" | "shift";
export type WorkDayType = "working" | "half" | "off" | "rest";
/** Monday first; always 7 entries. */
export type WorkWeek = { type: WorkDayType; minutes: number }[];

export const workSchedules = pgTable(
  "work_schedules",
  {
    id: uuid("id").primaryKey(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    kind: text("kind").$type<WorkScheduleKind>().notNull(),
    isDefault: boolean("is_default").notNull().default(false),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    unique("work_schedules_org_id_id_unique").on(t.orgId, t.id),
    uniqueIndex("work_schedules_active_name_unique")
      .on(t.orgId, sql`lower(${t.name})`)
      .where(sql`${t.archivedAt} is null`),
    uniqueIndex("work_schedules_one_default").on(t.orgId).where(sql`${t.isDefault}`),
  ],
);

/** Effective-dated versions of a schedule, half-open `[effective_from, effective_to)`. */
export const workScheduleVersions = pgTable(
  "work_schedule_versions",
  {
    id: uuid("id").primaryKey(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    scheduleId: uuid("schedule_id").notNull(),
    effectiveFrom: date("effective_from").notNull(),
    effectiveTo: date("effective_to"),
    /** Seven days, Monday first. Null for `shift` schedules (days come from rosters). */
    days: jsonb("days").$type<WorkWeek | null>(),
    weeklyMinutes: integer("weekly_minutes").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("work_schedule_versions_org_id_id_unique").on(t.orgId, t.id),
    foreignKey({
      name: "work_schedule_versions_schedule_fk",
      columns: [t.orgId, t.scheduleId],
      foreignColumns: [workSchedules.orgId, workSchedules.id],
    }).onDelete("cascade"),
    index("work_schedule_versions_lookup").on(t.orgId, t.scheduleId, t.effectiveFrom),
  ],
);

export type CompanyProfile = typeof companyProfiles.$inferSelect;
export type Department = typeof departments.$inferSelect;
export type Team = typeof teams.$inferSelect;
export type Location = typeof locations.$inferSelect;
export type CostCentre = typeof costCentres.$inferSelect;
export type WorkSchedule = typeof workSchedules.$inferSelect;
export type WorkScheduleVersion = typeof workScheduleVersions.$inferSelect;
