import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { memberships } from "./access.ts";
import { employees } from "./employees.ts";
import { organisations } from "./organisations.ts";

/**
 * Shared uploads (add-claims design decision 3; reused by documents). The bytes live in the
 * injected `FileStore` under `org/<orgId>/files/<id>.<ext>`; this row is the only way to reach
 * them. `mime` is the type detected from the file's signature, never the client's claim, and
 * `original_name` is a sanitised display name that is never used to build a storage key.
 */
export const FILE_SCAN_STATUSES = ["unscanned", "pending_scan", "clean", "infected", "scan_failed"] as const;
export type FileScanStatus = (typeof FILE_SCAN_STATUSES)[number];

export const files = pgTable(
  "files",
  {
    id: uuid("id").primaryKey(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organisations.id),
    /** What the file is for, e.g. `claim_receipt`. */
    purpose: text("purpose").notNull(),
    sha256: text("sha256").notNull(),
    mime: text("mime").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    storageKey: text("storage_key").notNull(),
    originalName: text("original_name").notNull(),
    scanStatus: text("scan_status").$type<FileScanStatus>().notNull(),
    scanAttempts: integer("scan_attempts").notNull().default(0),
    scannedAt: timestamp("scanned_at", { withTimezone: true }),
    /** The employee the file belongs to (claim receipts: the claimant). */
    ownerEmployeeId: uuid("owner_employee_id"),
    uploadedByMembershipId: uuid("uploaded_by_membership_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    /** Set when the bytes were removed (infected, or an unattached upload deleted by its uploader). */
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    unique("files_org_id_unique").on(t.orgId, t.id),
    unique("files_storage_key_unique").on(t.storageKey),
    index("files_org_sha_idx").on(t.orgId, t.sha256),
    index("files_scan_idx").on(t.scanStatus),
    foreignKey({
      name: "files_owner_employee_fk",
      columns: [t.orgId, t.ownerEmployeeId],
      foreignColumns: [employees.orgId, employees.id],
    }),
    foreignKey({
      name: "files_uploader_fk",
      columns: [t.orgId, t.uploadedByMembershipId],
      foreignColumns: [memberships.orgId, memberships.id],
    }),
    check("files_size_check", sql`${t.sizeBytes} > 0`),
    check(
      "files_scan_status_check",
      sql`${t.scanStatus} in ('unscanned', 'pending_scan', 'clean', 'infected', 'scan_failed')`,
    ),
  ],
);

/**
 * Per-organisation counters for human-readable numbers (`C-0001` claims; later others).
 * Incremented with `insert … on conflict do update … returning` inside the caller's transaction.
 */
export const orgCounters = pgTable(
  "org_counters",
  {
    orgId: uuid("org_id")
      .notNull()
      .references(() => organisations.id),
    name: text("name").notNull(),
    nextValue: bigint("next_value", { mode: "number" }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.orgId, t.name] })],
);
