import { sql } from "drizzle-orm";
import { check, foreignKey, index, pgTable, primaryKey, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { organisations } from "./organisations.ts";
import { users } from "./users.ts";

/**
 * A user's membership of one organisation. Roles live on the membership, not the user.
 * `employee_id` links to the employee record; its FK is added by the people module.
 */
export const memberships = pgTable(
  "memberships",
  {
    id: uuid("id").primaryKey(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organisations.id),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    employeeId: uuid("employee_id"),
    /** invited → active → suspended / former. */
    status: text("status", { enum: ["invited", "active", "suspended", "former"] }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("memberships_org_user_unique").on(t.orgId, t.userId),
    unique("memberships_org_id_unique").on(t.orgId, t.id),
    check("memberships_status_check", sql`${t.status} in ('invited', 'active', 'suspended', 'former')`),
  ],
);

/** Assigned roles. `employee` and `manager` are derived, never stored. */
export const membershipRoles = pgTable(
  "membership_roles",
  {
    orgId: uuid("org_id")
      .notNull()
      .references(() => organisations.id),
    membershipId: uuid("membership_id").notNull(),
    role: text("role", { enum: ["owner", "hr_admin", "payroll_admin"] }).notNull(),
    grantedBy: uuid("granted_by"),
    grantedAt: timestamp("granted_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.membershipId, t.role] }),
    foreignKey({
      name: "membership_roles_membership_fk",
      columns: [t.orgId, t.membershipId],
      foreignColumns: [memberships.orgId, memberships.id],
    }).onDelete("cascade"),
    check("membership_roles_role_check", sql`${t.role} in ('owner', 'hr_admin', 'payroll_admin')`),
  ],
);

export const invitations = pgTable(
  "invitations",
  {
    id: uuid("id").primaryKey(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organisations.id),
    email: text("email").notNull(),
    membershipId: uuid("membership_id").notNull(),
    /** sha256(token), hex. The token itself is shown once (copy link) or emailed. */
    tokenHash: text("token_hash").notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    invitedBy: uuid("invited_by"),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: "invitations_membership_fk",
      columns: [t.orgId, t.membershipId],
      foreignColumns: [memberships.orgId, memberships.id],
    }).onDelete("cascade"),
    unique("invitations_org_id_unique").on(t.orgId, t.id),
    index("invitations_membership_idx").on(t.membershipId),
  ],
);

export type Membership = typeof memberships.$inferSelect;
export type MembershipRole = typeof membershipRoles.$inferSelect;
export type Invitation = typeof invitations.$inferSelect;
