import { and, eq, inArray } from "drizzle-orm";
import type { AssignedRole } from "../access/matrix.ts";
import { membershipRoles, memberships } from "../db/schema/access.ts";
import { users } from "../db/schema/users.ts";
import type { Db } from "../db/types.ts";
import type { AppDeps } from "../deps.ts";
import { peopleManagerResolver } from "./people.ts";
import type { ApproverDirectory, DirectoryMember, ManagerResolver } from "./types.ts";

async function loadMembers(db: Db, orgId: string, where: ReturnType<typeof eq>): Promise<DirectoryMember[]> {
  const rows = await db
    .select({
      membershipId: memberships.id,
      employeeId: memberships.employeeId,
      status: memberships.status,
      displayName: users.displayName,
      email: users.email,
    })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(and(eq(memberships.orgId, orgId), where));
  if (!rows.length) return [];
  const roles = await db
    .select({ membershipId: membershipRoles.membershipId, role: membershipRoles.role })
    .from(membershipRoles)
    .where(
      and(
        eq(membershipRoles.orgId, orgId),
        inArray(
          membershipRoles.membershipId,
          rows.map((r) => r.membershipId),
        ),
      ),
    );
  return rows.map((r) => ({
    ...r,
    roles: roles.filter((x) => x.membershipId === r.membershipId).map((x) => x.role as AssignedRole),
  }));
}

/**
 * The default directory: members and roles from the identity tables, managers from `managers`.
 *
 * - `managers` omitted: the people module's reporting lines (employment record in force on the
 *   date), `peopleManagerResolver`.
 * - `managers` as a record `{ [employeeId]: managerEmployeeId }`: the test/demo double.
 */
export function createApproverDirectory(
  options: { managers?: ManagerResolver | Record<string, string | null> } = {},
): ApproverDirectory {
  const managers = options.managers ?? peopleManagerResolver;
  return {
    async managerOf(db, orgId, employeeId, onDate) {
      if (typeof (managers as ManagerResolver).managerOf === "function") {
        return (managers as ManagerResolver).managerOf(db, orgId, employeeId, onDate);
      }
      return (managers as Record<string, string | null>)[employeeId] ?? null;
    },
    async membersWithRole(db, orgId, role) {
      const ids = await db
        .select({ id: membershipRoles.membershipId })
        .from(membershipRoles)
        .where(and(eq(membershipRoles.orgId, orgId), eq(membershipRoles.role, role)));
      if (!ids.length) return [];
      return loadMembers(
        db,
        orgId,
        inArray(
          memberships.id,
          ids.map((r) => r.id),
        ) as ReturnType<typeof eq>,
      );
    },
    async memberForEmployee(db, orgId, employeeId) {
      const found = await loadMembers(db, orgId, eq(memberships.employeeId, employeeId));
      return found.find((m) => m.status === "active") ?? found[0] ?? null;
    },
    async member(db, orgId, membershipId) {
      const [found] = await loadMembers(db, orgId, eq(memberships.id, membershipId));
      return found ?? null;
    },
  };
}

let fallbackDirectory: ApproverDirectory | null = null;

export function approverDirectory(deps: Pick<AppDeps, "approverDirectory">): ApproverDirectory {
  // Created lazily: people.ts (the default manager resolver) imports the engine, which imports this.
  fallbackDirectory ??= createApproverDirectory();
  return deps.approverDirectory ?? fallbackDirectory;
}
