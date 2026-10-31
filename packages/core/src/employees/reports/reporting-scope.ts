import { sql } from "drizzle-orm";
import type { ReportingScopeResolver } from "../../access/scope.ts";
import type { Db } from "../../db/types.ts";
import type { IsoDate } from "../dates.ts";

/**
 * `ReportingScopeResolver` (defined in `access/scope.ts`, implemented here). A manager's team is everyone whose reporting chain, from employment
 * records in force on `onDate`, leads to the manager — directly or through
 * any number of levels — excluding the manager. Recursion stops at depth 20,
 * so a cycle in bad data terminates instead of looping.
 */
export interface PeopleReportingScope extends ReportingScopeResolver {
  directReportsOf(orgId: string, managerEmployeeId: string, onDate: IsoDate): Promise<string[]>;
}

export const MAX_REPORTING_DEPTH = 20;

/** Wire as `deps.reportingScope` in hosts so `authorize()` sees real reporting lines. */
export function createReportingScopeResolver(db: Db): PeopleReportingScope {
  return {
    async teamOf(orgId, managerEmployeeId, onDate) {
      const result = await db.execute<{ employee_id: string }>(sql`
        with recursive chain(employee_id, depth) as (
          select er.employee_id, 1
            from employment_records er
           where er.org_id = ${orgId}
             and er.manager_employee_id = ${managerEmployeeId}
             and er.effective_from <= ${onDate}
             and (er.effective_to is null or er.effective_to > ${onDate})
          union
          select er.employee_id, c.depth + 1
            from employment_records er
            join chain c on er.manager_employee_id = c.employee_id
           where er.org_id = ${orgId}
             and er.effective_from <= ${onDate}
             and (er.effective_to is null or er.effective_to > ${onDate})
             and c.depth < ${MAX_REPORTING_DEPTH}
        )
        select distinct employee_id from chain where employee_id <> ${managerEmployeeId}
      `);
      return new Set(rowsOf<{ employee_id: string }>(result).map((r) => r.employee_id));
    },
    async directReportsOf(orgId, managerEmployeeId, onDate) {
      const result = await db.execute<{ employee_id: string }>(sql`
        select er.employee_id from employment_records er
         where er.org_id = ${orgId}
           and er.manager_employee_id = ${managerEmployeeId}
           and er.effective_from <= ${onDate}
           and (er.effective_to is null or er.effective_to > ${onDate})
      `);
      return rowsOf<{ employee_id: string }>(result).map((r) => r.employee_id);
    },
  };
}

/**
 * Would making `managerId` the manager of `employeeId` on `onDate` create a
 * cycle? Walks up from the proposed manager (design decision 5).
 */
export async function wouldCreateCycle(
  db: Db,
  orgId: string,
  employeeId: string,
  managerId: string,
  onDate: IsoDate,
): Promise<boolean> {
  if (employeeId === managerId) return true;
  const result = await db.execute<{ hit: boolean }>(sql`
    with recursive up(employee_id, depth) as (
      select ${managerId}::uuid, 0
      union
      select er.manager_employee_id, u.depth + 1
        from employment_records er
        join up u on er.employee_id = u.employee_id
       where er.org_id = ${orgId}
         and er.manager_employee_id is not null
         and er.effective_from <= ${onDate}
         and (er.effective_to is null or er.effective_to > ${onDate})
         and u.depth < ${MAX_REPORTING_DEPTH}
    )
    select exists(select 1 from up where employee_id = ${employeeId}) as hit
  `);
  return Boolean(rowsOf<{ hit: boolean }>(result)[0]?.hit);
}

/** node-postgres returns `{ rows }`; PGlite returns `{ rows }` too; be lenient for other drivers. */
function rowsOf<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  return ((result as { rows?: T[] }).rows ?? []) as T[];
}
