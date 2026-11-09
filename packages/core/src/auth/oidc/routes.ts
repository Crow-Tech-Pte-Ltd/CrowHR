import { and, eq, gt, isNull } from "drizzle-orm";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import * as oidc from "openid-client";
import { z } from "zod";
import { auditContext, recordAudit } from "../../audit/audit.ts";
import type { AppContext, AuthMethod } from "../../context.ts";
import { SECRET_PURPOSES } from "../../crypto/secret-box.ts";
import { sha256Hex } from "../../crypto/tokens.ts";
import { invitations, memberships } from "../../db/schema/access.ts";
import { oidcTransactions, type SsoProvider, ssoProviders, userIdentities } from "../../db/schema/auth.ts";
import { organisations } from "../../db/schema/organisations.ts";
import { users } from "../../db/schema/users.ts";
import { AppError } from "../../errors.ts";
import { defineRoute } from "../../http/route.ts";
import { createMfaChallenge, normaliseEmail } from "../credentials.ts";
import { requireRecentAuth } from "../guards.ts";
import { rememberDevice } from "../known-device.ts";
import { isConfigured } from "../methods.ts";
import { completeNativeSignIn } from "../native/complete.ts";
import { noticeNewBrowserSignIn, sendSecurityNotice } from "../security-notices.ts";
import { startBrowserSession } from "../sessions.ts";
import { MINUTE, sessionCookie } from "../settings.ts";
import { setMfaCookie } from "../sign-in-routes.ts";
import { callbackUrl, providerConfig } from "./client.ts";
import { entraEmailVerified, idpAssertsMfa } from "./mfa.ts";
import { PRESETS, singpassSubject } from "./presets.ts";

export const OIDC_TRANSACTION_TTL_MS = 10 * MINUTE;

/**
 * Binds an OIDC transaction to the browser that started it, so a callback URL produced in one
 * browser can't complete in another (login CSRF / session swapping). SameSite=Lax is sent on the
 * IdP's top-level redirect back to us.
 */
const TX_COOKIE = "crowhr_oidc_tx";
function txCookieOptions(c: AppContext) {
  return {
    path: "/api/v1/auth/oidc",
    httpOnly: true,
    sameSite: "Lax" as const,
    secure: sessionCookie(c.var.deps.publicUrl).secure,
  };
}

const AUTH_METHOD: Record<SsoProvider["kind"], AuthMethod> = {
  google: "google",
  entra: "entra",
  singpass: "singpass",
  oidc: "oidc",
};

type FailureReason =
  | "state_mismatch"
  | "expired"
  | "idp_error"
  | "token_validation_failed"
  | "hd_mismatch"
  | "tid_mismatch"
  | "email_not_verified"
  | "not_provisioned"
  | "membership_inactive"
  | "invitation_invalid"
  | "already_linked"
  | "request_rejected";

/**
 * The OAuth error an identity provider answered with (`error`, `error_description`, HTTP status).
 * Safe to log and audit: these never contain tokens, keys or personal data.
 */
async function oauthErrorDetail(err: unknown): Promise<Record<string, unknown>> {
  if (err instanceof oidc.ResponseBodyError) {
    return {
      error: err.error,
      ...(err.error_description ? { errorDescription: err.error_description.slice(0, 200) } : {}),
      status: err.status,
    };
  }
  const detail: Record<string, unknown> = { error: err instanceof Error ? err.message.slice(0, 200) : "unknown" };
  // openid-client's ClientError keeps the provider's raw Response as `cause` (e.g. an unexpected status).
  // Duck-typed: the injected fetch may return a Response from another implementation (undici).
  if (err instanceof oidc.ClientError) {
    if (err.code) detail.code = err.code;
    const res = err.cause as
      | {
          status?: unknown;
          headers?: { get?: (name: string) => string | null };
          clone?: () => { json(): Promise<unknown> };
        }
      | undefined;
    if (typeof res?.status === "number") {
      detail.status = res.status;
      const contentType = res.headers?.get?.("content-type") ?? null;
      detail.contentType = contentType;
      // oauth4webapi reads OAuth error bodies only for 4xx; Singpass also uses them on 5xx
      // (e.g. 502 upstream_dependency_error when it cannot fetch the JWKS).
      if (contentType?.includes("json") && typeof res.clone === "function") {
        try {
          const body = (await res.clone().json()) as { error?: unknown; error_description?: unknown };
          if (typeof body.error === "string") detail.error = body.error.slice(0, 100);
          if (typeof body.error_description === "string")
            detail.errorDescription = body.error_description.slice(0, 200);
        } catch {
          // Not JSON after all: keep the status.
        }
      }
    }
  }
  return detail;
}

async function loadProvider(c: AppContext, providerId: string): Promise<SsoProvider | null> {
  if (!/^[0-9a-f-]{36}$/i.test(providerId)) return null;
  const [p] = await c.var.deps.db.select().from(ssoProviders).where(eq(ssoProviders.id, providerId));
  return p ?? null;
}

async function orgSlug(c: AppContext, orgId: string): Promise<string> {
  const [org] = await c.var.deps.db
    .select({ slug: organisations.slug })
    .from(organisations)
    .where(eq(organisations.id, orgId));
  return org?.slug ?? "";
}

/** Ends a failed SSO attempt on the sign-in page with a generic message; the reason goes to the audit log. */
async function fail(
  c: AppContext,
  provider: SsoProvider,
  reason: FailureReason,
  purpose: string,
  detail?: Record<string, unknown>,
): Promise<Response> {
  const deps = c.var.deps;
  await recordAudit(deps.db, deps, auditContext(c, provider.orgId), {
    action: purpose === "test" ? "sso.test_failed" : "auth.sso_failed",
    targetType: "sso_provider",
    targetId: provider.id,
    meta: { reason, provider: provider.displayName, ...detail },
  });
  if (purpose === "test")
    return c.redirect(`/settings/security?test=failed&provider=${provider.id}&reason=${reason}`, 302);
  if (purpose === "link") return c.redirect(`/me/sessions?link=failed&reason=${reason}`, 302);
  const slug = await orgSlug(c, provider.orgId);
  const code =
    reason === "not_provisioned"
      ? "not_provisioned"
      : reason === "invitation_invalid"
        ? "invitation_invalid"
        : "sso_failed";
  return c.redirect(`/sign-in/${slug}?error=${code}&provider=${encodeURIComponent(provider.displayName)}`, 302);
}

export const oidcRoutes = [
  defineRoute({
    method: "get",
    path: "/oidc/:providerId/start",
    summary: "Start single sign-on with a provider",
    description:
      "Redirects to the identity provider (authorization code + PKCE S256, state and nonce kept server-side for 10 minutes). `purpose=test` is an owner's test sign-in; `purpose=link` links the provider to the signed-in user.",
    access: "public",
    request: {
      params: z.object({ providerId: z.uuid() }),
      query: z.object({
        purpose: z.enum(["sign_in", "test", "link"]).default("sign_in"),
        invitation: z.string().min(20).max(200).optional(),
        native: z.uuid().optional(),
      }),
    },
    responses: { 302: { description: "Redirect to the identity provider." } },
    errors: ["not_found", "disabled_in_demo", "forbidden", "reauth_required"],
    handler: async ({ c, deps, params, query, auth }) => {
      if (deps.demoMode) {
        throw new AppError(
          "disabled_in_demo",
          "Not available in the demo. Self-hosted installs can enable this in Settings → Security.",
        );
      }
      const provider = await loadProvider(c, params.providerId);
      if (!provider || !isConfigured(provider)) throw new AppError("not_found", "That sign-in method isn't set up.");
      if (query.purpose === "test") {
        if (!auth || auth.orgId !== provider.orgId || !auth.roles.includes("owner")) {
          throw new AppError("forbidden", "Only an owner of this organisation can test a sign-in method.");
        }
        requireRecentAuth(c);
      } else if (query.purpose === "link") {
        if (!auth || auth.orgId !== provider.orgId)
          throw new AppError("forbidden", "Sign in first, then link this sign-in method from your profile.");
        // Security review finding 1: linking adds a permanent way in, so an unattended session
        // must not be enough. Password sessions re-enter password (+ TOTP); SSO sessions sign in again.
        requireRecentAuth(c);
      } else if (!provider.enabled) {
        throw new AppError("not_found", "That sign-in method isn't enabled.");
      }
      let invitationId: string | null = null;
      if (query.invitation) {
        const [invite] = await deps.db
          .select()
          .from(invitations)
          .where(
            and(eq(invitations.tokenHash, await sha256Hex(query.invitation)), eq(invitations.orgId, provider.orgId)),
          );
        invitationId = invite?.id ?? null;
        if (!invitationId)
          throw new AppError("not_found", "This invitation link is not valid. Ask your HR team to resend it.");
      }

      const preset = PRESETS[provider.kind];
      const config = await providerConfig(deps, provider);
      const state = oidc.randomState();
      const nonce = oidc.randomNonce();
      const verifier = oidc.randomPKCECodeVerifier();
      let dpopJwkEnc: string | null = null;
      let dpop: oidc.DPoPHandle | undefined;
      if (preset.dpop) {
        const pair = await oidc.randomDPoPKeyPair("ES256", { extractable: true });
        const jwk = {
          private: await crypto.subtle.exportKey("jwk", pair.privateKey),
          public: await crypto.subtle.exportKey("jwk", pair.publicKey),
        };
        dpopJwkEnc = await deps.secretBox.encrypt(SECRET_PURPOSES.oidcTransaction, JSON.stringify(jwk));
        dpop = oidc.getDPoPHandle(config, pair);
      }
      const now = deps.clock.now();
      setCookie(c, TX_COOKIE, state, { ...txCookieOptions(c), maxAge: OIDC_TRANSACTION_TTL_MS / 1000 });
      await deps.db.insert(oidcTransactions).values({
        stateHash: await sha256Hex(state),
        orgId: provider.orgId,
        providerId: provider.id,
        purpose: query.purpose === "sign_in" && invitationId ? "invite" : query.purpose,
        nonce,
        codeVerifierEnc: await deps.secretBox.encrypt(SECRET_PURPOSES.oidcTransaction, verifier),
        dpopJwkEnc,
        invitationId,
        linkUserId: query.purpose !== "sign_in" ? (auth?.user.id ?? null) : null,
        nativeRequestId: query.native ?? null,
        expiresAt: new Date(now.getTime() + OIDC_TRANSACTION_TTL_MS),
        createdAt: now,
      });
      const parameters: Record<string, string> = {
        redirect_uri: callbackUrl(deps.publicUrl, provider.id),
        scope: preset.scopes,
        response_type: "code",
        response_mode: "query",
        state,
        nonce,
        code_challenge: await oidc.calculatePKCECodeChallenge(verifier),
        code_challenge_method: "S256",
        ...preset.authParams,
      };
      if (provider.kind === "google" && provider.allowedDomains.length === 1)
        parameters.hd = provider.allowedDomains[0] as string;
      let url: URL;
      try {
        url = preset.par
          ? await oidc.buildAuthorizationUrlWithPAR(config, parameters, dpop ? { DPoP: dpop } : undefined)
          : oidc.buildAuthorizationUrl(config, parameters);
      } catch (err) {
        // The provider refused or garbled the pushed authorisation request (e.g. Singpass: invalid_client
        // for a JWKS or client assertion problem, invalid_request for a missing parameter).
        if (!(err instanceof oidc.ResponseBodyError || err instanceof oidc.ClientError)) throw err;
        const detail = await oauthErrorDetail(err);
        c.var.logger.warn("OIDC authorisation request rejected", { ...detail, provider: provider.id });
        return fail(c, provider, "request_rejected", query.purpose, detail);
      }
      return c.redirect(url.toString(), 302);
    },
  }),

  defineRoute({
    method: "get",
    path: "/oidc/:providerId/callback",
    summary: "Identity provider callback",
    description:
      "The only cookie-authenticated GET with side effects; protected by `state`. Validates the ID token (signature, issuer, audience, expiry, nonce) and the provider restrictions, links or matches the identity, then signs in.",
    access: "public",
    request: {
      params: z.object({ providerId: z.uuid() }),
      query: z.looseObject({ state: z.string().max(500).optional() }),
    },
    responses: { 302: { description: "Redirect into the app, or back to the sign-in page with an error." } },
    errors: ["not_found", "forbidden", "reauth_required"],
    handler: async ({ c, deps, params, query }) => {
      const provider = await loadProvider(c, params.providerId);
      if (!provider) throw new AppError("not_found", "That sign-in method isn't set up.");
      const { db, clock, secretBox } = deps;
      const now = clock.now();
      const stateHash = query.state ? await sha256Hex(query.state) : "";
      const boundState = getCookie(c, TX_COOKIE);
      deleteCookie(c, TX_COOKIE, txCookieOptions(c));
      if (!query.state || boundState !== query.state) return fail(c, provider, "state_mismatch", "sign_in");
      const [tx] = query.state
        ? await db
            .delete(oidcTransactions)
            .where(and(eq(oidcTransactions.stateHash, stateHash), eq(oidcTransactions.providerId, provider.id)))
            .returning()
        : [];
      if (!tx) return fail(c, provider, "state_mismatch", "sign_in");
      if (tx.expiresAt <= now) return fail(c, provider, "expired", tx.purpose);
      if (tx.purpose === "link" || tx.purpose === "test") {
        const auth = c.var.auth;
        if (
          !auth ||
          auth.orgId !== provider.orgId ||
          auth.user.id !== tx.linkUserId ||
          (tx.purpose === "test" && !auth.roles.includes("owner"))
        ) {
          throw new AppError("forbidden", "Sign in again before linking or testing a sign-in method.");
        }
        requireRecentAuth(c);
      }

      const incoming = new URL(c.req.url);
      const current = new URL(callbackUrl(deps.publicUrl, provider.id));
      current.search = incoming.search;
      if (current.searchParams.get("error")) {
        return fail(c, provider, "idp_error", tx.purpose, {
          idpError: current.searchParams.get("error")?.slice(0, 100),
        });
      }

      let claims: oidc.IDToken;
      try {
        const config = await providerConfig(deps, provider);
        let dpop: oidc.DPoPHandle | undefined;
        if (tx.dpopJwkEnc) {
          const jwk = JSON.parse(await secretBox.decrypt(SECRET_PURPOSES.oidcTransaction, tx.dpopJwkEnc)) as {
            private: JsonWebKey;
            public: JsonWebKey;
          };
          const alg = { name: "ECDSA", namedCurve: "P-256" };
          const pair = {
            privateKey: await crypto.subtle.importKey("jwk", jwk.private, alg, false, ["sign"]),
            publicKey: await crypto.subtle.importKey("jwk", jwk.public, alg, true, ["verify"]),
          };
          dpop = oidc.getDPoPHandle(config, pair);
        }
        const tokens = await oidc.authorizationCodeGrant(
          config,
          current,
          {
            pkceCodeVerifier: await secretBox.decrypt(SECRET_PURPOSES.oidcTransaction, tx.codeVerifierEnc),
            expectedState: query.state as string,
            expectedNonce: tx.nonce,
            idTokenExpected: true,
          },
          undefined,
          dpop ? { DPoP: dpop } : undefined,
        );
        const idClaims = tokens.claims();
        if (!idClaims) throw new Error("no id token");
        claims = idClaims;
      } catch (err) {
        const detail = await oauthErrorDetail(err);
        c.var.logger.warn("OIDC token validation failed", { err, ...detail, provider: provider.id });
        return fail(c, provider, "token_validation_failed", tx.purpose, detail);
      }

      // Provider restrictions.
      if (provider.kind === "google" && provider.allowedDomains.length) {
        const hd = typeof claims.hd === "string" ? claims.hd.toLowerCase() : null;
        if (!hd || !provider.allowedDomains.includes(hd)) return fail(c, provider, "hd_mismatch", tx.purpose, { hd });
      }
      if (provider.kind === "entra" && claims.tid !== provider.tenantId) {
        return fail(c, provider, "tid_mismatch", tx.purpose, {
          tid: typeof claims.tid === "string" ? claims.tid : null,
        });
      }

      if (tx.purpose === "test") {
        await db.update(ssoProviders).set({ lastTestOkAt: now }).where(eq(ssoProviders.id, provider.id));
        await recordAudit(db, deps, auditContext(c, provider.orgId), {
          action: "sso.test_succeeded",
          targetType: "sso_provider",
          targetId: provider.id,
        });
        return c.redirect(`/settings/security?test=ok&provider=${provider.id}`, 302);
      }

      const subject = provider.kind === "singpass" ? singpassSubject(claims.sub) : claims.sub;
      const issuer = claims.iss;
      const preset = PRESETS[provider.kind];
      const email = typeof claims.email === "string" ? normaliseEmail(claims.email) : null;
      // Entra: a matching tid does not make `email` verified; only `xms_edov` does (see mfa.ts).
      const emailVerified =
        provider.kind === "entra" ? !!email && entraEmailVerified(claims) : claims.email_verified === true;
      const idpMfa = idpAssertsMfa(claims);
      /** "New sign-in method linked" email (finding 1): the member learns about every link. */
      const notifyLinked = async (userId: string) => {
        await sendSecurityNotice(db, deps, {
          orgId: provider.orgId,
          to: { userId },
          title: "A new sign-in method was linked",
          body: `${provider.displayName} was linked to your Crow HR account as a way to sign in. If this wasn't you, sign in, choose "Sign out everywhere" in My sessions (this also removes linked sign-in methods), change your password and tell your administrator.`,
        });
      };

      const [existing] = await db
        .select()
        .from(userIdentities)
        .where(
          and(
            eq(userIdentities.issuer, issuer),
            eq(userIdentities.subject, subject),
            eq(userIdentities.orgId, provider.orgId),
          ),
        );

      if (tx.purpose === "link") {
        if (existing && existing.userId !== tx.linkUserId) return fail(c, provider, "already_linked", "link");
        if (!existing && tx.linkUserId) {
          const linkUserId = tx.linkUserId;
          await db.transaction(async (dbtx) => {
            await dbtx.insert(userIdentities).values({
              id: deps.ids.newId(),
              orgId: provider.orgId,
              userId: linkUserId,
              providerId: provider.id,
              issuer,
              subject,
              emailAtLink: email,
              linkedAt: now,
              lastUsedAt: now,
            });
            await recordAudit(dbtx, deps, auditContext(c, provider.orgId), {
              action: "sso.identity_linked",
              targetType: "user",
              targetId: linkUserId,
              meta: { providerId: provider.id, via: "profile" },
            });
          });
          await notifyLinked(tx.linkUserId);
        }
        return c.redirect("/me/sessions?link=ok", 302);
      }

      // Resolve the membership (spec "SSO identity linking").
      let userId: string | null = existing?.userId ?? null;
      let identityId: string | null = existing?.id ?? null;
      let linkedVia: string | null = null;
      let acceptInvitationId: string | null = null;

      if (!userId && tx.invitationId) {
        const [invite] = await db
          .select({ invite: invitations, m: memberships })
          .from(invitations)
          .innerJoin(
            memberships,
            and(eq(memberships.id, invitations.membershipId), eq(memberships.orgId, invitations.orgId)),
          )
          .where(
            and(
              eq(invitations.id, tx.invitationId),
              isNull(invitations.acceptedAt),
              isNull(invitations.revokedAt),
              gt(invitations.expiresAt, now),
            ),
          );
        if (invite?.m.status !== "invited") return fail(c, provider, "invitation_invalid", tx.purpose);
        userId = invite.m.userId;
        linkedVia = "invitation";
        acceptInvitationId = invite.invite.id;
      }
      if (!userId && preset.emailLinking && email) {
        if (!emailVerified) return fail(c, provider, "email_not_verified", tx.purpose);
        const [match] = await db
          .select({ u: users, m: memberships })
          .from(users)
          .innerJoin(memberships, and(eq(memberships.userId, users.id), eq(memberships.orgId, provider.orgId)))
          .where(eq(users.email, email));
        if (match && (match.m.status === "active" || match.m.status === "invited")) {
          userId = match.u.id;
          linkedVia = "verified_email";
        }
      }
      if (!userId && preset.jitAllowed && provider.jitEnabled && email && emailVerified) {
        const domain = email.split("@")[1] ?? "";
        if (provider.allowedDomains.includes(domain)) {
          const [u] = await db.select().from(users).where(eq(users.email, email));
          userId = u?.id ?? deps.ids.newId();
          if (!u)
            await db.insert(users).values({
              id: userId,
              email,
              displayName: typeof claims.name === "string" ? claims.name.slice(0, 120) : (email.split("@")[0] ?? email),
              emailVerifiedAt: now,
            });
          const membershipId = deps.ids.newId();
          await db.insert(memberships).values({ id: membershipId, orgId: provider.orgId, userId, status: "active" });
          await recordAudit(db, deps, auditContext(c, provider.orgId), {
            action: "member.jit_provisioned",
            targetType: "membership",
            targetId: membershipId,
            meta: { email, providerId: provider.id },
          });
          // Spec "JIT provisioning": HR is told to link the new member to an employee record or remove them.
          await sendSecurityNotice(db, deps, {
            orgId: provider.orgId,
            to: { hrAdmins: true },
            title: "A new member joined through single sign-on",
            body: `${email} signed in with ${provider.displayName} and was added as a member automatically (sign-up for allowed domains is on). Link them to an employee record, or remove them, in Settings → Members.`,
            link: "/settings/members",
            actionLabel: "Open Members",
          });
          linkedVia = "jit";
        }
      }
      if (!userId) return fail(c, provider, "not_provisioned", tx.purpose, { email });

      const [membership] = await db
        .select()
        .from(memberships)
        .where(and(eq(memberships.orgId, provider.orgId), eq(memberships.userId, userId)));
      if (!membership) return fail(c, provider, "not_provisioned", tx.purpose);
      if (membership.status === "invited") acceptInvitationId ??= "pending";
      else if (membership.status !== "active" && membership.status !== "former")
        return fail(c, provider, "membership_inactive", tx.purpose);

      if (acceptInvitationId) {
        await db.update(memberships).set({ status: "active", updatedAt: now }).where(eq(memberships.id, membership.id));
        await db
          .update(invitations)
          .set({ acceptedAt: now })
          .where(
            and(
              eq(invitations.membershipId, membership.id),
              eq(invitations.orgId, provider.orgId),
              isNull(invitations.acceptedAt),
              isNull(invitations.revokedAt),
            ),
          );
        await recordAudit(db, deps, auditContext(c, provider.orgId), {
          action: "member.invitation_accepted",
          targetType: "membership",
          targetId: membership.id,
          meta: { method: provider.kind },
        });
      }
      if (!identityId) {
        const newIdentityId = deps.ids.newId();
        identityId = newIdentityId;
        const linkedUserId = userId;
        await db.transaction(async (dbtx) => {
          await dbtx.insert(userIdentities).values({
            id: newIdentityId,
            orgId: provider.orgId,
            userId: linkedUserId,
            providerId: provider.id,
            issuer,
            subject,
            emailAtLink: email,
            linkedAt: now,
            lastUsedAt: now,
          });
          await recordAudit(dbtx, deps, auditContext(c, provider.orgId), {
            action: "sso.identity_linked",
            targetType: "membership",
            targetId: membership.id,
            meta: { providerId: provider.id, via: linkedVia },
          });
        });
        await notifyLinked(userId);
      } else {
        await db.update(userIdentities).set({ lastUsedAt: now }).where(eq(userIdentities.id, identityId));
      }

      const authMethod = AUTH_METHOD[provider.kind];
      // Finding 1: an SSO sign-in is never a way around the member's Crow HR TOTP. Unless the IdP
      // asserted MFA, a member who enrolled TOTP finishes on the sign-in page with their code.
      const [account] = await db.select({ mfaEnrolledAt: users.mfaEnrolledAt }).from(users).where(eq(users.id, userId));
      if (account?.mfaEnrolledAt && !idpMfa) {
        const challenge = await createMfaChallenge(deps, {
          orgId: provider.orgId,
          userId,
          membershipId: membership.id,
          authMethod,
          identityId,
          nativeRequestId: tx.nativeRequestId,
        });
        setMfaCookie(c, challenge.token);
        await recordAudit(db, deps, auditContext(c, provider.orgId), {
          action: "auth.sso_mfa_required",
          targetType: "membership",
          targetId: membership.id,
          meta: { providerId: provider.id },
        });
        return c.redirect(`/sign-in/${await orgSlug(c, provider.orgId)}?mfa=1`, 302);
      }
      if (tx.nativeRequestId) {
        const redirect = await completeNativeSignIn(c, {
          requestId: tx.nativeRequestId,
          orgId: provider.orgId,
          userId,
          membershipId: membership.id,
          authMethod,
          mfaSatisfied: idpMfa,
        });
        await recordAudit(db, deps, auditContext(c, provider.orgId), {
          action: "auth.signed_in",
          targetType: "membership",
          targetId: membership.id,
          meta: { method: provider.kind, providerId: provider.id, client: "native" },
        });
        return c.redirect(redirect, 302);
      }
      await noticeNewBrowserSignIn(c, { orgId: provider.orgId, userId, membershipId: membership.id, authMethod });
      await startBrowserSession(c, {
        userId,
        orgId: provider.orgId,
        membershipId: membership.id,
        authMethod,
        identityId,
        mfaSatisfied: idpMfa,
      });
      await rememberDevice(c, userId);
      await recordAudit(db, deps, auditContext(c, provider.orgId), {
        action: "auth.signed_in",
        targetType: "membership",
        targetId: membership.id,
        meta: { method: provider.kind, providerId: provider.id },
      });
      return c.redirect("/", 302);
    },
  }),

  defineRoute({
    method: "get",
    path: "/oidc/:providerId/jwks.json",
    summary: "Relying-party public keys for a provider (Singpass)",
    access: "public",
    request: { params: z.object({ providerId: z.uuid() }) },
    responses: { 200: z.object({ keys: z.array(z.looseObject({ kty: z.string(), kid: z.string().optional() })) }) },
    errors: ["not_found"],
    handler: async ({ c, params }) => {
      const provider = await loadProvider(c, params.providerId);
      const jwks = provider?.publicJwks as { keys: Record<string, unknown>[] } | null | undefined;
      if (!jwks) throw new AppError("not_found", "This provider has no relying-party keys.");
      c.header("cache-control", "public, max-age=300");
      // Defence in depth: never emit private members even if a bad row slipped in.
      return {
        keys: jwks.keys.map(
          ({ d: _d, p: _p, q: _q, dp: _dp, dq: _dq, qi: _qi, k: _k, ...pub }) => pub as { kty: string; kid?: string },
        ),
      };
    },
  }),
];
