import { and, eq, gt, isNull } from "drizzle-orm";
import { z } from "zod";
import { auditContext, recordAudit } from "../audit/audit.ts";
import { newToken, sha256Hex } from "../crypto/tokens.ts";
import { invitations, memberships } from "../db/schema/access.ts";
import { passwordResets, ssoProviders } from "../db/schema/auth.ts";
import { organisations } from "../db/schema/organisations.ts";
import { users } from "../db/schema/users.ts";
import { AppError } from "../errors.ts";
import { defineRoute, reply } from "../http/route.ts";
import { audit, emailInput, findMemberByEmail, findOrgBySlug, verifyPasswordOrDummy } from "./credentials.ts";
import { passwordProblem } from "./password-policy.ts";
import { revokeUserSessions, startBrowserSession } from "./sessions.ts";
import { loadSecuritySettings } from "./settings.ts";

const RESET_TTL_MS = 60 * 60_000;

const tokenBody = z.object({ token: z.string().min(20).max(200) });

function passwordIssue(problem: string) {
  return new AppError("validation_failed", "Some fields need attention.", {
    target: "json",
    issues: [{ path: "password", message: problem }],
  });
}

export const accountRoutes = [
  defineRoute({
    method: "post",
    path: "/password-reset/request",
    summary: "Request a password reset email",
    description: "Always answers 202, whether or not the email belongs to a member.",
    access: "public",
    request: { body: z.object({ org: z.string().min(1), email: emailInput() }) },
    responses: { 202: z.object({ accepted: z.literal(true), emailConfigured: z.boolean() }) },
    handler: async ({ c, deps, body }) => {
      const { db, clock, mailer } = deps;
      const org = await findOrgBySlug(db, body.org);
      const found = org ? await findMemberByEmail(db, org.id, body.email) : null;
      if (org && found && mailer && (found.membership.status === "active" || found.membership.status === "former")) {
        const now = clock.now();
        const token = newToken();
        await db.insert(passwordResets).values({
          tokenHash: await sha256Hex(token),
          orgId: org.id,
          userId: found.user.id,
          expiresAt: new Date(now.getTime() + RESET_TTL_MS),
          createdAt: now,
        });
        const url = `${deps.publicUrl.replace(/\/$/, "")}/reset/${token}`;
        try {
          await mailer.send({
            to: found.user.email,
            subject: "Reset your Crow HR password",
            text: `Someone asked to reset the password for your ${org.name} account on Crow HR. Use this link within 60 minutes: ${url}\nIf you didn't ask for this, ignore this email.`,
          });
        } catch (err) {
          c.var.logger.warn("Password reset email failed", { err });
        }
        await audit(
          c,
          { action: "auth.reset_requested", targetType: "membership", targetId: found.membership.id },
          { orgId: org.id },
        );
      }
      return reply(202, { accepted: true, emailConfigured: !!mailer });
    },
  }),

  defineRoute({
    method: "post",
    path: "/password-reset/inspect",
    summary: "Check a password reset link before showing the form",
    access: "public",
    request: { body: tokenBody },
    responses: { 200: z.object({ status: z.enum(["valid", "expired_or_used"]), orgSlug: z.string().nullable() }) },
    handler: async ({ deps, body }) => {
      const [row] = await deps.db
        .select({ reset: passwordResets, slug: organisations.slug })
        .from(passwordResets)
        .innerJoin(organisations, eq(organisations.id, passwordResets.orgId))
        .where(eq(passwordResets.tokenHash, await sha256Hex(body.token)));
      const valid = !!row && !row.reset.usedAt && row.reset.expiresAt > deps.clock.now();
      return { status: valid ? ("valid" as const) : ("expired_or_used" as const), orgSlug: row?.slug ?? null };
    },
  }),

  defineRoute({
    method: "post",
    path: "/password-reset/complete",
    summary: "Set a new password from a reset link",
    description: "Single use. Revokes every session and device of the user.",
    access: "public",
    request: { body: tokenBody.extend({ password: z.string().max(1024) }) },
    responses: { 200: z.object({ orgSlug: z.string().nullable() }) },
    errors: ["conflict"],
    handler: async ({ c, deps, body }) => {
      const { db, clock, passwordHasher } = deps;
      const now = clock.now();
      const hash = await sha256Hex(body.token);
      const [reset] = await db.select().from(passwordResets).where(eq(passwordResets.tokenHash, hash));
      if (!reset || reset.usedAt || reset.expiresAt <= now) {
        throw new AppError("conflict", "This reset link has expired or was already used. Request a new one.", {
          reason: "expired_or_used",
        });
      }
      const [user] = await db.select().from(users).where(eq(users.id, reset.userId));
      if (!user)
        throw new AppError("conflict", "This reset link has expired or was already used. Request a new one.", {
          reason: "expired_or_used",
        });
      const problem = passwordProblem(body.password, user.email);
      if (problem) throw passwordIssue(problem);
      const claimed = await db
        .update(passwordResets)
        .set({ usedAt: now })
        .where(and(eq(passwordResets.tokenHash, hash), isNull(passwordResets.usedAt)))
        .returning();
      if (!claimed.length)
        throw new AppError("conflict", "This reset link has expired or was already used. Request a new one.", {
          reason: "expired_or_used",
        });
      await db
        .update(users)
        .set({ passwordHash: await passwordHasher.hash(body.password), passwordChangedAt: now, updatedAt: now })
        .where(eq(users.id, user.id));
      await revokeUserSessions(db, { userId: user.id, reason: "password_reset", now });
      const [m] = await db
        .select()
        .from(memberships)
        .where(and(eq(memberships.orgId, reset.orgId), eq(memberships.userId, user.id)));
      await recordAudit(
        db,
        deps,
        { ...auditContext(c, reset.orgId), actorLabel: user.email },
        {
          action: "auth.password_reset",
          targetType: "membership",
          targetId: m?.id ?? null,
          meta: { via: reset.createdBy ? "admin_link" : "email" },
        },
      );
      const [org] = await db
        .select({ slug: organisations.slug })
        .from(organisations)
        .where(eq(organisations.id, reset.orgId));
      return { orgSlug: org?.slug ?? null };
    },
  }),

  defineRoute({
    method: "post",
    path: "/invitations/inspect",
    summary: "Look up an invitation link",
    access: "public",
    request: { body: tokenBody },
    responses: {
      200: z.object({
        status: z.enum(["valid", "expired", "used", "revoked", "unknown"]),
        organisation: z.object({ name: z.string(), slug: z.string().nullable() }).nullable(),
        email: z.string().nullable(),
        displayName: z.string().nullable(),
        /** The invitee already has a Crow HR password (another organisation): they confirm it instead. */
        existingAccount: z.boolean(),
        passwordAllowed: z.boolean(),
        providers: z.array(z.object({ id: z.uuid(), kind: z.string(), displayName: z.string() })),
      }),
    },
    handler: async ({ deps, body }) => {
      const { db, clock } = deps;
      const [row] = await db
        .select({ invite: invitations, org: organisations, user: users })
        .from(invitations)
        .innerJoin(organisations, eq(organisations.id, invitations.orgId))
        .innerJoin(
          memberships,
          and(eq(memberships.id, invitations.membershipId), eq(memberships.orgId, invitations.orgId)),
        )
        .innerJoin(users, eq(users.id, memberships.userId))
        .where(eq(invitations.tokenHash, await sha256Hex(body.token)));
      if (!row)
        return {
          status: "unknown" as const,
          organisation: null,
          email: null,
          displayName: null,
          existingAccount: false,
          passwordAllowed: false,
          providers: [],
        };
      const status: "used" | "revoked" | "expired" | "valid" = row.invite.acceptedAt
        ? "used"
        : row.invite.revokedAt
          ? "revoked"
          : row.invite.expiresAt <= clock.now()
            ? "expired"
            : "valid";
      const settings = await loadSecuritySettings(db, row.org.id);
      const providers = await db
        .select({ id: ssoProviders.id, kind: ssoProviders.kind, displayName: ssoProviders.displayName })
        .from(ssoProviders)
        .where(and(eq(ssoProviders.orgId, row.org.id), eq(ssoProviders.enabled, true)));
      return {
        status,
        organisation: { name: row.org.name, slug: row.org.slug },
        email: status === "valid" ? row.user.email : null,
        displayName: status === "valid" ? row.user.displayName : null,
        existingAccount: !!row.user.passwordHash,
        passwordAllowed: settings.passwordEnabled,
        providers: status === "valid" ? providers : [],
      };
    },
  }),

  defineRoute({
    method: "post",
    path: "/invitations/accept",
    summary: "Accept an invitation with a password",
    description:
      "Sets the password (or confirms the existing one for people already on Crow HR), activates the membership and signs in.",
    access: "public",
    request: {
      body: tokenBody.extend({
        password: z.string().min(1, "Enter a password.").max(1024),
        displayName: z.string().trim().min(1).max(120).optional(),
      }),
    },
    responses: { 200: z.object({ orgSlug: z.string().nullable() }) },
    errors: ["conflict", "invalid_credentials", "password_sign_in_disabled"],
    handler: async ({ c, deps, body }) => {
      const { db, clock, passwordHasher } = deps;
      const now = clock.now();
      const hash = await sha256Hex(body.token);
      const [row] = await db
        .select({ invite: invitations, membership: memberships, user: users })
        .from(invitations)
        .innerJoin(
          memberships,
          and(eq(memberships.id, invitations.membershipId), eq(memberships.orgId, invitations.orgId)),
        )
        .innerJoin(users, eq(users.id, memberships.userId))
        .where(
          and(
            eq(invitations.tokenHash, hash),
            isNull(invitations.acceptedAt),
            isNull(invitations.revokedAt),
            gt(invitations.expiresAt, now),
          ),
        );
      if (row?.membership.status !== "invited") {
        throw new AppError(
          "conflict",
          "This invitation has expired or was already used. Ask your HR team to resend it.",
          { reason: "invalid_invitation" },
        );
      }
      const settings = await loadSecuritySettings(db, row.invite.orgId);
      if (!settings.passwordEnabled) {
        throw new AppError(
          "password_sign_in_disabled",
          "This organisation signs in with single sign-on. Accept the invitation with one of the sign-in buttons instead.",
        );
      }
      if (row.user.passwordHash) {
        if (!(await verifyPasswordOrDummy(passwordHasher, row.user.passwordHash, body.password))) {
          throw new AppError(
            "invalid_credentials",
            "Enter the password you already use for Crow HR to accept this invitation.",
          );
        }
      } else {
        const problem = passwordProblem(body.password, row.user.email);
        if (problem) throw passwordIssue(problem);
      }
      await db.transaction(async (tx) => {
        await tx.update(invitations).set({ acceptedAt: now }).where(eq(invitations.id, row.invite.id));
        await tx
          .update(memberships)
          .set({ status: "active", updatedAt: now })
          .where(eq(memberships.id, row.membership.id));
        if (!row.user.passwordHash) {
          await tx
            .update(users)
            .set({
              passwordHash: await passwordHasher.hash(body.password),
              passwordChangedAt: now,
              emailVerifiedAt: row.user.emailVerifiedAt ?? now,
              ...(body.displayName ? { displayName: body.displayName } : {}),
              updatedAt: now,
            })
            .where(eq(users.id, row.user.id));
        }
        await recordAudit(
          tx,
          deps,
          { ...auditContext(c, row.invite.orgId), actorLabel: row.user.email },
          {
            action: "member.invitation_accepted",
            targetType: "membership",
            targetId: row.membership.id,
            meta: { method: "password" },
          },
        );
      });
      await startBrowserSession(c, {
        userId: row.user.id,
        orgId: row.invite.orgId,
        membershipId: row.membership.id,
        authMethod: "password",
        mfaSatisfied: false,
      });
      const [org] = await db
        .select({ slug: organisations.slug })
        .from(organisations)
        .where(eq(organisations.id, row.invite.orgId));
      return { orgSlug: org?.slug ?? null };
    },
  }),
];
