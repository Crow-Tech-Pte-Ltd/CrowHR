import { and, count, desc, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { emailOutbox, notificationPrefs, notifications } from "../db/schema/notifications.ts";
import { AppError } from "../errors.ts";
import { listQuery, pageOf, toLimitOffset } from "../http/list.ts";
import { defineModule, defineRoute } from "../http/route.ts";
import { CATEGORY_LABEL, NOTIFICATION_CATEGORIES, type NotificationCategory } from "./kinds.ts";
import { outboxStatus } from "./outbox.ts";

const notificationOut = z.object({
  id: z.uuid(),
  kind: z.string(),
  category: z.string(),
  title: z.string(),
  body: z.string().nullable(),
  link: z.string(),
  createdAt: z.iso.datetime(),
  readAt: z.iso.datetime().nullable(),
});

const categoryPref = z.object({
  category: z.enum(NOTIFICATION_CATEGORIES),
  label: z.string(),
  description: z.string(),
  emailEnabled: z.boolean(),
  /** Security emails are always sent. */
  locked: z.boolean(),
});

const SETUP_HELP =
  'Set SMTP_URL (for example smtps://user:password@smtp.example.sg:465) and MAIL_FROM (for example "Crow HR <hr@example.sg>") in your .env, then restart Crow HR.';

function maskEmail(email: string): string {
  const [local = "", domain = ""] = email.split("@");
  return `${local.slice(0, 1)}${"•".repeat(Math.max(1, Math.min(6, local.length - 1)))}@${domain}`;
}

export const notificationsModule = defineModule({
  name: "notifications",
  basePath: "/notifications",
  tag: "Notifications",
  routes: [
    defineRoute({
      method: "get",
      path: "/",
      summary: "List my notifications",
      access: "authenticated",
      request: {
        query: listQuery({
          sort: ["createdAt"],
          defaultSort: "-createdAt",
          filters: { unread: z.enum(["true", "false"]).optional() },
        }),
      },
      responses: { 200: pageOf(notificationOut).extend({ unread: z.int() }) },
      handler: async ({ deps, auth, query }) => {
        const mine = and(
          eq(notifications.orgId, auth.orgId),
          eq(notifications.recipientMembershipId, auth.membershipId),
        );
        const where = query.unread === "true" ? and(mine, isNull(notifications.readAt)) : mine;
        const { limit, offset } = toLimitOffset(query);
        const rows = await deps.db
          .select()
          .from(notifications)
          .where(where)
          .orderBy(
            query.sort === "createdAt" ? notifications.createdAt : desc(notifications.createdAt),
            desc(notifications.id),
          )
          .limit(limit)
          .offset(offset);
        const [total] = await deps.db.select({ n: count() }).from(notifications).where(where);
        const [unread] = await deps.db
          .select({ n: count() })
          .from(notifications)
          .where(and(mine, isNull(notifications.readAt)));
        return {
          items: rows.map((n) => ({
            id: n.id,
            kind: n.kind,
            category: n.category,
            title: n.title,
            body: n.body,
            link: n.link,
            createdAt: n.createdAt.toISOString(),
            readAt: n.readAt?.toISOString() ?? null,
          })),
          page: query.page,
          pageSize: query.pageSize,
          total: Number(total?.n ?? 0),
          unread: Number(unread?.n ?? 0),
        };
      },
    }),
    defineRoute({
      method: "get",
      path: "/unread-count",
      summary: "Count my unread notifications",
      description: "Cheap enough to poll; the top bar shows it.",
      access: "authenticated",
      responses: { 200: z.object({ unread: z.int() }) },
      handler: async ({ deps, auth }) => {
        const [row] = await deps.db
          .select({ n: count() })
          .from(notifications)
          .where(
            and(
              eq(notifications.orgId, auth.orgId),
              eq(notifications.recipientMembershipId, auth.membershipId),
              isNull(notifications.readAt),
            ),
          );
        return { unread: Number(row?.n ?? 0) };
      },
    }),
    defineRoute({
      method: "post",
      path: "/:id/read",
      summary: "Mark a notification read",
      access: "authenticated",
      request: { params: z.object({ id: z.uuid() }) },
      responses: { 204: null },
      errors: ["not_found"],
      handler: async ({ deps, auth, params }) => {
        const rows = await deps.db
          .update(notifications)
          .set({ readAt: sql`coalesce(${notifications.readAt}, ${deps.clock.now().toISOString()}::timestamptz)` })
          .where(
            and(
              eq(notifications.orgId, auth.orgId),
              eq(notifications.id, params.id),
              eq(notifications.recipientMembershipId, auth.membershipId),
            ),
          )
          .returning({ id: notifications.id });
        if (!rows.length) throw new AppError("not_found", "That notification doesn't exist.");
      },
    }),
    defineRoute({
      method: "post",
      path: "/read-all",
      summary: "Mark all my notifications read",
      access: "authenticated",
      responses: { 200: z.object({ updated: z.int() }) },
      handler: async ({ deps, auth }) => {
        const rows = await deps.db
          .update(notifications)
          .set({ readAt: deps.clock.now() })
          .where(
            and(
              eq(notifications.orgId, auth.orgId),
              eq(notifications.recipientMembershipId, auth.membershipId),
              isNull(notifications.readAt),
            ),
          )
          .returning({ id: notifications.id });
        return { updated: rows.length };
      },
    }),
    defineRoute({
      method: "get",
      path: "/preferences",
      summary: "Get my email preferences",
      access: "authenticated",
      responses: {
        200: z.object({ emailConfigured: z.boolean(), categories: z.array(categoryPref) }),
      },
      handler: async ({ deps, auth }) => {
        const prefs = await deps.db
          .select()
          .from(notificationPrefs)
          .where(and(eq(notificationPrefs.orgId, auth.orgId), eq(notificationPrefs.membershipId, auth.membershipId)));
        return {
          emailConfigured: !!deps.mailer,
          categories: NOTIFICATION_CATEGORIES.map((category) => ({
            category,
            ...CATEGORY_LABEL[category],
            emailEnabled:
              category === "security" ? true : (prefs.find((p) => p.category === category)?.emailEnabled ?? true),
            locked: category === "security",
          })),
        };
      },
    }),
    defineRoute({
      method: "put",
      path: "/preferences",
      summary: "Set my email preferences",
      description: "Per category; security emails cannot be turned off.",
      access: "authenticated",
      request: {
        body: z.object({
          email: z.partialRecord(z.enum(NOTIFICATION_CATEGORIES), z.boolean()),
        }),
      },
      responses: { 200: z.object({ updated: z.int() }) },
      handler: async ({ deps, auth, body }) => {
        const now = deps.clock.now();
        let updated = 0;
        for (const [category, enabled] of Object.entries(body.email) as [NotificationCategory, boolean][]) {
          if (category === "security") {
            if (!enabled) {
              throw new AppError("validation_failed", "Security emails are always sent, so they can't be turned off.", {
                issues: [{ path: "email.security", message: "Leave security emails on." }],
              });
            }
            continue;
          }
          await deps.db
            .insert(notificationPrefs)
            .values({
              orgId: auth.orgId,
              membershipId: auth.membershipId,
              category,
              emailEnabled: enabled,
              updatedAt: now,
            })
            .onConflictDoUpdate({
              target: [notificationPrefs.membershipId, notificationPrefs.category],
              set: { emailEnabled: enabled, updatedAt: now },
            });
          updated++;
        }
        return { updated };
      },
    }),
    defineRoute({
      method: "get",
      path: "/delivery",
      summary: "Email delivery status",
      description: "Whether email is configured, outbox counts, and emails that failed after every retry.",
      access: { permission: "notification_delivery:read" },
      responses: {
        200: z.object({
          emailConfigured: z.boolean(),
          setupHelp: z.string().nullable(),
          counts: z.object({ queued: z.int(), sent: z.int(), failed: z.int(), suppressed: z.int() }),
          failed: z.array(
            z.object({
              id: z.uuid(),
              to: z.string(),
              kind: z.string(),
              attempts: z.int(),
              lastError: z.string().nullable(),
              createdAt: z.iso.datetime(),
            }),
          ),
        }),
      },
      handler: async ({ deps, auth }) => {
        const counts = await outboxStatus(deps, auth.orgId);
        const failed = await deps.db
          .select()
          .from(emailOutbox)
          .where(and(eq(emailOutbox.orgId, auth.orgId), eq(emailOutbox.status, "failed")))
          .orderBy(desc(emailOutbox.createdAt))
          .limit(50);
        return {
          emailConfigured: !!deps.mailer,
          setupHelp: deps.mailer ? null : SETUP_HELP,
          counts: {
            queued: (counts.queued ?? 0) + (counts.sending ?? 0),
            sent: counts.sent ?? 0,
            failed: counts.failed ?? 0,
            suppressed: counts.suppressed ?? 0,
          },
          failed: failed.map((f) => ({
            id: f.id,
            to: maskEmail(f.toAddress),
            kind: f.kind,
            attempts: f.attempts,
            lastError: f.lastError,
            createdAt: f.createdAt.toISOString(),
          })),
        };
      },
    }),
  ],
});
