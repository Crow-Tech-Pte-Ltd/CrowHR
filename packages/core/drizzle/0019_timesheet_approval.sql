CREATE TABLE "attendance_timesheets" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"status" text NOT NULL,
	"approval_request_id" uuid,
	"submitted_by_membership_id" uuid NOT NULL,
	"submitted_at" timestamp with time zone NOT NULL,
	"submitted_totals" jsonb NOT NULL,
	"approved_totals" jsonb,
	"decided_at" timestamp with time zone,
	"decided_by_membership_id" uuid,
	"comment" text,
	"reopened_at" timestamp with time zone,
	"reopened_by_membership_id" uuid,
	"reopen_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "attendance_timesheets_org_id_id_unique" UNIQUE("org_id","id"),
	CONSTRAINT "attendance_timesheets_period_order" CHECK ("attendance_timesheets"."period_end" >= "attendance_timesheets"."period_start")
);
--> statement-breakpoint
ALTER TABLE "attendance_settings" ADD COLUMN "timesheet_approval" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "attendance_settings" ADD COLUMN "timesheet_period" text DEFAULT 'monthly' NOT NULL;--> statement-breakpoint
ALTER TABLE "attendance_settings" ADD COLUMN "timesheet_submitter" text DEFAULT 'employee' NOT NULL;--> statement-breakpoint
ALTER TABLE "attendance_settings" ADD COLUMN "payroll_approved_timesheets_only" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "attendance_timesheets" ADD CONSTRAINT "attendance_timesheets_org_id_organisations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_timesheets" ADD CONSTRAINT "attendance_timesheets_employee_fk" FOREIGN KEY ("org_id","employee_id") REFERENCES "public"."employees"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "attendance_timesheets_one_open" ON "attendance_timesheets" USING btree ("org_id","employee_id","period_start") WHERE "attendance_timesheets"."status" in ('submitted', 'approved');--> statement-breakpoint
CREATE INDEX "attendance_timesheets_period" ON "attendance_timesheets" USING btree ("org_id","employee_id","period_start");