import { eq, isNull } from "drizzle-orm";
import { type AuditContext, recordAudit } from "../audit/audit.ts";
import { normaliseEmail } from "../auth/credentials.ts";
import { DAY } from "../auth/settings.ts";
import { newToken, sha256Hex } from "../crypto/tokens.ts";
import { invitations, membershipRoles, memberships } from "../db/schema/access.ts";
import { employees } from "../db/schema/employees.ts";
import { organisations } from "../db/schema/organisations.ts";
import { users } from "../db/schema/users.ts";
import type { Db } from "../db/types.ts";
import type { AppDeps } from "../deps.ts";
import { AppError } from "../errors.ts";
import type { AssignedRole } from "./matrix.ts";
import { orgScope } from "./org-scope.ts";

/**
 * Invitation service (access-control "Invitations"). The members routes and the people hire flow
 * both use `inviteMember`, so every invitation gets the same checks, token, audit event and
 * delivery: an email when SMTP is configured, otherwise a one-time link for the inviter to copy.
 * Callers check who may grant which roles (only owners invite with a role).
 */

export const INVITATION_TTL_MS = 7 * DAY;

export interface InviteMemberInput {
  orgId: string;
  email: string;
  displayName: string;
  roles?: readonly AssignedRole[];
  /** Link the membership to this employee of the organisation (404 if there is none). */
  employeeId?: string | null;
  /** Membership id of the inviter, if any. */
  invitedBy: string | null;
}

export interface InviteMemberResult {
  membershipId: string;
  expiresAt: Date;
  /** The link to copy when no mailer is configured; null when the invitation was emailed. */
  inviteUrl: string | null;
}

export function invitationUrl(deps: Pick<AppDeps, "publicUrl">, token: string): string {
  return `${deps.publicUrl.replace(/\/$/, "")}/invite/${token}`;
}

/** Replaces any pending invitation of the membership with a new token (7 days). Run inside the caller's transaction. */
export async function issueInvitation(
  deps: Pick<AppDeps, "clock" | "ids">,
  db: Db,
  input: { orgId: string; membershipId: string; email: string; invitedBy: string | null },
) {
  const now = deps.clock.now();
  await db
    .update(invitations)
    .set({ revokedAt: now })
    .where(
      orgScope(db, input.orgId).where(
        invitations,
        eq(invitations.membershipId, input.membershipId),
        isNull(invitations.acceptedAt),
        isNull(invitations.revokedAt),
      ),
    );
  const token = newToken();
  const id = deps.ids.newId();
  const expiresAt = new Date(now.getTime() + INVITATION_TTL_MS);
  await db.insert(invitations).values({
    id,
    orgId: input.orgId,
    email: input.email,
    membershipId: input.membershipId,
    tokenHash: await sha256Hex(token),
    expiresAt,
    invitedBy: input.invitedBy,
    createdAt: now,
  });
  return { id, token, expiresAt };
}

/** Sends the invitation email, or returns the link for the inviter to copy when there is no mailer. */
export async function deliverInvitation(
  deps: Pick<AppDeps, "mailer" | "publicUrl" | "db">,
  input: { orgId: string; email: string; token: string },
): Promise<string | null> {
  const url = invitationUrl(deps, input.token);
  if (!deps.mailer) return url;
  const [org] = await deps.db
    .select({ name: organisations.name })
    .from(organisations)
    .where(eq(organisations.id, input.orgId));
  const orgName = org?.name ?? "your organisation";
  await deps.mailer.send({
    to: input.email,
    subject: `You're invited to ${orgName} on Crow HR`,
    text: `You've been invited to ${orgName} on Crow HR. Accept within 7 days: ${url}`,
  });
  return null;
}

/**
 * Creates (or reuses) the user, an `invited` membership with its roles and an invitation, audited
 * as `member.invited`, in one transaction; then delivers it. 409 `conflict` when the email
 * already has a membership of this organisation.
 */
export async function inviteMember(
  deps: AppDeps,
  ctx: AuditContext,
  input: InviteMemberInput,
): Promise<InviteMemberResult> {
  const email = normaliseEmail(input.email);
  const roles = [...new Set(input.roles ?? [])];
  const org = orgScope(deps.db, input.orgId);
  if (input.employeeId) await org.getById(employees, input.employeeId, "employee record");
  const result = await deps.db.transaction(async (tx) => {
    let [user] = await tx.select().from(users).where(eq(users.email, email));
    if (user) {
      const [existing] = await tx
        .select()
        .from(memberships)
        .where(org.where(memberships, eq(memberships.userId, user.id)));
      if (existing?.status === "active")
        throw new AppError("conflict", `${email} is already a member of this organisation.`, {
          membershipId: existing.id,
        });
      if (existing)
        throw new AppError(
          "conflict",
          `${email} already has a ${existing.status} membership. Resend the invitation or reactivate them instead.`,
          { membershipId: existing.id },
        );
    } else {
      [user] = await tx
        .insert(users)
        .values({ id: deps.ids.newId(), email, displayName: input.displayName })
        .returning();
    }
    if (!user) throw new Error("user insert failed");
    const membershipId = deps.ids.newId();
    await tx.insert(memberships).values(
      org.values({
        id: membershipId,
        userId: user.id,
        employeeId: input.employeeId ?? null,
        status: "invited" as const,
      }),
    );
    for (const role of roles) {
      await tx.insert(membershipRoles).values(
        org.values({
          membershipId,
          role,
          grantedBy: input.invitedBy,
          grantedAt: deps.clock.now(),
        }),
      );
    }
    const invite = await issueInvitation(deps, tx, {
      orgId: input.orgId,
      membershipId,
      email,
      invitedBy: input.invitedBy,
    });
    await recordAudit(tx, deps, ctx, {
      action: "member.invited",
      targetType: "membership",
      targetId: membershipId,
      meta: { email, roles, ...(input.employeeId ? { employeeId: input.employeeId } : {}) },
    });
    return { membershipId, invite };
  });
  const inviteUrl = await deliverInvitation(deps, { orgId: input.orgId, email, token: result.invite.token });
  return { membershipId: result.membershipId, expiresAt: result.invite.expiresAt, inviteUrl };
}

/** The membership linked to an employee, if any (any status). */
export async function membershipForEmployee(db: Db, orgId: string, employeeId: string) {
  const [m] = await db
    .select({ id: memberships.id, status: memberships.status })
    .from(memberships)
    .where(orgScope(db, orgId).where(memberships, eq(memberships.employeeId, employeeId)));
  return m ?? null;
}
