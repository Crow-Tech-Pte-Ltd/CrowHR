CREATE TABLE "acknowledgement_requests" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"document_version_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"requested_by_membership_id" uuid NOT NULL,
	"requested_at" timestamp with time zone NOT NULL,
	"acknowledged_at" timestamp with time zone,
	"acknowledged_by_membership_id" uuid,
	"ip" text,
	"user_agent" text,
	"file_sha256" text,
	CONSTRAINT "acknowledgement_requests_org_id_id_unique" UNIQUE("org_id","id"),
	CONSTRAINT "acknowledgement_requests_version_unique" UNIQUE("org_id","document_version_id","employee_id")
);
--> statement-breakpoint
CREATE TABLE "document_categories" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"system_key" text,
	"name" text NOT NULL,
	"sensitivity" text DEFAULT 'normal' NOT NULL,
	"employee_visible" boolean DEFAULT false NOT NULL,
	"manager_visible" boolean DEFAULT false NOT NULL,
	"payroll_visible" boolean DEFAULT false NOT NULL,
	"employee_uploadable" boolean DEFAULT false NOT NULL,
	"expiry_required" boolean DEFAULT false NOT NULL,
	"audit_views" boolean DEFAULT false NOT NULL,
	"retention_months_after_exit" smallint,
	"position" smallint DEFAULT 100 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "document_categories_org_id_id_unique" UNIQUE("org_id","id"),
	CONSTRAINT "document_categories_name_unique" UNIQUE("org_id","name"),
	CONSTRAINT "document_categories_sensitivity_check" CHECK ("document_categories"."sensitivity" in ('normal', 'medical')),
	CONSTRAINT "document_categories_medical_not_manager" CHECK (not ("document_categories"."sensitivity" = 'medical' and "document_categories"."manager_visible"))
);
--> statement-breakpoint
CREATE TABLE "document_requests" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"purpose" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"approval_request_id" uuid,
	"document_id" uuid,
	"requested_by_membership_id" uuid NOT NULL,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "document_requests_org_id_id_unique" UNIQUE("org_id","id")
);
--> statement-breakpoint
CREATE TABLE "document_retention_reviews" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"review_from" date NOT NULL,
	"flagged_at" timestamp with time zone NOT NULL,
	"resolved_at" timestamp with time zone,
	"resolution" text,
	"keep_until" date,
	"resolved_by_membership_id" uuid,
	CONSTRAINT "document_retention_reviews_org_id_id_unique" UNIQUE("org_id","id")
);
--> statement-breakpoint
CREATE TABLE "document_versions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"file_id" uuid,
	"file_sha256" text NOT NULL,
	"expires_on" date,
	"source" text NOT NULL,
	"template_id" uuid,
	"template_version" integer,
	"as_at" date,
	"field_snapshot" jsonb,
	"overrides" jsonb,
	"uploaded_by_membership_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"superseded_at" timestamp with time zone,
	CONSTRAINT "document_versions_org_id_id_unique" UNIQUE("org_id","id"),
	CONSTRAINT "document_versions_number_unique" UNIQUE("org_id","document_id","version"),
	CONSTRAINT "document_versions_source_check" CHECK ("document_versions"."source" in ('upload', 'generated'))
);
--> statement-breakpoint
CREATE TABLE "document_views" (
	"org_id" uuid NOT NULL,
	"document_version_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"first_viewed_at" timestamp with time zone NOT NULL,
	CONSTRAINT "document_views_org_id_document_version_id_membership_id_pk" PRIMARY KEY("org_id","document_version_id","membership_id")
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"category_id" uuid NOT NULL,
	"title" text NOT NULL,
	"notes" text,
	"current_version_id" uuid,
	"created_by_membership_id" uuid NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by_membership_id" uuid,
	"delete_reason" text,
	"purged_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "documents_org_id_id_unique" UNIQUE("org_id","id")
);
--> statement-breakpoint
CREATE TABLE "letter_templates" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"body_md" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"target_category_id" uuid NOT NULL,
	"updated_by_membership_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "letter_templates_org_id_id_unique" UNIQUE("org_id","id"),
	CONSTRAINT "letter_templates_name_unique" UNIQUE("org_id","name")
);
--> statement-breakpoint
ALTER TABLE "acknowledgement_requests" ADD CONSTRAINT "acknowledgement_requests_org_id_organisations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "acknowledgement_requests" ADD CONSTRAINT "acknowledgement_requests_document_fk" FOREIGN KEY ("org_id","document_id") REFERENCES "public"."documents"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "acknowledgement_requests" ADD CONSTRAINT "acknowledgement_requests_version_fk" FOREIGN KEY ("org_id","document_version_id") REFERENCES "public"."document_versions"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "acknowledgement_requests" ADD CONSTRAINT "acknowledgement_requests_employee_fk" FOREIGN KEY ("org_id","employee_id") REFERENCES "public"."employees"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_categories" ADD CONSTRAINT "document_categories_org_id_organisations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_requests" ADD CONSTRAINT "document_requests_org_id_organisations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_requests" ADD CONSTRAINT "document_requests_employee_fk" FOREIGN KEY ("org_id","employee_id") REFERENCES "public"."employees"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_requests" ADD CONSTRAINT "document_requests_document_fk" FOREIGN KEY ("org_id","document_id") REFERENCES "public"."documents"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_retention_reviews" ADD CONSTRAINT "document_retention_reviews_org_id_organisations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_retention_reviews" ADD CONSTRAINT "document_retention_reviews_document_fk" FOREIGN KEY ("org_id","document_id") REFERENCES "public"."documents"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_org_id_organisations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_document_fk" FOREIGN KEY ("org_id","document_id") REFERENCES "public"."documents"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_file_fk" FOREIGN KEY ("org_id","file_id") REFERENCES "public"."files"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_template_fk" FOREIGN KEY ("org_id","template_id") REFERENCES "public"."letter_templates"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_views" ADD CONSTRAINT "document_views_org_id_organisations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_views" ADD CONSTRAINT "document_views_version_fk" FOREIGN KEY ("org_id","document_version_id") REFERENCES "public"."document_versions"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_views" ADD CONSTRAINT "document_views_membership_fk" FOREIGN KEY ("org_id","membership_id") REFERENCES "public"."memberships"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_org_id_organisations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_employee_fk" FOREIGN KEY ("org_id","employee_id") REFERENCES "public"."employees"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_category_fk" FOREIGN KEY ("org_id","category_id") REFERENCES "public"."document_categories"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_created_by_fk" FOREIGN KEY ("org_id","created_by_membership_id") REFERENCES "public"."memberships"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "letter_templates" ADD CONSTRAINT "letter_templates_org_id_organisations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "letter_templates" ADD CONSTRAINT "letter_templates_category_fk" FOREIGN KEY ("org_id","target_category_id") REFERENCES "public"."document_categories"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "acknowledgement_requests_open_idx" ON "acknowledgement_requests" USING btree ("org_id","employee_id") WHERE "acknowledgement_requests"."acknowledged_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "document_categories_system_key_unique" ON "document_categories" USING btree ("org_id","system_key") WHERE "document_categories"."system_key" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "document_retention_reviews_one_open" ON "document_retention_reviews" USING btree ("org_id","document_id") WHERE "document_retention_reviews"."resolved_at" is null;--> statement-breakpoint
CREATE INDEX "documents_employee_idx" ON "documents" USING btree ("org_id","employee_id");