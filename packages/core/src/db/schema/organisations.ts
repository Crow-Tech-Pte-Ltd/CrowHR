import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

/**
 * A tenant. Every tenant-owned table references this via `org_id`
 * (AGENTS.md hard rule 6).
 */
export const organisations = pgTable("organisations", {
  id: uuid("id").primaryKey(),
  name: text("name").notNull(),
  /** Singapore Unique Entity Number (ACRA). Optional until onboarding asks for it. */
  uen: text("uen").unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Organisation = typeof organisations.$inferSelect;
export type NewOrganisation = typeof organisations.$inferInsert;
