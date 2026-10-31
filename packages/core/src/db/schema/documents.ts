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
  smallint,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { memberships } from "./access.ts";
import { employees } from "./employees.ts";
import { files } from "./files.ts";
import { organisations } from "./organisations.ts";

/**
 * Employee documents (openspec/changes/add-documents): categories with access flags, documents
 * with versions (each version is one stored file), letter templates, first views (required before
 * acknowledging), acknowledgement requests, employee document requests, and retention reviews.
 * Every table has `org_id`; references between tenant tables are composite `(org_id, id)` FKs.
 */

export const DOCUMENT_SENSITIVITIES = ["normal", "medical"] as const;
export type DocumentSensitivity = (typeof DOCUMENT_SENSITIVITIES)[number];
/** Default categories, seeded per organisation (spec "Document categories"). */
export const DOCUMENT_CATEGORY_KEYS = ["contract", "identity", "certificates", "medical", "letters", "other"] as const;
export type DocumentCategoryKey = (typeof DOCUMENT_CATEGORY_KEYS)[number];
export const LETTER_KINDS = [
  "offer",
  "ket",
  "confirmation",
  "promotion",
  "salary_adjustment",
  "resignation_acceptance",
  "employment_certificate",
  "custom",
] as const;
export type LetterKind = (typeof LETTER_KINDS)[number];
export type DocumentSource = "upload" | "generated";
export type DocumentRequestStatus = "pending" | "approved" | "rejected" | "withdrawn";

const orgId = () =>
  uuid("org_id")
    .notNull()
    .references(() => organisations.id);
const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
};

export const documentCategories = pgTable(
  "document_categories",
  {
    id: uuid("id").primaryKey(),
    orgId: orgId(),
    /** Which default this row started as (null for categories HR added). */
    systemKey: text("system_key").$type<DocumentCategoryKey>(),
    name: text("name").notNull(),
    sensitivity: text("sensitivity").$type<DocumentSensitivity>().notNull().default("normal"),
    employeeVisible: boolean("employee_visible").notNull().default(false),
    managerVisible: boolean("manager_visible").notNull().default(false),
    payrollVisible: boolean("payroll_visible").notNull().default(false),
    employeeUploadable: boolean("employee_uploadable").notNull().default(false),
    expiryRequired: boolean("expiry_required").notNull().default(false),
    /** Every view and download is audit-logged (medical and identity documents). */
    auditViews: boolean("audit_views").notNull().default(false),
    /**
     * Months after the employee's last working day from which documents are flagged for review
     * (Employment Act: 12). Null = never flagged.
     */
    retentionMonthsAfterExit: smallint("retention_months_after_exit"),
    position: smallint("position").notNull().default(100),
    ...timestamps,
  },
  (t) => [
    unique("document_categories_org_id_id_unique").on(t.orgId, t.id),
    unique("document_categories_name_unique").on(t.orgId, t.name),
    uniqueIndex("document_categories_system_key_unique")
      .on(t.orgId, t.systemKey)
      .where(sql`${t.systemKey} is not null`),
    check("document_categories_sensitivity_check", sql`${t.sensitivity} in ('normal', 'medical')`),
    check("document_categories_medical_not_manager", sql`not (${t.sensitivity} = 'medical' and ${t.managerVisible})`),
  ],
);

export const documents = pgTable(
  "documents",
  {
    id: uuid("id").primaryKey(),
    orgId: orgId(),
    employeeId: uuid("employee_id").notNull(),
    categoryId: uuid("category_id").notNull(),
    title: text("title").notNull(),
    notes: text("notes"),
    currentVersionId: uuid("current_version_id"),
    createdByMembershipId: uuid("created_by_membership_id").notNull(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    deletedByMembershipId: uuid("deleted_by_membership_id"),
    deleteReason: text("delete_reason"),
    purgedAt: timestamp("purged_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    unique("documents_org_id_id_unique").on(t.orgId, t.id),
    foreignKey({
      name: "documents_employee_fk",
      columns: [t.orgId, t.employeeId],
      foreignColumns: [employees.orgId, employees.id],
    }),
    foreignKey({
      name: "documents_category_fk",
      columns: [t.orgId, t.categoryId],
      foreignColumns: [documentCategories.orgId, documentCategories.id],
    }),
    foreignKey({
      name: "documents_created_by_fk",
      columns: [t.orgId, t.createdByMembershipId],
      foreignColumns: [memberships.orgId, memberships.id],
    }),
    index("documents_employee_idx").on(t.orgId, t.employeeId),
  ],
);

export const letterTemplates = pgTable(
  "letter_templates",
  {
    id: uuid("id").primaryKey(),
    orgId: orgId(),
    kind: text("kind").$type<LetterKind>().notNull(),
    name: text("name").notNull(),
    bodyMd: text("body_md").notNull(),
    /** Bumped on every save; generated documents record the version they used. */
    version: integer("version").notNull().default(1),
    active: boolean("active").notNull().default(true),
    targetCategoryId: uuid("target_category_id").notNull(),
    updatedByMembershipId: uuid("updated_by_membership_id"),
    ...timestamps,
  },
  (t) => [
    unique("letter_templates_org_id_id_unique").on(t.orgId, t.id),
    unique("letter_templates_name_unique").on(t.orgId, t.name),
    foreignKey({
      name: "letter_templates_category_fk",
      columns: [t.orgId, t.targetCategoryId],
      foreignColumns: [documentCategories.orgId, documentCategories.id],
    }),
  ],
);

export const documentVersions = pgTable(
  "document_versions",
  {
    id: uuid("id").primaryKey(),
    orgId: orgId(),
    documentId: uuid("document_id").notNull(),
    version: integer("version").notNull(),
    /** Null once purged. */
    fileId: uuid("file_id"),
    fileSha256: text("file_sha256").notNull(),
    expiresOn: date("expires_on"),
    source: text("source").$type<DocumentSource>().notNull(),
    templateId: uuid("template_id"),
    templateVersion: integer("template_version"),
    asAt: date("as_at"),
    /** Resolved merge-field values (salary fields left out). Per-document KET values entered by HR are kept here too. */
    fieldSnapshot: jsonb("field_snapshot").$type<Record<string, string>>(),
    overrides: jsonb("overrides").$type<Record<string, string>>(),
    uploadedByMembershipId: uuid("uploaded_by_membership_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    supersededAt: timestamp("superseded_at", { withTimezone: true }),
  },
  (t) => [
    unique("document_versions_org_id_id_unique").on(t.orgId, t.id),
    unique("document_versions_number_unique").on(t.orgId, t.documentId, t.version),
    foreignKey({
      name: "document_versions_document_fk",
      columns: [t.orgId, t.documentId],
      foreignColumns: [documents.orgId, documents.id],
    }),
    foreignKey({
      name: "document_versions_file_fk",
      columns: [t.orgId, t.fileId],
      foreignColumns: [files.orgId, files.id],
    }),
    foreignKey({
      name: "document_versions_template_fk",
      columns: [t.orgId, t.templateId],
      foreignColumns: [letterTemplates.orgId, letterTemplates.id],
    }),
    check("document_versions_source_check", sql`${t.source} in ('upload', 'generated')`),
  ],
);

export const documentViews = pgTable(
  "document_views",
  {
    orgId: orgId(),
    documentVersionId: uuid("document_version_id").notNull(),
    membershipId: uuid("membership_id").notNull(),
    firstViewedAt: timestamp("first_viewed_at", { withTimezone: true }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.documentVersionId, t.membershipId] }),
    foreignKey({
      name: "document_views_version_fk",
      columns: [t.orgId, t.documentVersionId],
      foreignColumns: [documentVersions.orgId, documentVersions.id],
    }),
    foreignKey({
      name: "document_views_membership_fk",
      columns: [t.orgId, t.membershipId],
      foreignColumns: [memberships.orgId, memberships.id],
    }),
  ],
);

export const acknowledgementRequests = pgTable(
  "acknowledgement_requests",
  {
    id: uuid("id").primaryKey(),
    orgId: orgId(),
    documentId: uuid("document_id").notNull(),
    documentVersionId: uuid("document_version_id").notNull(),
    employeeId: uuid("employee_id").notNull(),
    requestedByMembershipId: uuid("requested_by_membership_id").notNull(),
    requestedAt: timestamp("requested_at", { withTimezone: true }).notNull(),
    acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }),
    acknowledgedByMembershipId: uuid("acknowledged_by_membership_id"),
    ip: text("ip"),
    userAgent: text("user_agent"),
    /** SHA-256 of the exact file version opened and acknowledged. */
    fileSha256: text("file_sha256"),
  },
  (t) => [
    unique("acknowledgement_requests_org_id_id_unique").on(t.orgId, t.id),
    unique("acknowledgement_requests_version_unique").on(t.orgId, t.documentVersionId, t.employeeId),
    foreignKey({
      name: "acknowledgement_requests_document_fk",
      columns: [t.orgId, t.documentId],
      foreignColumns: [documents.orgId, documents.id],
    }),
    foreignKey({
      name: "acknowledgement_requests_version_fk",
      columns: [t.orgId, t.documentVersionId],
      foreignColumns: [documentVersions.orgId, documentVersions.id],
    }),
    foreignKey({
      name: "acknowledgement_requests_employee_fk",
      columns: [t.orgId, t.employeeId],
      foreignColumns: [employees.orgId, employees.id],
    }),
    index("acknowledgement_requests_open_idx").on(t.orgId, t.employeeId).where(sql`${t.acknowledgedAt} is null`),
  ],
);

/** "Request an employment letter" and similar: decided through the workflows engine, then generated. */
export const documentRequests = pgTable(
  "document_requests",
  {
    id: uuid("id").primaryKey(),
    orgId: orgId(),
    employeeId: uuid("employee_id").notNull(),
    kind: text("kind").$type<LetterKind>().notNull(),
    purpose: text("purpose"),
    status: text("status").$type<DocumentRequestStatus>().notNull().default("pending"),
    approvalRequestId: uuid("approval_request_id"),
    documentId: uuid("document_id"),
    requestedByMembershipId: uuid("requested_by_membership_id").notNull(),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("document_requests_org_id_id_unique").on(t.orgId, t.id),
    foreignKey({
      name: "document_requests_employee_fk",
      columns: [t.orgId, t.employeeId],
      foreignColumns: [employees.orgId, employees.id],
    }),
    foreignKey({
      name: "document_requests_document_fk",
      columns: [t.orgId, t.documentId],
      foreignColumns: [documents.orgId, documents.id],
    }),
  ],
);

/**
 * Retention review flags (research §7, §11.2): set by the `tick` sweep once a document's statutory
 * keeping period has passed. Flags only: nothing is deleted until HR decides.
 */
export const documentRetentionReviews = pgTable(
  "document_retention_reviews",
  {
    id: uuid("id").primaryKey(),
    orgId: orgId(),
    documentId: uuid("document_id").notNull(),
    reason: text("reason").notNull(),
    reviewFrom: date("review_from").notNull(),
    flaggedAt: timestamp("flagged_at", { withTimezone: true }).notNull(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    resolution: text("resolution").$type<"keep" | "delete">(),
    /** For `keep`: flag again from this date. */
    keepUntil: date("keep_until"),
    resolvedByMembershipId: uuid("resolved_by_membership_id"),
  },
  (t) => [
    unique("document_retention_reviews_org_id_id_unique").on(t.orgId, t.id),
    foreignKey({
      name: "document_retention_reviews_document_fk",
      columns: [t.orgId, t.documentId],
      foreignColumns: [documents.orgId, documents.id],
    }),
    uniqueIndex("document_retention_reviews_one_open").on(t.orgId, t.documentId).where(sql`${t.resolvedAt} is null`),
  ],
);

export type DocumentCategory = typeof documentCategories.$inferSelect;
export type DocumentRow = typeof documents.$inferSelect;
export type DocumentVersion = typeof documentVersions.$inferSelect;
export type LetterTemplate = typeof letterTemplates.$inferSelect;
export type AcknowledgementRequest = typeof acknowledgementRequests.$inferSelect;
