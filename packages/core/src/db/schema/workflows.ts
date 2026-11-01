import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { memberships } from "./access.ts";
import { organisations } from "./organisations.ts";

/**
 * Approval engine (openspec/changes/add-approvals-and-notifications, "workflows" spec).
 *
 * - `approval_policies` + `approval_policy_steps`: per-org configuration per subject type.
 * - `approval_requests`: one per submitted subject; `approval_steps` is the chain snapshot taken at
 *   submission (approver *rules*, resolved to people only when a step becomes active).
 * - `approval_tasks`: one per eligible approver of the active step (any-of).
 * - `approval_comments`: discussion on a request (decision comments live on the task).
 * - `delegations`: out-of-office cover.
 *
 * Requester/manager employee IDs are plain UUIDs: the employees table belongs to the people module,
 * which adds FKs when it lands.
 */

/** Subject type names: lower snake case, e.g. `leave`, `payroll_run`. */
export const SUBJECT_TYPE_PATTERN = /^[a-z][a-z0-9_]{1,47}$/;

/** `{ amountGte }` (integer cents) or `{ typeCodes }`. Null = always matches. */
export interface PolicyCondition {
  amountGte?: number;
  typeCodes?: string[];
}

export interface SubjectAttributes {
  /** Integer cents. */
  amountCents?: number;
  /** e.g. the leave or claim type code. */
  typeCode?: string;
}

export const approvalPolicies = pgTable(
  "approval_policies",
  {
    id: uuid("id").primaryKey(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organisations.id),
    subjectType: text("subject_type").notNull(),
    name: text("name").notNull(),
    condition: jsonb("condition").$type<PolicyCondition>(),
    /** Higher wins when several conditions match. The default policy has no condition. */
    priority: integer("priority").notNull().default(0),
    isDefault: boolean("is_default").notNull().default(false),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("approval_policies_org_id_unique").on(t.orgId, t.id),
    index("approval_policies_type_idx").on(t.orgId, t.subjectType),
  ],
);

export const approvalPolicySteps = pgTable(
  "approval_policy_steps",
  {
    orgId: uuid("org_id")
      .notNull()
      .references(() => organisations.id),
    policyId: uuid("policy_id").notNull(),
    position: integer("position").notNull(),
    /** `manager`, `manager_of_manager`, `role:<owner|hr_admin|payroll_admin>`, `member:<membershipId>`. */
    approverRule: text("approver_rule").notNull(),
    /** Calendar days before escalation; 0 disables it. */
    escalateAfterDays: integer("escalate_after_days").notNull().default(3),
  },
  (t) => [
    primaryKey({ columns: [t.policyId, t.position] }),
    foreignKey({
      name: "approval_policy_steps_policy_fk",
      columns: [t.orgId, t.policyId],
      foreignColumns: [approvalPolicies.orgId, approvalPolicies.id],
    }).onDelete("cascade"),
    check("approval_policy_steps_position_check", sql`${t.position} between 1 and 5`),
    check("approval_policy_steps_escalate_check", sql`${t.escalateAfterDays} between 0 and 60`),
  ],
);

export const approvalRequests = pgTable(
  "approval_requests",
  {
    id: uuid("id").primaryKey(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organisations.id),
    subjectType: text("subject_type").notNull(),
    subjectId: uuid("subject_id").notNull(),
    requesterEmployeeId: uuid("requester_employee_id"),
    requesterMembershipId: uuid("requester_membership_id").notNull(),
    /** Null when the built-in default chain was used (no stored policy). */
    policyId: uuid("policy_id"),
    policyName: text("policy_name").notNull(),
    status: text("status", { enum: ["pending", "approved", "rejected", "withdrawn"] }).notNull(),
    currentPosition: integer("current_position").notNull().default(1),
    attributes: jsonb("attributes").$type<SubjectAttributes>().notNull().default({}),
    /**
     * Members who may never decide this request besides the requester: whoever filed it on the
     * requester's behalf, and the beneficiaries the module names (e.g. the colleague taking a shift).
     */
    excludedDeciderMembershipIds: uuid("excluded_decider_membership_ids").array().notNull().default(sql`'{}'::uuid[]`),
    /** Subject title at submission, for fast lists (the adapter's live summary is shown in detail). */
    title: text("title").notNull(),
    submittedAt: timestamp("submitted_at", { withTimezone: true }).notNull(),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
  },
  (t) => [
    unique("approval_requests_org_id_unique").on(t.orgId, t.id),
    foreignKey({
      name: "approval_requests_requester_fk",
      columns: [t.orgId, t.requesterMembershipId],
      foreignColumns: [memberships.orgId, memberships.id],
    }),
    // One open request per subject: resubmitting the same subject is idempotent.
    uniqueIndex("approval_requests_open_subject_unique")
      .on(t.orgId, t.subjectType, t.subjectId)
      .where(sql`${t.status} = 'pending'`),
    index("approval_requests_requester_idx").on(t.orgId, t.requesterMembershipId),
    index("approval_requests_employee_idx").on(t.orgId, t.requesterEmployeeId, t.status),
    check("approval_requests_status_check", sql`${t.status} in ('pending', 'approved', 'rejected', 'withdrawn')`),
  ],
);

export const approvalSteps = pgTable(
  "approval_steps",
  {
    orgId: uuid("org_id")
      .notNull()
      .references(() => organisations.id),
    requestId: uuid("request_id").notNull(),
    position: integer("position").notNull(),
    approverRule: text("approver_rule").notNull(),
    escalateAfterDays: integer("escalate_after_days").notNull(),
    status: text("status", { enum: ["waiting", "active", "approved", "rejected", "skipped"] }).notNull(),
    /** `self`, `no_manager`, `inactive`, `no_members`, `no_requester_employee`. */
    skipReason: text("skip_reason"),
    /** True for the hr_admin/owner step added when every configured step was skipped. */
    fallback: boolean("fallback").notNull().default(false),
    activatedAt: timestamp("activated_at", { withTimezone: true }),
    escalatedAt: timestamp("escalated_at", { withTimezone: true }),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
  },
  (t) => [
    primaryKey({ columns: [t.requestId, t.position] }),
    foreignKey({
      name: "approval_steps_request_fk",
      columns: [t.orgId, t.requestId],
      foreignColumns: [approvalRequests.orgId, approvalRequests.id],
    }).onDelete("cascade"),
    check("approval_steps_status_check", sql`${t.status} in ('waiting', 'active', 'approved', 'rejected', 'skipped')`),
  ],
);

export const approvalTasks = pgTable(
  "approval_tasks",
  {
    id: uuid("id").primaryKey(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organisations.id),
    requestId: uuid("request_id").notNull(),
    position: integer("position").notNull(),
    assigneeMembershipId: uuid("assignee_membership_id").notNull(),
    /** Set on delegated tasks: the delegator this decision is made on behalf of. */
    onBehalfOfMembershipId: uuid("on_behalf_of_membership_id"),
    origin: text("origin", { enum: ["resolved", "delegated", "escalated", "reassigned"] }).notNull(),
    status: text("status", { enum: ["pending", "approved", "rejected", "superseded"] }).notNull(),
    /** Why a task was superseded: `decided_by_other`, `withdrawn`, `rerouted`, `reassigned`. */
    supersededReason: text("superseded_reason"),
    /** The rule this task satisfies (role steps delegate only to holders of the role). */
    viaRole: text("via_role"),
    dueAt: timestamp("due_at", { withTimezone: true }),
    escalatedAt: timestamp("escalated_at", { withTimezone: true }),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    comment: text("comment"),
    selfApproved: boolean("self_approved").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  (t) => [
    unique("approval_tasks_org_id_unique").on(t.orgId, t.id),
    foreignKey({
      name: "approval_tasks_request_fk",
      columns: [t.orgId, t.requestId],
      foreignColumns: [approvalRequests.orgId, approvalRequests.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "approval_tasks_assignee_fk",
      columns: [t.orgId, t.assigneeMembershipId],
      foreignColumns: [memberships.orgId, memberships.id],
    }),
    // At most one open task per person per step (delegation loops and repeated sweeps are no-ops).
    uniqueIndex("approval_tasks_open_unique")
      .on(t.requestId, t.position, t.assigneeMembershipId)
      .where(sql`${t.status} = 'pending'`),
    index("approval_tasks_assignee_idx").on(t.orgId, t.assigneeMembershipId, t.status),
    index("approval_tasks_due_idx").on(t.status, t.dueAt),
    check("approval_tasks_origin_check", sql`${t.origin} in ('resolved', 'delegated', 'escalated', 'reassigned')`),
    check("approval_tasks_status_check", sql`${t.status} in ('pending', 'approved', 'rejected', 'superseded')`),
  ],
);

export const approvalComments = pgTable(
  "approval_comments",
  {
    id: uuid("id").primaryKey(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organisations.id),
    requestId: uuid("request_id").notNull(),
    authorMembershipId: uuid("author_membership_id").notNull(),
    body: text("body").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  (t) => [
    foreignKey({
      name: "approval_comments_request_fk",
      columns: [t.orgId, t.requestId],
      foreignColumns: [approvalRequests.orgId, approvalRequests.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "approval_comments_author_fk",
      columns: [t.orgId, t.authorMembershipId],
      foreignColumns: [memberships.orgId, memberships.id],
    }),
    index("approval_comments_request_idx").on(t.requestId),
  ],
);

export const delegations = pgTable(
  "delegations",
  {
    id: uuid("id").primaryKey(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organisations.id),
    fromMembershipId: uuid("from_membership_id").notNull(),
    toMembershipId: uuid("to_membership_id").notNull(),
    /** Inclusive, Asia/Singapore calendar dates. */
    startsOn: date("starts_on", { mode: "string" }).notNull(),
    endsOn: date("ends_on", { mode: "string" }).notNull(),
    /** Null = every subject type. */
    subjectTypes: text("subject_types").array(),
    createdByMembershipId: uuid("created_by_membership_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (t) => [
    unique("delegations_org_id_unique").on(t.orgId, t.id),
    foreignKey({
      name: "delegations_from_fk",
      columns: [t.orgId, t.fromMembershipId],
      foreignColumns: [memberships.orgId, memberships.id],
    }),
    foreignKey({
      name: "delegations_to_fk",
      columns: [t.orgId, t.toMembershipId],
      foreignColumns: [memberships.orgId, memberships.id],
    }),
    index("delegations_from_idx").on(t.orgId, t.fromMembershipId),
    check("delegations_dates_check", sql`${t.endsOn} >= ${t.startsOn}`),
    check("delegations_not_self_check", sql`${t.fromMembershipId} <> ${t.toMembershipId}`),
  ],
);

export type ApprovalPolicy = typeof approvalPolicies.$inferSelect;
export type ApprovalPolicyStep = typeof approvalPolicySteps.$inferSelect;
export type ApprovalRequest = typeof approvalRequests.$inferSelect;
export type ApprovalStep = typeof approvalSteps.$inferSelect;
export type ApprovalTask = typeof approvalTasks.$inferSelect;
export type Delegation = typeof delegations.$inferSelect;
