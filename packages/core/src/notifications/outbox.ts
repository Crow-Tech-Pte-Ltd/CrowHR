import { and, eq, inArray, lt, lte, or, sql } from "drizzle-orm";
import { singaporeDate } from "../access/scope.ts";
import { membershipRoles, memberships } from "../db/schema/access.ts";
import { emailOutbox, notifications, remindersSent } from "../db/schema/notifications.ts";
import { organisations } from "../db/schema/organisations.ts";
import type { AppDeps } from "../deps.ts";
import { type EmailPayload, renderEmail } from "./email-templates.ts";
import { NOTIFICATION_RETENTION_DAYS, notify } from "./notify.ts";

/**
 * Email outbox sweep (spec "Email notifications"; design decision 6). The first send is attempted
 * on the next tick; failures are retried after 1, 5, 30, 120 and 720 minutes, and an email still
 * failing after those five retries is marked `failed` (owners see it in Settings → Notifications).
 *
 * Rows are claimed with `FOR UPDATE SKIP LOCKED` and a 10-minute lease (`status = sending`,
 * `locked_until`) before the SMTP call, so two replicas never send the same email and a crashed
 * sender's rows are picked up again after the lease.
 */
export const RETRY_MINUTES = [1, 5, 30, 120, 720] as const;
const LEASE_MS = 10 * 60_000;
const BATCH = 100;

export interface OutboxReport {
  sent: number;
  retried: number;
  failed: number;
  suppressed: number;
}

export async function sweepOutbox(deps: AppDeps, now: Date): Promise<OutboxReport> {
  const report: OutboxReport = { sent: 0, retried: 0, failed: 0, suppressed: 0 };
  if (!deps.mailer) {
    // Mailer removed after emails were queued: drop them (in-app notifications already exist).
    const rows = await deps.db
      .update(emailOutbox)
      .set({ status: "suppressed", lastError: "Email is not configured on this server.", lockedUntil: null })
      .where(inArray(emailOutbox.status, ["queued", "sending"]))
      .returning({ id: emailOutbox.id });
    report.suppressed = rows.length;
    return report;
  }
  const orgNames = new Map<string, string>();
  const failedOrgs = new Set<string>();
  for (;;) {
    const claimed = await deps.db.transaction(async (tx) => {
      const due = await tx
        .select()
        .from(emailOutbox)
        .where(
          or(
            and(eq(emailOutbox.status, "queued"), lte(emailOutbox.nextAttemptAt, now)),
            and(eq(emailOutbox.status, "sending"), lt(emailOutbox.lockedUntil, now)),
          ),
        )
        .limit(BATCH)
        .for("update", { skipLocked: true });
      if (due.length) {
        await tx
          .update(emailOutbox)
          .set({ status: "sending", lockedUntil: new Date(now.getTime() + LEASE_MS) })
          .where(
            inArray(
              emailOutbox.id,
              due.map((r) => r.id),
            ),
          );
      }
      return due;
    });
    for (const row of claimed) {
      let orgName = orgNames.get(row.orgId);
      if (orgName === undefined) {
        const [org] = await deps.db
          .select({ name: organisations.name })
          .from(organisations)
          .where(eq(organisations.id, row.orgId));
        orgName = org?.name ?? "Crow HR";
        orgNames.set(row.orgId, orgName);
      }
      const email = renderEmail(row.kind, row.payload as unknown as EmailPayload, { name: orgName }, deps.publicUrl);
      try {
        await deps.mailer.send({ to: row.toAddress, subject: email.subject, text: email.text, html: email.html });
        await deps.db
          .update(emailOutbox)
          .set({ status: "sent", sentAt: now, attempts: row.attempts + 1, lockedUntil: null, lastError: null })
          .where(eq(emailOutbox.id, row.id));
        report.sent++;
      } catch (err) {
        const failures = row.attempts + 1;
        const message = (err instanceof Error ? err.message : String(err)).slice(0, 500);
        const retryIn = RETRY_MINUTES[failures - 1];
        if (retryIn === undefined) {
          await deps.db
            .update(emailOutbox)
            .set({ status: "failed", attempts: failures, lockedUntil: null, lastError: message })
            .where(eq(emailOutbox.id, row.id));
          report.failed++;
          failedOrgs.add(row.orgId);
        } else {
          await deps.db
            .update(emailOutbox)
            .set({
              status: "queued",
              attempts: failures,
              nextAttemptAt: new Date(now.getTime() + retryIn * 60_000),
              lockedUntil: null,
              lastError: message,
            })
            .where(eq(emailOutbox.id, row.id));
          report.retried++;
        }
      }
    }
    if (claimed.length < BATCH) break;
  }
  for (const orgId of failedOrgs) await tellOwnersAboutFailures(deps, orgId, now);
  return report;
}

/** One in-app notice per organisation per day when emails could not be delivered. */
async function tellOwnersAboutFailures(deps: AppDeps, orgId: string, now: Date) {
  await deps.db.transaction(async (tx) => {
    const fresh = await tx
      .insert(remindersSent)
      .values({ orgId, source: "email_failed", subjectKey: orgId, threshold: singaporeDate(now), sentAt: now })
      .onConflictDoNothing()
      .returning({ k: remindersSent.subjectKey });
    if (!fresh.length) return;
    const owners = await tx
      .select({ id: membershipRoles.membershipId })
      .from(membershipRoles)
      .innerJoin(memberships, eq(memberships.id, membershipRoles.membershipId))
      .where(
        and(eq(membershipRoles.orgId, orgId), eq(membershipRoles.role, "owner"), eq(memberships.status, "active")),
      );
    await notify(
      tx,
      { ...deps, mailer: undefined },
      {
        orgId,
        recipients: owners.map((o) => o.id),
        kind: "email_delivery_failed",
        title: "Some emails could not be delivered",
        body: "Check the mail server settings. In-app notifications were not affected.",
        link: "/settings/notifications",
      },
    );
  });
}

/** Deletes notifications older than 180 days. */
export async function sweepNotificationRetention(deps: AppDeps, now: Date): Promise<number> {
  const cutoff = new Date(now.getTime() - NOTIFICATION_RETENTION_DAYS * 86_400_000);
  const rows = await deps.db
    .delete(notifications)
    .where(lt(notifications.createdAt, cutoff))
    .returning({ id: notifications.id });
  return rows.length;
}

/** Counts for Settings → Notifications. */
export async function outboxStatus(deps: AppDeps, orgId: string) {
  const rows = await deps.db
    .select({ status: emailOutbox.status, n: sql<number>`count(*)::int` })
    .from(emailOutbox)
    .where(eq(emailOutbox.orgId, orgId))
    .groupBy(emailOutbox.status);
  return Object.fromEntries(rows.map((r) => [r.status, Number(r.n)])) as Partial<Record<string, number>>;
}
