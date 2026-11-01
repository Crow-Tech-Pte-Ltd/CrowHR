import { and, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { auditContext, clientIp, recordAudit } from "../../audit/audit.ts";
import type { AppContext, AuthMethod } from "../../context.ts";
import { newToken, sha256Base64Url, sha256Hex } from "../../crypto/tokens.ts";
import { deviceSessions, nativeAuthRequests } from "../../db/schema/auth.ts";
import { AppError } from "../../errors.ts";
import { defineModule, defineRoute } from "../../http/route.ts";
import { audit, findOrgBySlug } from "../credentials.ts";
import { mfaPolicyStatus } from "../mfa-policy.ts";
import { loadMember } from "../sessions.ts";
import { DAY, loadSecuritySettings, MINUTE } from "../settings.ts";
import { DEFAULT_NATIVE_REDIRECT_URIS, NATIVE_REQUEST_TTL_MS } from "./complete.ts";

export const ACCESS_TOKEN_TTL_MS = 15 * MINUTE;
export const DEVICE_ABSOLUTE_TTL_MS = 90 * DAY;
const PREVIOUS_REFRESH_KEPT = 10;

function errorPage(title: string, body: string): Response {
  const html = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><body style="font-family:system-ui,sans-serif;max-width:32rem;margin:4rem auto;padding:0 1rem;color:#141414"><h1 style="font-size:1.25rem">${title}</h1><p>${body}</p></body></html>`;
  return new Response(html, {
    status: 400,
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
  });
}

const invalidGrant = (message: string) => new AppError("invalid_grant", message);

const tokenResponse = z.object({
  accessToken: z.string(),
  tokenType: z.literal("Bearer"),
  expiresIn: z.number().int(),
  refreshToken: z.string(),
  deviceSessionId: z.uuid(),
});

async function issueTokens(
  c: AppContext,
  deviceId: string | null,
  base: {
    orgId: string;
    userId: string;
    membershipId: string;
    authMethod: string;
    platform: "ios" | "android";
    deviceName: string;
    appVersion: string | null;
    authenticatedAt: Date;
    mfaSatisfied: boolean;
  },
) {
  const { db, clock, ids } = c.var.deps;
  const now = clock.now();
  const settings = await loadSecuritySettings(db, base.orgId);
  const access = newToken();
  const refresh = newToken();
  const id = deviceId ?? ids.newId();
  await db.insert(deviceSessions).values({
    id,
    orgId: base.orgId,
    userId: base.userId,
    membershipId: base.membershipId,
    authMethod: base.authMethod,
    platform: base.platform,
    deviceName: base.deviceName,
    appVersion: base.appVersion,
    accessHash: await sha256Hex(access),
    accessExpiresAt: new Date(now.getTime() + ACCESS_TOKEN_TTL_MS),
    refreshFamilyId: ids.newId(),
    currentRefreshHash: await sha256Hex(refresh),
    createdAt: now,
    lastUsedAt: now,
    lastIp: clientIp(c),
    idleExpiresAt: new Date(now.getTime() + settings.deviceIdleDays * DAY),
    absoluteExpiresAt: new Date(now.getTime() + DEVICE_ABSOLUTE_TTL_MS),
    authenticatedAt: base.authenticatedAt,
    mfaSatisfied: base.mfaSatisfied,
  });
  return {
    accessToken: access,
    tokenType: "Bearer" as const,
    expiresIn: ACCESS_TOKEN_TTL_MS / 1000,
    refreshToken: refresh,
    deviceSessionId: id,
  };
}

const tokenBody = z.discriminatedUnion("grantType", [
  z.object({
    grantType: z.literal("authorization_code"),
    code: z.string().min(1).max(200),
    codeVerifier: z
      .string()
      .regex(/^[A-Za-z0-9._~-]{43,128}$/, "Send the PKCE code_verifier (43–128 unreserved characters)."),
    deviceName: z.string().trim().min(1).max(60, "Device names are at most 60 characters."),
    appVersion: z.string().trim().max(40).optional(),
  }),
  z.object({ grantType: z.literal("refresh_token"), refreshToken: z.string().min(1).max(200) }),
]);

export const nativeModule = defineModule({
  name: "native",
  basePath: "/native",
  tag: "Native apps",
  routes: [
    defineRoute({
      method: "get",
      path: "/authorize",
      summary: "Start a native-app sign-in (system browser, PKCE S256)",
      access: "public",
      request: {
        query: z.object({
          org: z.string().min(1),
          client: z.enum(["ios", "android"]),
          redirect_uri: z.string().min(1),
          code_challenge: z
            .string()
            .regex(/^[A-Za-z0-9_-]{43}$/, "Send an S256 PKCE code_challenge (43 base64url characters)."),
          code_challenge_method: z.literal("S256", { error: "Only code_challenge_method=S256 is supported." }),
          state: z.string().min(8).max(200),
        }),
      },
      responses: {
        302: { description: "Redirect to the organisation's sign-in page." },
        400: {
          description: "Error page (unregistered redirect URI or unknown organisation).",
          contentType: "text/html",
        },
      },
      handler: async ({ c, deps, query }) => {
        const allowed = deps.nativeRedirectUris ?? DEFAULT_NATIVE_REDIRECT_URIS;
        if (!allowed.includes(query.redirect_uri)) {
          return errorPage(
            "This app can't sign in here",
            "The sign-in request came from an app this server doesn't recognise, so it was stopped. Use the official Crow HR app.",
          );
        }
        const org = await findOrgBySlug(deps.db, query.org);
        if (!org?.slug)
          return errorPage(
            "Organisation not found",
            "Check the server address and organisation in the app and try again.",
          );
        const now = deps.clock.now();
        const id = deps.ids.newId();
        await deps.db.insert(nativeAuthRequests).values({
          id,
          orgId: org.id,
          client: query.client,
          redirectUri: query.redirect_uri,
          codeChallenge: query.code_challenge,
          state: query.state,
          expiresAt: new Date(now.getTime() + NATIVE_REQUEST_TTL_MS),
          createdAt: now,
        });
        return c.redirect(`/sign-in/${org.slug}?native=${id}`, 302);
      },
    }),

    defineRoute({
      method: "post",
      path: "/token",
      summary: "Exchange an authorisation code, or rotate a refresh token",
      access: "public",
      request: { body: tokenBody },
      responses: { 200: tokenResponse },
      errors: ["invalid_grant", "mfa_enrolment_required"],
      handler: async ({ c, deps, body }) => {
        const { db, clock } = deps;
        const now = clock.now();
        if (body.grantType === "authorization_code") {
          const codeHash = await sha256Hex(body.code);
          const [request] = await db.select().from(nativeAuthRequests).where(eq(nativeAuthRequests.codeHash, codeHash));
          if (!request?.userId || !request.membershipId)
            throw invalidGrant("This sign-in code is not valid. Sign in again from the app.");
          if (request.usedAt) {
            // Replay (RFC 6749 §4.1.2): revoke whatever the first exchange created.
            if (request.deviceSessionId) {
              await db
                .update(deviceSessions)
                .set({ revokedAt: now, revokedReason: "code_replayed" })
                .where(eq(deviceSessions.id, request.deviceSessionId));
            }
            await recordAudit(db, deps, auditContext(c, request.orgId), {
              action: "auth.native_code_replayed",
              targetType: "membership",
              targetId: request.membershipId,
            });
            throw invalidGrant("This sign-in code was already used. Sign in again from the app.");
          }
          const claimed = await db
            .update(nativeAuthRequests)
            .set({ usedAt: now })
            .where(and(eq(nativeAuthRequests.id, request.id), isNull(nativeAuthRequests.usedAt)))
            .returning();
          if (!claimed.length) throw invalidGrant("This sign-in code was already used. Sign in again from the app.");
          if (!request.codeExpiresAt || request.codeExpiresAt <= now)
            throw invalidGrant("This sign-in code has expired (codes last 60 seconds). Sign in again.");
          if ((await sha256Base64Url(body.codeVerifier)) !== request.codeChallenge)
            throw invalidGrant("The PKCE verifier does not match. Sign in again from the app.");
          const member = await loadMember(db, request.membershipId);
          if (member?.status !== "active") throw invalidGrant("This account can't sign in to the app.");
          const authMethod = (request.authMethod ?? "password") as AuthMethod;
          // Security review finding 11: the MFA enrolment policy applies to the app as well.
          const policy = await mfaPolicyStatus(
            db,
            {
              user: member.user,
              orgId: request.orgId,
              membershipId: request.membershipId,
              roles: member.roles,
              authMethod,
              session: { mfaSatisfied: request.mfaSatisfied },
            },
            await loadSecuritySettings(db, request.orgId),
            now,
          );
          if (policy.blocked) {
            throw new AppError(
              "mfa_enrolment_required",
              "Your role requires two-step verification. Set up an authenticator app in Crow HR on the web, then sign in to the app again.",
            );
          }
          const tokens = await issueTokens(c, null, {
            orgId: request.orgId,
            userId: request.userId,
            membershipId: request.membershipId,
            authMethod,
            platform: request.client,
            deviceName: body.deviceName,
            appVersion: body.appVersion ?? null,
            authenticatedAt: now,
            mfaSatisfied: request.mfaSatisfied,
          });
          await db
            .update(nativeAuthRequests)
            .set({ deviceSessionId: tokens.deviceSessionId })
            .where(eq(nativeAuthRequests.id, request.id));
          await recordAudit(db, deps, auditContext(c, request.orgId), {
            action: "auth.device_session_created",
            targetType: "device_session",
            targetId: tokens.deviceSessionId,
            meta: { platform: request.client, deviceName: body.deviceName },
          });
          return tokens;
        }

        const hash = await sha256Hex(body.refreshToken);
        /** Refresh-token reuse (RFC 9700 §4.14.2): the whole device session is revoked. */
        const reuseDetected = async (reused: typeof deviceSessions.$inferSelect) => {
          await db.transaction(async (tx) => {
            await tx
              .update(deviceSessions)
              .set({ revokedAt: now, revokedReason: "refresh_reuse" })
              .where(eq(deviceSessions.id, reused.id));
            await recordAudit(
              tx,
              deps,
              { ...auditContext(c, reused.orgId), actorType: "system", actorLabel: "token service" },
              {
                action: "auth.refresh_reuse_detected",
                targetType: "device_session",
                targetId: reused.id,
                meta: { deviceName: reused.deviceName, membershipId: reused.membershipId },
              },
            );
          });
          return invalidGrant("This session has ended. Sign in again.");
        };
        const [device] = await db.select().from(deviceSessions).where(eq(deviceSessions.currentRefreshHash, hash));
        if (!device) {
          const [reused] = await db
            .select()
            .from(deviceSessions)
            .where(sql`${hash} = any(${deviceSessions.previousRefreshHashes})`);
          if (reused) throw await reuseDetected(reused);
          throw invalidGrant("This session has ended. Sign in again.");
        }
        if (device.revokedAt || device.absoluteExpiresAt <= now || device.idleExpiresAt <= now) {
          throw invalidGrant("This session has ended. Sign in again.");
        }
        const member = await loadMember(db, device.membershipId);
        if (member?.status !== "active") {
          await db
            .update(deviceSessions)
            .set({ revokedAt: now, revokedReason: "membership_inactive" })
            .where(eq(deviceSessions.id, device.id));
          throw invalidGrant("This account can no longer use the app.");
        }
        const settings = await loadSecuritySettings(db, device.orgId);
        const access = newToken();
        const refresh = newToken();
        // Compare-and-set (security review finding 23): only the request that still holds the
        // current refresh token rotates it. A concurrent use of the same token updates nothing
        // and is treated as reuse.
        const rotated = await db
          .update(deviceSessions)
          .set({
            accessHash: await sha256Hex(access),
            accessExpiresAt: new Date(now.getTime() + ACCESS_TOKEN_TTL_MS),
            currentRefreshHash: await sha256Hex(refresh),
            // Safe to compute from the row read above: the compare-and-set below only matches
            // while the current hash (and so this list) is unchanged.
            previousRefreshHashes: [hash, ...device.previousRefreshHashes].slice(0, PREVIOUS_REFRESH_KEPT),
            idleExpiresAt: new Date(
              Math.min(now.getTime() + settings.deviceIdleDays * DAY, device.absoluteExpiresAt.getTime()),
            ),
            lastUsedAt: now,
            lastIp: clientIp(c),
          })
          .where(
            and(
              eq(deviceSessions.id, device.id),
              eq(deviceSessions.currentRefreshHash, hash),
              isNull(deviceSessions.revokedAt),
            ),
          )
          .returning({ id: deviceSessions.id });
        if (!rotated.length) throw await reuseDetected(device);
        return {
          accessToken: access,
          tokenType: "Bearer" as const,
          expiresIn: ACCESS_TOKEN_TTL_MS / 1000,
          refreshToken: refresh,
          deviceSessionId: device.id,
        };
      },
    }),

    defineRoute({
      method: "post",
      path: "/revoke",
      summary: "Sign this device out",
      access: "authenticated",
      allowDuringMfaEnrolment: true,
      responses: { 204: null },
      handler: async ({ c, deps, auth }) => {
        if (auth.session.kind !== "device")
          throw new AppError("forbidden", "Only native-app sessions can be revoked here. Use sign out in the browser.");
        await deps.db
          .update(deviceSessions)
          .set({ revokedAt: deps.clock.now(), revokedReason: "signed_out" })
          .where(eq(deviceSessions.id, auth.session.id));
        await audit(c, {
          action: "auth.session_revoked",
          targetType: "device_session",
          targetId: auth.session.id,
          meta: { by: "self" },
        });
        return undefined;
      },
    }),
  ],
});
