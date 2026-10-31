CREATE TABLE "attendance_punches" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"source" text NOT NULL,
	"device_time" timestamp with time zone NOT NULL,
	"sent_at" timestamp with time zone NOT NULL,
	"server_time" timestamp with time zone NOT NULL,
	"recorded_at" timestamp with time zone NOT NULL,
	"work_date" date NOT NULL,
	"skew_seconds" integer NOT NULL,
	"queued" boolean DEFAULT false NOT NULL,
	"latitude" double precision,
	"longitude" double precision,
	"accuracy_metres" integer,
	"ip" text,
	"flags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"reason" text,
	"created_by_membership_id" uuid,
	"voided_at" timestamp with time zone,
	"voided_by_membership_id" uuid,
	"void_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "attendance_punches_org_id_id_unique" UNIQUE("org_id","id"),
	CONSTRAINT "attendance_punches_idempotency" UNIQUE("org_id","employee_id","idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "attendance_settings" (
	"org_id" uuid PRIMARY KEY NOT NULL,
	"location_mode" text DEFAULT 'off' NOT NULL,
	"offices" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"location_enforcement" text DEFAULT 'flag' NOT NULL,
	"allowed_ips" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"ip_enforcement" text DEFAULT 'flag' NOT NULL,
	"pdpa_notice" text,
	"default_start_time" text DEFAULT '09:00' NOT NULL,
	"schedule_start_times" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"break_minutes" integer DEFAULT 60 NOT NULL,
	"late_grace_minutes" integer DEFAULT 5 NOT NULL,
	"early_out_grace_minutes" integer DEFAULT 5 NOT NULL,
	"skew_threshold_seconds" integer DEFAULT 120 NOT NULL,
	"ot_block_minutes" integer DEFAULT 15 NOT NULL,
	"ot_minimum_minutes" integer DEFAULT 30 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "overtime_claims" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"work_date" date NOT NULL,
	"computed_minutes" integer NOT NULL,
	"claimed_minutes" integer NOT NULL,
	"approved_minutes" integer,
	"statutory" boolean NOT NULL,
	"reason" text,
	"status" text NOT NULL,
	"approval_request_id" uuid,
	"created_by_membership_id" uuid NOT NULL,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "overtime_claims_org_id_id_unique" UNIQUE("org_id","id")
);
--> statement-breakpoint
CREATE TABLE "leave_attachments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"request_id" uuid NOT NULL,
	"file_key" text NOT NULL,
	"filename" text NOT NULL,
	"content_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"uploaded_by_membership_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "leave_attachments_org_id_id_unique" UNIQUE("org_id","id")
);
--> statement-breakpoint
CREATE TABLE "leave_children" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"name" text NOT NULL,
	"birth_date" date,
	"expected_delivery_date" date,
	"is_citizen" boolean NOT NULL,
	"birth_order" smallint NOT NULL,
	"stillborn" boolean DEFAULT false NOT NULL,
	"adoption_intent_date" date,
	"married_to_mother" boolean,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "leave_children_org_id_id_unique" UNIQUE("org_id","id")
);
--> statement-breakpoint
CREATE TABLE "leave_holidays" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"date" date NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "leave_holidays_org_id_id_unique" UNIQUE("org_id","id"),
	CONSTRAINT "leave_holidays_org_date" UNIQUE("org_id","date")
);
--> statement-breakpoint
CREATE TABLE "leave_ledger" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"leave_type_id" uuid NOT NULL,
	"leave_year" integer NOT NULL,
	"child_id" uuid,
	"kind" text NOT NULL,
	"unit" text NOT NULL,
	"hundredths" integer NOT NULL,
	"request_id" uuid,
	"source_ref" text,
	"expires_on" date,
	"reason" text,
	"created_by_membership_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "leave_ledger_org_id_id_unique" UNIQUE("org_id","id")
);
--> statement-breakpoint
CREATE TABLE "leave_request_days" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"request_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"leave_type_id" uuid NOT NULL,
	"date" date NOT NULL,
	"session" text NOT NULL,
	"hundredths" integer NOT NULL,
	"leave_year" integer NOT NULL,
	CONSTRAINT "leave_request_days_org_id_id_unique" UNIQUE("org_id","id")
);
--> statement-breakpoint
CREATE TABLE "leave_requests" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"leave_type_id" uuid NOT NULL,
	"child_id" uuid,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"start_session" text NOT NULL,
	"end_session" text NOT NULL,
	"unit" text NOT NULL,
	"hundredths" integer NOT NULL,
	"reason" text,
	"status" text NOT NULL,
	"approval_request_id" uuid,
	"cancellation_request_id" uuid,
	"requested_by_membership_id" uuid NOT NULL,
	"on_behalf" boolean DEFAULT false NOT NULL,
	"cancel_reason" text,
	"decided_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "leave_requests_org_id_id_unique" UNIQUE("org_id","id")
);
--> statement-breakpoint
CREATE TABLE "leave_settings" (
	"org_id" uuid PRIMARY KEY NOT NULL,
	"off_day_holiday" text DEFAULT 'extra_pay' NOT NULL,
	"unpaid_service_rule" text DEFAULT 'whole_month' NOT NULL,
	"full_time_schedule_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "leave_types" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"statutory_code" text,
	"paid" boolean NOT NULL,
	"day_counting" text NOT NULL,
	"half_days" boolean NOT NULL,
	"attachment" text NOT NULL,
	"attachment_label" text,
	"sensitive" boolean NOT NULL,
	"policy" jsonb NOT NULL,
	"sort_order" smallint DEFAULT 100 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "leave_types_org_id_id_unique" UNIQUE("org_id","id"),
	CONSTRAINT "leave_types_org_code" UNIQUE("org_id","code")
);
--> statement-breakpoint
CREATE TABLE "leave_year_closings" (
	"org_id" uuid NOT NULL,
	"year" integer NOT NULL,
	"closed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"employees" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "leave_year_closings_org_id_year_pk" PRIMARY KEY("org_id","year")
);
--> statement-breakpoint
ALTER TABLE "attendance_punches" ADD CONSTRAINT "attendance_punches_org_id_organisations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_punches" ADD CONSTRAINT "attendance_punches_employee_fk" FOREIGN KEY ("org_id","employee_id") REFERENCES "public"."employees"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_settings" ADD CONSTRAINT "attendance_settings_org_id_organisations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "overtime_claims" ADD CONSTRAINT "overtime_claims_org_id_organisations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "overtime_claims" ADD CONSTRAINT "overtime_claims_employee_fk" FOREIGN KEY ("org_id","employee_id") REFERENCES "public"."employees"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_attachments" ADD CONSTRAINT "leave_attachments_org_id_organisations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_attachments" ADD CONSTRAINT "leave_attachments_request_fk" FOREIGN KEY ("org_id","request_id") REFERENCES "public"."leave_requests"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_children" ADD CONSTRAINT "leave_children_org_id_organisations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_children" ADD CONSTRAINT "leave_children_employee_fk" FOREIGN KEY ("org_id","employee_id") REFERENCES "public"."employees"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_holidays" ADD CONSTRAINT "leave_holidays_org_id_organisations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_ledger" ADD CONSTRAINT "leave_ledger_org_id_organisations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_ledger" ADD CONSTRAINT "leave_ledger_employee_fk" FOREIGN KEY ("org_id","employee_id") REFERENCES "public"."employees"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_ledger" ADD CONSTRAINT "leave_ledger_type_fk" FOREIGN KEY ("org_id","leave_type_id") REFERENCES "public"."leave_types"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_ledger" ADD CONSTRAINT "leave_ledger_request_fk" FOREIGN KEY ("org_id","request_id") REFERENCES "public"."leave_requests"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_request_days" ADD CONSTRAINT "leave_request_days_org_id_organisations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_request_days" ADD CONSTRAINT "leave_request_days_request_fk" FOREIGN KEY ("org_id","request_id") REFERENCES "public"."leave_requests"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_request_days" ADD CONSTRAINT "leave_request_days_employee_fk" FOREIGN KEY ("org_id","employee_id") REFERENCES "public"."employees"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_org_id_organisations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_employee_fk" FOREIGN KEY ("org_id","employee_id") REFERENCES "public"."employees"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_type_fk" FOREIGN KEY ("org_id","leave_type_id") REFERENCES "public"."leave_types"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_child_fk" FOREIGN KEY ("org_id","child_id") REFERENCES "public"."leave_children"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_settings" ADD CONSTRAINT "leave_settings_org_id_organisations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_settings" ADD CONSTRAINT "leave_settings_schedule_fk" FOREIGN KEY ("org_id","full_time_schedule_id") REFERENCES "public"."work_schedules"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_types" ADD CONSTRAINT "leave_types_org_id_organisations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_year_closings" ADD CONSTRAINT "leave_year_closings_org_id_organisations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "attendance_punches_day" ON "attendance_punches" USING btree ("org_id","employee_id","work_date");--> statement-breakpoint
CREATE UNIQUE INDEX "overtime_claims_one_open" ON "overtime_claims" USING btree ("org_id","employee_id","work_date") WHERE "overtime_claims"."status" in ('pending', 'approved');--> statement-breakpoint
CREATE INDEX "overtime_claims_period" ON "overtime_claims" USING btree ("org_id","work_date");--> statement-breakpoint
CREATE INDEX "leave_children_employee" ON "leave_children" USING btree ("org_id","employee_id");--> statement-breakpoint
CREATE INDEX "leave_ledger_balance" ON "leave_ledger" USING btree ("org_id","employee_id","leave_type_id","leave_year");--> statement-breakpoint
CREATE UNIQUE INDEX "leave_ledger_request_once" ON "leave_ledger" USING btree ("request_id","kind","leave_year") WHERE "leave_ledger"."request_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "leave_ledger_source_once" ON "leave_ledger" USING btree ("org_id","source_ref") WHERE "leave_ledger"."source_ref" is not null;--> statement-breakpoint
CREATE INDEX "leave_request_days_employee_date" ON "leave_request_days" USING btree ("org_id","employee_id","date");--> statement-breakpoint
CREATE INDEX "leave_request_days_date" ON "leave_request_days" USING btree ("org_id","date");--> statement-breakpoint
CREATE INDEX "leave_requests_employee" ON "leave_requests" USING btree ("org_id","employee_id","start_date");