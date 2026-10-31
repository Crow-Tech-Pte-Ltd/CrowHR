import { integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

/**
 * A login identity. Users are global (not tenant-scoped) because one person
 * can belong to several organisations, e.g. an accountant running payroll for
 * multiple clients. Org membership and roles live in `memberships` (access.ts).
 *
 * `email` is stored normalised (trimmed, lower-cased) by the service layer;
 * the unique constraint relies on that.
 */
export const users = pgTable("users", {
  id: uuid("id").primaryKey(),
  email: text("email").notNull().unique(),
  displayName: text("display_name").notNull(),
  /** argon2id PHC string. Null for users who have been invited but not set a password. */
  passwordHash: text("password_hash"),
  passwordChangedAt: timestamp("password_changed_at", { withTimezone: true }),
  /** TOTP secret, SecretBox ciphertext (purpose `totp`). Null until enrolment is confirmed. */
  mfaTotpSecretEnc: text("mfa_totp_secret_enc"),
  /** Secret awaiting its first valid code (enrolment in progress). */
  mfaPendingSecretEnc: text("mfa_pending_secret_enc"),
  /** Last accepted TOTP time step; a code is accepted at most once. */
  mfaLastStep: integer("mfa_last_step"),
  mfaEnrolledAt: timestamp("mfa_enrolled_at", { withTimezone: true }),
  emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
