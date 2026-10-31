import type { Role } from "../access/matrix.ts";
import { type OrgScope, orgScope } from "../access/org-scope.ts";
import { effectiveRoles, teamOf } from "../access/scope.ts";
import { type AuditContext, auditContext, clientIp } from "../audit/audit.ts";
import { type AppContext, requireAuth } from "../context.ts";
import type { DocumentCategory } from "../db/schema/documents.ts";

/**
 * Who is acting on documents, and which categories they may see (add-documents spec "Document
 * access and audit", access-control matrix `documents:*` with its note):
 * - owners and hr_admins: every category;
 * - payroll_admins: `payroll_visible` categories, never medical;
 * - managers: `manager_visible` categories of their team, never medical;
 * - employees: their own `employee_visible` categories (medical included: it is their own).
 * Out-of-scope documents answer 404, like missing ones.
 */
export interface DocActor {
  orgId: string;
  org: OrgScope;
  userId: string;
  membershipId: string;
  employeeId: string | null;
  displayName: string;
  roles: ReadonlySet<Role>;
  team(): Promise<ReadonlySet<string>>;
  audit: AuditContext;
  ip: string | null;
  userAgent: string | null;
}

export async function docActor(c: AppContext): Promise<DocActor> {
  const auth = requireAuth(c);
  const roles = await effectiveRoles(c);
  const deps = c.var.deps;
  return {
    orgId: auth.orgId,
    org: orgScope(deps.db, auth),
    userId: auth.user.id,
    membershipId: auth.membershipId,
    employeeId: auth.employeeId,
    displayName: auth.user.displayName || auth.user.email,
    // Former members keep read-only access to their own employee-visible documents.
    roles: auth.membershipStatus === "former" ? new Set<Role>(auth.employeeId ? ["employee"] : []) : roles,
    team: () => teamOf(c),
    audit: auditContext(c),
    ip: clientIp(c),
    userAgent: c.req.header("user-agent")?.slice(0, 300) ?? null,
  };
}

export const isHr = (a: Pick<DocActor, "roles">) => a.roles.has("owner") || a.roles.has("hr_admin");

export async function canReadCategory(
  a: DocActor,
  category: Pick<DocumentCategory, "sensitivity" | "employeeVisible" | "managerVisible" | "payrollVisible">,
  employeeId: string,
): Promise<boolean> {
  if (isHr(a)) return true;
  if (a.employeeId === employeeId && a.roles.has("employee") && category.employeeVisible) return true;
  if (category.sensitivity === "medical") return false;
  if (a.roles.has("payroll_admin") && category.payrollVisible) return true;
  if (a.roles.has("manager") && category.managerVisible && (await a.team()).has(employeeId)) return true;
  return false;
}

export function canUploadTo(
  a: DocActor,
  category: Pick<DocumentCategory, "employeeUploadable">,
  employeeId: string,
): boolean {
  if (isHr(a)) return true;
  return a.employeeId === employeeId && a.roles.has("employee") && category.employeeUploadable;
}
