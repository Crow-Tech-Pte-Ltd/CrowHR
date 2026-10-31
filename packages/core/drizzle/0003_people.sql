CREATE TABLE "allowance_types" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "allowance_types_org_id_id_unique" UNIQUE("org_id","id")
);
--> statement-breakpoint
CREATE TABLE "bank_accounts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"bank_code" text NOT NULL,
	"account_number_enc" text NOT NULL,
	"account_number_hmac" text NOT NULL,
	"account_last4" text NOT NULL,
	"holder_name" text NOT NULL,
	"effective_from" date NOT NULL,
	"effective_to" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bank_accounts_org_id_id_unique" UNIQUE("org_id","id")
);
--> statement-breakpoint
CREATE TABLE "checklist_items" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"checklist_id" uuid NOT NULL,
	"title" text NOT NULL,
	"assignee_role" text NOT NULL,
	"due_on" date NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"position" smallint NOT NULL,
	"done_by" uuid,
	"done_at" timestamp with time zone,
	"skip_reason" text,
	CONSTRAINT "checklist_items_org_id_id_unique" UNIQUE("org_id","id")
);
--> statement-breakpoint
CREATE TABLE "checklist_template_items" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"template_id" uuid NOT NULL,
	"title" text NOT NULL,
	"assignee_role" text NOT NULL,
	"due_offset_days" integer NOT NULL,
	"position" smallint NOT NULL,
	CONSTRAINT "checklist_template_items_org_id_id_unique" UNIQUE("org_id","id")
);
--> statement-breakpoint
CREATE TABLE "checklist_templates" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "checklist_templates_org_id_id_unique" UNIQUE("org_id","id")
);
--> statement-breakpoint
CREATE TABLE "checklists" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"template_id" uuid,
	"kind" text NOT NULL,
	"anchor_date" date NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "checklists_org_id_id_unique" UNIQUE("org_id","id")
);
--> statement-breakpoint
CREATE TABLE "compensation_records" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"effective_from" date NOT NULL,
	"effective_to" date,
	"pay_basis" text NOT NULL,
	"amount_cents" bigint NOT NULL,
	"reason" text,
	"retroactive" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "compensation_records_org_id_id_unique" UNIQUE("org_id","id")
);
--> statement-breakpoint
CREATE TABLE "emergency_contacts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"name" text NOT NULL,
	"relationship" text NOT NULL,
	"phone_e164" text NOT NULL,
	"position" smallint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "emergency_contacts_org_id_id_unique" UNIQUE("org_id","id")
);
--> statement-breakpoint
CREATE TABLE "employees" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"employee_number" text NOT NULL,
	"legal_name" text NOT NULL,
	"preferred_name" text,
	"id_type" text NOT NULL,
	"id_number_enc" text NOT NULL,
	"id_number_hmac" text NOT NULL,
	"id_number_masked" text NOT NULL,
	"dob" date NOT NULL,
	"gender" text,
	"nationality" text,
	"residency_status" text NOT NULL,
	"pr_start_date" date,
	"spr_cpf_option" text,
	"spr_cpf_option_approved_on" date,
	"race" text,
	"race_secondary" text,
	"religion" text,
	"shg_opt_out_on" date,
	"work_email" text,
	"personal_email" text,
	"mobile_e164" text,
	"address" jsonb,
	"photo_file_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "employees_org_id_id_unique" UNIQUE("org_id","id"),
	CONSTRAINT "employees_org_number_unique" UNIQUE("org_id","employee_number"),
	CONSTRAINT "employees_org_id_hmac_unique" UNIQUE("org_id","id_number_hmac")
);
--> statement-breakpoint
CREATE TABLE "employment_records" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"tenure_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"effective_from" date NOT NULL,
	"effective_to" date,
	"job_title" text NOT NULL,
	"department_id" uuid NOT NULL,
	"team_id" uuid,
	"location_id" uuid,
	"cost_centre_id" uuid,
	"manager_employee_id" uuid,
	"employment_type" text NOT NULL,
	"work_schedule_id" uuid NOT NULL,
	"probation_end" date,
	"ea_covered" boolean DEFAULT true NOT NULL,
	"is_workman" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "employment_records_org_id_id_unique" UNIQUE("org_id","id")
);
--> statement-breakpoint
CREATE TABLE "import_jobs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"status" text NOT NULL,
	"file_name" text,
	"rows" jsonb NOT NULL,
	"errors" jsonb NOT NULL,
	"valid_row_count" integer NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_by" uuid,
	"committed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "import_jobs_org_id_id_unique" UNIQUE("org_id","id")
);
--> statement-breakpoint
CREATE TABLE "lifecycle_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"tenure_id" uuid,
	"type" text NOT NULL,
	"effective_date" date NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by" uuid,
	"cancelled_at" timestamp with time zone,
	"cancelled_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lifecycle_events_org_id_id_unique" UNIQUE("org_id","id")
);
--> statement-breakpoint
CREATE TABLE "profile_change_requests" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"fields" jsonb NOT NULL,
	"field_names" text[] NOT NULL,
	"route_to_role" text NOT NULL,
	"attachment_file_key" text,
	"approval_request_id" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"effective_from" date,
	"requested_by" uuid,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"decision_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "profile_change_requests_org_id_id_unique" UNIQUE("org_id","id")
);
--> statement-breakpoint
CREATE TABLE "recurring_allowances" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"allowance_type_id" uuid NOT NULL,
	"event_id" uuid,
	"amount_cents" bigint NOT NULL,
	"effective_from" date NOT NULL,
	"effective_to" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recurring_allowances_org_id_id_unique" UNIQUE("org_id","id")
);
--> statement-breakpoint
CREATE TABLE "tenures" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"hire_date" date NOT NULL,
	"last_working_day" date,
	"notice_given_on" date,
	"notice_days" integer,
	"cessation_reason" text,
	"cessation_event_id" uuid,
	"former_transition_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenures_org_id_id_unique" UNIQUE("org_id","id")
);
--> statement-breakpoint
CREATE TABLE "work_passes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"pass_type" text NOT NULL,
	"pass_number_enc" text,
	"pass_number_masked" text,
	"issued_on" date,
	"expires_on" date NOT NULL,
	"cancelled_on" date,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "work_passes_org_id_id_unique" UNIQUE("org_id","id")
);
--> statement-breakpoint
CREATE TABLE "ytd_opening_balances" (
	"org_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"year" smallint NOT NULL,
	"through_month" smallint NOT NULL,
	"ow_cents" bigint NOT NULL,
	"ow_cpf_cents" bigint,
	"aw_cents" bigint NOT NULL,
	"aw_cpf_cents" bigint,
	"cpf_ee_cents" bigint NOT NULL,
	"cpf_er_cents" bigint NOT NULL,
	"shg_cents" bigint NOT NULL,
	"sdl_cents" bigint,
	"import_job_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ytd_opening_balances_pk" PRIMARY KEY("org_id","employee_id","year")
);
--> statement-breakpoint
CREATE TABLE "company_profiles" (
	"org_id" uuid PRIMARY KEY NOT NULL,
	"legal_name" text NOT NULL,
	"trading_name" text,
	"uen" text NOT NULL,
	"csn" text,
	"address_block" text,
	"address_street" text,
	"address_unit" text,
	"address_building" text,
	"postal_code" text,
	"logo_file_key" text,
	"logo_content_type" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cost_centres" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cost_centres_org_id_id_unique" UNIQUE("org_id","id")
);
--> statement-breakpoint
CREATE TABLE "departments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"code" text,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "departments_org_id_id_unique" UNIQUE("org_id","id")
);
--> statement-breakpoint
CREATE TABLE "locations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"address" text,
	"postal_code" text,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "locations_org_id_id_unique" UNIQUE("org_id","id")
);
--> statement-breakpoint
CREATE TABLE "teams" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"department_id" uuid,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "teams_org_id_id_unique" UNIQUE("org_id","id")
);
--> statement-breakpoint
CREATE TABLE "work_schedule_versions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"schedule_id" uuid NOT NULL,
	"effective_from" date NOT NULL,
	"effective_to" date,
	"days" jsonb,
	"weekly_minutes" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "work_schedule_versions_org_id_id_unique" UNIQUE("org_id","id")
);
--> statement-breakpoint
CREATE TABLE "work_schedules" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "work_schedules_org_id_id_unique" UNIQUE("org_id","id")
);
--> statement-breakpoint
ALTER TABLE "allowance_types" ADD CONSTRAINT "allowance_types_org_id_organisations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_accounts" ADD CONSTRAINT "bank_accounts_org_id_organisations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_accounts" ADD CONSTRAINT "bank_accounts_employee_fk" FOREIGN KEY ("org_id","employee_id") REFERENCES "public"."employees"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checklist_items" ADD CONSTRAINT "checklist_items_org_id_organisations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checklist_items" ADD CONSTRAINT "checklist_items_checklist_fk" FOREIGN KEY ("org_id","checklist_id") REFERENCES "public"."checklists"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checklist_template_items" ADD CONSTRAINT "checklist_template_items_org_id_organisations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checklist_template_items" ADD CONSTRAINT "checklist_template_items_template_fk" FOREIGN KEY ("org_id","template_id") REFERENCES "public"."checklist_templates"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checklist_templates" ADD CONSTRAINT "checklist_templates_org_id_organisations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checklists" ADD CONSTRAINT "checklists_org_id_organisations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checklists" ADD CONSTRAINT "checklists_employee_fk" FOREIGN KEY ("org_id","employee_id") REFERENCES "public"."employees"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checklists" ADD CONSTRAINT "checklists_event_fk" FOREIGN KEY ("org_id","event_id") REFERENCES "public"."lifecycle_events"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compensation_records" ADD CONSTRAINT "compensation_records_org_id_organisations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compensation_records" ADD CONSTRAINT "compensation_records_employee_fk" FOREIGN KEY ("org_id","employee_id") REFERENCES "public"."employees"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compensation_records" ADD CONSTRAINT "compensation_records_event_fk" FOREIGN KEY ("org_id","event_id") REFERENCES "public"."lifecycle_events"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "emergency_contacts" ADD CONSTRAINT "emergency_contacts_org_id_organisations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "emergency_contacts" ADD CONSTRAINT "emergency_contacts_employee_fk" FOREIGN KEY ("org_id","employee_id") REFERENCES "public"."employees"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_org_id_organisations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employment_records" ADD CONSTRAINT "employment_records_org_id_organisations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employment_records" ADD CONSTRAINT "employment_records_employee_fk" FOREIGN KEY ("org_id","employee_id") REFERENCES "public"."employees"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employment_records" ADD CONSTRAINT "employment_records_tenure_fk" FOREIGN KEY ("org_id","tenure_id") REFERENCES "public"."tenures"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employment_records" ADD CONSTRAINT "employment_records_event_fk" FOREIGN KEY ("org_id","event_id") REFERENCES "public"."lifecycle_events"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employment_records" ADD CONSTRAINT "employment_records_department_fk" FOREIGN KEY ("org_id","department_id") REFERENCES "public"."departments"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employment_records" ADD CONSTRAINT "employment_records_team_fk" FOREIGN KEY ("org_id","team_id") REFERENCES "public"."teams"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employment_records" ADD CONSTRAINT "employment_records_location_fk" FOREIGN KEY ("org_id","location_id") REFERENCES "public"."locations"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employment_records" ADD CONSTRAINT "employment_records_cost_centre_fk" FOREIGN KEY ("org_id","cost_centre_id") REFERENCES "public"."cost_centres"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employment_records" ADD CONSTRAINT "employment_records_manager_fk" FOREIGN KEY ("org_id","manager_employee_id") REFERENCES "public"."employees"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employment_records" ADD CONSTRAINT "employment_records_schedule_fk" FOREIGN KEY ("org_id","work_schedule_id") REFERENCES "public"."work_schedules"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_jobs" ADD CONSTRAINT "import_jobs_org_id_organisations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lifecycle_events" ADD CONSTRAINT "lifecycle_events_org_id_organisations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lifecycle_events" ADD CONSTRAINT "lifecycle_events_employee_fk" FOREIGN KEY ("org_id","employee_id") REFERENCES "public"."employees"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lifecycle_events" ADD CONSTRAINT "lifecycle_events_tenure_fk" FOREIGN KEY ("org_id","tenure_id") REFERENCES "public"."tenures"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile_change_requests" ADD CONSTRAINT "profile_change_requests_org_id_organisations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile_change_requests" ADD CONSTRAINT "profile_change_requests_employee_fk" FOREIGN KEY ("org_id","employee_id") REFERENCES "public"."employees"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_allowances" ADD CONSTRAINT "recurring_allowances_org_id_organisations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_allowances" ADD CONSTRAINT "recurring_allowances_employee_fk" FOREIGN KEY ("org_id","employee_id") REFERENCES "public"."employees"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_allowances" ADD CONSTRAINT "recurring_allowances_type_fk" FOREIGN KEY ("org_id","allowance_type_id") REFERENCES "public"."allowance_types"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_allowances" ADD CONSTRAINT "recurring_allowances_event_fk" FOREIGN KEY ("org_id","event_id") REFERENCES "public"."lifecycle_events"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenures" ADD CONSTRAINT "tenures_org_id_organisations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenures" ADD CONSTRAINT "tenures_employee_fk" FOREIGN KEY ("org_id","employee_id") REFERENCES "public"."employees"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_passes" ADD CONSTRAINT "work_passes_org_id_organisations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_passes" ADD CONSTRAINT "work_passes_employee_fk" FOREIGN KEY ("org_id","employee_id") REFERENCES "public"."employees"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ytd_opening_balances" ADD CONSTRAINT "ytd_opening_balances_org_id_organisations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ytd_opening_balances" ADD CONSTRAINT "ytd_opening_balances_employee_fk" FOREIGN KEY ("org_id","employee_id") REFERENCES "public"."employees"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_profiles" ADD CONSTRAINT "company_profiles_org_id_organisations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cost_centres" ADD CONSTRAINT "cost_centres_org_id_organisations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "departments" ADD CONSTRAINT "departments_org_id_organisations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "locations" ADD CONSTRAINT "locations_org_id_organisations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teams" ADD CONSTRAINT "teams_org_id_organisations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teams" ADD CONSTRAINT "teams_department_fk" FOREIGN KEY ("org_id","department_id") REFERENCES "public"."departments"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_schedule_versions" ADD CONSTRAINT "work_schedule_versions_org_id_organisations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_schedule_versions" ADD CONSTRAINT "work_schedule_versions_schedule_fk" FOREIGN KEY ("org_id","schedule_id") REFERENCES "public"."work_schedules"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_schedules" ADD CONSTRAINT "work_schedules_org_id_organisations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "allowance_types_active_code_unique" ON "allowance_types" USING btree ("org_id",lower("code")) WHERE "allowance_types"."archived_at" is null;--> statement-breakpoint
CREATE INDEX "bank_accounts_lookup" ON "bank_accounts" USING btree ("org_id","employee_id","effective_from");--> statement-breakpoint
CREATE INDEX "checklist_items_open" ON "checklist_items" USING btree ("org_id","status","due_on");--> statement-breakpoint
CREATE UNIQUE INDEX "checklist_templates_one_default" ON "checklist_templates" USING btree ("org_id","kind") WHERE "checklist_templates"."is_default";--> statement-breakpoint
CREATE INDEX "compensation_records_lookup" ON "compensation_records" USING btree ("org_id","employee_id","effective_from");--> statement-breakpoint
CREATE INDEX "employees_org_work_email" ON "employees" USING btree ("org_id",lower("work_email"));--> statement-breakpoint
CREATE INDEX "employment_records_lookup" ON "employment_records" USING btree ("org_id","employee_id","effective_from");--> statement-breakpoint
CREATE INDEX "employment_records_manager" ON "employment_records" USING btree ("org_id","manager_employee_id");--> statement-breakpoint
CREATE INDEX "lifecycle_events_employee" ON "lifecycle_events" USING btree ("org_id","employee_id","effective_date");--> statement-breakpoint
CREATE INDEX "profile_change_requests_pending" ON "profile_change_requests" USING btree ("org_id","employee_id","status");--> statement-breakpoint
CREATE INDEX "recurring_allowances_lookup" ON "recurring_allowances" USING btree ("org_id","employee_id","allowance_type_id","effective_from");--> statement-breakpoint
CREATE INDEX "tenures_employee" ON "tenures" USING btree ("org_id","employee_id","hire_date");--> statement-breakpoint
CREATE INDEX "work_passes_expiry" ON "work_passes" USING btree ("org_id","expires_on");--> statement-breakpoint
CREATE UNIQUE INDEX "cost_centres_active_code_unique" ON "cost_centres" USING btree ("org_id",lower("code")) WHERE "cost_centres"."archived_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "cost_centres_active_name_unique" ON "cost_centres" USING btree ("org_id",lower("name")) WHERE "cost_centres"."archived_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "departments_active_name_unique" ON "departments" USING btree ("org_id",lower("name")) WHERE "departments"."archived_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "locations_active_name_unique" ON "locations" USING btree ("org_id",lower("name")) WHERE "locations"."archived_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "teams_active_name_unique" ON "teams" USING btree ("org_id",lower("name")) WHERE "teams"."archived_at" is null;--> statement-breakpoint
CREATE INDEX "work_schedule_versions_lookup" ON "work_schedule_versions" USING btree ("org_id","schedule_id","effective_from");--> statement-breakpoint
CREATE UNIQUE INDEX "work_schedules_active_name_unique" ON "work_schedules" USING btree ("org_id",lower("name")) WHERE "work_schedules"."archived_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "work_schedules_one_default" ON "work_schedules" USING btree ("org_id") WHERE "work_schedules"."is_default";