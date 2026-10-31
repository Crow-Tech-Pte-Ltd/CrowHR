import { and, eq, gt, isNull } from "drizzle-orm";
import { getCookie } from "hono/cookie";
import { z } from "zod";
import { clientIp } from "../audit/audit.ts";
import type { AppContext } from "../context.ts";
import { sha256Hex } from "../crypto/tokens.ts";
import { mfaChallenges, sessions } from "../db/schema/auth.ts";
import { users } from "../db/schema/users.ts";
import { AppError } from "../errors.ts";
import { defineRoute } from "../http/route.ts";
import {
  audit,
  createMfaChallenge,
  emailInput,
  findMemberByEmail,
  findOrgBySlug,
  invalidCredentials,
  MFA_MAX_ATTEMPTS,
  notifyUser,
  rolesOf,
  verifyPasswordOrDummy,
  verifySecondFactor,
} from "./credentials.ts";
import { publicSignInMethods } from "./methods.ts";
import { completeNativeSignIn } from "./native/complete.ts";
import { clearSessionCookie, revokeSessionById, startBrowserSession } from "./sessions.ts";
import { loadSecuritySettings, sessionCookie } from "./settings.ts";
import {
  accountLockedUntil,
  checkIpRate,
  clearAccountThrottle,
  recordAccountFailure,
  sweepThrottle,
} from "./throttle.ts";

const signInBody = z.object({
  org: z.string().trim().min(1, "Choose the organisation to sign in to."),
  email: emailInput(),
  password: z.string().min(1, "Enter your password.").max(1024),
  /** Native-app authorisation in progress (api-platform). */
  nativeRequestId: z.uuid().optional(),
});

export const signInResult = z.object({
  mfaRequired: z.boolean(),
  /** Pending-sign-in token for `POST /auth/mfa/verify`, valid 5 minutes. */
  mfaToken: z.string().optional(),
  mfaExpiresAt: z.iso.datetime().optional(),
  /** Native flow: where the browser goes next (the app's redirect URI with code + state). */
  redirectTo: z.string().optional(),
});

/** Names of the enabled SSO methods, for the "password sign-in is disabled" message. */
async function enabledSsoNames(c: AppContext, orgId: string): Promise<string[]> {
  return (await publicSignInMethods(c.var.deps.db, orgId)).providers.map((p) => p.displayName);
}

/** Final step shared by password(+MFA) sign-in: browser session, or a native code. */
async function finishSignIn(
  c: AppContext,
  input: {
    orgId: string;
    userId: string;
    membershipId: string;
    mfa: "none" | "totp" | "recovery_code";
    nativeRequestId: string | null;
    breakGlass: boolean;
  },
): Promise<z.input<typeof signInResult>> {
  const meta = { method: "password", mfa: input.mfa };
  if (input.breakGlass) {
    await audit(
      c,
      { action: "auth.break_glass_sign_in", targetType: "membership", targetId: input.membershipId, meta },
      { orgId: input.orgId },
    );
  }
  if (input.nativeRequestId) {
    const redirectTo = await completeNativeSignIn(c, {
      requestId: input.nativeRequestId,
      orgId: input.orgId,
      userId: input.userId,
      membershipId: input.membershipId,
      authMethod: "password",
    });
    await audit(
      c,
      {
        action: "auth.signed_in",
        targetType: "membership",
        targetId: input.membershipId,
        meta: { ...meta, client: "native" },
      },
      { orgId: input.orgId },
    );
    return { mfaRequired: false, redirectTo };
  }
  await startBrowserSession(c, {
    userId: input.userId,
    orgId: input.orgId,
    membershipId: input.membershipId,
    authMethod: "password",
    mfaSatisfied: input.mfa !== "none",
  });
  await audit(
    c,
    { action: "auth.signed_in", targetType: "membership", targetId: input.membershipId, meta },
    { orgId: input.orgId },
  );
  return { mfaRequired: false };
}

export const signInRoutes = [
  defineRoute({
    method: "post",
    path: "/sign-in",
    summary: "Sign in with email and password",
    description:
      "Every failure (unknown email, wrong password, suspended, locked) answers the same 401 invalid_credentials. When MFA is enrolled the response carries a pending-sign-in token instead of a session.",
    access: "public",
    request: { body: signInBody },
    responses: { 200: signInResult },
    errors: ["invalid_credentials", "password_sign_in_disabled", "rate_limited"],
    handler: async ({ c, deps, body }) => {
      const { db, clock, passwordHasher } = deps;
      const now = clock.now();
      const ip = clientIp(c) ?? "unknown";
      const rate = await checkIpRate(db, ip, now);
      if (!rate.allowed) {
        throw new AppError(
          "rate_limited",
          "Too many sign-in attempts from this network. Wait a minute and try again.",
          undefined,
          {
            headers: { "Retry-After": String(rate.retryAfterSeconds) },
          },
        );
      }
      if (Math.random() < 0.02) await sweepThrottle(db, now);

      const org = await findOrgBySlug(db, body.org);
      const found = org ? await findMemberByEmail(db, org.id, body.email) : null;
      const passwordOk = await verifyPasswordOrDummy(passwordHasher, found?.user.passwordHash ?? null, body.password);
      if (!org || !found) throw invalidCredentials();

      const { user, membership } = found;
      const locked = await accountLockedUntil(db, user.id, now);
      const usable = membership.status === "active" || membership.status === "former";
      if (!passwordOk || locked || !usable) {
        let lockedNow = false;
        if (!passwordOk && !locked) lockedNow = await recordAccountFailure(db, user.id, now);
        await audit(
          c,
          {
            action: "auth.sign_in_failed",
            targetType: "membership",
            targetId: membership.id,
            meta: {
              method: "password",
              reason: locked ? "locked" : !usable ? `membership_${membership.status}` : "wrong_password",
            },
          },
          { orgId: org.id },
        );
        if (lockedNow) {
          await audit(
            c,
            { action: "auth.locked", targetType: "membership", targetId: membership.id, meta: { minutes: 15 } },
            { orgId: org.id },
          );
          await notifyUser(
            deps,
            user.email,
            "Sign-in attempts blocked",
            `There were 10 wrong passwords for your ${org.name} account on Crow HR, so password sign-in is blocked for 15 minutes. If this wasn't you, tell your administrator and change your password.`,
          );
        }
        throw invalidCredentials();
      }

      await clearAccountThrottle(db, user.id);
      if (user.passwordHash && passwordHasher.needsRehash?.(user.passwordHash)) {
        await db
          .update(users)
          .set({ passwordHash: await passwordHasher.hash(body.password) })
          .where(eq(users.id, user.id));
      }

      const settings = await loadSecuritySettings(db, org.id);
      const roles = await rolesOf(db, org.id, membership.id);
      const isOwner = roles.includes("owner") && membership.status === "active";
      if (!settings.passwordEnabled && !isOwner) {
        const names = await enabledSsoNames(c, org.id);
        await audit(
          c,
          {
            action: "auth.sign_in_failed",
            targetType: "membership",
            targetId: membership.id,
            meta: { method: "password", reason: "password_disabled" },
          },
          { orgId: org.id },
        );
        throw new AppError(
          "password_sign_in_disabled",
          `${org.name} doesn't use passwords for sign-in. Use ${names.length ? names.join(" or ") : "your organisation's single sign-on"} instead.`,
          { methods: names },
        );
      }
      const breakGlass = !settings.passwordEnabled && isOwner;

      if (user.mfaEnrolledAt) {
        const challenge = await createMfaChallenge(deps, {
          orgId: org.id,
          userId: user.id,
          membershipId: membership.id,
          authMethod: breakGlass ? "password:break_glass" : "password",
          nativeRequestId: body.nativeRequestId ?? null,
        });
        return { mfaRequired: true, mfaToken: challenge.token, mfaExpiresAt: challenge.expiresAt.toISOString() };
      }
      return finishSignIn(c, {
        orgId: org.id,
        userId: user.id,
        membershipId: membership.id,
        mfa: "none",
        nativeRequestId: body.nativeRequestId ?? null,
        breakGlass,
      });
    },
  }),

  defineRoute({
    method: "post",
    path: "/mfa/verify",
    summary: "Complete a password sign-in with a TOTP or recovery code",
    access: "public",
    request: {
      body: z.object({
        mfaToken: z.string().min(1).max(200),
        code: z
          .string()
          .trim()
          .min(6, "Enter the 6-digit code from your authenticator app, or a recovery code.")
          .max(20),
      }),
    },
    responses: { 200: signInResult },
    errors: ["invalid_mfa_code"],
    handler: async ({ c, deps, body }) => {
      const { db, clock } = deps;
      const now = clock.now();
      const id = await sha256Hex(body.mfaToken);
      const [challenge] = await db
        .select()
        .from(mfaChallenges)
        .where(and(eq(mfaChallenges.id, id), isNull(mfaChallenges.consumedAt), gt(mfaChallenges.expiresAt, now)));
      if (!challenge || challenge.attempts >= MFA_MAX_ATTEMPTS) {
        throw new AppError("invalid_mfa_code", "This sign-in has expired. Enter your email and password again.", {
          restart: true,
        });
      }
      const result = await verifySecondFactor(deps, challenge.userId, body.code);
      if (!result.ok) {
        const attempts = challenge.attempts + 1;
        const ended = attempts >= MFA_MAX_ATTEMPTS;
        await db
          .update(mfaChallenges)
          .set({ attempts, ...(ended ? { consumedAt: now } : {}) })
          .where(eq(mfaChallenges.id, id));
        await audit(
          c,
          {
            action: "auth.mfa_failed",
            targetType: "membership",
            targetId: challenge.membershipId,
            meta: { attempts, ended },
          },
          { orgId: challenge.orgId },
        );
        throw new AppError(
          "invalid_mfa_code",
          ended
            ? "Too many wrong codes. Enter your email and password again."
            : "That code didn't work. Check the code in your authenticator app (it changes every 30 seconds) and try again.",
          { remainingAttempts: MFA_MAX_ATTEMPTS - attempts, restart: ended },
        );
      }
      // Single use: a second request with the same token fails.
      const consumed = await db
        .update(mfaChallenges)
        .set({ consumedAt: now })
        .where(and(eq(mfaChallenges.id, id), isNull(mfaChallenges.consumedAt)))
        .returning({ id: mfaChallenges.id });
      if (!consumed.length)
        throw new AppError("invalid_mfa_code", "This sign-in has expired. Enter your email and password again.", {
          restart: true,
        });
      if (result.method === "recovery_code") {
        await audit(
          c,
          {
            action: "auth.recovery_code_used",
            targetType: "membership",
            targetId: challenge.membershipId,
            meta: { remaining: result.remainingRecoveryCodes },
          },
          { orgId: challenge.orgId },
        );
        const [user] = await db.select({ email: users.email }).from(users).where(eq(users.id, challenge.userId));
        if (user) {
          await notifyUser(
            deps,
            user.email,
            "A recovery code was used",
            `A recovery code was used to sign in to Crow HR. You have ${result.remainingRecoveryCodes} left. If this wasn't you, change your password and reset two-step verification now.`,
          );
        }
      }
      return finishSignIn(c, {
        orgId: challenge.orgId,
        userId: challenge.userId,
        membershipId: challenge.membershipId,
        mfa: result.method,
        nativeRequestId: challenge.nativeRequestId,
        breakGlass: challenge.authMethod === "password:break_glass",
      });
    },
  }),

  defineRoute({
    method: "post",
    path: "/sign-out",
    summary: "Sign out of this browser session",
    access: "public",
    responses: { 204: null },
    handler: async ({ c, deps }) => {
      const token = getCookie(c, sessionCookie(deps.publicUrl).name);
      if (token) {
        const id = await sha256Hex(token);
        const [session] = await deps.db.select().from(sessions).where(eq(sessions.id, id));
        await revokeSessionById(deps.db, id, "signed_out", deps.clock.now());
        if (session && !session.revokedAt) {
          await audit(
            c,
            { action: "auth.signed_out", targetType: "membership", targetId: session.membershipId },
            { orgId: session.orgId },
          );
        }
      }
      clearSessionCookie(c);
      return undefined;
    },
  }),

  defineRoute({
    method: "post",
    path: "/switch-organisation",
    summary: "Switch the session to another organisation you belong to",
    description: "Issues a new session token (rotation) scoped to the target organisation.",
    access: "authenticated",
    request: { body: z.object({ org: z.string().trim().min(1).max(100) }) },
    responses: { 200: z.object({ orgSlug: z.string() }) },
    errors: ["not_found"],
    handler: async ({ c, deps, auth, body }) => {
      if (auth.session.kind !== "browser")
        throw new AppError("forbidden", "Switch organisations in the app's settings.");
      const org = await findOrgBySlug(deps.db, body.org);
      const target = org ? await findMemberByEmail(deps.db, org.id, auth.user.email) : null;
      if (!org?.slug || !target || (target.membership.status !== "active" && target.membership.status !== "former")) {
        throw new AppError("not_found", "You're not a member of that organisation.");
      }
      const settings = await loadSecuritySettings(deps.db, org.id);
      const roles = await rolesOf(deps.db, org.id, target.membership.id);
      if (auth.authMethod === "password" && !settings.passwordEnabled && !roles.includes("owner")) {
        throw new AppError(
          "password_sign_in_disabled",
          `${org.name} uses single sign-on. Sign in to it from its own sign-in page.`,
        );
      }
      const [user] = await deps.db.select().from(users).where(eq(users.id, auth.user.id));
      if (user?.mfaEnrolledAt && !auth.session.mfaSatisfied) {
        throw new AppError("reauth_required", "Confirm it's you with your authenticator code before switching.");
      }
      await startBrowserSession(c, {
        userId: auth.user.id,
        orgId: org.id,
        membershipId: target.membership.id,
        authMethod: auth.authMethod === "password" ? "password" : auth.authMethod,
        mfaSatisfied: auth.session.mfaSatisfied,
      });
      await audit(
        c,
        {
          action: "auth.organisation_switched",
          targetType: "membership",
          targetId: target.membership.id,
          meta: { from: auth.orgId },
        },
        { orgId: org.id },
      );
      return { orgSlug: org.slug };
    },
  }),

  defineRoute({
    method: "post",
    path: "/reauth",
    summary: "Confirm it's you before a sensitive action",
    description:
      "Password sessions: password, plus a TOTP or recovery code when MFA is enrolled. SSO sessions re-authenticate by an SSO round-trip instead.",
    access: "authenticated",
    allowDuringMfaEnrolment: true,
    request: {
      body: z.object({
        password: z.string().min(1, "Enter your password.").max(1024),
        code: z.string().trim().max(20).optional(),
      }),
    },
    responses: { 200: z.object({ authenticatedAt: z.iso.datetime() }) },
    errors: ["invalid_credentials", "invalid_mfa_code"],
    handler: async ({ c, deps, auth, body }) => {
      const { db, clock, passwordHasher } = deps;
      const now = clock.now();
      if (auth.session.kind !== "browser")
        throw new AppError("forbidden", "Re-authenticate in the app by signing in again.");
      const [user] = await db.select().from(users).where(eq(users.id, auth.user.id));
      if (await accountLockedUntil(db, auth.user.id, now)) throw invalidCredentials();
      const ok = await verifyPasswordOrDummy(passwordHasher, user?.passwordHash ?? null, body.password);
      if (!ok) {
        await recordAccountFailure(db, auth.user.id, now);
        await audit(c, {
          action: "auth.reauth_failed",
          targetType: "membership",
          targetId: auth.membershipId,
          meta: { reason: "wrong_password" },
        });
        throw invalidCredentials();
      }
      if (user?.mfaEnrolledAt) {
        if (!body.code)
          throw new AppError("invalid_mfa_code", "Enter the 6-digit code from your authenticator app.", {
            codeRequired: true,
          });
        const second = await verifySecondFactor(deps, auth.user.id, body.code);
        if (!second.ok)
          throw new AppError("invalid_mfa_code", "That code didn't work. Check your authenticator app and try again.");
      }
      await db.update(sessions).set({ authenticatedAt: now }).where(eq(sessions.id, auth.session.id));
      await audit(c, { action: "auth.reauthenticated", targetType: "membership", targetId: auth.membershipId });
      return { authenticatedAt: now.toISOString() };
    },
  }),
];
