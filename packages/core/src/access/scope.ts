import type { AppContext } from "../context.ts";
import { ASSIGNED_ROLES, type Role } from "./matrix.ts";

/**
 * Resolves a manager's team: every employee whose current reporting chain leads to the
 * manager through any number of levels, as at `onDate` (YYYY-MM-DD, Asia/Singapore),
 * excluding the manager. Implementations must terminate on cycles.
 *
 * Defined here; implemented by `add-organisation-and-people` (recursive CTE over current
 * employment records, depth cap 20). Until then hosts get `noReportingLines`, so nobody
 * holds the derived `manager` role.
 */
export interface ReportingScopeResolver {
  teamOf(orgId: string, managerEmployeeId: string, onDate: string): Promise<ReadonlySet<string>>;
}

/**
 * NOT IMPLEMENTED (real resolver): the default until the people workstream plugs in its
 * resolver. Nobody has reports, so the `manager` role never applies.
 */
export const noReportingLines: ReportingScopeResolver = {
  teamOf: async () => new Set(),
};

/** Today's date in Asia/Singapore (UTC+8, no DST) as YYYY-MM-DD. */
export function singaporeDate(at: Date): string {
  return new Date(at.getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/** The caller's team for this request, memoised per request (never across requests). */
export async function teamOf(c: AppContext): Promise<ReadonlySet<string>> {
  const auth = c.get("auth");
  if (!auth?.employeeId || auth.membershipStatus !== "active") return new Set();
  const memo = c.get("memo");
  const cached = memo.get("access.team") as ReadonlySet<string> | undefined;
  if (cached) return cached;
  const { reportingScope = noReportingLines, clock } = c.get("deps");
  const team = await reportingScope.teamOf(auth.orgId, auth.employeeId, singaporeDate(clock.now()));
  const withoutSelf = new Set(team);
  withoutSelf.delete(auth.employeeId);
  memo.set("access.team", withoutSelf);
  return withoutSelf;
}

/**
 * Assigned roles + implicit `employee` (membership linked to an employee record) +
 * derived `manager` (that employee has at least one report). Former members hold no roles.
 */
export async function effectiveRoles(c: AppContext): Promise<ReadonlySet<Role>> {
  const auth = c.get("auth");
  if (auth?.membershipStatus !== "active") return new Set();
  const roles = new Set<Role>(auth.roles.filter((r) => ASSIGNED_ROLES.includes(r)));
  if (auth.employeeId) {
    roles.add("employee");
    if ((await teamOf(c)).size > 0) roles.add("manager");
  }
  return roles;
}

/**
 * Test double: `{ managerId: [directReportIds] }`. Walks the graph breadth-first and stops at
 * already-visited nodes, so cycles terminate. Exported from core (not `testing/`) so the demo
 * can use it with seeded data too.
 */
export function createStaticReportingScope(directReports: Record<string, readonly string[]>): ReportingScopeResolver {
  return {
    async teamOf(_orgId, managerEmployeeId) {
      const seen = new Set<string>();
      const queue = [...(directReports[managerEmployeeId] ?? [])];
      while (queue.length) {
        const next = queue.shift() as string;
        if (seen.has(next)) continue;
        seen.add(next);
        queue.push(...(directReports[next] ?? []));
      }
      seen.delete(managerEmployeeId);
      return seen;
    },
  };
}
