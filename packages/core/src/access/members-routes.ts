import { and, asc, desc, eq, ilike, inArray, isNull, ne, or, type SQL, sql } from "drizzle-orm";
import { z } from "zod";
import { type AuditContext, auditContext, recordAudit } from "../audit/audit.ts";
import { audit, emailInput } from "../auth/credentials.ts";
import { clearMfa, listSessionsFor, revokeOneSession, sessionItem } from "../auth/me-routes.ts";
import { sendSecurityNotice } from "../auth/security-notices.ts";
import { removeLinkedIdentities, revokeMembershipSessions, revokeUserSessions } from "../auth/sessions.ts";
import { accountLockedUntil, clearAccountThrottle } from "../auth/throttle.ts";
import type { AppContext, AuthContext } from "../context.ts";
import { newToken, sha256Hex } from "../crypto/tokens.ts";
import { invitations, membershipRoles, memberships } from "../db/schema/access.ts";
import { passwordResets, sessions } from "../db/schema/auth.ts";
import { employees } from "../db/schema/employees.ts";
import { users } from "../db/schema/users.ts";
import type { Db } from "../db/types.ts";
import type { AppDeps } from "../deps.ts";
import { AppError } from "../errors.ts";
import { csvEnum, listQuery, pageOf, toLimitOffset } from "../http/list.ts";
import { defineModule, defineRoute } from "../http/route.ts";
import { retireInactiveApprovers, retireRevokedRoleTasks } from "../workflows/engine.ts";
import { deliverInvitation, inviteMember, issueInvitation } from "./invitations.ts";
import { ASSIGNED_ROLES, type AssignedRole } from "./matrix.ts";
import { orgScope } from "./org-scope.ts";

export { INVITATION_TTL_MS } from "./invitations.ts";
export const RESET_TTL_MS = 60 * 60_000;

const assignedRole = z.enum(["owner", "hr_admin", "payroll_admin"]);

const member = z.object({
  id: z.uuid(),
  userId: z.uuid(),
  email: z.string(),
  displayName: z.string(),
  /** The linked employee's preferred name, if any (what they go by). */
  preferredName: z.string().nullable(),
  status: z.enum(["invited", "active", "suspended", "former"]),
  roles: z.array(assignedRole),
  employeeId: z.uuid().nullable(),
  mfaEnrolled: z.boolean(),
  lockedUntil: z.iso.datetime().nullable(),
  lastActiveAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
  invitation: z.object({ id: z.uuid(), expiresAt: z.iso.datetime(), expired: z.boolean() }).nullable(),
});

type MemberOut = z.input<typeof member>;

async function loadMembers(
  c: AppContext,
  orgId: string,
  where: SQL | undefined,
  paging?: { limit: number; offset: number; order: SQL[] },
) {
  const { db, clock } = c.var.deps;
  const base = db
    .select({ m: memberships, u: users })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(and(eq(memberships.orgId, orgId), where))
    .$dynamic();
  const rows = paging
    ? await base
        .orderBy(...paging.order)
        .limit(paging.limit)
        .offset(paging.offset)
    : await base;
  if (!rows.length) return [];
  const ids = rows.map((r) => r.m.id);
  const roles = await db
    .select()
    .from(membershipRoles)
    .where(and(eq(membershipRoles.orgId, orgId), inArray(membershipRoles.membershipId, ids)));
  const invites = await db
    .select()
    .from(invitations)
    .where(
      and(
        eq(invitations.orgId, orgId),
        inArray(invitations.membershipId, ids),
        isNull(invitations.acceptedAt),
        isNull(invitations.revokedAt),
      ),
    );
  const lastSeen = await db
    .select({ membershipId: sessions.membershipId, at: sql<string>`max(${sessions.lastSeenAt})` })
    .from(sessions)
    .where(and(eq(sessions.orgId, orgId), inArray(sessions.membershipId, ids)))
    .groupBy(sessions.membershipId);
  const employeeIds = rows.flatMap((r) => (r.m.employeeId ? [r.m.employeeId] : []));
  const preferred = new Map(
    (employeeIds.length
      ? await db
          .select({ id: employees.id, preferredName: employees.preferredName })
          .from(employees)
          .where(and(eq(employees.orgId, orgId), inArray(employees.id, employeeIds)))
      : []
    ).map((e) => [e.id, e.preferredName?.trim() || null]),
  );
  const now = clock.now();
  const out: MemberOut[] = [];
  for (const { m, u } of rows) {
    const invite = invites
      .filter((i) => i.membershipId === m.id)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
    const locked = await accountLockedUntil(db, u.id, now);
    const seen = lastSeen.find((s) => s.membershipId === m.id)?.at;
    out.push({
      id: m.id,
      userId: u.id,
      email: u.email,
      displayName: u.displayName,
      preferredName: m.employeeId ? (preferred.get(m.employeeId) ?? null) : null,
      status: m.status,
      roles: roles.filter((r) => r.membershipId === m.id).map((r) => r.role),
      employeeId: m.employeeId,
      mfaEnrolled: !!u.mfaEnrolledAt,
      lockedUntil: locked?.toISOString() ?? null,
      lastActiveAt: seen ? new Date(seen).toISOString() : null,
      createdAt: m.createdAt.toISOString(),
      invitation:
        m.status === "invited" && invite
          ? { id: invite.id, expiresAt: invite.expiresAt.toISOString(), expired: invite.expiresAt <= now }
          : null,
    });
  }
  return out;
}

async function getMember(c: AppContext, orgId: string, id: string): Promise<MemberOut> {
  const [found] = /^[0-9a-f-]{36}$/i.test(id) ? await loadMembers(c, orgId, eq(memberships.id, id)) : [];
  if (!found) throw new AppError("not_found", "That member doesn't exist or you can't see them.");
  return found;
}

/**
 * hr_admins manage members with no assigned roles only; touching an owner or admin would let
 * them escalate (e.g. resetting an owner's password). Owners manage everyone.
 */
function assertCanManage(auth: AuthContext, target: MemberOut) {
  if (auth.roles.includes("owner")) return;
  if (target.roles.length > 0) {
    throw new AppError(
      "forbidden",
      "Only an owner can change members who hold the owner, HR admin or payroll admin role.",
    );
  }
}

async function activeOwnerCount(
  db: Db,
  orgId: string,
  excludingMembershipId?: string | readonly string[],
): Promise<number> {
  const rows = await db
    .select({ id: memberships.id })
    .from(membershipRoles)
    .innerJoin(
      memberships,
      and(eq(memberships.id, membershipRoles.membershipId), eq(memberships.orgId, membershipRoles.orgId)),
    )
    .where(and(eq(membershipRoles.orgId, orgId), eq(membershipRoles.role, "owner"), eq(memberships.status, "active")));
  const excluded = new Set(
    typeof excludingMembershipId === "string" ? [excludingMembershipId] : (excludingMembershipId ?? []),
  );
  return rows.filter((r) => !excluded.has(r.id)).length;
}

const LAST_OWNER_MESSAGE = "An organisation needs at least one active owner. Make someone else an owner first.";

const invitationResult = z.object({
  member,
  /** Present only when email is not configured: show it once with a copy button. */
  inviteUrl: z.string().nullable(),
  expiresAt: z.iso.datetime(),
});

/**
 * Termination hook for the people module (access-control "Membership suspension and former
 * employees"): drops every assigned role and makes linked memberships `former`, revoking their
 * sessions and devices. Refuses with 409 `last_owner` when it would remove the last owner.
 */
export async function markMembershipFormer(
  deps: AppDeps,
  db: Db,
  ctx: AuditContext,
  input: { orgId: string; employeeId: string },
): Promise<string[]> {
  const linked = await db
    .select()
    .from(memberships)
    .where(
      and(
        eq(memberships.orgId, input.orgId),
        eq(memberships.employeeId, input.employeeId),
        inArray(memberships.status, ["active", "invited", "suspended"]),
      ),
    );
  for (const m of linked) {
    const roles = await db
      .select()
      .from(membershipRoles)
      .where(and(eq(membershipRoles.orgId, input.orgId), eq(membershipRoles.membershipId, m.id)));
    if (
      roles.some((r) => r.role === "owner") &&
      m.status === "active" &&
      (await activeOwnerCount(
        db,
        input.orgId,
        linked.map((member) => member.id),
      )) === 0
    ) {
      throw new AppError("last_owner", `${LAST_OWNER_MESSAGE} The termination can't take effect until then.`);
    }
  }
  const now = deps.clock.now();
  for (const m of linked) {
    await db
      .delete(membershipRoles)
      .where(and(eq(membershipRoles.orgId, input.orgId), eq(membershipRoles.membershipId, m.id)));
    await db.update(memberships).set({ status: "former", updatedAt: now }).where(eq(memberships.id, m.id));
    await recordAudit(db, deps, ctx, {
      action: "member.became_former",
      targetType: "membership",
      targetId: m.id,
      meta: { employeeId: input.employeeId },
    });
  }
  await revokeMembershipSessions(
    db,
    linked.map((m) => m.id),
    "former",
    now,
  );
  const ids = linked.map((m) => m.id);
  await retireInactiveApprovers(db, deps, ctx, { orgId: input.orgId, membershipIds: ids });
  return ids;
}

const idParams = z.object({ id: z.uuid() });

export const membersModule = defineModule({
  name: "members",
  basePath: "/members",
  tag: "Members and roles",
  routes: [
    defineRoute({
      method: "get",
      path: "/",
      summary: "List members",
      access: { permission: "members:read" },
      request: {
        query: listQuery({
          sort: ["displayName", "email", "createdAt"],
          defaultSort: "displayName",
          search: true,
          filters: {
            status: csvEnum(["invited", "active", "suspended", "former"]),
            role: csvEnum(["owner", "hr_admin", "payroll_admin"]),
          },
        }),
      },
      responses: { 200: pageOf(member) },
      handler: async ({ c, deps, auth, query }) => {
        const conds: (SQL | undefined)[] = [];
        if (query.q) conds.push(or(ilike(users.email, `%${query.q}%`), ilike(users.displayName, `%${query.q}%`)));
        if (query.status) conds.push(inArray(memberships.status, query.status));
        if (query.role) {
          conds.push(
            inArray(
              memberships.id,
              deps.db
                .select({ id: membershipRoles.membershipId })
                .from(membershipRoles)
                .where(and(eq(membershipRoles.orgId, auth.orgId), inArray(membershipRoles.role, query.role))),
            ),
          );
        }
        const where = and(...conds);
        const [count] = await deps.db
          .select({ n: sql<number>`count(*)::int` })
          .from(memberships)
          .innerJoin(users, eq(users.id, memberships.userId))
          .where(and(eq(memberships.orgId, auth.orgId), where));
        const field = query.sort.replace(/^-/, "");
        const col = field === "email" ? users.email : field === "createdAt" ? memberships.createdAt : users.displayName;
        const dir = query.sort.startsWith("-") ? desc : asc;
        const items = await loadMembers(c, auth.orgId, where, {
          ...toLimitOffset(query),
          order: [dir(col), asc(memberships.id)],
        });
        return { items, page: query.page, pageSize: query.pageSize, total: count?.n ?? 0 };
      },
    }),

    defineRoute({
      method: "get",
      path: "/:id",
      summary: "Get a member",
      access: { permission: "members:read" },
      request: { params: idParams },
      responses: { 200: member },
      errors: ["not_found"],
      handler: ({ c, auth, params }) => getMember(c, auth.orgId, params.id),
    }),

    defineRoute({
      method: "post",
      path: "/invitations",
      summary: "Invite someone by email",
      description:
        "hr_admins may only invite members with no assigned roles, and may not link the invitation to a manager's employee record. An employee record that already has a (non-former) sign-in is refused with 409. Without email configured, the response carries a link to copy.",
      access: { permission: "members:create" },
      request: {
        body: z.object({
          email: emailInput(),
          displayName: z.string().trim().min(1, "Enter the person's name.").max(120),
          roles: z.array(assignedRole).max(3).default([]),
          employeeId: z.uuid().optional(),
        }),
      },
      responses: { 201: invitationResult },
      errors: ["conflict", "not_found"],
      handler: async ({ c, deps, auth, body }) => {
        const roles = [...new Set(body.roles)] as AssignedRole[];
        const isOwner = auth.roles.includes("owner");
        if (roles.length && !isOwner) {
          throw new AppError(
            "forbidden",
            "Only an owner can invite someone with a role. Invite them without a role, then ask an owner.",
          );
        }
        const result = await inviteMember(deps, auditContext(c), {
          orgId: auth.orgId,
          email: body.email,
          displayName: body.displayName,
          roles,
          employeeId: body.employeeId ?? null,
          invitedBy: auth.membershipId,
        });
        return {
          member: await getMember(c, auth.orgId, result.membershipId),
          inviteUrl: result.inviteUrl,
          expiresAt: result.expiresAt.toISOString(),
        };
      },
    }),

    defineRoute({
      method: "post",
      path: "/:id/invitation/resend",
      summary: "Resend an invitation (replaces the link)",
      access: { permission: "members:create" },
      request: { params: idParams },
      responses: { 200: invitationResult },
      errors: ["not_found", "conflict"],
      handler: async ({ c, deps, auth, params }) => {
        const target = await getMember(c, auth.orgId, params.id);
        assertCanManage(auth, target);
        if (target.status !== "invited")
          throw new AppError("conflict", "This person has already accepted their invitation.");
        const invite = await issueInvitation(deps, deps.db, {
          orgId: auth.orgId,
          membershipId: target.id,
          email: target.email,
          invitedBy: auth.membershipId,
        });
        await audit(c, { action: "member.invitation_resent", targetType: "membership", targetId: target.id });
        const url = await deliverInvitation(deps, { orgId: auth.orgId, email: target.email, token: invite.token });
        return {
          member: await getMember(c, auth.orgId, target.id),
          inviteUrl: url,
          expiresAt: invite.expiresAt.toISOString(),
        };
      },
    }),

    defineRoute({
      method: "delete",
      path: "/:id/invitation",
      summary: "Revoke an invitation",
      access: { permission: "members:create" },
      request: { params: idParams },
      responses: { 204: null },
      errors: ["not_found", "conflict"],
      handler: async ({ c, deps, auth, params }) => {
        const target = await getMember(c, auth.orgId, params.id);
        assertCanManage(auth, target);
        if (target.status !== "invited")
          throw new AppError("conflict", "Only pending invitations can be revoked. Suspend the member instead.");
        await deps.db
          .update(invitations)
          .set({ revokedAt: deps.clock.now() })
          .where(
            and(
              eq(invitations.orgId, auth.orgId),
              eq(invitations.membershipId, target.id),
              isNull(invitations.acceptedAt),
              isNull(invitations.revokedAt),
            ),
          );
        await audit(c, { action: "member.invitation_revoked", targetType: "membership", targetId: target.id });
        return undefined;
      },
    }),

    defineRoute({
      method: "put",
      path: "/:id/roles",
      summary: "Set a member's assigned roles",
      description:
        "Owner only. Takes effect on the member's next request. The last active owner cannot lose the owner role.",
      access: { permission: "member_roles:grant" },
      recentAuth: true,
      request: { params: idParams, body: z.object({ roles: z.array(assignedRole).max(3) }) },
      example: { body: { roles: ["hr_admin", "payroll_admin"] } },
      responses: { 200: member },
      errors: ["not_found", "last_owner"],
      handler: async ({ c, deps, auth, params, body }) => {
        const { db, clock } = deps;
        const target = await getMember(c, auth.orgId, params.id);
        const next = ASSIGNED_ROLES.filter((r) => body.roles.includes(r));
        const added = next.filter((r) => !target.roles.includes(r));
        const removed = target.roles.filter((r) => !next.includes(r));
        if (
          removed.includes("owner") &&
          target.status === "active" &&
          (await activeOwnerCount(db, auth.orgId, target.id)) === 0
        ) {
          throw new AppError("last_owner", LAST_OWNER_MESSAGE);
        }
        await db.transaction(async (tx) => {
          if (removed.length) {
            await tx
              .delete(membershipRoles)
              .where(
                and(
                  eq(membershipRoles.orgId, auth.orgId),
                  eq(membershipRoles.membershipId, target.id),
                  inArray(membershipRoles.role, removed),
                ),
              );
          }
          for (const role of added) {
            await tx.insert(membershipRoles).values({
              orgId: auth.orgId,
              membershipId: target.id,
              role,
              grantedBy: auth.membershipId,
              grantedAt: clock.now(),
            });
          }
          for (const role of added)
            await recordAudit(tx, deps, auditContext(c), {
              action: "member.role_granted",
              targetType: "membership",
              targetId: target.id,
              meta: { role },
            });
          for (const role of removed)
            await recordAudit(tx, deps, auditContext(c), {
              action: "member.role_revoked",
              targetType: "membership",
              targetId: target.id,
              meta: { role },
            });
          // Open tasks only a removed role could decide move to whoever may decide them now.
          await retireRevokedRoleTasks(tx, deps, auditContext(c), {
            orgId: auth.orgId,
            membershipId: target.id,
            roles: removed,
          });
        });
        return getMember(c, auth.orgId, target.id);
      },
    }),

    defineRoute({
      method: "post",
      path: "/:id/suspend",
      summary: "Suspend a member",
      description: "Revokes their sessions and devices and refuses sign-in.",
      access: { permission: "members:update" },
      request: { params: idParams },
      responses: { 200: member },
      errors: ["not_found", "conflict", "last_owner"],
      handler: async ({ c, deps, auth, params }) => {
        const { db, clock } = deps;
        const target = await getMember(c, auth.orgId, params.id);
        assertCanManage(auth, target);
        if (target.id === auth.membershipId) throw new AppError("conflict", "You can't suspend yourself.");
        if (target.status !== "active" && target.status !== "invited")
          throw new AppError("conflict", `This member is already ${target.status}.`);
        if (target.roles.includes("owner") && (await activeOwnerCount(db, auth.orgId, target.id)) === 0) {
          throw new AppError("last_owner", LAST_OWNER_MESSAGE);
        }
        const now = clock.now();
        await db.transaction(async (tx) => {
          await tx
            .update(memberships)
            .set({ status: "suspended", updatedAt: now })
            .where(orgScope(tx, auth).whereId(memberships, target.id));
          await revokeMembershipSessions(tx, [target.id], "suspended", now);
          const ctx = auditContext(c);
          await recordAudit(tx, deps, ctx, {
            action: "member.suspended",
            targetType: "membership",
            targetId: target.id,
          });
          await retireInactiveApprovers(tx, deps, ctx, { orgId: auth.orgId, membershipIds: [target.id] });
        });
        return getMember(c, auth.orgId, target.id);
      },
    }),

    defineRoute({
      method: "post",
      path: "/:id/reactivate",
      summary: "Reactivate a suspended member",
      access: { permission: "members:update" },
      request: { params: idParams },
      responses: { 200: member },
      errors: ["not_found", "conflict"],
      handler: async ({ c, deps, auth, params }) => {
        const target = await getMember(c, auth.orgId, params.id);
        assertCanManage(auth, target);
        if (target.status !== "suspended") throw new AppError("conflict", "Only suspended members can be reactivated.");
        await deps.db
          .update(memberships)
          .set({ status: "active", updatedAt: deps.clock.now() })
          .where(orgScope(deps.db, auth).whereId(memberships, target.id));
        await audit(c, { action: "member.reactivated", targetType: "membership", targetId: target.id });
        return getMember(c, auth.orgId, target.id);
      },
    }),

    defineRoute({
      method: "post",
      path: "/:id/unlock",
      summary: "Clear a member's sign-in lockout",
      access: { permission: "security_settings:update" },
      request: { params: idParams },
      responses: { 204: null },
      errors: ["not_found"],
      handler: async ({ c, deps, auth, params }) => {
        const target = await getMember(c, auth.orgId, params.id);
        await clearAccountThrottle(deps.db, target.userId);
        await audit(c, { action: "auth.lockout_cleared", targetType: "membership", targetId: target.id });
        return undefined;
      },
    }),

    defineRoute({
      method: "get",
      path: "/:id/sessions",
      summary: "A member's browser and mobile sessions",
      access: { permission: "security_settings:read" },
      request: { params: idParams },
      responses: { 200: z.object({ items: z.array(sessionItem) }) },
      errors: ["not_found"],
      handler: async ({ c, auth, params }) => {
        const target = await getMember(c, auth.orgId, params.id);
        return { items: await listSessionsFor(c, target.userId, auth.orgId, auth.session.id) };
      },
    }),

    defineRoute({
      method: "delete",
      path: "/:id/sessions/:sessionId",
      summary: "Revoke one of a member's sessions or devices",
      access: { permission: "security_settings:update" },
      request: { params: z.object({ id: z.uuid(), sessionId: z.string().min(1).max(100) }) },
      responses: { 204: null },
      errors: ["not_found"],
      handler: async ({ c, auth, params }) => {
        const target = await getMember(c, auth.orgId, params.id);
        if (!(await revokeOneSession(c, target.userId, auth.orgId, params.sessionId))) {
          throw new AppError("not_found", "That session doesn't exist or has already ended.");
        }
        await audit(c, {
          action: "auth.session_revoked",
          targetType: "membership",
          targetId: target.id,
          meta: { by: "owner" },
        });
        return undefined;
      },
    }),

    defineRoute({
      method: "post",
      path: "/:id/sign-out-everywhere",
      summary: "Sign a member out of every browser and device",
      description: "Also unlinks the member's SSO sign-in methods in this organisation (`unlinked` counts them).",
      access: { permission: "security_settings:update" },
      request: { params: idParams },
      responses: { 200: z.object({ revoked: z.number().int(), unlinked: z.number().int() }) },
      errors: ["not_found"],
      handler: async ({ c, deps, auth, params }) => {
        const target = await getMember(c, auth.orgId, params.id);
        const self = target.id === auth.membershipId;
        return deps.db.transaction(async (tx) => {
          const revoked = await revokeUserSessions(tx, {
            userId: target.userId,
            orgId: auth.orgId,
            reason: "owner_sign_out_everywhere",
            now: deps.clock.now(),
            ...(self ? { exceptSessionId: auth.session.id } : {}),
          });
          // Finding 1: also unlink every SSO identity in this organisation (an intruder's included).
          const unlinked = await removeLinkedIdentities(tx, {
            userId: target.userId,
            orgId: auth.orgId,
          });
          await recordAudit(tx, deps, auditContext(c), {
            action: "auth.session_revoked",
            targetType: "membership",
            targetId: target.id,
            meta: { by: "owner", scope: "everywhere", count: revoked, unlinkedIdentities: unlinked },
          });
          return { revoked, unlinked };
        });
      },
    }),

    defineRoute({
      method: "post",
      path: "/:id/mfa/reset",
      summary: "Reset a member's two-step verification",
      description: "Owner only. The member enrols again at next sign-in (subject to the MFA policy).",
      access: { permission: "security_settings:update" },
      recentAuth: true,
      request: { params: idParams },
      responses: { 204: null },
      errors: ["not_found"],
      handler: async ({ c, deps, auth, params }) => {
        const target = await getMember(c, auth.orgId, params.id);
        await clearMfa(c, target.userId);
        await audit(c, {
          action: "auth.mfa_reset",
          targetType: "membership",
          targetId: target.id,
          meta: { by: "owner" },
        });
        await sendSecurityNotice(deps.db, deps, {
          orgId: auth.orgId,
          to: { membershipIds: [target.id] },
          title: "Your two-step verification was reset",
          body: "An owner reset two-step verification for your Crow HR account, so your authenticator app no longer works for it. Set it up again from My sessions. If you didn't ask for this, tell your administrator.",
        });
        return undefined;
      },
    }),

    defineRoute({
      method: "post",
      path: "/:id/password-reset-link",
      summary: "Reset a member's password (email, or a one-time link for the owner)",
      description:
        "Owner only, after a recent sign-in. With email configured the reset link goes to the member (forced reset by email; `url` is null). Without email the owner gets a link to hand over, shown once and valid 60 minutes. Refused for members who hold a role or belong to another organisation (the password is shared across organisations).",
      access: { permission: "members:update" },
      recentAuth: true,
      request: { params: idParams },
      responses: {
        201: z.object({
          url: z.string().nullable(),
          delivery: z.enum(["email", "link"]),
          expiresAt: z.iso.datetime(),
        }),
      },
      errors: ["not_found", "conflict", "forbidden"],
      handler: async ({ c, deps, auth, params }) => {
        // Security review finding 2: this takes over the account, so it is the owner's call.
        if (!auth.roles.includes("owner"))
          throw new AppError("forbidden", "Only an owner can reset another member's password.");
        const target = await getMember(c, auth.orgId, params.id);
        if (target.status !== "active" && target.status !== "former")
          throw new AppError("conflict", "Only active members can reset a password. Resend the invitation instead.");
        if (target.roles.length > 0) {
          throw new AppError(
            "conflict",
            "Members who hold a role reset their own password (Forgot password on the sign-in page). For a lost authenticator, reset their two-step verification instead.",
          );
        }
        const [elsewhere] = await deps.db
          .select({ id: memberships.id })
          .from(memberships)
          .where(and(eq(memberships.userId, target.userId), ne(memberships.orgId, auth.orgId)))
          .limit(1);
        if (elsewhere) {
          throw new AppError(
            "conflict",
            "This person also belongs to another organisation on this server, and the password is shared, so only they can reset it (Forgot password on the sign-in page).",
          );
        }
        const now = deps.clock.now();
        const token = newToken();
        const expiresAt = new Date(now.getTime() + RESET_TTL_MS);
        await deps.db.transaction(async (tx) => {
          await tx.insert(passwordResets).values({
            tokenHash: await sha256Hex(token),
            orgId: auth.orgId,
            userId: target.userId,
            expiresAt,
            createdBy: auth.membershipId,
            createdAt: now,
          });
          await recordAudit(tx, deps, auditContext(c), {
            action: "auth.reset_link_generated",
            targetType: "membership",
            targetId: target.id,
            meta: { for: target.email, emailConfigured: !!deps.mailer },
          });
        });
        const url = `${deps.publicUrl.replace(/\/$/, "")}/reset/${token}`;
        let delivery: "email" | "link" = "link";
        if (deps.mailer) {
          try {
            await deps.mailer.send({
              to: target.email,
              subject: "Reset your Crow HR password",
              text: `An owner of your organisation asked you to set a new password for Crow HR. Use this link within 60 minutes: ${url}\nIf you didn't expect this, tell your administrator.`,
            });
            delivery = "email";
          } catch (err) {
            // Owners can do this anyway without email; hand over the link rather than fail.
            c.var.logger.warn("Password reset email failed; returning the link to the owner", { err });
          }
        }
        if (delivery === "link") {
          await sendSecurityNotice(deps.db, deps, {
            orgId: auth.orgId,
            to: { membershipIds: [target.id] },
            title: "A password reset link was created for you",
            body: "An owner created a one-time link to reset your Crow HR password. If you didn't ask for this, tell your administrator.",
          });
        }
        return { url: delivery === "link" ? url : null, delivery, expiresAt: expiresAt.toISOString() };
      },
    }),
  ],
});
