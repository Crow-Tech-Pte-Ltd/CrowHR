CREATE TABLE "payroll_allowance_settings" (
	"org_id" uuid NOT NULL,
	"allowance_type_id" uuid NOT NULL,
	"cpf_liable" boolean DEFAULT true NOT NULL,
	"prorate" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payroll_allowance_settings_pk" PRIMARY KEY("org_id","allowance_type_id")
);
--> statement-breakpoint
CREATE TABLE "payroll_backpay_notices" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"compensation_record_id" uuid NOT NULL,
	"effective_from" date NOT NULL,
	"previous_amount_cents" bigint,
	"new_amount_cents" bigint NOT NULL,
	"resolved_run_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payroll_backpay_notices_org_id_id_unique" UNIQUE("org_id","id")
);
--> statement-breakpoint
CREATE TABLE "payroll_payslips" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"employee_number" text NOT NULL,
	"employee_name" text NOT NULL,
	"input" jsonb NOT NULL,
	"input_hash" text NOT NULL,
	"result" jsonb NOT NULL,
	"result_hash" text NOT NULL,
	"gross_cents" bigint NOT NULL,
	"net_cents" bigint NOT NULL,
	"net_payable_cents" bigint NOT NULL,
	"cpf_employee_cents" bigint NOT NULL,
	"cpf_employer_cents" bigint NOT NULL,
	"blocking_count" integer NOT NULL,
	"warning_count" integer NOT NULL,
	"released_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payroll_payslips_org_id_id_unique" UNIQUE("org_id","id"),
	CONSTRAINT "payroll_payslips_run_employee_unique" UNIQUE("org_id","run_id","employee_id")
);
--> statement-breakpoint
CREATE TABLE "payroll_run_items" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"label" text NOT NULL,
	"amount_cents" bigint,
	"wage_class" text,
	"cpf_liable" boolean DEFAULT true NOT NULL,
	"aw_payable_date" date,
	"minutes" integer,
	"half_days" integer,
	"item_date" date,
	"period_start" date,
	"period_end" date,
	"deduction_category" text,
	"source" text DEFAULT 'manual' NOT NULL,
	"copied_from_item_id" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payroll_run_items_org_id_id_unique" UNIQUE("org_id","id")
);
--> statement-breakpoint
CREATE TABLE "payroll_runs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"off_cycle_reason" text,
	"month" text NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"pay_date" date NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"employee_ids" jsonb,
	"adjusts_run_id" uuid,
	"superseded_by_run_id" uuid,
	"reopen_reason" text,
	"approval_request_id" text,
	"submitted_by" uuid,
	"submitted_at" timestamp with time zone,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"decision_comment" text,
	"self_approved" boolean DEFAULT false NOT NULL,
	"computed_at" timestamp with time zone,
	"inputs_changed_at" timestamp with time zone,
	"input_hash" text,
	"result_hash" text,
	"totals" jsonb,
	"issues" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"released_at" timestamp with time zone,
	"released_by" uuid,
	"paid_at" timestamp with time zone,
	"paid_by" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payroll_runs_org_id_id_unique" UNIQUE("org_id","id")
);
--> statement-breakpoint
CREATE TABLE "payroll_settings" (
	"org_id" uuid PRIMARY KEY NOT NULL,
	"pay_day" smallint,
	"cutoff_day" smallint,
	"auto_release" boolean DEFAULT false NOT NULL,
	"cpf_advice_code" text DEFAULT '01' NOT NULL,
	"fwl_sector" text,
	"fwl_tier" text,
	"fwl_skill" text,
	"debit_bank_bic" text,
	"debit_account_enc" text,
	"debit_account_last4" text,
	"debit_account_name" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "payroll_allowance_settings" ADD CONSTRAINT "payroll_allowance_settings_org_id_organisations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_allowance_settings" ADD CONSTRAINT "payroll_allowance_settings_type_fk" FOREIGN KEY ("org_id","allowance_type_id") REFERENCES "public"."allowance_types"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_backpay_notices" ADD CONSTRAINT "payroll_backpay_notices_org_id_organisations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_backpay_notices" ADD CONSTRAINT "payroll_backpay_notices_employee_fk" FOREIGN KEY ("org_id","employee_id") REFERENCES "public"."employees"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_backpay_notices" ADD CONSTRAINT "payroll_backpay_notices_run_fk" FOREIGN KEY ("org_id","resolved_run_id") REFERENCES "public"."payroll_runs"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_payslips" ADD CONSTRAINT "payroll_payslips_org_id_organisations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_payslips" ADD CONSTRAINT "payroll_payslips_run_fk" FOREIGN KEY ("org_id","run_id") REFERENCES "public"."payroll_runs"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_payslips" ADD CONSTRAINT "payroll_payslips_employee_fk" FOREIGN KEY ("org_id","employee_id") REFERENCES "public"."employees"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_run_items" ADD CONSTRAINT "payroll_run_items_org_id_organisations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_run_items" ADD CONSTRAINT "payroll_run_items_run_fk" FOREIGN KEY ("org_id","run_id") REFERENCES "public"."payroll_runs"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_run_items" ADD CONSTRAINT "payroll_run_items_employee_fk" FOREIGN KEY ("org_id","employee_id") REFERENCES "public"."employees"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_runs" ADD CONSTRAINT "payroll_runs_org_id_organisations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_runs" ADD CONSTRAINT "payroll_runs_adjusts_fk" FOREIGN KEY ("org_id","adjusts_run_id") REFERENCES "public"."payroll_runs"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_runs" ADD CONSTRAINT "payroll_runs_superseded_by_fk" FOREIGN KEY ("org_id","superseded_by_run_id") REFERENCES "public"."payroll_runs"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_settings" ADD CONSTRAINT "payroll_settings_org_id_organisations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "payroll_backpay_notices_open" ON "payroll_backpay_notices" USING btree ("org_id","employee_id");--> statement-breakpoint
CREATE INDEX "payroll_payslips_employee" ON "payroll_payslips" USING btree ("org_id","employee_id","released_at");--> statement-breakpoint
CREATE INDEX "payroll_run_items_run" ON "payroll_run_items" USING btree ("org_id","run_id","employee_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payroll_runs_one_regular_per_month" ON "payroll_runs" USING btree ("org_id","month") WHERE "payroll_runs"."kind" = 'regular';--> statement-breakpoint
CREATE UNIQUE INDEX "payroll_runs_one_open_adjustment" ON "payroll_runs" USING btree ("org_id","adjusts_run_id") WHERE "payroll_runs"."kind" = 'adjustment' and "payroll_runs"."status" in ('draft', 'in_review');--> statement-breakpoint
CREATE INDEX "payroll_runs_month" ON "payroll_runs" USING btree ("org_id","month");