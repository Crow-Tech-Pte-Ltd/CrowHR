import { and, eq, inArray, ne } from "drizzle-orm";
import { cellFor, type Permission, type Role } from "../access/matrix.ts";
import { singaporeDate, teamOf } from "../access/scope.ts";
import { auditContext } from "../audit/audit.ts";
import { type AppContext, requireAuth } from "../context.ts";
import { approvalRequests, approvalTasks } from "../db/schema/workflows.ts";
import type { Db } from "../db/types.ts";
import { type Actor, buildActor } from "../employees/access.ts";

/**
 * Who is acting on claims: the people `Actor` (tenancy via `actor.org`, roles, own employee,
 * lazy team) plus the membership, which approvals and file ownership key on. Services take this,
 * never the Hono context, so HTTP, jobs and the demo seeder share one set of rules.
 */
export interface ClaimsActor extends Actor {
  membershipId: string;
  today: string;
}

export function claimsActorFrom(c: AppContext): ClaimsActor {
  const auth = requireAuth(c);
  const deps = c.get("deps");
  const active = auth.membershipStatus === "active";
  const today = singaporeDate(deps.clock.now());
  const actor = buildActor({
    db: deps.db,
    orgId: auth.orgId,
    userId: auth.user.id,
    requestId: c.get("requestId"),
    roles: active ? auth.roles : [],
    employeeId: active ? auth.employeeId : null,
    today,
    team: () => teamOf(c),
    auditCtx: auditContext(c),
  });
  return Object.assign(actor, { membershipId: auth.membershipId, today });
}

/** For tests and seeding: an actor without an HTTP request. */
export function buildClaimsActor(input: Parameters<typeof buildActor>[0] & { membershipId: string }): ClaimsActor {
  return Object.assign(buildActor(input), { membershipId: input.membershipId, today: input.today });
}

async function effectiveRoles(actor: Actor): Promise<Set<Role>> {
  const roles = new Set<Role>(actor.roles);
  if (actor.employeeId) {
    roles.add("employee");
    if ((await actor.team()).size > 0) roles.add("manager");
  }
  return roles;
}

/** Employees the actor may act on for `permission`: everyone, or an explicit (possibly empty) set. */
export async function scopeFor(actor: Actor, permission: Permission): Promise<"all" | Set<string>> {
  const ids = new Set<string>();
  for (const role of await effectiveRoles(actor)) {
    const scope = cellFor(permission, role);
    if (scope === "all") return "all";
    if (scope === "own" && actor.employeeId) ids.add(actor.employeeId);
    if (scope === "team") for (const id of await actor.team()) ids.add(id);
  }
  return ids;
}

export async function inScope(actor: Actor, permission: Permission, employeeId: string): Promise<boolean> {
  const scope = await scopeFor(actor, permission);
  return scope === "all" || scope.has(employeeId);
}

/** Approval tasks the member holds on this claim's request: `current` = a pending one. */
export async function approverRole(
  db: Db,
  orgId: string,
  membershipId: string,
  claimId: string,
): Promise<{ holder: boolean; current: boolean }> {
  const rows = await db
    .select({ status: approvalTasks.status, origin: approvalTasks.origin })
    .from(approvalTasks)
    .innerJoin(
      approvalRequests,
      and(eq(approvalRequests.orgId, approvalTasks.orgId), eq(approvalRequests.id, approvalTasks.requestId)),
    )
    .where(
      and(
        eq(approvalTasks.orgId, orgId),
        eq(approvalTasks.assigneeMembershipId, membershipId),
        eq(approvalRequests.subjectType, "claim"),
        eq(approvalRequests.subjectId, claimId),
        ne(approvalTasks.status, "superseded"),
      ),
    );
  return {
    holder: rows.some((r) => r.origin !== "delegated" || r.status === "pending"),
    current: rows.some((r) => r.status === "pending"),
  };
}

/** Claims among `claimIds` the member holds (or decided) an approval task for. */
export async function claimsWithTasks(db: Db, orgId: string, membershipId: string, claimIds: string[]) {
  if (!claimIds.length) return new Set<string>();
  const rows = await db
    .select({ subjectId: approvalRequests.subjectId, status: approvalTasks.status, origin: approvalTasks.origin })
    .from(approvalTasks)
    .innerJoin(
      approvalRequests,
      and(eq(approvalRequests.orgId, approvalTasks.orgId), eq(approvalRequests.id, approvalTasks.requestId)),
    )
    .where(
      and(
        eq(approvalTasks.orgId, orgId),
        eq(approvalTasks.assigneeMembershipId, membershipId),
        eq(approvalRequests.subjectType, "claim"),
        inArray(approvalRequests.subjectId, claimIds),
        ne(approvalTasks.status, "superseded"),
      ),
    );
  // As `approverRole`: a cover task counts only while it is open.
  return new Set(rows.filter((r) => r.origin !== "delegated" || r.status === "pending").map((r) => r.subjectId));
}

/**
 * Medical lines (description, merchant, receipts) are visible to owners, hr_admins, the claimant
 * and the claim's current approver (access-control "Field-level sensitivity", "Manager approves
 * medical claim"). Everyone else sees the type, date and amount only.
 */
export async function canSeeMedical(
  db: Db,
  actor: ClaimsActor,
  claim: { id: string; employeeId: string },
): Promise<boolean> {
  if (actor.roles.has("owner") || actor.roles.has("hr_admin")) return true;
  if (actor.employeeId && actor.employeeId === claim.employeeId) return true;
  return (await approverRole(db, actor.orgId, actor.membershipId, claim.id)).current;
}
