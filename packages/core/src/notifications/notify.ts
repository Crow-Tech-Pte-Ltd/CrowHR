import { and, eq, inArray } from "drizzle-orm";
import { memberships } from "../db/schema/access.ts";
import { emailOutbox, notificationPrefs, notifications } from "../db/schema/notifications.ts";
import { users } from "../db/schema/users.ts";
import type { Db } from "../db/types.ts";
import type { AppDeps } from "../deps.ts";
import { type EmailPayload, scrubPayload } from "./email-templates.ts";
import { categoryOf, type NotificationKind } from "./kinds.ts";

/** Notifications are kept for 180 days (spec "In-app notifications"). */
export const NOTIFICATION_RETENTION_DAYS = 180;

export interface NotifyInput {
  orgId: string;
  /** Membership IDs. Duplicates and inactive members are ignored. */
  recipients: readonly string[];
  kind: NotificationKind;
  title: string;
  body?: string | null;
  /** In-app path. */
  link: string;
  subjectType?: string | null;
  subjectId?: string | null;
  /** Email content. Omit to send in-app only. */
  email?: EmailPayload;
}

/**
 * Writes in-app notifications and, when a mailer is configured and the member's preference allows
 * (security is always on), queues an email in the same transaction (design decision 5). Without a
 * mailer nothing is queued: the app works in full with in-app notifications only.
 */
export async function notify(db: Db, deps: Pick<AppDeps, "clock" | "ids" | "mailer">, input: NotifyInput) {
  const recipients = [...new Set(input.recipients)];
  if (!recipients.length) return { inApp: 0, emails: 0 };
  const active = await db
    .select({ id: memberships.id, email: users.email, status: memberships.status })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(and(eq(memberships.orgId, input.orgId), inArray(memberships.id, recipients)));
  const live = active.filter((m) => m.status === "active");
  if (!live.length) return { inApp: 0, emails: 0 };
  const now = deps.clock.now();
  const category = categoryOf(input.kind);
  await db.insert(notifications).values(
    live.map((m) => ({
      id: deps.ids.newId(),
      orgId: input.orgId,
      recipientMembershipId: m.id,
      kind: input.kind,
      category,
      title: input.title.slice(0, 200),
      body: input.body?.slice(0, 1000) ?? null,
      link: input.link,
      subjectType: input.subjectType ?? null,
      subjectId: input.subjectId ?? null,
      createdAt: now,
    })),
  );
  if (!deps.mailer || !input.email) return { inApp: live.length, emails: 0 };

  let emailTo = live;
  if (category !== "security") {
    const prefs = await db
      .select()
      .from(notificationPrefs)
      .where(
        and(
          eq(notificationPrefs.orgId, input.orgId),
          eq(notificationPrefs.category, category),
          inArray(
            notificationPrefs.membershipId,
            live.map((m) => m.id),
          ),
        ),
      );
    const off = new Set(prefs.filter((p) => !p.emailEnabled).map((p) => p.membershipId));
    emailTo = live.filter((m) => !off.has(m.id));
  }
  if (!emailTo.length) return { inApp: live.length, emails: 0 };
  const payload = scrubPayload(input.email);
  await db.insert(emailOutbox).values(
    emailTo.map((m) => ({
      id: deps.ids.newId(),
      orgId: input.orgId,
      toAddress: m.email,
      recipientMembershipId: m.id,
      kind: input.kind,
      payload: { ...payload },
      status: "queued" as const,
      attempts: 0,
      nextAttemptAt: now,
      createdAt: now,
    })),
  );
  return { inApp: live.length, emails: emailTo.length };
}
