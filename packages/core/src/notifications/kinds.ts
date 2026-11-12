/**
 * Notification kinds and their email preference category (spec "In-app notifications",
 * "Email notifications"). `security` is always emailed and cannot be turned off.
 */
export const NOTIFICATION_CATEGORIES = ["approvals", "requests", "reminders", "updates", "security"] as const;
export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number];

export const CATEGORY_LABEL: Record<NotificationCategory, { label: string; description: string }> = {
  approvals: { label: "Approvals for you", description: "A request needs your decision, was escalated or reassigned." },
  requests: { label: "Your requests", description: "Your request was approved, rejected or needs attention." },
  reminders: { label: "Reminders", description: "Work passes expiring, probation ending, payroll cutoff." },
  updates: { label: "Updates", description: "Payslip released, roster published, document shared." },
  security: {
    label: "Security",
    description: "Password reset, invitation, lockout, new two-step method. Always sent.",
  },
};

export const NOTIFICATION_KINDS = {
  task_assigned: "approvals",
  task_escalated: "approvals",
  task_reassigned: "approvals",
  task_reminder: "approvals",
  request_withdrawn: "approvals",
  request_approved: "requests",
  request_rejected: "requests",
  request_comment: "requests",
  timesheet_reopened: "requests",
  work_pass_expiry: "reminders",
  probation_end: "reminders",
  payroll_cutoff: "reminders",
  document_expiry: "reminders",
  payslip_released: "updates",
  roster_published: "updates",
  document_shared: "updates",
  acknowledgement_requested: "updates",
  email_delivery_failed: "updates",
  security_notice: "security",
} as const satisfies Record<string, NotificationCategory>;

export type NotificationKind = keyof typeof NOTIFICATION_KINDS;

export function categoryOf(kind: string): NotificationCategory {
  return (NOTIFICATION_KINDS as Record<string, NotificationCategory>)[kind] ?? "updates";
}
