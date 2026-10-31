import { sql } from "drizzle-orm";
import type { Db } from "../db/types.ts";

/** Display facts about employees for claim lists, details and reports. */
export interface EmployeeSummary {
  id: string;
  name: string;
  employeeNumber: string;
  departmentId: string | null;
  departmentName: string | null;
}

function rowsOf<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  return ((result as { rows?: T[] }).rows ?? []) as T[];
}

/**
 * Name, number and department (from the employment record in force on `onDate`, else the
 * latest one) for each employee ID.
 */
export async function employeeSummaries(
  db: Db,
  orgId: string,
  ids: readonly string[],
  onDate: string,
): Promise<Map<string, EmployeeSummary>> {
  const unique = [...new Set(ids)];
  if (!unique.length) return new Map();
  const result = await db.execute<{
    id: string;
    name: string;
    employee_number: string;
    department_id: string | null;
    department_name: string | null;
  }>(sql`
    select e.id, coalesce(e.preferred_name, e.legal_name) as name, e.employee_number,
           er.department_id, d.name as department_name
      from employees e
      left join lateral (
        select r.department_id from employment_records r
         where r.org_id = e.org_id and r.employee_id = e.id and r.effective_from <= ${onDate}
         order by r.effective_from desc limit 1
      ) er on true
      left join departments d on d.org_id = e.org_id and d.id = er.department_id
     where e.org_id = ${orgId}
       and e.id in (${sql.join(
         unique.map((id) => sql`${id}::uuid`),
         sql`, `,
       )})
  `);
  return new Map(
    rowsOf<{
      id: string;
      name: string;
      employee_number: string;
      department_id: string | null;
      department_name: string | null;
    }>(result).map((r) => [
      r.id,
      {
        id: r.id,
        name: r.name,
        employeeNumber: r.employee_number,
        departmentId: r.department_id,
        departmentName: r.department_name,
      },
    ]),
  );
}

/** The membership linked to an employee (active or invited), if any. */
export async function membershipOfEmployee(db: Db, orgId: string, employeeId: string): Promise<string | null> {
  const result = await db.execute<{ id: string }>(sql`
    select id from memberships where org_id = ${orgId} and employee_id = ${employeeId}
       and status in ('active', 'invited') limit 1
  `);
  return rowsOf<{ id: string }>(result)[0]?.id ?? null;
}
