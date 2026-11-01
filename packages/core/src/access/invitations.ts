import { and, eq, isNull, ne } from "drizzle-orm";
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
import { noReportingLines, singaporeDate } from "./scope.ts";

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
  if (input.employeeId) {
    await org.getById(employees, input.employeeId, "employee record");
  }
  // The injected resolver can use its own DB handle; resolve before opening a transaction
  // (PGlite serializes transactions and would otherwise wait on this transaction itself).
  const team = input.employeeId
    ? await (deps.reportingScope ?? noReportingLines).teamOf(
        input.orgId,
        input.employeeId,
        singaporeDate(deps.clock.now()),
      )
    : new Set<string>();
  const result = await deps.db.transaction(async (tx) => {
    if (input.employeeId) {
      // Serialize competing invites for the same employee, so the loser gets a readable 409.
      await tx
        .select({ id: employees.id })
        .from(employees)
        .where(org.whereId(employees, input.employeeId))
        .for("update");
      await assertEmployeeUnlinked(tx, input.orgId, input.employeeId);
      const [owner] = input.invitedBy
        ? await tx
            .select({ role: membershipRoles.role })
            .from(membershipRoles)
            .where(
              org.where(
                membershipRoles,
                eq(membershipRoles.membershipId, input.invitedBy),
                eq(membershipRoles.role, "owner"),
              ),
            )
        : [];
      if (!owner) {
        const [privileged] = await tx
          .select({ id: memberships.id })
          .from(memberships)
          .innerJoin(
            membershipRoles,
            and(eq(membershipRoles.membershipId, memberships.id), eq(membershipRoles.orgId, memberships.orgId)),
          )
          .where(org.where(memberships, eq(memberships.employeeId, input.employeeId)))
          .limit(1);
        if (privileged || [...team].some((id) => id !== input.employeeId)) {
          throw new AppError(
            "forbidden",
            "Only an owner can link a sign-in to an employee who holds roles or manages people.",
          );
        }
      }
    }
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

/**
 * One login per employee record (security review finding 3): a second live membership linked to
 * the same employee would read that person's salary, bank account and NRIC through `own` scope.
 * Former memberships don't count (they keep payslip access; the person may be rehired). The
 * partial unique index `memberships_org_employee_live_unique` enforces the same in the database.
 */
export async function assertEmployeeUnlinked(db: Db, orgId: string, employeeId: string) {
  const [linked] = await db
    .select({ id: memberships.id, status: memberships.status, email: users.email })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(
      orgScope(db, orgId).where(memberships, eq(memberships.employeeId, employeeId), ne(memberships.status, "former")),
    );
  if (linked) {
    throw new AppError(
      "conflict",
      `This employee record already has a sign-in (${linked.email}, ${linked.status}). Use that member, or remove it in Settings → Members first.`,
      { linkedMembershipId: linked.id },
    );
  }
}

/** The membership linked to an employee, if any (any status). */
export async function membershipForEmployee(db: Db, orgId: string, employeeId: string) {
  const [m] = await db
    .select({ id: memberships.id, status: memberships.status })
    .from(memberships)
    .where(orgScope(db, orgId).where(memberships, eq(memberships.employeeId, employeeId)));
  return m ?? null;
}
