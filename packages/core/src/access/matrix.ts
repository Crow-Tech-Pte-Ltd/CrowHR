/**
 * The permission matrix from `openspec/changes/add-identity-and-access/specs/access-control/spec.md`
 * ("Permission matrix"), as code. It is the single source of truth: `authorize()` reads it,
 * `GET /api/v1/me` reports it, and `access/matrix.http.test.ts` asserts every cell.
 *
 * Scopes: `all` = every record in the organisation (A), `team` = the member's direct and
 * indirect reports, not themselves (T), `own` = the member's own records (O), `assigned` =
 * only items the member is the assigned approver for. A missing role means denied (—).
 *
 * Adding a row (module authors): add a `"<resource>:<action>"` key below with the cells from
 * the spec table, add a `note` when the spec qualifies a cell (the handler must enforce it),
 * and the table-driven test picks the row up automatically. Changing an existing cell is a
 * spec change: update the access-control spec in the same PR.
 */
export type AssignedRole = "owner" | "hr_admin" | "payroll_admin";
/** `employee` applies when the membership is linked to an employee; `manager` while that employee has reports. */
export type DerivedRole = "manager" | "employee";
export type Role = AssignedRole | DerivedRole;
export type Scope = "all" | "team" | "own" | "assigned";

export const ASSIGNED_ROLES: readonly AssignedRole[] = ["owner", "hr_admin", "payroll_admin"];
export const ROLES: readonly Role[] = ["owner", "hr_admin", "payroll_admin", "manager", "employee"];

export interface MatrixRow {
  cells: Partial<Record<Role, Scope>>;
  /** Spec qualifications the handler enforces beyond the scope (e.g. document categories). */
  note?: string;
}

const A = "all" as const;
const T = "team" as const;
const O = "own" as const;
const STAFF_ADMIN = { owner: A, hr_admin: A } as const;
const PAY_ADMIN = { owner: A, payroll_admin: A } as const;
const ALL_READ = { owner: A, hr_admin: A, payroll_admin: A, manager: A, employee: A } as const;
const TIME_READ = { owner: A, hr_admin: A, payroll_admin: A, manager: T, employee: O } as const;
const TIME_CREATE = { owner: A, hr_admin: A, employee: O } as const;

export const MATRIX = {
  // Security settings (sign-in methods, SSO, MFA policy, timeouts)
  "security_settings:read": { cells: { owner: A } },
  "security_settings:update": { cells: { owner: A } },
  // Members, invitations, role grants
  "members:read": { cells: { owner: A, hr_admin: A, payroll_admin: A } },
  "members:create": { cells: STAFF_ADMIN, note: "hr_admin may only invite members with no assigned roles." },
  "members:update": { cells: STAFF_ADMIN, note: "hr_admin may not grant or revoke roles." },
  "member_roles:grant": { cells: { owner: A } },
  // Company profile, departments, teams, locations, cost centres, work schedules
  "org_structure:read": { cells: ALL_READ },
  "org_structure:create": { cells: STAFF_ADMIN },
  "org_structure:update": { cells: STAFF_ADMIN },
  "org_structure:archive": { cells: STAFF_ADMIN },
  // Employee directory (name, photo, job title, department, team, location, work email/phone, manager)
  "directory:read": { cells: ALL_READ },
  // Employment record and lifecycle events
  "employment:read": { cells: TIME_READ },
  "employment:create": { cells: STAFF_ADMIN },
  "employment:update": { cells: STAFF_ADMIN },
  // Personal details (DOB, residency, race, religion, personal contact, address)
  "personal_details:read": { cells: { owner: A, hr_admin: A, payroll_admin: A, employee: O } },
  "personal_details:update": {
    cells: { owner: A, hr_admin: A, employee: O },
    note: "Employees update via change request where required.",
  },
  "emergency_contacts:read": { cells: { owner: A, hr_admin: A, manager: T, employee: O } },
  "emergency_contacts:update": { cells: { owner: A, hr_admin: A, employee: O } },
  // Work pass
  "work_pass:read": { cells: { owner: A, hr_admin: A, payroll_admin: A, employee: O } },
  "work_pass:create": { cells: STAFF_ADMIN },
  "work_pass:update": { cells: STAFF_ADMIN },
  // Compensation (basic pay, allowances, history)
  "compensation:read": { cells: { owner: A, payroll_admin: A, employee: O } },
  "compensation:create": { cells: PAY_ADMIN, note: "Nobody changes their own compensation directly." },
  "compensation:update": { cells: PAY_ADMIN, note: "Nobody changes their own compensation directly." },
  // Bank details
  "bank_details:read": { cells: { owner: A, payroll_admin: A, employee: O } },
  "bank_details:update": {
    cells: { owner: A, payroll_admin: A, employee: O },
    note: "Own bank details change only via change request.",
  },
  // Payroll runs, statutory files
  "payroll:read": { cells: PAY_ADMIN },
  "payroll:create": { cells: PAY_ADMIN },
  "payroll:update": { cells: PAY_ADMIN },
  "payroll:finalise": { cells: PAY_ADMIN },
  // Payslips, tax forms
  "payslips:read": { cells: { owner: A, payroll_admin: A, employee: O }, note: "Employees see released ones only." },
  // Leave, claims, attendance, OT, timesheets
  "leave:read": { cells: TIME_READ },
  "leave:create": { cells: TIME_CREATE, note: "owner and hr_admin create on behalf of employees." },
  // Leave balance adjustments and direct cancellations (add-leave)
  "leave:update": { cells: STAFF_ADMIN, note: "Nobody adjusts their own balance." },
  // Government-paid leave report for manual GPL claims (add-leave)
  "leave_claims:read": { cells: { owner: A, hr_admin: A, payroll_admin: A } },
  "claims:read": { cells: TIME_READ },
  "claims:create": { cells: TIME_CREATE, note: "owner and hr_admin create on behalf of employees." },
  // Mark approved claims paid outside payroll (add-claims "Payment outside payroll")
  "claims:pay": { cells: PAY_ADMIN },
  "attendance:read": { cells: TIME_READ },
  "attendance:create": { cells: TIME_CREATE, note: "owner and hr_admin create on behalf of employees." },
  // Timesheet corrections: add or void punches with a reason (add-attendance)
  "attendance:update": { cells: { owner: A, hr_admin: A, manager: T }, note: "Nobody corrects their own timesheet." },
  // Approval tasks
  "approval_tasks:decide": {
    cells: {
      owner: "assigned",
      hr_admin: "assigned",
      payroll_admin: "assigned",
      manager: "assigned",
      employee: "assigned",
    },
  },
  "approval_tasks:reassign": { cells: STAFF_ADMIN, note: "hr_admin may not reassign payroll_run tasks." },
  // Out-of-office cover for someone else (everyone sets their own)
  "approval_delegations:manage": { cells: STAFF_ADMIN },
  // Email delivery status (failed emails, SMTP setup)
  "notification_delivery:read": { cells: { owner: A } },
  // Rosters and shifts
  "rosters:read": {
    cells: { owner: A, hr_admin: A, manager: T, employee: O },
    note: "Employees also see the published roster of their own location.",
  },
  "rosters:create": { cells: { owner: A, hr_admin: A, manager: T } },
  "rosters:update": { cells: { owner: A, hr_admin: A, manager: T } },
  "rosters:publish": { cells: { owner: A, hr_admin: A, manager: T } },
  // Settings → Shift templates (add-scheduling)
  "shift_templates:update": { cells: STAFF_ADMIN },
  // Offer a published shift to a colleague or ask for an open shift (add-scheduling)
  "shift_swaps:create": { cells: { employee: O }, note: "Only for the employee's own published shifts." },
  // Documents
  "documents:read": {
    cells: { owner: A, hr_admin: A, payroll_admin: A, manager: T, employee: O },
    note: "payroll_admin: payroll-visible categories; manager: manager-visible categories, never medical; employee: employee-visible categories.",
  },
  "documents:create": {
    cells: { owner: A, hr_admin: A, employee: O },
    note: "Employees upload to employee-uploadable categories only.",
  },
  "documents:update": { cells: STAFF_ADMIN },
  "documents:delete": { cells: STAFF_ADMIN },
  // Approval policies, notification templates, leave and claim types
  "policies:read": { cells: STAFF_ADMIN },
  "policies:update": { cells: STAFF_ADMIN },
  "claim_types:read": { cells: { owner: A, hr_admin: A, payroll_admin: A } },
  // Reports
  "reports_people:read": { cells: STAFF_ADMIN, note: "Headcount and turnover." },
  "reports_people:export": { cells: STAFF_ADMIN },
  "reports_leave:read": { cells: { owner: A, hr_admin: A, manager: T } },
  "reports_leave:export": { cells: { owner: A, hr_admin: A, manager: T } },
  "reports_attendance:read": { cells: { owner: A, hr_admin: A, manager: T } },
  "reports_attendance:export": { cells: { owner: A, hr_admin: A, manager: T } },
  "reports_claims:read": { cells: { owner: A, hr_admin: A, payroll_admin: A } },
  "reports_claims:export": { cells: { owner: A, hr_admin: A, payroll_admin: A } },
  "reports_payroll_cost:read": { cells: PAY_ADMIN },
  "reports_payroll_cost:export": { cells: PAY_ADMIN },
  // Audit log
  "audit_log:read": {
    cells: { owner: A, hr_admin: A, payroll_admin: A },
    note: "hr_admin: non-security, non-payroll events; payroll_admin: payroll, compensation and bank events.",
  },
  "audit_log:export": { cells: { owner: A, hr_admin: A, payroll_admin: A } },
} as const satisfies Record<string, MatrixRow>;

export type Permission = keyof typeof MATRIX;

export const PERMISSIONS = Object.keys(MATRIX) as Permission[];

/**
 * Permissions a `former` member keeps (spec "Membership suspension and former employees"):
 * read-only access to their own payslips, tax forms and employee-visible documents.
 */
export const FORMER_MEMBER_PERMISSIONS: ReadonlySet<Permission> = new Set<Permission>([
  "payslips:read",
  "documents:read",
]);

export function cellFor(permission: Permission, role: Role): Scope | undefined {
  const cells: Partial<Record<Role, Scope>> = MATRIX[permission].cells;
  return cells[role];
}
