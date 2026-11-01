CREATE TABLE "payroll_feed_reservations" (
	"org_id" uuid NOT NULL,
	"source_id" text NOT NULL,
	"employee_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	CONSTRAINT "payroll_feed_reservations_org_id_source_id_pk" PRIMARY KEY("org_id","source_id")
);
--> statement-breakpoint
ALTER TABLE "payroll_allowance_settings" ADD COLUMN "gross_rate_included" boolean;--> statement-breakpoint
ALTER TABLE "payroll_run_items" ADD COLUMN "overtime_source_id" uuid;--> statement-breakpoint
ALTER TABLE "payroll_feed_reservations" ADD CONSTRAINT "payroll_feed_reservations_org_id_organisations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_feed_reservations" ADD CONSTRAINT "payroll_feed_reservations_org_id_run_id_payroll_runs_org_id_id_fk" FOREIGN KEY ("org_id","run_id") REFERENCES "public"."payroll_runs"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_feed_reservations" ADD CONSTRAINT "payroll_feed_reservations_org_id_employee_id_employees_org_id_id_fk" FOREIGN KEY ("org_id","employee_id") REFERENCES "public"."employees"("org_id","id") ON DELETE no action ON UPDATE no action;