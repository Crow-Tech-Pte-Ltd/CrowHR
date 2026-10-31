CREATE TABLE "claim_line_files" (
	"org_id" uuid NOT NULL,
	"claim_line_id" uuid NOT NULL,
	"file_id" uuid NOT NULL,
	"position" integer NOT NULL,
	CONSTRAINT "claim_line_files_claim_line_id_file_id_pk" PRIMARY KEY("claim_line_id","file_id")
);
--> statement-breakpoint
CREATE TABLE "claim_lines" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"claim_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"claim_type_id" uuid NOT NULL,
	"expense_date" date NOT NULL,
	"merchant" text NOT NULL,
	"description" text NOT NULL,
	"currency" text NOT NULL,
	"currency_exponent" integer NOT NULL,
	"amount_minor" bigint NOT NULL,
	"rate_micros" bigint,
	"sgd_cents" bigint NOT NULL,
	"gst_cents" bigint,
	CONSTRAINT "claim_lines_org_id_unique" UNIQUE("org_id","id"),
	CONSTRAINT "claim_lines_position_unique" UNIQUE("claim_id","position"),
	CONSTRAINT "claim_lines_amount_check" CHECK ("claim_lines"."amount_minor" > 0 and "claim_lines"."sgd_cents" >= 0),
	CONSTRAINT "claim_lines_gst_check" CHECK ("claim_lines"."gst_cents" is null or ("claim_lines"."gst_cents" >= 0 and "claim_lines"."gst_cents" <= "claim_lines"."sgd_cents")),
	CONSTRAINT "claim_lines_rate_check" CHECK (("claim_lines"."currency" = 'SGD') = ("claim_lines"."rate_micros" is null))
);
--> statement-breakpoint
CREATE TABLE "claim_settings" (
	"org_id" uuid PRIMARY KEY NOT NULL,
	"submission_window_days" integer DEFAULT 90 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "claim_types" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"category" text NOT NULL,
	"receipt_rule" text NOT NULL,
	"receipt_above_cents" bigint,
	"cap_cents" bigint,
	"cap_period" text DEFAULT 'none' NOT NULL,
	"eligible_employment_types" text[] DEFAULT '{}' NOT NULL,
	"available_during_probation" boolean DEFAULT true NOT NULL,
	"default_payout" text DEFAULT 'payroll' NOT NULL,
	"gst_applicable" boolean DEFAULT true NOT NULL,
	"taxable" boolean DEFAULT false NOT NULL,
	"gl_code" text,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "claim_types_org_id_unique" UNIQUE("org_id","id"),
	CONSTRAINT "claim_types_org_code_unique" UNIQUE("org_id","code"),
	CONSTRAINT "claim_types_cap_check" CHECK (("claim_types"."cap_period" = 'none' and "claim_types"."cap_cents" is null) or ("claim_types"."cap_period" <> 'none' and "claim_types"."cap_cents" > 0)),
	CONSTRAINT "claim_types_receipt_check" CHECK (("claim_types"."receipt_rule" = 'above') = ("claim_types"."receipt_above_cents" is not null))
);
--> statement-breakpoint
CREATE TABLE "claims" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"claim_number" text,
	"status" text NOT NULL,
	"title" text,
	"total_cents" bigint DEFAULT 0 NOT NULL,
	"payout_method" text,
	"approval_request_id" uuid,
	"created_by_membership_id" uuid NOT NULL,
	"submitted_by_membership_id" uuid,
	"submitted_at" timestamp with time zone,
	"decided_at" timestamp with time zone,
	"approved_on" date,
	"decision_comment" text,
	"payroll_run_id" uuid,
	"reserved_at" timestamp with time zone,
	"paid_via" text,
	"paid_on" date,
	"paid_reference" text,
	"paid_by_membership_id" uuid,
	"copied_from_claim_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "claims_org_id_unique" UNIQUE("org_id","id"),
	CONSTRAINT "claims_org_number_unique" UNIQUE("org_id","claim_number"),
	CONSTRAINT "claims_status_check" CHECK ("claims"."status" in ('draft', 'submitted', 'approved', 'rejected', 'withdrawn', 'paid')),
	CONSTRAINT "claims_paid_check" CHECK (("claims"."status" = 'paid') = ("claims"."paid_on" is not null)),
	CONSTRAINT "claims_reserved_check" CHECK ("claims"."payroll_run_id" is null or "claims"."status" in ('approved', 'paid')),
	CONSTRAINT "claims_total_check" CHECK ("claims"."total_cents" >= 0)
);
--> statement-breakpoint
CREATE TABLE "files" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"purpose" text NOT NULL,
	"sha256" text NOT NULL,
	"mime" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"storage_key" text NOT NULL,
	"original_name" text NOT NULL,
	"scan_status" text NOT NULL,
	"scan_attempts" integer DEFAULT 0 NOT NULL,
	"scanned_at" timestamp with time zone,
	"owner_employee_id" uuid,
	"uploaded_by_membership_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "files_org_id_unique" UNIQUE("org_id","id"),
	CONSTRAINT "files_storage_key_unique" UNIQUE("storage_key"),
	CONSTRAINT "files_size_check" CHECK ("files"."size_bytes" > 0),
	CONSTRAINT "files_scan_status_check" CHECK ("files"."scan_status" in ('unscanned', 'pending_scan', 'clean', 'infected', 'scan_failed'))
);
--> statement-breakpoint
CREATE TABLE "org_counters" (
	"org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"next_value" bigint NOT NULL,
	CONSTRAINT "org_counters_org_id_name_pk" PRIMARY KEY("org_id","name")
);
--> statement-breakpoint
ALTER TABLE "claim_line_files" ADD CONSTRAINT "claim_line_files_org_id_organisations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claim_line_files" ADD CONSTRAINT "claim_line_files_line_fk" FOREIGN KEY ("org_id","claim_line_id") REFERENCES "public"."claim_lines"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claim_line_files" ADD CONSTRAINT "claim_line_files_file_fk" FOREIGN KEY ("org_id","file_id") REFERENCES "public"."files"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claim_lines" ADD CONSTRAINT "claim_lines_org_id_organisations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claim_lines" ADD CONSTRAINT "claim_lines_claim_fk" FOREIGN KEY ("org_id","claim_id") REFERENCES "public"."claims"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claim_lines" ADD CONSTRAINT "claim_lines_type_fk" FOREIGN KEY ("org_id","claim_type_id") REFERENCES "public"."claim_types"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claim_settings" ADD CONSTRAINT "claim_settings_org_id_organisations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claim_types" ADD CONSTRAINT "claim_types_org_id_organisations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_org_id_organisations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_employee_fk" FOREIGN KEY ("org_id","employee_id") REFERENCES "public"."employees"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_created_by_fk" FOREIGN KEY ("org_id","created_by_membership_id") REFERENCES "public"."memberships"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_org_id_organisations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_owner_employee_fk" FOREIGN KEY ("org_id","owner_employee_id") REFERENCES "public"."employees"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_uploader_fk" FOREIGN KEY ("org_id","uploaded_by_membership_id") REFERENCES "public"."memberships"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_counters" ADD CONSTRAINT "org_counters_org_id_organisations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "claim_line_files_file_idx" ON "claim_line_files" USING btree ("org_id","file_id");--> statement-breakpoint
CREATE INDEX "claim_lines_type_date_idx" ON "claim_lines" USING btree ("org_id","claim_type_id","expense_date");--> statement-breakpoint
CREATE INDEX "claims_employee_idx" ON "claims" USING btree ("org_id","employee_id","status");--> statement-breakpoint
CREATE INDEX "claims_payable_idx" ON "claims" USING btree ("org_id","status","approved_on");--> statement-breakpoint
CREATE INDEX "claims_run_idx" ON "claims" USING btree ("org_id","payroll_run_id");--> statement-breakpoint
CREATE INDEX "files_org_sha_idx" ON "files" USING btree ("org_id","sha256");--> statement-breakpoint
CREATE INDEX "files_scan_idx" ON "files" USING btree ("scan_status");