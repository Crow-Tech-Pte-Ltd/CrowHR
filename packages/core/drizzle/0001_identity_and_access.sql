CREATE TABLE "invitations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"email" text NOT NULL,
	"membership_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"invited_by" uuid,
	"accepted_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invitations_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "invitations_org_id_unique" UNIQUE("org_id","id")
);
--> statement-breakpoint
CREATE TABLE "membership_roles" (
	"org_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"role" text NOT NULL,
	"granted_by" uuid,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "membership_roles_membership_id_role_pk" PRIMARY KEY("membership_id","role"),
	CONSTRAINT "membership_roles_role_check" CHECK ("membership_roles"."role" in ('owner', 'hr_admin', 'payroll_admin'))
);
--> statement-breakpoint
CREATE TABLE "memberships" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"employee_id" uuid,
	"status" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "memberships_org_user_unique" UNIQUE("org_id","user_id"),
	CONSTRAINT "memberships_org_id_unique" UNIQUE("org_id","id"),
	CONSTRAINT "memberships_status_check" CHECK ("memberships"."status" in ('invited', 'active', 'suspended', 'former'))
);
--> statement-breakpoint
CREATE TABLE "audit_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"seq" bigint NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"actor_type" text NOT NULL,
	"actor_membership_id" uuid,
	"actor_label" text,
	"action" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" text,
	"request_id" text,
	"ip" text,
	"user_agent" text,
	"diff" jsonb,
	"meta" jsonb,
	"prev_hash" text NOT NULL,
	"hash" text NOT NULL,
	CONSTRAINT "audit_events_org_seq_unique" UNIQUE("org_id","seq")
);
--> statement-breakpoint
CREATE TABLE "audit_heads" (
	"org_id" uuid PRIMARY KEY NOT NULL,
	"last_seq" bigint NOT NULL,
	"last_hash" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth_throttle" (
	"key" text PRIMARY KEY NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"count" integer NOT NULL,
	"locked_until" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "device_sessions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"auth_method" text NOT NULL,
	"platform" text NOT NULL,
	"device_name" text NOT NULL,
	"app_version" text,
	"access_hash" text NOT NULL,
	"access_expires_at" timestamp with time zone NOT NULL,
	"refresh_family_id" uuid NOT NULL,
	"current_refresh_hash" text NOT NULL,
	"previous_refresh_hashes" text[] DEFAULT '{}'::text[] NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"last_used_at" timestamp with time zone NOT NULL,
	"last_ip" text,
	"idle_expires_at" timestamp with time zone NOT NULL,
	"absolute_expires_at" timestamp with time zone NOT NULL,
	"authenticated_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"revoked_reason" text,
	CONSTRAINT "device_sessions_access_hash_unique" UNIQUE("access_hash"),
	CONSTRAINT "device_sessions_current_refresh_hash_unique" UNIQUE("current_refresh_hash")
);
--> statement-breakpoint
CREATE TABLE "mfa_challenges" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"auth_method" text NOT NULL,
	"native_request_id" uuid,
	"attempts" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "native_auth_requests" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"client" text NOT NULL,
	"redirect_uri" text NOT NULL,
	"code_challenge" text NOT NULL,
	"state" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"code_hash" text,
	"code_expires_at" timestamp with time zone,
	"user_id" uuid,
	"membership_id" uuid,
	"auth_method" text,
	"used_at" timestamp with time zone,
	"device_session_id" uuid,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "native_auth_requests_code_hash_unique" UNIQUE("code_hash")
);
--> statement-breakpoint
CREATE TABLE "oidc_transactions" (
	"state_hash" text PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"provider_id" uuid NOT NULL,
	"purpose" text NOT NULL,
	"nonce" text NOT NULL,
	"code_verifier_enc" text NOT NULL,
	"dpop_jwk_enc" text,
	"invitation_id" uuid,
	"link_user_id" uuid,
	"native_request_id" uuid,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "org_security_settings" (
	"org_id" uuid PRIMARY KEY NOT NULL,
	"password_enabled" boolean DEFAULT true NOT NULL,
	"mfa_required_roles" text[] DEFAULT '{owner,hr_admin,payroll_admin}'::text[] NOT NULL,
	"idle_timeout_min" integer DEFAULT 30 NOT NULL,
	"absolute_timeout_h" integer DEFAULT 12 NOT NULL,
	"device_idle_days" integer DEFAULT 30 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "org_security_idle_check" CHECK ("org_security_settings"."idle_timeout_min" between 15 and 240),
	CONSTRAINT "org_security_absolute_check" CHECK ("org_security_settings"."absolute_timeout_h" between 1 and 24),
	CONSTRAINT "org_security_device_idle_check" CHECK ("org_security_settings"."device_idle_days" between 1 and 90)
);
--> statement-breakpoint
CREATE TABLE "password_resets" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recovery_codes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"code_hash" text NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "secret_key_checks" (
	"key_id" text PRIMARY KEY NOT NULL,
	"check_value" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"auth_method" text NOT NULL,
	"identity_id" uuid,
	"created_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone NOT NULL,
	"authenticated_at" timestamp with time zone NOT NULL,
	"absolute_expires_at" timestamp with time zone NOT NULL,
	"ip" text,
	"user_agent" text,
	"mfa_satisfied" boolean DEFAULT false NOT NULL,
	"revoked_at" timestamp with time zone,
	"revoked_reason" text
);
--> statement-breakpoint
CREATE TABLE "sso_providers" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"display_name" text NOT NULL,
	"issuer" text NOT NULL,
	"client_id" text NOT NULL,
	"client_secret_enc" text,
	"private_jwks_enc" text,
	"public_jwks" jsonb,
	"allowed_domains" text[] DEFAULT '{}'::text[] NOT NULL,
	"tenant_id" text,
	"environment" text,
	"jit_enabled" boolean DEFAULT false NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"last_test_ok_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "sso_providers_org_id_unique" UNIQUE("org_id","id"),
	CONSTRAINT "sso_providers_kind_check" CHECK ("sso_providers"."kind" in ('google', 'entra', 'singpass', 'oidc'))
);
--> statement-breakpoint
CREATE TABLE "user_identities" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"provider_id" uuid NOT NULL,
	"issuer" text NOT NULL,
	"subject" text NOT NULL,
	"email_at_link" text,
	"linked_at" timestamp with time zone NOT NULL,
	"last_used_at" timestamp with time zone,
	CONSTRAINT "user_identities_issuer_subject_org_unique" UNIQUE("issuer","subject","org_id")
);
--> statement-breakpoint
ALTER TABLE "organisations" ADD COLUMN "slug" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "password_changed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "mfa_totp_secret_enc" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "mfa_pending_secret_enc" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "mfa_last_step" integer;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "mfa_enrolled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "email_verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_org_id_organisations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_membership_fk" FOREIGN KEY ("org_id","membership_id") REFERENCES "public"."memberships"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership_roles" ADD CONSTRAINT "membership_roles_org_id_organisations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership_roles" ADD CONSTRAINT "membership_roles_membership_fk" FOREIGN KEY ("org_id","membership_id") REFERENCES "public"."memberships"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_org_id_organisations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_org_id_organisations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_heads" ADD CONSTRAINT "audit_heads_org_id_organisations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_sessions" ADD CONSTRAINT "device_sessions_org_id_organisations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_sessions" ADD CONSTRAINT "device_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_sessions" ADD CONSTRAINT "device_sessions_membership_fk" FOREIGN KEY ("org_id","membership_id") REFERENCES "public"."memberships"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mfa_challenges" ADD CONSTRAINT "mfa_challenges_org_id_organisations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mfa_challenges" ADD CONSTRAINT "mfa_challenges_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mfa_challenges" ADD CONSTRAINT "mfa_challenges_membership_fk" FOREIGN KEY ("org_id","membership_id") REFERENCES "public"."memberships"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "native_auth_requests" ADD CONSTRAINT "native_auth_requests_org_id_organisations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oidc_transactions" ADD CONSTRAINT "oidc_transactions_org_id_organisations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oidc_transactions" ADD CONSTRAINT "oidc_transactions_provider_fk" FOREIGN KEY ("org_id","provider_id") REFERENCES "public"."sso_providers"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_security_settings" ADD CONSTRAINT "org_security_settings_org_id_organisations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "password_resets" ADD CONSTRAINT "password_resets_org_id_organisations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "password_resets" ADD CONSTRAINT "password_resets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recovery_codes" ADD CONSTRAINT "recovery_codes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_org_id_organisations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_membership_fk" FOREIGN KEY ("org_id","membership_id") REFERENCES "public"."memberships"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sso_providers" ADD CONSTRAINT "sso_providers_org_id_organisations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_identities" ADD CONSTRAINT "user_identities_org_id_organisations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_identities" ADD CONSTRAINT "user_identities_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_identities" ADD CONSTRAINT "user_identities_provider_fk" FOREIGN KEY ("org_id","provider_id") REFERENCES "public"."sso_providers"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "invitations_membership_idx" ON "invitations" USING btree ("membership_id");--> statement-breakpoint
CREATE INDEX "audit_events_org_at_idx" ON "audit_events" USING btree ("org_id","at");--> statement-breakpoint
CREATE INDEX "audit_events_org_action_idx" ON "audit_events" USING btree ("org_id","action");--> statement-breakpoint
CREATE INDEX "device_sessions_user_idx" ON "device_sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "recovery_codes_user_idx" ON "recovery_codes" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "organisations" ADD CONSTRAINT "organisations_slug_unique" UNIQUE("slug");