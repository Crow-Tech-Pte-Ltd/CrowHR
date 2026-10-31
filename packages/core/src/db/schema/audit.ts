import { bigint, index, jsonb, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { organisations } from "./organisations.ts";

/**
 * Append-only audit log with a per-organisation SHA-256 hash chain. UPDATE and DELETE are
 * rejected by a trigger (migration 0002_audit_immutability). Write only via `recordAudit()`.
 */
export const auditEvents = pgTable(
  "audit_events",
  {
    id: uuid("id").primaryKey(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organisations.id),
    seq: bigint("seq", { mode: "number" }).notNull(),
    at: timestamp("at", { withTimezone: true }).notNull(),
    actorType: text("actor_type", { enum: ["member", "system", "cli", "anonymous"] }).notNull(),
    actorMembershipId: uuid("actor_membership_id"),
    /** Display label captured at write time (e.g. the member's email), so the log survives renames. */
    actorLabel: text("actor_label"),
    action: text("action").notNull(),
    targetType: text("target_type").notNull(),
    targetId: text("target_id"),
    requestId: text("request_id"),
    ip: text("ip"),
    userAgent: text("user_agent"),
    /** Field-level diff. Sensitive fields record `{ changed: true }` only. */
    diff: jsonb("diff"),
    /** Extra context such as a failure reason. Never secrets. */
    meta: jsonb("meta"),
    prevHash: text("prev_hash").notNull(),
    hash: text("hash").notNull(),
  },
  (t) => [
    unique("audit_events_org_seq_unique").on(t.orgId, t.seq),
    index("audit_events_org_at_idx").on(t.orgId, t.at),
    index("audit_events_org_action_idx").on(t.orgId, t.action),
  ],
);

export const auditHeads = pgTable("audit_heads", {
  orgId: uuid("org_id")
    .primaryKey()
    .references(() => organisations.id),
  lastSeq: bigint("last_seq", { mode: "number" }).notNull(),
  lastHash: text("last_hash").notNull(),
});

export type AuditEventRow = typeof auditEvents.$inferSelect;
