CREATE TABLE "assistant_grants" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"client_id" text NOT NULL,
	"resource" text NOT NULL,
	"redirect_uri" text NOT NULL,
	"challenge" text NOT NULL,
	"code_hash" text,
	"access_hash" text,
	"access_expires_at" timestamp with time zone,
	"refresh_hash" text,
	"prior_refresh_hash" text,
	"connected_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"authenticated_at" timestamp with time zone NOT NULL,
	"auth_method" text NOT NULL,
	"mfa_satisfied" boolean NOT NULL
);
--> statement-breakpoint
CREATE TABLE "org_assistant_settings" (
	"org_id" uuid PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
ALTER TABLE "assistant_grants" ADD CONSTRAINT "assistant_grants_org_id_organisations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistant_grants" ADD CONSTRAINT "assistant_grants_membership_id_memberships_id_fk" FOREIGN KEY ("membership_id") REFERENCES "public"."memberships"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_assistant_settings" ADD CONSTRAINT "org_assistant_settings_org_id_organisations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "assistant_grants_code" ON "assistant_grants" USING btree ("code_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "assistant_grants_access" ON "assistant_grants" USING btree ("access_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "assistant_grants_refresh" ON "assistant_grants" USING btree ("refresh_hash");--> statement-breakpoint
CREATE INDEX "assistant_grants_prior_refresh" ON "assistant_grants" USING btree ("prior_refresh_hash");--> statement-breakpoint
CREATE INDEX "assistant_grants_member" ON "assistant_grants" USING btree ("org_id","membership_id");