ALTER TABLE "device_sessions" ADD COLUMN "mfa_satisfied" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "mfa_challenges" ADD COLUMN "identity_id" uuid;--> statement-breakpoint
ALTER TABLE "native_auth_requests" ADD COLUMN "mfa_satisfied" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "memberships_org_employee_live_unique" ON "memberships" USING btree ("org_id","employee_id") WHERE "memberships"."status" <> 'former';