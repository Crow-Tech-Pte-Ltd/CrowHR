ALTER TABLE "payroll_run_items" ADD COLUMN "holiday_date" date;--> statement-breakpoint
ALTER TABLE "payroll_run_items" ADD CONSTRAINT "payroll_run_items_ot_source_unique" UNIQUE("org_id","run_id","overtime_source_id");--> statement-breakpoint
ALTER TABLE "payroll_run_items" ADD CONSTRAINT "payroll_run_items_holiday_unique" UNIQUE("org_id","run_id","employee_id","holiday_date");