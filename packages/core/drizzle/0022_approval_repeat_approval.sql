ALTER TABLE "approval_tasks" ADD COLUMN "repeat_approval" boolean DEFAULT false NOT NULL;--> statement-breakpoint
-- Segregation of duties: whoever approved an earlier step of a request no longer decides a later one,
-- unless the task is marked repeat_approval (nobody else may decide it). An open task that already sits
-- with its earlier approver is marked only when nobody else holds that step, so no request in flight is
-- left without someone who can decide it; elsewhere a colleague holding the step decides it.
UPDATE "approval_tasks" AS t SET "repeat_approval" = true
WHERE t."status" = 'pending'
  AND EXISTS (
    SELECT 1 FROM "approval_tasks" e
     WHERE e."request_id" = t."request_id" AND e."assignee_membership_id" = t."assignee_membership_id"
       AND e."status" = 'approved' AND e."position" < t."position")
  AND NOT EXISTS (
    SELECT 1 FROM "approval_tasks" o
     WHERE o."request_id" = t."request_id" AND o."position" = t."position" AND o."status" = 'pending'
       AND NOT EXISTS (
         SELECT 1 FROM "approval_tasks" e2
          WHERE e2."request_id" = o."request_id" AND e2."assignee_membership_id" = o."assignee_membership_id"
            AND e2."status" = 'approved' AND e2."position" < o."position"));
