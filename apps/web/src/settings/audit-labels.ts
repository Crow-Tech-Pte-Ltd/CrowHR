/**
 * Human labels for audit-log action keys and target types. The API stores and filters by the raw
 * key (`auth.signed_in`); the UI shows the label ("Signed in") with the key in a tooltip.
 * Unknown keys (new modules) fall back to a humanised key, so nothing ever renders blank.
 */

const STRUCTURE: Record<string, string> = {
  department: "Department",
  team: "Team",
  location: "Location",
  cost_centre: "Cost centre",
};
const STRUCTURE_VERBS: Record<string, string> = {
  created: "added",
  updated: "updated",
  archived: "archived",
  restored: "restored",
};

const LIFECYCLE: Record<string, string> = {
  hire: "Hire recorded",
  rehire: "Rehire recorded",
  transfer: "Transfer recorded",
  promotion: "Promotion recorded",
  salary_change: "Salary change recorded",
  probation_confirmed: "Probation confirmed",
  resignation: "Resignation recorded",
  termination: "Termination recorded",
  cancelled: "Lifecycle event cancelled",
};

const IMPORTS: Record<string, string> = {
  employees: "Employees imported",
  compensation: "Pay imported",
  ytd: "Year-to-date balances imported",
};

export const ACTION_LABELS: Record<string, string> = {
  // Sign-in and sessions
  "auth.signed_in": "Signed in",
  "auth.signed_out": "Signed out",
  "auth.sign_in_failed": "Sign-in failed",
  "auth.sso_failed": "Single sign-on failed",
  "auth.break_glass_sign_in": "Owner break-glass sign-in",
  "auth.locked": "Account locked",
  "auth.lockout_cleared": "Lockout cleared",
  "auth.reauthenticated": "Identity confirmed",
  "auth.reauth_failed": "Identity confirmation failed",
  "auth.organisation_switched": "Switched organisation",
  "auth.session_revoked": "Session signed out",
  "auth.device_session_created": "Mobile app signed in",
  "auth.native_code_replayed": "Mobile sign-in code reused",
  "auth.refresh_reuse_detected": "Mobile token reuse detected",
  "auth.password_changed": "Password changed",
  "auth.password_reset": "Password reset",
  "auth.reset_requested": "Password reset requested",
  "auth.reset_link_generated": "Password reset link created",
  "auth.mfa_enrolled": "Two-step verification turned on",
  "auth.mfa_disabled": "Two-step verification turned off",
  "auth.mfa_failed": "Two-step code rejected",
  "auth.mfa_reset": "Two-step verification reset",
  "auth.recovery_code_used": "Recovery code used",
  "auth.recovery_codes_regenerated": "Recovery codes regenerated",
  // Members and access
  "member.invited": "Member invited",
  "member.invitation_resent": "Invitation resent",
  "member.invitation_revoked": "Invitation revoked",
  "member.invitation_accepted": "Invitation accepted",
  "member.jit_provisioned": "Member added on first sign-in",
  "member.role_granted": "Role granted",
  "member.role_revoked": "Role removed",
  "member.suspended": "Member suspended",
  "member.reactivated": "Member reactivated",
  "member.became_former": "Member became former",
  // Security settings and single sign-on
  "security_settings.updated": "Security settings changed",
  "sso.provider_created": "Sign-in method added",
  "sso.provider_updated": "Sign-in method changed",
  "sso.provider_deleted": "Sign-in method removed",
  "sso.test_succeeded": "Sign-in method test passed",
  "sso.test_failed": "Sign-in method test failed",
  "sso.identity_linked": "Sign-in account linked",
  "sso.identity_unlinked": "Sign-in account unlinked",
  // Organisation
  "setup.completed": "Setup completed",
  "company_profile.created": "Company profile created",
  "company_profile.updated": "Company profile updated",
  "company_profile.logo_updated": "Company logo updated",
  "work_schedule.created": "Work schedule added",
  "work_schedule.versioned": "Work schedule changed",
  "work_schedule.default_set": "Default work schedule set",
  "allowance_type.created": "Allowance type added",
  "checklist_template.created": "Checklist template added",
  // People
  "employee.hired": "Employee added",
  "employee.updated": "Employee updated",
  "employee.self_updated": "Employee updated own profile",
  "employee.updated_by_request": "Profile change applied",
  "employee.emergency_contacts_updated": "Emergency contacts updated",
  "employees.exported": "Employee list exported",
  "nric.revealed": "NRIC/FIN revealed",
  "bank.revealed": "Bank account number revealed",
  "bank_account.updated": "Bank account updated",
  "compensation.updated": "Pay updated",
  "compensation.retroactive": "Backdated pay change",
  "work_pass.created": "Work pass added",
  "work_pass.updated": "Work pass updated",
  "profile_change.submitted": "Profile change requested",
  "profile_change.approved": "Profile change approved",
  "profile_change.rejected": "Profile change rejected",
  "profile_change.cancelled": "Profile change withdrawn",
  "checklist_item.completed": "Checklist item done",
  "checklist_item.skipped": "Checklist item skipped",
  "checklist_item.reopened": "Checklist item reopened",
  // Payroll
  "payroll.finalised": "Payroll finalised",
  // Audit log
  "audit_log.exported": "Audit log exported",
  ...Object.fromEntries(
    Object.entries(STRUCTURE).flatMap(([type, noun]) =>
      Object.entries(STRUCTURE_VERBS).map(([verb, done]) => [`${type}.${verb}`, `${noun} ${done}`]),
    ),
  ),
  ...Object.fromEntries(Object.entries(LIFECYCLE).map(([type, label]) => [`lifecycle.${type}`, label])),
  ...Object.fromEntries(Object.entries(IMPORTS).map(([kind, label]) => [`import.${kind}.committed`, label])),
};

const TARGET_LABELS: Record<string, string> = {
  membership: "Member",
  user: "User",
  employee: "Employee",
  employee_list: "Employee list",
  organisation: "Organisation",
  sso_provider: "Sign-in method",
  session: "Session",
  device_session: "Mobile session",
  work_schedule: "Work schedule",
  allowance_type: "Allowance type",
  checklist_template: "Checklist template",
  checklist_item: "Checklist item",
  import_job: "Import",
  audit_log: "Audit log",
  ...STRUCTURE,
};

/** `payroll.run_reopened` → "Payroll run reopened". */
export function humaniseKey(key: string): string {
  const words = key.split(/[._]+/).filter(Boolean).join(" ").toLowerCase();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : key;
}

export function actionLabel(key: string): string {
  return ACTION_LABELS[key] ?? humaniseKey(key);
}

export function targetTypeLabel(type: string): string {
  return TARGET_LABELS[type] ?? humaniseKey(type);
}

/** Known actions for the filter's suggestions, sorted by label. */
export const ACTION_OPTIONS: { key: string; label: string }[] = Object.entries(ACTION_LABELS)
  .map(([key, label]) => ({ key, label }))
  .sort((a, b) => a.label.localeCompare(b.label));

/**
 * What the filter sends: a typed label ("Signed in") becomes its key; a key or prefix (`auth.`)
 * passes through unchanged.
 */
export function actionFilterValue(input: string): string {
  const v = input.trim();
  const lower = v.toLowerCase();
  return ACTION_OPTIONS.find((o) => o.label.toLowerCase() === lower)?.key ?? v;
}
