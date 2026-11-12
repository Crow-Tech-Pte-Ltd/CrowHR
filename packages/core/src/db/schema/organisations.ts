import { sql } from "drizzle-orm";
import { index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

/**
 * A tenant. Every tenant-owned table references this via `org_id`
 * (AGENTS.md hard rule 6).
 */
export const organisations = pgTable(
  "organisations",
  {
    id: uuid("id").primaryKey(),
    name: text("name").notNull(),
    /** Singapore Unique Entity Number (ACRA). Optional until onboarding asks for it. */
    uen: text("uen").unique(),
    /**
     * URL-safe identifier used by `/sign-in/<slug>` and `GET /api/v1/meta?org=<slug>`.
     * Lower-case letters, digits and hyphens. Nullable only for rows created before it existed;
     * the setup and organisation services always set it.
     */
    slug: text("slug").unique(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    /**
     * Set only for a demo company (demo-companies design decision 2): when it is deleted with
     * everything in it. A trigger refuses any UPDATE that sets it on an organisation without one or
     * clears it, so a real organisation can never become a demo company (and so deletable). Null
     * for every real organisation.
     */
    demoExpiresAt: timestamp("demo_expires_at", { withTimezone: true }),
    /** When a visitor was handed this demo company; null while it waits in the pool. */
    demoClaimedAt: timestamp("demo_claimed_at", { withTimezone: true }),
  },
  (t) => [index("organisations_demo_expires_idx").on(t.demoExpiresAt).where(sql`${t.demoExpiresAt} is not null`)],
);

export type Organisation = typeof organisations.$inferSelect;
export type NewOrganisation = typeof organisations.$inferInsert;
