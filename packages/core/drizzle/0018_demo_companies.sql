ALTER TABLE "organisations" ADD COLUMN "demo_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "organisations" ADD COLUMN "demo_claimed_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "organisations_demo_expires_idx" ON "organisations" USING btree ("demo_expires_at") WHERE "organisations"."demo_expires_at" is not null;--> statement-breakpoint
-- Demo companies (add-demo-companies design decisions 2 and 8; access-control "Audit log
-- immutability"). The demo flag is set only when an organisation is inserted: an UPDATE may move
-- a demo company's expiry but never turn a real organisation into a demo company, or a demo
-- company into a real one.
CREATE OR REPLACE FUNCTION crowhr_organisations_demo_flag() RETURNS trigger AS $$
BEGIN
  IF (OLD.demo_expires_at IS NULL) <> (NEW.demo_expires_at IS NULL) THEN
    RAISE EXCEPTION 'organisations.demo_expires_at can only be set when the organisation is created'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER organisations_demo_flag
  BEFORE UPDATE ON organisations
  FOR EACH ROW EXECUTE FUNCTION crowhr_organisations_demo_flag();
--> statement-breakpoint
-- Audit events stay append-only. The one exception: the demo-company expiry sweep deletes an
-- expired demo company's events inside a transaction that names that organisation with
-- SET LOCAL crowhr.purge_demo_org = '<org id>'. A DELETE passes only when that setting equals the
-- row's organisation AND the organisation has a demo expiry that has passed (database clock).
-- UPDATE and TRUNCATE stay refused for everyone; real organisations (no demo expiry, which can't
-- be added later) never lose an event.
CREATE OR REPLACE FUNCTION crowhr_audit_events_immutable() RETURNS trigger AS $$
DECLARE
  purge text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    purge := current_setting('crowhr.purge_demo_org', true);
    IF purge IS NOT NULL AND purge <> '' AND purge = OLD.org_id::text AND EXISTS (
      SELECT 1 FROM organisations o
      WHERE o.id = OLD.org_id AND o.demo_expires_at IS NOT NULL AND o.demo_expires_at < now()
    ) THEN
      RETURN OLD;
    END IF;
  END IF;
  RAISE EXCEPTION 'audit_events is append-only: % is not allowed', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$ LANGUAGE plpgsql;
