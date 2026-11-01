CREATE TABLE "leave_encashments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"leave_type_id" uuid NOT NULL,
	"leave_year" integer NOT NULL,
	"unit" text NOT NULL,
	"hundredths" integer NOT NULL,
	"ledger_entry_id" uuid,
	"amount_cents" bigint NOT NULL,
	"rate_text" text NOT NULL,
	"rate_date" date NOT NULL,
	"status" text NOT NULL,
	"approval_request_id" uuid,
	"requested_by_membership_id" uuid NOT NULL,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "leave_encashments_org_id_id_unique" UNIQUE("org_id","id"),
	CONSTRAINT "leave_encashments_ledger_once" UNIQUE("org_id","ledger_entry_id")
);
--> statement-breakpoint
ALTER TABLE "leave_encashments" ADD CONSTRAINT "leave_encashments_org_id_organisations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_encashments" ADD CONSTRAINT "leave_encashments_employee_fk" FOREIGN KEY ("org_id","employee_id") REFERENCES "public"."employees"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_encashments" ADD CONSTRAINT "leave_encashments_type_fk" FOREIGN KEY ("org_id","leave_type_id") REFERENCES "public"."leave_types"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_encashments" ADD CONSTRAINT "leave_encashments_ledger_fk" FOREIGN KEY ("org_id","ledger_entry_id") REFERENCES "public"."leave_ledger"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "leave_encashments_balance" ON "leave_encashments" USING btree ("org_id","employee_id","leave_year");