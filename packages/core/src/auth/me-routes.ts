import { and, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import { MATRIX, type Permission, ROLES, type Role, type Scope } from "../access/matrix.ts";
import { effectiveRoles } from "../access/scope.ts";
import { auditContext, recordAudit } from "../audit/audit.ts";
import type { AppContext } from "../context.ts";
import { SECRET_PURPOSES } from "../crypto/secret-box.ts";
import { memberships } from "../db/schema/access.ts";
import { deviceSessions, recoveryCodes, sessions, ssoProviders, userIdentities } from "../db/schema/auth.ts";
import { employees } from "../db/schema/employees.ts";
import { organisations } from "../db/schema/organisations.ts";
import { users } from "../db/schema/users.ts";
import { AppError } from "../errors.ts";
import { defineModule, defineRoute } from "../http/route.ts";
import { audit, regenerateRecoveryCodes, remainingRecoveryCodes, verifyPasswordOrDummy } from "./credentials.ts";
import { mfaPolicyStatus } from "./mfa-policy.ts";
import { passwordProblem } from "./password-policy.ts";
import { sendSecurityNotice, sgDateTimePhrase } from "./security-notices.ts";
import {
  activeBrowserSessions,
  activeDeviceSessions,
  removeLinkedIdentities,
  revokeUserSessions,
  startBrowserSession,
} from "./sessions.ts";
import { sessionCookie, settingsFor } from "./settings.ts";
import { newTotpSecret, otpauthUri, verifyTotp } from "./totp.ts";

/** "Chrome on macOS" from a user agent; good enough for a session list. */
export function describeUserAgent(ua: string | null): string {
  if (!ua) return "Unknown device";
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /Firefox\//.test(ua)
      ? "Firefox"
      : /Chrome\//.test(ua)
        ? "Chrome"
        : /Safari\//.test(ua)
          ? "Safari"
          : "Browser";
  const os = /iPhone|iPad/.test(ua)
    ? "iOS"
    : /Android/.test(ua)
      ? "Android"
      : /Mac OS X/.test(ua)
        ? "macOS"
        : /Windows/.test(ua)
          ? "Windows"
          : /Linux/.test(ua)
            ? "Linux"
            : "unknown OS";
  return `${browser} on ${os}`;
}

export const sessionItem = z.object({
  id: z.string(),
  kind: z.enum(["browser", "mobile"]),
  device: z.string(),
  ip: z.string().nullable(),
  createdAt: z.iso.datetime(),
  lastActiveAt: z.iso.datetime(),
  current: z.boolean(),
  authMethod: z.string(),
  appVersion: z.string().nullable().optional(),
});

export async function listSessionsFor(c: AppContext, userId: string, orgId: string, currentId: string | null) {
  const { db, clock } = c.var.deps;
  const now = clock.now();
  const browser = await activeBrowserSessions(db, userId, orgId, now);
  const devices = await activeDeviceSessions(db, userId, orgId, now);
  return [
    ...browser.map((s) => ({
      id: s.id,
      kind: "browser" as const,
      device: describeUserAgent(s.userAgent),
      ip: s.ip,
      createdAt: s.createdAt.toISOString(),
      lastActiveAt: s.lastSeenAt.toISOString(),
      current: s.id === currentId,
      authMethod: s.authMethod,
    })),
    ...devices.map((d) => ({
      id: d.id,
      kind: "mobile" as const,
      device: `${d.deviceName} (${d.platform === "ios" ? "iOS" : "Android"})`,
      ip: d.lastIp,
      createdAt: d.createdAt.toISOString(),
      lastActiveAt: d.lastUsedAt.toISOString(),
      current: d.id === currentId,
      authMethod: d.authMethod,
      appVersion: d.appVersion,
    })),
  ].sort((a, b) => (a.lastActiveAt < b.lastActiveAt ? 1 : -1));
}

/** Revokes one browser or device session belonging to `userId` in `orgId`. False when not found. */
export async function revokeOneSession(c: AppContext, userId: string, orgId: string, id: string): Promise<boolean> {
  const { db, clock } = c.var.deps;
  const now = clock.now();
  const b = await db
    .update(sessions)
    .set({ revokedAt: now, revokedReason: "revoked" })
    .where(and(eq(sessions.id, id), eq(sessions.userId, userId), eq(sessions.orgId, orgId), isNull(sessions.revokedAt)))
    .returning({ id: sessions.id });
  if (b.length) return true;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return false;
  const d = await db
    .update(deviceSessions)
    .set({ revokedAt: now, revokedReason: "revoked" })
    .where(
      and(
        eq(deviceSessions.id, id),
        eq(deviceSessions.userId, userId),
        eq(deviceSessions.orgId, orgId),
        isNull(deviceSessions.revokedAt),
      ),
    )
    .returning({ id: deviceSessions.id });
  return d.length > 0;
}

const permissionScopes = z.record(z.string(), z.array(z.enum(["all", "team", "own", "assigned"])));

const meResponse = z.object({
  user: z.object({
    id: z.uuid(),
    email: z.string(),
    displayName: z.string(),
    /** The linked employee's preferred name (what they go by); null when unset or not an employee. */
    preferredName: z.string().nullable(),
    /** The linked employee's full legal name, else the member's display name. Greet with `preferredName ?? fullName`. */
    fullName: z.string(),
  }),
  organisation: z.object({ id: z.uuid(), name: z.string(), slug: z.string().nullable() }),
  membershipId: z.uuid(),
  membershipStatus: z.enum(["active", "former"]),
  employeeId: z.uuid().nullable(),
  roles: z.array(z.enum(["owner", "hr_admin", "payroll_admin", "manager", "employee"])),
  /** Effective permissions for hiding UI. Cosmetic: the server checks every request. */
  permissions: permissionScopes,
  authMethod: z.string(),
  session: z.object({ kind: z.enum(["browser", "device"]), authenticatedAt: z.iso.datetime() }),
  mfa: z.object({
    enrolled: z.boolean(),
    required: z.boolean(),
    graceEndsAt: z.iso.datetime().nullable(),
    blocked: z.boolean(),
    remainingRecoveryCodes: z.number().int(),
  }),
  hasPassword: z.boolean(),
  /** Session cookies over plain http (owners see a warning in Settings → Security). */
  insecureTransport: z.boolean(),
  demoMode: z.boolean(),
  /** Set in a demo company (demo-companies): fictional data, deleted with everything at `expiresAt`. */
  demoCompany: z.object({ expiresAt: z.iso.datetime() }).nullable(),
  mailerConfigured: z.boolean(),
  /** The server's PUBLIC_URL (no trailing slash): what the mobile apps connect to. */
  publicUrl: z.string(),
});

async function permissionsFor(_c: AppContext, roles: ReadonlySet<Role>, former: boolean) {
  const out: Record<string, Scope[]> = {};
  for (const permission of Object.keys(MATRIX) as Permission[]) {
    if (former) {
      if (permission === "payslips:read" || permission === "documents:read") out[permission] = ["own"];
      continue;
    }
    const cells: Partial<Record<Role, Scope>> = MATRIX[permission].cells;
    const scopes = new Set<Scope>();
    for (const role of ROLES) if (roles.has(role) && cells[role]) scopes.add(cells[role] as Scope);
    if (scopes.size) out[permission] = [...scopes];
  }
  return out;
}

export const meModule = defineModule({
  name: "me",
  basePath: "/me",
  tag: "Me",
  routes: [
    defineRoute({
      method: "get",
      path: "/",
      summary: "The signed-in member, their roles and effective permissions",
      access: "authenticated",
      allowDuringMfaEnrolment: true,
      responses: { 200: meResponse },
      handler: async ({ c, deps, auth }) => {
        const { db, clock, publicUrl } = deps;
        const [org] = await db.select().from(organisations).where(eq(organisations.id, auth.orgId));
        const [user] = await db.select().from(users).where(eq(users.id, auth.user.id));
        const roles = await effectiveRoles(c);
        const mfa = await mfaPolicyStatus(db, auth, await settingsFor(c, auth.orgId), clock.now());
        const [emp] = auth.employeeId
          ? await db
              .select({ legalName: employees.legalName, preferredName: employees.preferredName })
              .from(employees)
              .where(and(eq(employees.orgId, auth.orgId), eq(employees.id, auth.employeeId)))
          : [];
        return {
          user: {
            ...auth.user,
            preferredName: emp?.preferredName?.trim() || null,
            fullName: emp?.legalName || auth.user.displayName,
          },
          organisation: { id: auth.orgId, name: org?.name ?? "", slug: org?.slug ?? null },
          membershipId: auth.membershipId,
          membershipStatus: auth.membershipStatus,
          employeeId: auth.employeeId,
          roles: [...roles],
          permissions: await permissionsFor(c, roles, auth.membershipStatus === "former"),
          authMethod: auth.authMethod,
          session: { kind: auth.session.kind, authenticatedAt: auth.session.authenticatedAt.toISOString() },
          mfa: {
            enrolled: mfa.enrolled,
            required: mfa.required,
            graceEndsAt: mfa.graceEndsAt?.toISOString() ?? null,
            blocked: mfa.blocked,
            remainingRecoveryCodes: mfa.enrolled ? await remainingRecoveryCodes(db, auth.user.id) : 0,
          },
          hasPassword: !!user?.passwordHash,
          insecureTransport: !sessionCookie(publicUrl).secure,
          demoMode: !!deps.demoMode,
          demoCompany: auth.demoCompany ? { expiresAt: auth.demoCompany.expiresAt.toISOString() } : null,
          mailerConfigured: !!deps.mailer,
          publicUrl: publicUrl.replace(/\/+$/, ""),
        };
      },
    }),

    defineRoute({
      method: "get",
      path: "/sessions",
      summary: "My browser and mobile sessions",
      access: "authenticated",
      responses: { 200: z.object({ items: z.array(sessionItem) }) },
      handler: async ({ c, auth }) => ({ items: await listSessionsFor(c, auth.user.id, auth.orgId, auth.session.id) }),
    }),

    defineRoute({
      method: "delete",
      path: "/sessions/:id",
      summary: "Sign out one of my sessions",
      access: "authenticated",
      request: { params: z.object({ id: z.string().min(1).max(100) }) },
      responses: { 204: null },
      errors: ["not_found"],
      handler: async ({ c, auth, params }) => {
        if (!(await revokeOneSession(c, auth.user.id, auth.orgId, params.id))) {
          throw new AppError("not_found", "That session doesn't exist or has already ended.");
        }
        await audit(c, {
          action: "auth.session_revoked",
          targetType: "session",
          targetId: params.id.slice(0, 12),
          meta: { by: "self" },
        });
        return undefined;
      },
    }),

    defineRoute({
      method: "post",
      path: "/sessions/revoke-others",
      summary: "Sign out everywhere except here",
      description:
        "Also unlinks every SSO sign-in method of this organisation including the one this session signed in with (`unlinked` counts them).",
      access: "authenticated",
      responses: { 200: z.object({ revoked: z.number().int(), unlinked: z.number().int() }) },
      handler: async ({ c, deps, auth }) => {
        return deps.db.transaction(async (tx) => {
          const revoked = await revokeUserSessions(tx, {
            userId: auth.user.id,
            orgId: auth.orgId,
            exceptSessionId: auth.session.id,
            reason: "revoked_others",
            now: deps.clock.now(),
          });
          const unlinked = await removeLinkedIdentities(tx, {
            userId: auth.user.id,
            orgId: auth.orgId,
          });
          await recordAudit(tx, deps, auditContext(c), {
            action: "auth.session_revoked",
            targetType: "membership",
            targetId: auth.membershipId,
            meta: { by: "self", scope: "others", count: revoked, unlinkedIdentities: unlinked },
          });
          return { revoked, unlinked };
        });
      },
    }),

    defineRoute({
      method: "post",
      path: "/password",
      summary: "Change my password",
      access: "authenticated",
      refusedInDemoCompany: true,
      allowDuringMfaEnrolment: true,
      recentAuth: true,
      request: {
        body: z.object({
          currentPassword: z.string().max(1024).optional(),
          newPassword: z.string().max(1024),
        }),
      },
      responses: { 204: null },
      errors: ["invalid_credentials"],
      handler: async ({ c, deps, auth, body }) => {
        const { db, clock, passwordHasher } = deps;
        const [user] = await db.select().from(users).where(eq(users.id, auth.user.id));
        if (user?.passwordHash) {
          const ok = await verifyPasswordOrDummy(passwordHasher, user.passwordHash, body.currentPassword ?? "");
          if (!ok) throw new AppError("invalid_credentials", "Your current password is not correct.");
        }
        const problem = passwordProblem(body.newPassword, auth.user.email);
        if (problem) {
          throw new AppError("validation_failed", "Some fields need attention.", {
            target: "json",
            issues: [{ path: "newPassword", message: problem }],
          });
        }
        const now = clock.now();
        await db
          .update(users)
          .set({ passwordHash: await passwordHasher.hash(body.newPassword), passwordChangedAt: now, updatedAt: now })
          .where(eq(users.id, auth.user.id));
        // Every other session and device of this user, in every organisation.
        await revokeUserSessions(db, {
          userId: auth.user.id,
          exceptSessionId: auth.session.id,
          reason: "password_changed",
          now,
        });
        await audit(c, { action: "auth.password_changed", targetType: "user", targetId: auth.user.id });
        await sendSecurityNotice(db, deps, {
          orgId: auth.orgId,
          to: { membershipIds: [auth.membershipId] },
          title: "Your Crow HR password was changed",
          body: `Your password was changed on ${sgDateTimePhrase(now)}, and every other browser and device was signed out. If this wasn't you, reset your password from the sign-in page now and tell your administrator.`,
        });
        return undefined;
      },
    }),

    defineRoute({
      method: "post",
      path: "/mfa/totp/setup",
      summary: "Start authenticator-app enrolment",
      description: "Returns a new secret and otpauth URI. Enrolment completes only after a valid code is confirmed.",
      access: "authenticated",
      refusedInDemoCompany: true,
      allowDuringMfaEnrolment: true,
      responses: { 200: z.object({ secret: z.string(), otpauthUri: z.string() }) },
      errors: ["conflict"],
      handler: async ({ deps, auth }) => {
        const { db, secretBox } = deps;
        const [user] = await db.select().from(users).where(eq(users.id, auth.user.id));
        if (user?.mfaEnrolledAt)
          throw new AppError(
            "conflict",
            "Two-step verification is already set up. Turn it off first to set up a new authenticator.",
          );
        const [org] = await db.select().from(organisations).where(eq(organisations.id, auth.orgId));
        const secret = newTotpSecret();
        await db
          .update(users)
          .set({ mfaPendingSecretEnc: await secretBox.encrypt(SECRET_PURPOSES.totp, secret) })
          .where(eq(users.id, auth.user.id));
        return { secret, otpauthUri: otpauthUri(secret, auth.user.email, `Crow HR (${org?.name ?? "Crow HR"})`) };
      },
    }),

    defineRoute({
      method: "post",
      path: "/mfa/totp/confirm",
      summary: "Finish enrolment with a code from the authenticator app",
      description: "Returns 10 single-use recovery codes, shown once.",
      access: "authenticated",
      refusedInDemoCompany: true,
      allowDuringMfaEnrolment: true,
      request: {
        body: z.object({
          code: z
            .string()
            .trim()
            .regex(/^\d{6}$/, "Enter the 6-digit code shown in your authenticator app."),
        }),
      },
      responses: { 200: z.object({ recoveryCodes: z.array(z.string()) }) },
      errors: ["invalid_mfa_code", "conflict"],
      handler: async ({ c, deps, auth, body }) => {
        const { db, secretBox, clock } = deps;
        const [user] = await db.select().from(users).where(eq(users.id, auth.user.id));
        if (!user?.mfaPendingSecretEnc)
          throw new AppError("conflict", "Start setup again: there is no authenticator waiting to be confirmed.");
        const secret = await secretBox.decrypt(SECRET_PURPOSES.totp, user.mfaPendingSecretEnc);
        const step = await verifyTotp(secret, body.code, clock.now(), null);
        if (step === null)
          throw new AppError(
            "invalid_mfa_code",
            "That code didn't match. Check the time on your phone is correct and enter the current code.",
          );
        const now = clock.now();
        const codes = await db.transaction(async (tx) => {
          await tx
            .update(users)
            .set({
              mfaTotpSecretEnc: user.mfaPendingSecretEnc,
              mfaPendingSecretEnc: null,
              mfaEnrolledAt: now,
              mfaLastStep: step,
              updatedAt: now,
            })
            .where(eq(users.id, auth.user.id));
          return regenerateRecoveryCodes(deps, tx, auth.user.id);
        });
        await audit(c, {
          action: "auth.mfa_enrolled",
          targetType: "user",
          targetId: auth.user.id,
          meta: { method: "totp" },
        });
        await sendSecurityNotice(db, deps, {
          orgId: auth.orgId,
          to: { membershipIds: [auth.membershipId] },
          title: "Two-step verification was turned on",
          body: "An authenticator app was set up for your Crow HR account; sign-ins now ask for its code. Keep your recovery codes somewhere safe. If this wasn't you, tell your administrator now.",
        });
        // MFA completion rotates the session token.
        if (auth.session.kind === "browser") {
          await startBrowserSession(c, {
            userId: auth.user.id,
            orgId: auth.orgId,
            membershipId: auth.membershipId,
            authMethod: auth.authMethod,
            // Retain the SSO identity associated with this rotated session.
            identityId:
              (await db.select({ id: sessions.identityId }).from(sessions).where(eq(sessions.id, auth.session.id)))[0]
                ?.id ?? null,
            mfaSatisfied: true,
          });
        }
        return { recoveryCodes: codes };
      },
    }),

    defineRoute({
      method: "post",
      path: "/mfa/recovery-codes",
      summary: "Replace my recovery codes",
      description: "Invalidates every previous recovery code.",
      access: "authenticated",
      refusedInDemoCompany: true,
      recentAuth: true,
      responses: { 200: z.object({ recoveryCodes: z.array(z.string()) }) },
      errors: ["conflict"],
      handler: async ({ c, deps, auth }) => {
        const [user] = await deps.db.select().from(users).where(eq(users.id, auth.user.id));
        if (!user?.mfaEnrolledAt) throw new AppError("conflict", "Set up two-step verification first.");
        const codes = await regenerateRecoveryCodes(deps, deps.db, auth.user.id);
        await audit(c, { action: "auth.recovery_codes_regenerated", targetType: "user", targetId: auth.user.id });
        return { recoveryCodes: codes };
      },
    }),

    defineRoute({
      method: "delete",
      path: "/mfa",
      summary: "Turn off two-step verification",
      access: "authenticated",
      refusedInDemoCompany: true,
      recentAuth: true,
      responses: { 204: null },
      handler: async ({ c, deps, auth }) => {
        await clearMfa(c, auth.user.id);
        await audit(c, {
          action: "auth.mfa_disabled",
          targetType: "user",
          targetId: auth.user.id,
          meta: { by: "self" },
        });
        await sendSecurityNotice(deps.db, deps, {
          orgId: auth.orgId,
          to: { membershipIds: [auth.membershipId] },
          title: "Two-step verification was turned off",
          body: "Two-step verification was turned off for your Crow HR account, so sign-ins no longer ask for a code. If this wasn't you, change your password, set it up again and tell your administrator.",
        });
        return undefined;
      },
    }),

    defineRoute({
      method: "get",
      path: "/identities",
      summary: "My linked sign-in identities",
      access: "authenticated",
      responses: {
        200: z.object({
          items: z.array(
            z.object({
              id: z.uuid(),
              providerId: z.uuid(),
              providerName: z.string(),
              kind: z.string(),
              linkedAt: z.iso.datetime(),
              lastUsedAt: z.iso.datetime().nullable(),
            }),
          ),
        }),
      },
      handler: async ({ deps, auth }) => {
        const rows = await deps.db
          .select({ identity: userIdentities, provider: ssoProviders })
          .from(userIdentities)
          .innerJoin(
            ssoProviders,
            and(eq(ssoProviders.id, userIdentities.providerId), eq(ssoProviders.orgId, userIdentities.orgId)),
          )
          .where(and(eq(userIdentities.userId, auth.user.id), eq(userIdentities.orgId, auth.orgId)));
        return {
          items: rows.map(({ identity, provider }) => ({
            id: identity.id,
            providerId: provider.id,
            providerName: provider.displayName,
            kind: provider.kind,
            linkedAt: identity.linkedAt.toISOString(),
            lastUsedAt: identity.lastUsedAt?.toISOString() ?? null,
          })),
        };
      },
    }),

    defineRoute({
      method: "delete",
      path: "/identities/:id",
      summary: "Unlink a sign-in identity",
      description: "Refused when it is the only remaining way to sign in.",
      access: "authenticated",
      recentAuth: true,
      request: { params: z.object({ id: z.uuid() }) },
      responses: { 204: null },
      errors: ["not_found", "conflict"],
      handler: async ({ c, deps, auth, params }) => {
        const { db } = deps;
        const mine = await db
          .select()
          .from(userIdentities)
          .where(and(eq(userIdentities.userId, auth.user.id), eq(userIdentities.orgId, auth.orgId)));
        const target = mine.find((i) => i.id === params.id);
        if (!target) throw new AppError("not_found", "That identity isn't linked to your account.");
        const [user] = await db.select().from(users).where(eq(users.id, auth.user.id));
        const settings = await settingsFor(c, auth.orgId);
        const isOwner = auth.roles.includes("owner");
        const passwordUsable = !!user?.passwordHash && (settings.passwordEnabled || isOwner);
        if (mine.length === 1 && !passwordUsable) {
          throw new AppError(
            "conflict",
            "This is your only way to sign in. Link another method or set a password before unlinking it.",
          );
        }
        await db.delete(userIdentities).where(eq(userIdentities.id, target.id));
        await audit(c, {
          action: "sso.identity_unlinked",
          targetType: "user",
          targetId: auth.user.id,
          meta: { providerId: target.providerId },
        });
        const [provider] = await db
          .select({ name: ssoProviders.displayName })
          .from(ssoProviders)
          .where(and(eq(ssoProviders.orgId, auth.orgId), eq(ssoProviders.id, target.providerId)));
        await sendSecurityNotice(db, deps, {
          orgId: auth.orgId,
          to: { membershipIds: [auth.membershipId] },
          title: "A sign-in method was unlinked",
          body: `${provider?.name ?? "A single sign-on method"} can no longer be used to sign in to your Crow HR account. If this wasn't you, change your password and tell your administrator.`,
        });
        return undefined;
      },
    }),
    defineRoute({
      method: "get",
      path: "/organisations",
      summary: "Organisations I can switch to (for the organisation switcher)",
      description:
        "Organisations where the signed-in person has an active or former membership, by name, the current one marked. Switch with `POST /auth/switch-organisation`.",
      access: "authenticated",
      allowDuringMfaEnrolment: true,
      responses: {
        200: z.object({
          items: z.array(
            z.object({
              id: z.uuid(),
              name: z.string(),
              slug: z.string(),
              current: z.boolean(),
              status: z.enum(["active", "former"]),
            }),
          ),
        }),
      },
      handler: async ({ deps, auth }) => {
        const rows = await deps.db
          .select({
            id: organisations.id,
            name: organisations.name,
            slug: organisations.slug,
            status: memberships.status,
          })
          .from(memberships)
          .innerJoin(organisations, eq(organisations.id, memberships.orgId))
          .where(and(eq(memberships.userId, auth.user.id), inArray(memberships.status, ["active", "former"])));
        return {
          items: rows
            .filter((r): r is typeof r & { slug: string } => r.slug !== null)
            .map((r) => ({
              id: r.id,
              name: r.name,
              slug: r.slug,
              current: r.id === auth.orgId,
              status: r.status as "active" | "former",
            }))
            .sort((a, b) => a.name.localeCompare(b.name) || a.slug.localeCompare(b.slug)),
        };
      },
    }),
  ],
});

/** Removes TOTP and recovery codes for a user (self-service or an owner's reset). */
export async function clearMfa(c: AppContext, userId: string) {
  const { db, clock } = c.var.deps;
  await db.transaction(async (tx) => {
    await tx
      .update(users)
      .set({
        mfaTotpSecretEnc: null,
        mfaPendingSecretEnc: null,
        mfaEnrolledAt: null,
        mfaLastStep: null,
        updatedAt: clock.now(),
      })
      .where(eq(users.id, userId));
    await tx.delete(recoveryCodes).where(eq(recoveryCodes.userId, userId));
  });
}
