CREATE TABLE "published_shifts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"roster_id" uuid NOT NULL,
	"employee_id" uuid,
	"kind" text DEFAULT 'shift' NOT NULL,
	"date" date NOT NULL,
	"starts_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	"break_minutes" integer DEFAULT 0 NOT NULL,
	"template_id" uuid,
	"note" text,
	"version" integer NOT NULL,
	"published_at" timestamp with time zone NOT NULL,
	CONSTRAINT "published_shifts_org_id_id_unique" UNIQUE("org_id","id")
);
--> statement-breakpoint
CREATE TABLE "roster_publications" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"roster_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"published_by_membership_id" uuid NOT NULL,
	"acknowledged" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"changes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"published_at" timestamp with time zone NOT NULL,
	CONSTRAINT "roster_publications_org_id_id_unique" UNIQUE("org_id","id")
);
--> statement-breakpoint
CREATE TABLE "roster_shifts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"roster_id" uuid NOT NULL,
	"employee_id" uuid,
	"kind" text DEFAULT 'shift' NOT NULL,
	"date" date NOT NULL,
	"starts_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	"break_minutes" integer DEFAULT 0 NOT NULL,
	"template_id" uuid,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "roster_shifts_org_id_id_unique" UNIQUE("org_id","id")
);
--> statement-breakpoint
CREATE TABLE "rosters" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"location_id" uuid,
	"department_id" uuid,
	"scope_key" text NOT NULL,
	"week_start" date NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"has_changes" boolean DEFAULT false NOT NULL,
	"published_at" timestamp with time zone,
	"published_by_membership_id" uuid,
	"created_by_membership_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rosters_org_id_id_unique" UNIQUE("org_id","id"),
	CONSTRAINT "rosters_scope_week_unique" UNIQUE("org_id","scope_key","week_start")
);
--> statement-breakpoint
CREATE TABLE "shift_swaps" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"roster_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"shift_id" uuid NOT NULL,
	"requester_employee_id" uuid NOT NULL,
	"peer_employee_id" uuid,
	"peer_shift_id" uuid,
	"status" text NOT NULL,
	"approval_request_id" uuid,
	"note" text,
	"created_by_membership_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"decided_at" timestamp with time zone,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shift_swaps_org_id_id_unique" UNIQUE("org_id","id")
);
--> statement-breakpoint
CREATE TABLE "shift_templates" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"location_id" uuid,
	"name" text NOT NULL,
	"code" text NOT NULL,
	"start_time" text NOT NULL,
	"end_time" text NOT NULL,
	"break_minutes" integer DEFAULT 0 NOT NULL,
	"colour" text DEFAULT 'plain' NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shift_templates_org_id_id_unique" UNIQUE("org_id","id")
);
--> statement-breakpoint
ALTER TABLE "published_shifts" ADD CONSTRAINT "published_shifts_org_id_organisations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "published_shifts" ADD CONSTRAINT "published_shifts_roster_fk" FOREIGN KEY ("org_id","roster_id") REFERENCES "public"."rosters"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "published_shifts" ADD CONSTRAINT "published_shifts_employee_fk" FOREIGN KEY ("org_id","employee_id") REFERENCES "public"."employees"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "published_shifts" ADD CONSTRAINT "published_shifts_template_fk" FOREIGN KEY ("org_id","template_id") REFERENCES "public"."shift_templates"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roster_publications" ADD CONSTRAINT "roster_publications_org_id_organisations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roster_publications" ADD CONSTRAINT "roster_publications_roster_fk" FOREIGN KEY ("org_id","roster_id") REFERENCES "public"."rosters"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roster_shifts" ADD CONSTRAINT "roster_shifts_org_id_organisations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roster_shifts" ADD CONSTRAINT "roster_shifts_roster_fk" FOREIGN KEY ("org_id","roster_id") REFERENCES "public"."rosters"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roster_shifts" ADD CONSTRAINT "roster_shifts_employee_fk" FOREIGN KEY ("org_id","employee_id") REFERENCES "public"."employees"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roster_shifts" ADD CONSTRAINT "roster_shifts_template_fk" FOREIGN KEY ("org_id","template_id") REFERENCES "public"."shift_templates"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rosters" ADD CONSTRAINT "rosters_org_id_organisations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rosters" ADD CONSTRAINT "rosters_location_fk" FOREIGN KEY ("org_id","location_id") REFERENCES "public"."locations"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rosters" ADD CONSTRAINT "rosters_department_fk" FOREIGN KEY ("org_id","department_id") REFERENCES "public"."departments"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_swaps" ADD CONSTRAINT "shift_swaps_org_id_organisations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_swaps" ADD CONSTRAINT "shift_swaps_roster_fk" FOREIGN KEY ("org_id","roster_id") REFERENCES "public"."rosters"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_swaps" ADD CONSTRAINT "shift_swaps_shift_fk" FOREIGN KEY ("org_id","shift_id") REFERENCES "public"."roster_shifts"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_swaps" ADD CONSTRAINT "shift_swaps_peer_shift_fk" FOREIGN KEY ("org_id","peer_shift_id") REFERENCES "public"."roster_shifts"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_swaps" ADD CONSTRAINT "shift_swaps_requester_fk" FOREIGN KEY ("org_id","requester_employee_id") REFERENCES "public"."employees"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_swaps" ADD CONSTRAINT "shift_swaps_peer_fk" FOREIGN KEY ("org_id","peer_employee_id") REFERENCES "public"."employees"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_templates" ADD CONSTRAINT "shift_templates_org_id_organisations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_templates" ADD CONSTRAINT "shift_templates_location_fk" FOREIGN KEY ("org_id","location_id") REFERENCES "public"."locations"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "published_shifts_roster" ON "published_shifts" USING btree ("org_id","roster_id");--> statement-breakpoint
CREATE INDEX "published_shifts_employee" ON "published_shifts" USING btree ("org_id","employee_id","date");--> statement-breakpoint
CREATE INDEX "roster_shifts_roster" ON "roster_shifts" USING btree ("org_id","roster_id");--> statement-breakpoint
CREATE INDEX "roster_shifts_employee" ON "roster_shifts" USING btree ("org_id","employee_id","date");--> statement-breakpoint
CREATE INDEX "rosters_week" ON "rosters" USING btree ("org_id","week_start");--> statement-breakpoint
CREATE UNIQUE INDEX "shift_swaps_one_open" ON "shift_swaps" USING btree ("org_id","shift_id") WHERE "shift_swaps"."status" in ('pending_peer', 'pending_approval');--> statement-breakpoint
CREATE INDEX "shift_swaps_peer" ON "shift_swaps" USING btree ("org_id","peer_employee_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "shift_templates_active_code_unique" ON "shift_templates" USING btree ("org_id",lower("code")) WHERE "shift_templates"."archived_at" is null;