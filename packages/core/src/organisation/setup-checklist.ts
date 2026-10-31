import { eq, isNull, sql } from "drizzle-orm";
import { orgScope } from "../access/org-scope.ts";
import { employees } from "../db/schema/employees.ts";
import { companyProfiles, departments, workSchedules } from "../db/schema/organisation.ts";
import type { Db } from "../db/types.ts";

export interface SetupStep {
  id: "company_profile" | "department" | "work_schedule" | "employee";
  title: string;
  done: boolean;
  /** Web route that completes the step. */
  href: string;
}

export interface SetupChecklist {
  complete: boolean;
  steps: SetupStep[];
}

/**
 * Organisation setup progress, derived from data (never ticked by hand).
 * Shown on Home to owners and hr_admins until complete. Exposed in the shape
 * of a workflows `InboxSource` once that interface lands (WS3).
 */
export async function setupChecklist(db: Db, orgId: string): Promise<SetupChecklist> {
  const org = orgScope(db, orgId);
  const [counts] = await db
    .select({
      profile: sql<number>`(select count(*)::int from ${companyProfiles} where ${companyProfiles.orgId} = ${orgId})`,
      departments: sql<number>`(select count(*)::int from ${departments} where ${org.where(departments, isNull(departments.archivedAt))})`,
      schedule: sql<number>`(select count(*)::int from ${workSchedules} where ${org.where(workSchedules, eq(workSchedules.isDefault, true))})`,
      employees: sql<number>`(select count(*)::int from ${employees} where ${org.where(employees)})`,
    })
    .from(sql`(select 1) as one`);
  const c = counts ?? { profile: 0, departments: 0, schedule: 0, employees: 0 };
  const steps: SetupStep[] = [
    { id: "company_profile", title: "Company profile", done: c.profile > 0, href: "/settings/company" },
    { id: "department", title: "Departments", done: c.departments > 0, href: "/settings/structure" },
    { id: "work_schedule", title: "Work schedule", done: c.schedule > 0, href: "/settings/structure?tab=schedules" },
    { id: "employee", title: "First employee", done: c.employees > 0, href: "/people/new" },
  ];
  return { complete: steps.every((s) => s.done), steps };
}
