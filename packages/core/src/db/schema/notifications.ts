import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { memberships } from "./access.ts";
import { organisations } from "./organisations.ts";

/**
 * In-app notifications, email preferences, the email outbox and reminder de-duplication
 * ("workflows" spec: In-app notifications, Email notifications, Reminders).
 */

export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").primaryKey(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organisations.id),
    recipientMembershipId: uuid("recipient_membership_id").notNull(),
    kind: text("kind").notNull(),
    category: text("category").notNull(),
    title: text("title").notNull(),
    body: text("body"),
    /** In-app path, e.g. `/inbox?request=<id>`. */
    link: text("link").notNull(),
    subjectType: text("subject_type"),
    subjectId: uuid("subject_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    readAt: timestamp("read_at", { withTimezone: true }),
  },
  (t) => [
    unique("notifications_org_id_unique").on(t.orgId, t.id),
    foreignKey({
      name: "notifications_recipient_fk",
      columns: [t.orgId, t.recipientMembershipId],
      foreignColumns: [memberships.orgId, memberships.id],
    }).onDelete("cascade"),
    index("notifications_recipient_idx").on(t.orgId, t.recipientMembershipId, t.createdAt),
    index("notifications_created_idx").on(t.createdAt),
  ],
);

export const notificationPrefs = pgTable(
  "notification_prefs",
  {
    orgId: uuid("org_id")
      .notNull()
      .references(() => organisations.id),
    membershipId: uuid("membership_id").notNull(),
    category: text("category").notNull(),
    emailEnabled: boolean("email_enabled").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.membershipId, t.category] }),
    foreignKey({
      name: "notification_prefs_membership_fk",
      columns: [t.orgId, t.membershipId],
      foreignColumns: [memberships.orgId, memberships.id],
    }).onDelete("cascade"),
  ],
);

export const emailOutbox = pgTable(
  "email_outbox",
  {
    id: uuid("id").primaryKey(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organisations.id),
    toAddress: text("to_address").notNull(),
    recipientMembershipId: uuid("recipient_membership_id"),
    kind: text("kind").notNull(),
    /** Non-sensitive template payload (see notifications/email-templates.ts). */
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    status: text("status", { enum: ["queued", "sending", "sent", "failed", "suppressed"] }).notNull(),
    attempts: integer("attempts").notNull().default(0),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull(),
    /** Claimed by a sweep until this time (safe with several app replicas). */
    lockedUntil: timestamp("locked_until", { withTimezone: true }),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    sentAt: timestamp("sent_at", { withTimezone: true }),
  },
  (t) => [
    unique("email_outbox_org_id_unique").on(t.orgId, t.id),
    index("email_outbox_due_idx").on(t.status, t.nextAttemptAt),
    check("email_outbox_status_check", sql`${t.status} in ('queued', 'sending', 'sent', 'failed', 'suppressed')`),
  ],
);

export const remindersSent = pgTable(
  "reminders_sent",
  {
    orgId: uuid("org_id")
      .notNull()
      .references(() => organisations.id),
    source: text("source").notNull(),
    subjectKey: text("subject_key").notNull(),
    /** e.g. `d90`, `d0`, `probation_d14`. */
    threshold: text("threshold").notNull(),
    sentAt: timestamp("sent_at", { withTimezone: true }).notNull(),
  },
  (t) => [unique("reminders_sent_unique").on(t.orgId, t.source, t.subjectKey, t.threshold)],
);

export type Notification = typeof notifications.$inferSelect;
export type EmailOutboxRow = typeof emailOutbox.$inferSelect;
