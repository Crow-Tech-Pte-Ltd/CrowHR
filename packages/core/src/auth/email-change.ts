import { and, eq, gt, isNull } from "drizzle-orm";
import { z } from "zod";
import { newToken, sha256Hex } from "../crypto/tokens.ts";
import { memberships } from "../db/schema/access.ts";
import { emailChanges } from "../db/schema/auth.ts";
import { organisations } from "../db/schema/organisations.ts";
import { users } from "../db/schema/users.ts";
import { NOT_IN_DEMO_COMPANY } from "../demo-companies/config.ts";
import { demoCompanyOf } from "../demo-companies/service.ts";
import { isUniqueViolation } from "../employees/validation.ts";
import { AppError } from "../errors.ts";
import { defineRoute, reply } from "../http/route.ts";
import { audit, emailInput, normaliseEmail } from "./credentials.ts";

/**
 * Changing your own sign-in email (one address per person, shared by every organisation they
 * belong to). The new address must prove it is reachable: a one-time link, valid 24 hours, goes to
 * it, and the old address is told. Without SMTP nothing can be verified, so the change is refused
 * rather than made unverified: an unverified address could squat someone else's, and invitations,
 * SSO linking and password resets all trust the address.
 */
export const EMAIL_CHANGE_TTL_MS = 24 * 3600_000;

const pendingSchema = z.object({
  newEmail: z.string(),
  expiresAt: z.iso.datetime(),
});

async function pendingFor(db: import("../db/types.ts").Db, userId: string, now: Date) {
  const [row] = await db
    .select()
    .from(emailChanges)
    .where(and(eq(emailChanges.userId, userId), isNull(emailChanges.usedAt), gt(emailChanges.expiresAt, now)))
    .orderBy(emailChanges.createdAt);
  return row ?? null;
}

const mask = (email: string) => {
  const [local = "", domain = ""] = email.split("@");
  return `${local.slice(0, 1)}${"*".repeat(Math.max(local.length - 1, 1))}@${domain}`;
};

/** `/me/email-change`: request, see and cancel a change of my own sign-in email. */
export const emailChangeMeRoutes = [
  defineRoute({
    method: "get",
    path: "/email-change",
    summary: "My pending sign-in email change, if any",
    access: "authenticated",
    responses: { 200: z.object({ email: z.string(), pending: pendingSchema.nullable(), canChange: z.boolean() }) },
    handler: async ({ deps, auth }) => {
      const pending = await pendingFor(deps.db, auth.user.id, deps.clock.now());
      return {
        email: auth.user.email,
        pending: pending ? { newEmail: pending.newEmail, expiresAt: pending.expiresAt.toISOString() } : null,
        canChange: !!deps.mailer && !(await demoCompanyOf(deps.db, auth.orgId)),
      };
    },
  }),
  defineRoute({
    method: "post",
    path: "/email-change",
    summary: "Change my sign-in email: sends a confirmation link to the new address",
    description:
      "Needs a recent sign-in. The change takes effect when the link (valid 24 hours) is opened and confirmed; a new request replaces a pending one. Refused with `email_unavailable` when this server can't send email, because the new address can't be verified.",
    access: "authenticated",
    recentAuth: true,
    request: { body: z.object({ newEmail: emailInput() }) },
    example: { body: { newEmail: "aisyah.rahman@example.sg" } },
    responses: { 202: pendingSchema },
    errors: ["reauth_required", "conflict", "disabled_in_demo"],
    handler: async ({ c, deps, auth, body }) => {
      const { db, clock, mailer } = deps;
      if (await demoCompanyOf(db, auth.orgId)) throw new AppError("disabled_in_demo", NOT_IN_DEMO_COMPANY);
      const newEmail = normaliseEmail(body.newEmail);
      if (newEmail === normaliseEmail(auth.user.email))
        throw new AppError("validation_failed", "That's already your sign-in email.", {
          issues: [{ path: "newEmail", message: "Enter a different address." }],
        });
      if (!mailer)
        throw new AppError(
          "conflict",
          "This server can't send email, so the new address can't be verified. Ask whoever runs Crow HR to set up email (SMTP), then try again.",
          { reason: "email_unavailable" },
        );
      const now = clock.now();
      const token = newToken();
      const expiresAt = new Date(now.getTime() + EMAIL_CHANGE_TTL_MS);
      const [org] = await db.select().from(organisations).where(eq(organisations.id, auth.orgId));
      await db.transaction(async (tx) => {
        // One pending change at a time: a new request replaces the old link.
        await tx
          .update(emailChanges)
          .set({ usedAt: now })
          .where(and(eq(emailChanges.userId, auth.user.id), isNull(emailChanges.usedAt)));
        await tx.insert(emailChanges).values({
          tokenHash: await sha256Hex(token),
          orgId: auth.orgId,
          userId: auth.user.id,
          newEmail,
          expiresAt,
          createdAt: now,
        });
        await audit(
          c,
          { action: "auth.email_change_requested", targetType: "membership", targetId: auth.membershipId },
          { db: tx },
        );
      });
      const base = deps.publicUrl.replace(/\/$/, "");
      try {
        await mailer.send({
          to: newEmail,
          subject: "Confirm your new Crow HR sign-in email",
          text: `${auth.user.displayName} asked to use this address to sign in to Crow HR${org ? ` (${org.name})` : ""}. Confirm it within 24 hours: ${base}/email/${token}\nUntil then the old address keeps working. If you didn't ask for this, ignore this email.`,
        });
        await mailer.send({
          to: auth.user.email,
          subject: "Your Crow HR sign-in email is being changed",
          text: `Someone signed in as you asked to change your Crow HR sign-in email to ${mask(newEmail)}. Nothing changes until the new address confirms it. If this wasn't you, change your password now: ${base}/me/sessions`,
        });
      } catch (err) {
        c.var.logger.warn("Email change emails failed", { err });
        throw new AppError(
          "conflict",
          "The confirmation email couldn't be sent. Check the address, or try again later.",
          { reason: "email_unavailable" },
        );
      }
      return reply(202, { newEmail, expiresAt: expiresAt.toISOString() });
    },
  }),
  defineRoute({
    method: "delete",
    path: "/email-change",
    summary: "Cancel my pending sign-in email change",
    access: "authenticated",
    responses: { 204: null },
    handler: async ({ c, deps, auth }) => {
      const now = deps.clock.now();
      const cancelled = await deps.db
        .update(emailChanges)
        .set({ usedAt: now })
        .where(and(eq(emailChanges.userId, auth.user.id), isNull(emailChanges.usedAt)))
        .returning({ tokenHash: emailChanges.tokenHash });
      if (cancelled.length)
        await audit(c, {
          action: "auth.email_change_cancelled",
          targetType: "membership",
          targetId: auth.membershipId,
        });
    },
  }),
];

const taken = () =>
  new AppError(
    "conflict",
    "That address now belongs to another Crow HR account, so it can't be used. Ask for a change to a different address.",
    { reason: "email_taken" },
  );

/** `/auth/email-change/confirm`: opened from the link sent to the new address (no session needed). */
export const emailChangeAuthRoutes = [
  defineRoute({
    method: "post",
    path: "/email-change/confirm",
    summary: "Confirm a sign-in email change with the link sent to the new address",
    description:
      "The token from the link proves the new address is reachable. The new address becomes the sign-in email in every organisation, verified; the old address is told.",
    access: "public",
    request: { body: z.object({ token: z.string().min(16).max(200) }) },
    responses: { 200: z.object({ email: z.string(), orgSlug: z.string().nullable() }) },
    errors: ["not_found", "conflict"],
    crossOrgExempt: "Keyed by a one-time token, not a record ID.",
    handler: async ({ c, deps, body }) => {
      const { db, clock } = deps;
      const now = clock.now();
      const tokenHash = await sha256Hex(body.token);
      const [change] = await db.select().from(emailChanges).where(eq(emailChanges.tokenHash, tokenHash));
      if (!change || change.usedAt || change.expiresAt <= now)
        throw new AppError(
          "not_found",
          "This link has expired or was already used. Ask for a new one in Sign-in and devices.",
        );
      const [user] = await db.select().from(users).where(eq(users.id, change.userId));
      if (!user) throw new AppError("not_found", "This link has expired or was already used.");
      const [owner] = await db.select({ id: users.id }).from(users).where(eq(users.email, change.newEmail));
      if (owner && owner.id !== user.id) throw taken();
      const [membership] = await db
        .select({ id: memberships.id })
        .from(memberships)
        .where(and(eq(memberships.orgId, change.orgId), eq(memberships.userId, user.id)));
      await db.transaction(async (tx) => {
        const used = await tx
          .update(emailChanges)
          .set({ usedAt: now })
          .where(and(eq(emailChanges.tokenHash, tokenHash), isNull(emailChanges.usedAt)))
          .returning({ tokenHash: emailChanges.tokenHash });
        if (!used.length) throw new AppError("not_found", "This link has expired or was already used.");
        await tx
          .update(users)
          .set({ email: change.newEmail, emailVerifiedAt: now, updatedAt: now })
          .where(eq(users.id, user.id))
          .catch((err: unknown) => {
            // Another account took the address between the check above and this update.
            if (isUniqueViolation(err)) throw taken();
            throw err;
          });
        await audit(
          c,
          {
            action: "auth.email_changed",
            targetType: "membership",
            targetId: membership?.id ?? user.id,
            diff: { email: { from: user.email, to: change.newEmail } },
          },
          { orgId: change.orgId, db: tx },
        );
      });
      try {
        await deps.mailer?.send({
          to: user.email,
          subject: "Your Crow HR sign-in email was changed",
          text: `Your Crow HR sign-in email is now ${mask(change.newEmail)}. Sign in with the new address from now on. If this wasn't you, contact your administrator now.`,
        });
      } catch (err) {
        c.var.logger.warn("Email change notice failed", { err });
      }
      const [org] = await db
        .select({ slug: organisations.slug })
        .from(organisations)
        .where(eq(organisations.id, change.orgId));
      return { email: change.newEmail, orgSlug: org?.slug ?? null };
    },
  }),
];
