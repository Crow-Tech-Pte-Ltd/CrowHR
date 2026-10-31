import { and, eq, gt, inArray, isNull, ne, type SQL } from "drizzle-orm";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { createMiddleware } from "hono/factory";
import type { AssignedRole } from "../access/matrix.ts";
import { clientIp } from "../audit/audit.ts";
import type { AppContext, AppEnv, AuthContext, AuthMethod } from "../context.ts";
import { newToken, sha256Hex } from "../crypto/tokens.ts";
import { membershipRoles, memberships } from "../db/schema/access.ts";
import { deviceSessions, sessions, userIdentities } from "../db/schema/auth.ts";
import { users } from "../db/schema/users.ts";
import type { Db } from "../db/types.ts";
import { AppError } from "../errors.ts";
import { HOUR, loadSecuritySettings, MINUTE, sessionCookie } from "./settings.ts";

/**
 * Database-backed sessions (auth spec "Sessions", design decisions 2–3).
 * The cookie holds a 256-bit random token; the database stores only sha256(token).
 * `authenticate()` resolves the cookie or a native bearer token into `c.var.auth` on every request.
 */

const LAST_SEEN_WRITE_INTERVAL = 60_000;

export interface NewSessionInput {
  userId: string;
  orgId: string;
  membershipId: string;
  authMethod: AuthMethod;
  identityId?: string | null;
  mfaSatisfied: boolean;
}

/**
 * Creates a session row and sets the cookie. Always a fresh token: this is the rotation on
 * sign-in, MFA completion and organisation change (prevents session fixation). Any session the
 * request arrived with is revoked.
 */
export async function startBrowserSession(c: AppContext, input: NewSessionInput): Promise<{ id: string }> {
  const { db, clock, publicUrl } = c.var.deps;
  const now = clock.now();
  const settings = await loadSecuritySettings(db, input.orgId);
  const token = newToken();
  const id = await sha256Hex(token);
  const previous = getCookie(c, sessionCookie(publicUrl).name);
  if (previous) await revokeSessionById(db, await sha256Hex(previous), "rotated", now);
  await db.insert(sessions).values({
    id,
    orgId: input.orgId,
    userId: input.userId,
    membershipId: input.membershipId,
    authMethod: input.authMethod,
    identityId: input.identityId ?? null,
    createdAt: now,
    lastSeenAt: now,
    authenticatedAt: now,
    absoluteExpiresAt: new Date(now.getTime() + settings.absoluteTimeoutH * HOUR),
    ip: clientIp(c),
    userAgent: c.req.header("user-agent")?.slice(0, 400) ?? null,
    mfaSatisfied: input.mfaSatisfied,
  });
  setSessionCookie(c, token, settings.absoluteTimeoutH * 3600);
  return { id };
}

export function setSessionCookie(c: AppContext, token: string, maxAgeSeconds: number) {
  const { name, secure } = sessionCookie(c.var.deps.publicUrl);
  setCookie(c, name, token, {
    httpOnly: true,
    secure,
    sameSite: "Lax",
    path: "/",
    maxAge: maxAgeSeconds,
  });
}

export function clearSessionCookie(c: AppContext) {
  const { name, secure } = sessionCookie(c.var.deps.publicUrl);
  deleteCookie(c, name, { path: "/", secure });
}

export async function revokeSessionById(db: Db, id: string, reason: string, now: Date) {
  await db
    .update(sessions)
    .set({ revokedAt: now, revokedReason: reason })
    .where(and(eq(sessions.id, id), isNull(sessions.revokedAt)));
}

/**
 * Revokes a user's browser sessions (and device sessions unless `browserOnly`), optionally only
 * in one organisation and optionally keeping the current one. Returns the number revoked.
 */
export async function revokeUserSessions(
  db: Db,
  input: { userId: string; orgId?: string; exceptSessionId?: string; reason: string; now: Date; browserOnly?: boolean },
): Promise<number> {
  const conds: SQL[] = [eq(sessions.userId, input.userId), isNull(sessions.revokedAt)];
  if (input.orgId) conds.push(eq(sessions.orgId, input.orgId));
  if (input.exceptSessionId) conds.push(ne(sessions.id, input.exceptSessionId));
  const revoked = await db
    .update(sessions)
    .set({ revokedAt: input.now, revokedReason: input.reason })
    .where(and(...conds))
    .returning({ id: sessions.id });
  let count = revoked.length;
  if (!input.browserOnly) {
    const dconds: SQL[] = [eq(deviceSessions.userId, input.userId), isNull(deviceSessions.revokedAt)];
    if (input.orgId) dconds.push(eq(deviceSessions.orgId, input.orgId));
    // Device session ids are UUIDs; browser session ids are hashes and never match a device.
    if (input.exceptSessionId && /^[0-9a-f-]{36}$/i.test(input.exceptSessionId)) {
      dconds.push(ne(deviceSessions.id, input.exceptSessionId));
    }
    const d = await db
      .update(deviceSessions)
      .set({ revokedAt: input.now, revokedReason: input.reason })
      .where(and(...dconds))
      .returning({ id: deviceSessions.id });
    count += d.length;
  }
  return count;
}

/** Loads the member behind a session; null when the membership cannot sign in. */
export async function loadMember(
  db: Db,
  membershipId: string,
): Promise<{
  user: AuthContext["user"];
  orgId: string;
  status: "invited" | "active" | "suspended" | "former";
  employeeId: string | null;
  roles: AssignedRole[];
} | null> {
  const [row] = await db
    .select({
      orgId: memberships.orgId,
      status: memberships.status,
      employeeId: memberships.employeeId,
      userId: users.id,
      email: users.email,
      displayName: users.displayName,
    })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(eq(memberships.id, membershipId));
  if (!row) return null;
  const roles = await db
    .select({ role: membershipRoles.role })
    .from(membershipRoles)
    .where(and(eq(membershipRoles.membershipId, membershipId), eq(membershipRoles.orgId, row.orgId)));
  return {
    user: { id: row.userId, email: row.email, displayName: row.displayName },
    orgId: row.orgId,
    status: row.status,
    employeeId: row.employeeId,
    // Former members hold no roles even if a stale row survived.
    roles: row.status === "former" ? [] : roles.map((r) => r.role),
  };
}

async function identityInfo(db: Db, identityId: string | null): Promise<AuthContext["identity"]> {
  if (!identityId) return null;
  const [row] = await db.select().from(userIdentities).where(eq(userIdentities.id, identityId));
  return row ? { providerId: row.providerId, issuer: row.issuer, subject: row.subject } : null;
}

function bearerToken(c: AppContext): string | null {
  const header = c.req.header("authorization");
  if (!header) return null;
  const match = /^Bearer\s+([A-Za-z0-9._~+/-]+=*)$/i.exec(header.trim());
  return match ? (match[1] as string) : null;
}

/**
 * Resolves the caller. Order: reject cookie + bearer together; bearer → device session;
 * cookie → browser session. Expired or revoked credentials leave `auth` null and record the
 * reason in `authFailure`, so public routes still work and protected ones answer with the
 * specific 401 code. Query-string tokens are never read.
 */
export function authenticate() {
  return createMiddleware<AppEnv>(async (c, next) => {
    const { db, clock, publicUrl } = c.var.deps;
    const cookie = getCookie(c, sessionCookie(publicUrl).name);
    const bearer = bearerToken(c);
    if (cookie && bearer) {
      throw new AppError(
        "ambiguous_credentials",
        "Send either a session cookie or a bearer token, not both. Native apps must not send browser cookies.",
      );
    }
    const now = clock.now();
    if (bearer) await resolveBearer(c, db, bearer, now);
    else if (cookie) await resolveCookie(c, db, cookie, now);
    await next();
  });
}

async function resolveCookie(c: AppContext, db: Db, token: string, now: Date) {
  const id = await sha256Hex(token);
  const [session] = await db.select().from(sessions).where(eq(sessions.id, id));
  if (!session) return;
  if (session.revokedAt) {
    c.set("authFailure", "session_revoked");
    return;
  }
  const settings = await loadSecuritySettings(db, session.orgId);
  const idleDeadline = session.lastSeenAt.getTime() + settings.idleTimeoutMin * MINUTE;
  if (now.getTime() >= idleDeadline || now.getTime() >= session.absoluteExpiresAt.getTime()) {
    await revokeSessionById(db, id, "expired", now);
    c.set("authFailure", "session_expired");
    return;
  }
  const member = await loadMember(db, session.membershipId);
  if (!member || (member.status !== "active" && member.status !== "former")) {
    await revokeSessionById(db, id, "membership_inactive", now);
    c.set("authFailure", "session_revoked");
    return;
  }
  if (now.getTime() - session.lastSeenAt.getTime() >= LAST_SEEN_WRITE_INTERVAL) {
    await db.update(sessions).set({ lastSeenAt: now }).where(eq(sessions.id, id));
  }
  c.set("auth", {
    user: member.user,
    orgId: member.orgId,
    membershipId: session.membershipId,
    membershipStatus: member.status,
    employeeId: member.employeeId,
    roles: member.roles,
    authMethod: session.authMethod as AuthMethod,
    identity: await identityInfo(db, session.identityId),
    session: {
      id,
      kind: "browser",
      authenticatedAt: session.authenticatedAt,
      mfaSatisfied: session.mfaSatisfied,
    },
  });
}

async function resolveBearer(c: AppContext, db: Db, token: string, now: Date) {
  const hash = await sha256Hex(token);
  const [device] = await db.select().from(deviceSessions).where(eq(deviceSessions.accessHash, hash));
  if (!device) return;
  if (device.revokedAt) {
    c.set("authFailure", "session_revoked");
    return;
  }
  if (now >= device.accessExpiresAt || now >= device.absoluteExpiresAt || now >= device.idleExpiresAt) {
    c.set("authFailure", "session_expired");
    return;
  }
  const member = await loadMember(db, device.membershipId);
  if (member?.status !== "active") {
    await db
      .update(deviceSessions)
      .set({ revokedAt: now, revokedReason: "membership_inactive" })
      .where(eq(deviceSessions.id, device.id));
    c.set("authFailure", "session_revoked");
    return;
  }
  if (now.getTime() - device.lastUsedAt.getTime() >= LAST_SEEN_WRITE_INTERVAL) {
    await db
      .update(deviceSessions)
      .set({ lastUsedAt: now, lastIp: clientIp(c) })
      .where(eq(deviceSessions.id, device.id));
  }
  c.set("auth", {
    user: member.user,
    orgId: member.orgId,
    membershipId: device.membershipId,
    membershipStatus: "active",
    employeeId: member.employeeId,
    roles: member.roles,
    authMethod: device.authMethod as AuthMethod,
    identity: null,
    session: { id: device.id, kind: "device", authenticatedAt: device.authenticatedAt, mfaSatisfied: true },
  });
}

/** Active (not revoked, not expired) browser sessions of a user in one organisation. */
export async function activeBrowserSessions(db: Db, userId: string, orgId: string, now: Date) {
  const settings = await loadSecuritySettings(db, orgId);
  const idleCutoff = new Date(now.getTime() - settings.idleTimeoutMin * MINUTE);
  return db
    .select()
    .from(sessions)
    .where(
      and(
        eq(sessions.userId, userId),
        eq(sessions.orgId, orgId),
        isNull(sessions.revokedAt),
        gt(sessions.absoluteExpiresAt, now),
        gt(sessions.lastSeenAt, idleCutoff),
      ),
    );
}

export async function activeDeviceSessions(db: Db, userId: string, orgId: string, now: Date) {
  return db
    .select()
    .from(deviceSessions)
    .where(
      and(
        eq(deviceSessions.userId, userId),
        eq(deviceSessions.orgId, orgId),
        isNull(deviceSessions.revokedAt),
        gt(deviceSessions.absoluteExpiresAt, now),
        gt(deviceSessions.idleExpiresAt, now),
      ),
    );
}

/** Revokes every session and device of the given memberships (suspension, former). */
export async function revokeMembershipSessions(db: Db, membershipIds: string[], reason: string, now: Date) {
  if (!membershipIds.length) return;
  await db
    .update(sessions)
    .set({ revokedAt: now, revokedReason: reason })
    .where(and(inArray(sessions.membershipId, membershipIds), isNull(sessions.revokedAt)));
  await db
    .update(deviceSessions)
    .set({ revokedAt: now, revokedReason: reason })
    .where(and(inArray(deviceSessions.membershipId, membershipIds), isNull(deviceSessions.revokedAt)));
}
