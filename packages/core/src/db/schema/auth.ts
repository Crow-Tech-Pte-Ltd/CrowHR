import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { memberships } from "./access.ts";
import { organisations } from "./organisations.ts";
import { users } from "./users.ts";

const tz = (name: string) => timestamp(name, { withTimezone: true });

/** Browser sessions. `id` is sha256(token) in hex; the token only ever lives in the cookie. */
export const sessions = pgTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organisations.id),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    membershipId: uuid("membership_id").notNull(),
    authMethod: text("auth_method").notNull(),
    /** user_identities.id for SSO sessions. */
    identityId: uuid("identity_id"),
    createdAt: tz("created_at").notNull(),
    lastSeenAt: tz("last_seen_at").notNull(),
    authenticatedAt: tz("authenticated_at").notNull(),
    absoluteExpiresAt: tz("absolute_expires_at").notNull(),
    ip: text("ip"),
    userAgent: text("user_agent"),
    mfaSatisfied: boolean("mfa_satisfied").notNull().default(false),
    revokedAt: tz("revoked_at"),
    revokedReason: text("revoked_reason"),
  },
  (t) => [
    foreignKey({
      name: "sessions_membership_fk",
      columns: [t.orgId, t.membershipId],
      foreignColumns: [memberships.orgId, memberships.id],
    }).onDelete("cascade"),
    index("sessions_user_idx").on(t.userId),
  ],
);

/** Password sign-in that passed the password step and awaits a TOTP or recovery code (5 minutes, 5 tries). */
export const mfaChallenges = pgTable(
  "mfa_challenges",
  {
    id: text("id").primaryKey(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organisations.id),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    membershipId: uuid("membership_id").notNull(),
    /** `password`, `password:break_glass`, or the SSO method (`google`, `oidc`, …) awaiting Crow HR's TOTP. */
    authMethod: text("auth_method").notNull(),
    /** user_identities.id when an SSO sign-in waits for the TOTP. */
    identityId: uuid("identity_id"),
    nativeRequestId: uuid("native_request_id"),
    attempts: integer("attempts").notNull().default(0),
    expiresAt: tz("expires_at").notNull(),
    consumedAt: tz("consumed_at"),
    createdAt: tz("created_at").notNull(),
  },
  (t) => [
    foreignKey({
      name: "mfa_challenges_membership_fk",
      columns: [t.orgId, t.membershipId],
      foreignColumns: [memberships.orgId, memberships.id],
    }).onDelete("cascade"),
  ],
);

/** MFA recovery codes belong to the user (global, like the TOTP secret). */
export const recoveryCodes = pgTable(
  "recovery_codes",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    codeHash: text("code_hash").notNull(),
    usedAt: tz("used_at"),
    createdAt: tz("created_at").notNull(),
  },
  (t) => [index("recovery_codes_user_idx").on(t.userId)],
);

export const passwordResets = pgTable("password_resets", {
  tokenHash: text("token_hash").primaryKey(),
  orgId: uuid("org_id")
    .notNull()
    .references(() => organisations.id),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id),
  expiresAt: tz("expires_at").notNull(),
  usedAt: tz("used_at"),
  /** Membership of the admin who generated the link (no-SMTP flow); null when self-requested. */
  createdBy: uuid("created_by"),
  createdAt: tz("created_at").notNull(),
});

/**
 * Sign-in throttling (security infrastructure, deliberately not org-scoped). Keys:
 * `acct:<userId>` (all networks), `acct:<userId>:<ip>` (one network), `mfa:<userId>`,
 * `ip:<ip>`, `ipmfa:<ip>`, `reveal:<membershipId>`. Swept after a day. See auth/throttle.ts.
 */
export const authThrottle = pgTable("auth_throttle", {
  key: text("key").primaryKey(),
  windowStart: tz("window_start").notNull(),
  count: integer("count").notNull(),
  lockedUntil: tz("locked_until"),
});

export const orgSecuritySettings = pgTable(
  "org_security_settings",
  {
    orgId: uuid("org_id")
      .primaryKey()
      .references(() => organisations.id),
    passwordEnabled: boolean("password_enabled").notNull().default(true),
    mfaRequiredRoles: text("mfa_required_roles")
      .array()
      .notNull()
      .default(sql`'{owner,hr_admin,payroll_admin}'::text[]`),
    idleTimeoutMin: integer("idle_timeout_min").notNull().default(30),
    absoluteTimeoutH: integer("absolute_timeout_h").notNull().default(12),
    deviceIdleDays: integer("device_idle_days").notNull().default(30),
    updatedAt: tz("updated_at").notNull().defaultNow(),
  },
  (t) => [
    check("org_security_idle_check", sql`${t.idleTimeoutMin} between 15 and 240`),
    check("org_security_absolute_check", sql`${t.absoluteTimeoutH} between 1 and 24`),
    check("org_security_device_idle_check", sql`${t.deviceIdleDays} between 1 and 90`),
  ],
);

export const ssoProviders = pgTable(
  "sso_providers",
  {
    id: uuid("id").primaryKey(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organisations.id),
    kind: text("kind", { enum: ["google", "entra", "singpass", "oidc"] }).notNull(),
    displayName: text("display_name").notNull(),
    issuer: text("issuer").notNull(),
    clientId: text("client_id").notNull(),
    /** SecretBox ciphertext (purpose `sso-client-secret`). Never returned by the API. */
    clientSecretEnc: text("client_secret_enc"),
    /** SecretBox ciphertext of the RP private JWKS (Singpass). */
    privateJwksEnc: text("private_jwks_enc"),
    /** Public half of the RP keys, served at /api/v1/auth/oidc/<id>/jwks.json. */
    publicJwks: jsonb("public_jwks"),
    allowedDomains: text("allowed_domains").array().notNull().default(sql`'{}'::text[]`),
    tenantId: text("tenant_id"),
    environment: text("environment", { enum: ["staging", "production"] }),
    jitEnabled: boolean("jit_enabled").notNull().default(false),
    enabled: boolean("enabled").notNull().default(false),
    lastTestOkAt: tz("last_test_ok_at"),
    createdAt: tz("created_at").notNull(),
    updatedAt: tz("updated_at").notNull(),
  },
  (t) => [
    unique("sso_providers_org_id_unique").on(t.orgId, t.id),
    check("sso_providers_kind_check", sql`${t.kind} in ('google', 'entra', 'singpass', 'oidc')`),
  ],
);

export const userIdentities = pgTable(
  "user_identities",
  {
    id: uuid("id").primaryKey(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organisations.id),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    providerId: uuid("provider_id").notNull(),
    issuer: text("issuer").notNull(),
    subject: text("subject").notNull(),
    emailAtLink: text("email_at_link"),
    linkedAt: tz("linked_at").notNull(),
    lastUsedAt: tz("last_used_at"),
  },
  (t) => [
    unique("user_identities_issuer_subject_org_unique").on(t.issuer, t.subject, t.orgId),
    foreignKey({
      name: "user_identities_provider_fk",
      columns: [t.orgId, t.providerId],
      foreignColumns: [ssoProviders.orgId, ssoProviders.id],
    }).onDelete("cascade"),
  ],
);

/** In-flight OIDC authorisation requests (10-minute TTL). Keyed by sha256(state). */
export const oidcTransactions = pgTable(
  "oidc_transactions",
  {
    stateHash: text("state_hash").primaryKey(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organisations.id),
    providerId: uuid("provider_id").notNull(),
    /**
     * sign_in | test (owner test sign-in) | link (signed-in user links an identity) | invite |
     * demo (Singpass round trip for the in-browser demo: validated, then the identity is discarded).
     */
    purpose: text("purpose", { enum: ["sign_in", "test", "link", "invite", "demo"] }).notNull(),
    nonce: text("nonce").notNull(),
    codeVerifierEnc: text("code_verifier_enc").notNull(),
    dpopJwkEnc: text("dpop_jwk_enc"),
    invitationId: uuid("invitation_id"),
    linkUserId: uuid("link_user_id"),
    nativeRequestId: uuid("native_request_id"),
    expiresAt: tz("expires_at").notNull(),
    createdAt: tz("created_at").notNull(),
  },
  (t) => [
    foreignKey({
      name: "oidc_transactions_provider_fk",
      columns: [t.orgId, t.providerId],
      foreignColumns: [ssoProviders.orgId, ssoProviders.id],
    }).onDelete("cascade"),
  ],
);

/** api-platform: a native app's pending authorisation (10-minute TTL) and its one-time code (60 s). */
export const nativeAuthRequests = pgTable("native_auth_requests", {
  id: uuid("id").primaryKey(),
  orgId: uuid("org_id")
    .notNull()
    .references(() => organisations.id),
  client: text("client", { enum: ["ios", "android"] }).notNull(),
  redirectUri: text("redirect_uri").notNull(),
  codeChallenge: text("code_challenge").notNull(),
  state: text("state").notNull(),
  expiresAt: tz("expires_at").notNull(),
  codeHash: text("code_hash").unique(),
  codeExpiresAt: tz("code_expires_at"),
  userId: uuid("user_id"),
  membershipId: uuid("membership_id"),
  authMethod: text("auth_method"),
  /** The sign-in satisfied MFA (Crow HR TOTP, or an IdP asserting MFA). */
  mfaSatisfied: boolean("mfa_satisfied").notNull().default(false),
  usedAt: tz("used_at"),
  /** Device session created by the first exchange; revoked if the code is replayed. */
  deviceSessionId: uuid("device_session_id"),
  createdAt: tz("created_at").notNull(),
});

/** api-platform: native-app sessions with opaque access tokens and rotating refresh tokens. */
export const deviceSessions = pgTable(
  "device_sessions",
  {
    id: uuid("id").primaryKey(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organisations.id),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    membershipId: uuid("membership_id").notNull(),
    authMethod: text("auth_method").notNull(),
    platform: text("platform", { enum: ["ios", "android"] }).notNull(),
    deviceName: text("device_name").notNull(),
    appVersion: text("app_version"),
    accessHash: text("access_hash").notNull().unique(),
    accessExpiresAt: tz("access_expires_at").notNull(),
    refreshFamilyId: uuid("refresh_family_id").notNull(),
    currentRefreshHash: text("current_refresh_hash").notNull().unique(),
    previousRefreshHashes: text("previous_refresh_hashes").array().notNull().default(sql`'{}'::text[]`),
    createdAt: tz("created_at").notNull(),
    lastUsedAt: tz("last_used_at").notNull(),
    lastIp: text("last_ip"),
    idleExpiresAt: tz("idle_expires_at").notNull(),
    absoluteExpiresAt: tz("absolute_expires_at").notNull(),
    authenticatedAt: tz("authenticated_at").notNull(),
    /** The sign-in behind this device satisfied MFA (drives the MFA policy for SSO devices). */
    mfaSatisfied: boolean("mfa_satisfied").notNull().default(false),
    revokedAt: tz("revoked_at"),
    revokedReason: text("revoked_reason"),
  },
  (t) => [
    foreignKey({
      name: "device_sessions_membership_fk",
      columns: [t.orgId, t.membershipId],
      foreignColumns: [memberships.orgId, memberships.id],
    }).onDelete("cascade"),
    index("device_sessions_user_idx").on(t.userId),
  ],
);

/**
 * Install-level check value for CROWHR_SECRET_KEY: the server refuses to start with a key
 * that does not reproduce the stored value (spec "Encryption of sensitive identifiers").
 */
export const secretKeyChecks = pgTable("secret_key_checks", {
  keyId: text("key_id").primaryKey(),
  checkValue: text("check_value").notNull(),
  createdAt: tz("created_at").notNull().defaultNow(),
});

export type Session = typeof sessions.$inferSelect;
export type SsoProvider = typeof ssoProviders.$inferSelect;
export type DeviceSession = typeof deviceSessions.$inferSelect;
