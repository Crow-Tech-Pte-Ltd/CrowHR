CREATE TABLE "email_outbox" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"to_address" text NOT NULL,
	"recipient_membership_id" uuid,
	"kind" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone NOT NULL,
	"locked_until" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone NOT NULL,
	"sent_at" timestamp with time zone,
	CONSTRAINT "email_outbox_org_id_unique" UNIQUE("org_id","id"),
	CONSTRAINT "email_outbox_status_check" CHECK ("email_outbox"."status" in ('queued', 'sending', 'sent', 'failed', 'suppressed'))
);
--> statement-breakpoint
CREATE TABLE "notification_prefs" (
	"org_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"category" text NOT NULL,
	"email_enabled" boolean NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "notification_prefs_membership_id_category_pk" PRIMARY KEY("membership_id","category")
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"recipient_membership_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"category" text NOT NULL,
	"title" text NOT NULL,
	"body" text,
	"link" text NOT NULL,
	"subject_type" text,
	"subject_id" uuid,
	"created_at" timestamp with time zone NOT NULL,
	"read_at" timestamp with time zone,
	CONSTRAINT "notifications_org_id_unique" UNIQUE("org_id","id")
);
--> statement-breakpoint
CREATE TABLE "reminders_sent" (
	"org_id" uuid NOT NULL,
	"source" text NOT NULL,
	"subject_key" text NOT NULL,
	"threshold" text NOT NULL,
	"sent_at" timestamp with time zone NOT NULL,
	CONSTRAINT "reminders_sent_unique" UNIQUE("org_id","source","subject_key","threshold")
);
--> statement-breakpoint
CREATE TABLE "approval_comments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"request_id" uuid NOT NULL,
	"author_membership_id" uuid NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "approval_policies" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"subject_type" text NOT NULL,
	"name" text NOT NULL,
	"condition" jsonb,
	"priority" integer DEFAULT 0 NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "approval_policies_org_id_unique" UNIQUE("org_id","id")
);
--> statement-breakpoint
CREATE TABLE "approval_policy_steps" (
	"org_id" uuid NOT NULL,
	"policy_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"approver_rule" text NOT NULL,
	"escalate_after_days" integer DEFAULT 3 NOT NULL,
	CONSTRAINT "approval_policy_steps_policy_id_position_pk" PRIMARY KEY("policy_id","position"),
	CONSTRAINT "approval_policy_steps_position_check" CHECK ("approval_policy_steps"."position" between 1 and 5),
	CONSTRAINT "approval_policy_steps_escalate_check" CHECK ("approval_policy_steps"."escalate_after_days" between 0 and 60)
);
--> statement-breakpoint
CREATE TABLE "approval_requests" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"subject_type" text NOT NULL,
	"subject_id" uuid NOT NULL,
	"requester_employee_id" uuid,
	"requester_membership_id" uuid NOT NULL,
	"policy_id" uuid,
	"policy_name" text NOT NULL,
	"status" text NOT NULL,
	"current_position" integer DEFAULT 1 NOT NULL,
	"attributes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"title" text NOT NULL,
	"submitted_at" timestamp with time zone NOT NULL,
	"decided_at" timestamp with time zone,
	CONSTRAINT "approval_requests_org_id_unique" UNIQUE("org_id","id"),
	CONSTRAINT "approval_requests_status_check" CHECK ("approval_requests"."status" in ('pending', 'approved', 'rejected', 'withdrawn'))
);
--> statement-breakpoint
CREATE TABLE "approval_steps" (
	"org_id" uuid NOT NULL,
	"request_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"approver_rule" text NOT NULL,
	"escalate_after_days" integer NOT NULL,
	"status" text NOT NULL,
	"skip_reason" text,
	"fallback" boolean DEFAULT false NOT NULL,
	"activated_at" timestamp with time zone,
	"escalated_at" timestamp with time zone,
	"decided_at" timestamp with time zone,
	CONSTRAINT "approval_steps_request_id_position_pk" PRIMARY KEY("request_id","position"),
	CONSTRAINT "approval_steps_status_check" CHECK ("approval_steps"."status" in ('waiting', 'active', 'approved', 'rejected', 'skipped'))
);
--> statement-breakpoint
CREATE TABLE "approval_tasks" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"request_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"assignee_membership_id" uuid NOT NULL,
	"on_behalf_of_membership_id" uuid,
	"origin" text NOT NULL,
	"status" text NOT NULL,
	"superseded_reason" text,
	"via_role" text,
	"due_at" timestamp with time zone,
	"escalated_at" timestamp with time zone,
	"decided_at" timestamp with time zone,
	"comment" text,
	"self_approved" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "approval_tasks_org_id_unique" UNIQUE("org_id","id"),
	CONSTRAINT "approval_tasks_origin_check" CHECK ("approval_tasks"."origin" in ('resolved', 'delegated', 'escalated', 'reassigned')),
	CONSTRAINT "approval_tasks_status_check" CHECK ("approval_tasks"."status" in ('pending', 'approved', 'rejected', 'superseded'))
);
--> statement-breakpoint
CREATE TABLE "delegations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"from_membership_id" uuid NOT NULL,
	"to_membership_id" uuid NOT NULL,
	"starts_on" date NOT NULL,
	"ends_on" date NOT NULL,
	"subject_types" text[],
	"created_by_membership_id" uuid NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "delegations_org_id_unique" UNIQUE("org_id","id"),
	CONSTRAINT "delegations_dates_check" CHECK ("delegations"."ends_on" >= "delegations"."starts_on"),
	CONSTRAINT "delegations_not_self_check" CHECK ("delegations"."from_membership_id" <> "delegations"."to_membership_id")
);
--> statement-breakpoint
ALTER TABLE "email_outbox" ADD CONSTRAINT "email_outbox_org_id_organisations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_prefs" ADD CONSTRAINT "notification_prefs_org_id_organisations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_prefs" ADD CONSTRAINT "notification_prefs_membership_fk" FOREIGN KEY ("org_id","membership_id") REFERENCES "public"."memberships"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_org_id_organisations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_recipient_fk" FOREIGN KEY ("org_id","recipient_membership_id") REFERENCES "public"."memberships"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reminders_sent" ADD CONSTRAINT "reminders_sent_org_id_organisations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_comments" ADD CONSTRAINT "approval_comments_org_id_organisations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_comments" ADD CONSTRAINT "approval_comments_request_fk" FOREIGN KEY ("org_id","request_id") REFERENCES "public"."approval_requests"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_comments" ADD CONSTRAINT "approval_comments_author_fk" FOREIGN KEY ("org_id","author_membership_id") REFERENCES "public"."memberships"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_policies" ADD CONSTRAINT "approval_policies_org_id_organisations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_policy_steps" ADD CONSTRAINT "approval_policy_steps_org_id_organisations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_policy_steps" ADD CONSTRAINT "approval_policy_steps_policy_fk" FOREIGN KEY ("org_id","policy_id") REFERENCES "public"."approval_policies"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_org_id_organisations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_requester_fk" FOREIGN KEY ("org_id","requester_membership_id") REFERENCES "public"."memberships"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_steps" ADD CONSTRAINT "approval_steps_org_id_organisations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_steps" ADD CONSTRAINT "approval_steps_request_fk" FOREIGN KEY ("org_id","request_id") REFERENCES "public"."approval_requests"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_tasks" ADD CONSTRAINT "approval_tasks_org_id_organisations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_tasks" ADD CONSTRAINT "approval_tasks_request_fk" FOREIGN KEY ("org_id","request_id") REFERENCES "public"."approval_requests"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_tasks" ADD CONSTRAINT "approval_tasks_assignee_fk" FOREIGN KEY ("org_id","assignee_membership_id") REFERENCES "public"."memberships"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delegations" ADD CONSTRAINT "delegations_org_id_organisations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delegations" ADD CONSTRAINT "delegations_from_fk" FOREIGN KEY ("org_id","from_membership_id") REFERENCES "public"."memberships"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delegations" ADD CONSTRAINT "delegations_to_fk" FOREIGN KEY ("org_id","to_membership_id") REFERENCES "public"."memberships"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "email_outbox_due_idx" ON "email_outbox" USING btree ("status","next_attempt_at");--> statement-breakpoint
CREATE INDEX "notifications_recipient_idx" ON "notifications" USING btree ("org_id","recipient_membership_id","created_at");--> statement-breakpoint
CREATE INDEX "notifications_created_idx" ON "notifications" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "approval_comments_request_idx" ON "approval_comments" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX "approval_policies_type_idx" ON "approval_policies" USING btree ("org_id","subject_type");--> statement-breakpoint
CREATE UNIQUE INDEX "approval_requests_open_subject_unique" ON "approval_requests" USING btree ("org_id","subject_type","subject_id") WHERE "approval_requests"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "approval_requests_requester_idx" ON "approval_requests" USING btree ("org_id","requester_membership_id");--> statement-breakpoint
CREATE INDEX "approval_requests_employee_idx" ON "approval_requests" USING btree ("org_id","requester_employee_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "approval_tasks_open_unique" ON "approval_tasks" USING btree ("request_id","position","assignee_membership_id") WHERE "approval_tasks"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "approval_tasks_assignee_idx" ON "approval_tasks" USING btree ("org_id","assignee_membership_id","status");--> statement-breakpoint
CREATE INDEX "approval_tasks_due_idx" ON "approval_tasks" USING btree ("status","due_at");--> statement-breakpoint
CREATE INDEX "delegations_from_idx" ON "delegations" USING btree ("org_id","from_membership_id");