CREATE TABLE "org_appearance" (
	"org_id" uuid PRIMARY KEY NOT NULL,
	"accent" text,
	"logo_base64" text,
	"use_document_logo" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "org_appearance" ADD CONSTRAINT "org_appearance_org_id_organisations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;