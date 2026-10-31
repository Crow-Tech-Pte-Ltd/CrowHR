/**
 * Turns the server's permission matrix (packages/core/src/access/matrix.ts) into rows for the
 * roles-and-permissions page. The matrix is imported at build time, so the published table is the
 * code. `tests/permissions.test.ts` fails when a resource has no human label here.
 */
import { MATRIX, ROLES, type Role, type Scope } from "../../../../packages/core/src/access/matrix.ts";

/** Plain-language names for each matrix resource, in the order they appear on the page. */
export const RESOURCE_LABELS: Record<string, string> = {
  security_settings: "Security settings (sign-in methods, SSO, MFA policy, timeouts)",
  members: "Members and invitations",
  member_roles: "Role grants",
  org_structure: "Company profile and structure",
  directory: "Employee directory",
  employment: "Employment records and lifecycle",
  personal_details: "Personal details",
  emergency_contacts: "Emergency contacts",
  work_pass: "Work passes",
  compensation: "Compensation",
  bank_details: "Bank details",
  payroll: "Payroll runs and statutory files",
  payslips: "Payslips and tax forms",
  leave: "Leave",
  leave_claims: "Government-paid leave report",
  claims: "Claims",
  attendance: "Attendance, overtime and timesheets",
  approval_tasks: "Approval tasks",
  approval_delegations: "Out-of-office cover for others",
  notification_delivery: "Email delivery status",
  rosters: "Rosters and shifts",
  documents: "Documents",
  policies: "Approval policies, leave and claim types",
  claim_types: "Claim types",
  reports_people: "People reports",
  reports_leave: "Leave reports",
  reports_attendance: "Attendance reports",
  reports_claims: "Claims reports",
  reports_payroll_cost: "Payroll cost reports",
  audit_log: "Audit log",
};

/** Resources whose module is not built yet: the rows exist in the matrix but no endpoint uses them. */
export const NOT_BUILT_RESOURCES = new Set([
  "rosters",
  "documents",
  "reports_people",
  "reports_leave",
  "reports_attendance",
  "reports_claims",
  "reports_payroll_cost",
]);

export const ROLE_LABELS: Record<Role, string> = {
  owner: "Owner",
  hr_admin: "HR admin",
  payroll_admin: "Payroll admin",
  manager: "Manager",
  employee: "Employee",
};

export const SCOPE_LABELS: Record<Scope, string> = {
  all: "All",
  team: "Team",
  own: "Own",
  assigned: "Assigned",
};

export interface MatrixRowView {
  permission: string;
  anchor: string;
  resource: string;
  action: string;
  cells: { role: Role; scope: Scope | null }[];
  note: string | undefined;
}

export interface MatrixGroupView {
  resource: string;
  label: string;
  notBuilt: boolean;
  rows: MatrixRowView[];
}

export function permissionAnchor(permission: string): string {
  return permission.replace(":", "-");
}

export function matrixGroups(): MatrixGroupView[] {
  const groups = new Map<string, MatrixGroupView>();
  for (const [permission, row] of Object.entries(MATRIX)) {
    const [resource = permission, action = ""] = permission.split(":");
    const cells: Partial<Record<Role, Scope>> = row.cells;
    const group = groups.get(resource) ?? {
      resource,
      label: RESOURCE_LABELS[resource] ?? resource,
      notBuilt: NOT_BUILT_RESOURCES.has(resource),
      rows: [],
    };
    group.rows.push({
      permission,
      anchor: permissionAnchor(permission),
      resource,
      action,
      cells: ROLES.map((role) => ({ role, scope: cells[role] ?? null })),
      note: "note" in row ? (row.note as string) : undefined,
    });
    groups.set(resource, group);
  }
  return [...groups.values()];
}
