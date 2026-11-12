import { NOTIFICATION_KINDS, type NotificationKind } from "./kinds.ts";

/**
 * Email templates (design decision 5). Plain functions per kind that only take non-sensitive
 * fields: emails never carry salary or other money amounts, NRIC/FIN, bank details or medical
 * details (spec "Email notifications"). They render a text part and a minimal HTML part in the
 * Crow Tech style: system fonts, ink on white, a yellow accent bar.
 */

/** Keys that must never appear in an email payload. The type below turns them into `never`. */
type SensitiveKey =
  | `${string}Cents`
  | `${string}cents`
  | `${string}Amount`
  | "amount"
  | "salary"
  | "pay"
  | "nric"
  | "fin"
  | "nricFin"
  | "bank"
  | "bankAccount"
  | "accountNumber"
  | "medical"
  | "diagnosis"
  | "employeeId"
  | "membershipId";

export interface EmailPayload {
  /** One sentence, e.g. "Ravi Kumar asked you to approve a leave request." */
  headline: string;
  /** Optional second line, e.g. "Due 3 Dec 2026" or the rejection comment. */
  detail?: string;
  /** In-app path the button opens, e.g. `/inbox`. */
  linkPath: string;
  /** Button label, e.g. "Review request". */
  actionLabel?: string;
}

/** Compile-time guard: a payload type with any sensitive key is rejected. */
export type SafePayload<T> = { [K in keyof T]: K extends SensitiveKey ? never : T[K] };

export function safePayload<T extends EmailPayload>(payload: SafePayload<T> & T): EmailPayload {
  return payload;
}

const SUBJECTS: Record<NotificationKind, string> = {
  task_assigned: "Approval needed",
  task_escalated: "Approval escalated to you",
  task_reassigned: "Approval reassigned to you",
  task_reminder: "Reminder: approval waiting",
  request_withdrawn: "Request withdrawn",
  request_approved: "Your request was approved",
  request_rejected: "Your request was not approved",
  request_comment: "New comment on your request",
  timesheet_reopened: "Your timesheet was reopened",
  work_pass_expiry: "Work pass expiring",
  probation_end: "Probation ending",
  payroll_cutoff: "Payroll cutoff coming up",
  document_expiry: "Document expiring",
  payslip_released: "Your payslip is ready",
  roster_published: "New roster published",
  document_shared: "A document was shared with you",
  acknowledgement_requested: "Please acknowledge a document",
  email_delivery_failed: "Some emails could not be delivered",
  security_notice: "Security notice",
};

export const EMAIL_KINDS = Object.keys(NOTIFICATION_KINDS) as NotificationKind[];

/**
 * Money (S$1,234.56, $12, SGD 50), NRIC/FIN (S1234567D) and long digit runs (bank account
 * numbers) are replaced, so a module that puts them in a title cannot leak them by email.
 */
const SENSITIVE_PATTERNS: RegExp[] = [
  /(?:S\$|SGD\s?|\$)\s?\d[\d,]*(?:\.\d+)?/gi,
  /\b[STFGM]\d{7}[A-Z]\b/gi,
  /\b\d[\d -]{5,}\d\b/g,
];

export function scrubSensitive(text: string): string {
  let out = text;
  for (const p of SENSITIVE_PATTERNS) out = out.replace(p, "[hidden]");
  return out;
}

export function containsSensitive(text: string): boolean {
  return SENSITIVE_PATTERNS.some((p) => {
    p.lastIndex = 0;
    const hit = p.test(text);
    p.lastIndex = 0;
    return hit;
  });
}

export function scrubPayload(payload: EmailPayload): EmailPayload {
  return {
    headline: scrubSensitive(payload.headline),
    ...(payload.detail ? { detail: scrubSensitive(payload.detail) } : {}),
    linkPath: payload.linkPath.startsWith("/") ? payload.linkPath : "/",
    ...(payload.actionLabel ? { actionLabel: payload.actionLabel } : {}),
  };
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
}

export interface RenderedEmail {
  subject: string;
  text: string;
  html: string;
}

export function renderEmail(
  kind: string,
  rawPayload: EmailPayload,
  org: { name: string },
  publicUrl: string,
): RenderedEmail {
  const payload = scrubPayload(rawPayload);
  const subjectLine = SUBJECTS[kind as NotificationKind] ?? "Update from Crow HR";
  const subject = `${subjectLine} · ${org.name}`;
  const url = `${publicUrl.replace(/\/$/, "")}${payload.linkPath}`;
  const action = payload.actionLabel ?? "Open Crow HR";
  const lines = [
    org.name,
    "",
    payload.headline,
    ...(payload.detail ? ["", payload.detail] : []),
    "",
    `${action}: ${url}`,
    "",
    "You get this email because of your Crow HR notification settings. Change them under Settings → Notifications.",
  ];
  const html = `<!doctype html><html><body style="margin:0;background:#ffffff;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Ubuntu,sans-serif;color:#141414">
<div style="max-width:560px;margin:0 auto;padding:24px">
<div style="height:4px;background:#f5d000;margin-bottom:20px"></div>
<p style="margin:0 0 16px;font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#555">${escapeHtml(org.name)}</p>
<p style="margin:0 0 12px;font-size:16px;line-height:24px">${escapeHtml(payload.headline)}</p>
${payload.detail ? `<p style="margin:0 0 16px;font-size:14px;line-height:22px;color:#333">${escapeHtml(payload.detail)}</p>` : ""}
<p style="margin:24px 0"><a href="${escapeHtml(url)}" style="display:inline-block;padding:10px 16px;border:2px solid #141414;background:#f5d000;color:#141414;text-decoration:none;font-weight:600">${escapeHtml(action)}</a></p>
<p style="margin:24px 0 0;font-size:12px;line-height:18px;color:#666">You get this email because of your Crow HR notification settings. Change them under Settings → Notifications.</p>
</div></body></html>`;
  return { subject, text: lines.join("\n"), html };
}
