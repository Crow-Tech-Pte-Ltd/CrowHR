import { and, eq } from "drizzle-orm";
import type { AppContext, AuthMethod } from "../context.ts";
import { membershipRoles, memberships } from "../db/schema/access.ts";
import { sessions } from "../db/schema/auth.ts";
import { organisations } from "../db/schema/organisations.ts";
import type { Db } from "../db/types.ts";
import type { AppDeps } from "../deps.ts";
import { notify } from "../notifications/notify.ts";
import { isKnownDevice } from "./known-device.ts";

/**
 * Security notices (add-identity-and-access; notifications spec "Email notifications": security
 * emails are always sent). Each one is an in-app notification of kind `security_notice` (category
 * `security`) for the member, so it reaches them without SMTP, and, when a mailer is configured, an
 * email queued in the same write through the email outbox, which retries it (1, 5, 30, 120 and 720
 * minutes) instead of sending inline. Member preferences cannot turn these emails off.
 *
 * Emails carrying one-time links (invitations, password-reset links) are not notices: their tokens
 * are never stored, so those are sent directly and the UI falls back to a link to copy.
 *
 * Notices never contain passwords, codes, tokens, IP addresses or other personal data beyond what
 * the member already knows (their own device name, the organisation name).
 */

export const SECURITY_LINK = "/me/sessions";

export type NoticeRecipients =
  | { membershipIds: readonly string[] }
  /** The user's membership in the organisation. */
  | { userId: string }
  /** Every active owner. */
  | { owners: true }
  /** Every active hr_admin, or the owners when there is none. */
  | { hrAdmins: true };

export interface SecurityNotice {
  orgId: string;
  to: NoticeRecipients;
  /** Short, no full stop: "A recovery code was used". */
  title: string;
  /** One or two sentences: what happened, and what to do if it wasn't them. */
  body: string;
  link?: string;
  actionLabel?: string;
}

async function recipientsOf(db: Db, orgId: string, to: NoticeRecipients): Promise<string[]> {
  if ("membershipIds" in to) return [...to.membershipIds];
  if ("userId" in to) {
    const rows = await db
      .select({ id: memberships.id })
      .from(memberships)
      .where(and(eq(memberships.orgId, orgId), eq(memberships.userId, to.userId)));
    return rows.map((r) => r.id);
  }
  const withRole = async (role: "owner" | "hr_admin") =>
    (
      await db
        .select({ id: memberships.id })
        .from(membershipRoles)
        .innerJoin(
          memberships,
          and(eq(memberships.orgId, membershipRoles.orgId), eq(memberships.id, membershipRoles.membershipId)),
        )
        .where(and(eq(membershipRoles.orgId, orgId), eq(membershipRoles.role, role), eq(memberships.status, "active")))
    ).map((r) => r.id);
  if ("owners" in to) return withRole("owner");
  const hr = await withRole("hr_admin");
  return hr.length ? hr : withRole("owner");
}

/**
 * Writes the notice (and queues its email). Pass the caller's transaction to commit it with the
 * change it reports; with `deps.db` a failure is logged and the request carries on.
 */
export async function sendSecurityNotice(db: Db, deps: AppDeps, notice: SecurityNotice): Promise<void> {
  const write = async (tx: Db) => {
    const recipients = await recipientsOf(tx, notice.orgId, notice.to);
    const link = notice.link ?? SECURITY_LINK;
    // The in-app notification and its outbox email commit together.
    await notify(tx, deps, {
      orgId: notice.orgId,
      recipients,
      kind: "security_notice",
      title: notice.title,
      body: notice.body,
      link,
      email: {
        headline: `${notice.title}.`,
        detail: notice.body,
        linkPath: link,
        actionLabel: notice.actionLabel ?? "Review your sign-ins",
      },
    });
  };
  if (db !== deps.db) return write(db);
  try {
    await deps.db.transaction((tx) => write(tx));
  } catch (err) {
    deps.logger.error("Security notice could not be recorded", { title: notice.title, error: String(err) });
  }
}

/**
 * "Sign-in settings were changed": to every owner (including the one who changed them, so a
 * hijacked owner session is noticed), after a change to sign-in methods, MFA policy, timeouts or
 * a single sign-on provider.
 */
export async function noticeSignInSettingsChanged(
  db: Db,
  deps: AppDeps,
  input: { orgId: string; actorName: string; what: string },
): Promise<void> {
  await sendSecurityNotice(db, deps, {
    orgId: input.orgId,
    to: { owners: true },
    title: "Sign-in settings were changed",
    body: `${input.actorName} ${input.what} on ${sgDateTimePhrase(deps.clock.now())}. If you didn't expect this, check Settings → Security and the audit log.`,
    link: "/settings/security",
    actionLabel: "Review security settings",
  });
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2 Nov 2026 at 9:00 am (Singapore time)". */
export function sgDateTimePhrase(at: Date): string {
  const d = new Date(at.getTime() + 8 * 3_600_000);
  const h = d.getUTCHours();
  const minutes = String(d.getUTCMinutes()).padStart(2, "0");
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()} at ${hour12}:${minutes} ${h < 12 ? "am" : "pm"} (Singapore time)`;
}

const METHOD_PHRASE: Record<AuthMethod, string> = {
  password: "a password",
  google: "Google",
  entra: "Microsoft",
  singpass: "Singpass",
  oidc: "single sign-on",
};

/**
 * "New sign-in" (call before the new browser session is created): reported when this browser has
 * no known-device cookie for the user and the member has signed in to this organisation before,
 * so a first sign-in after an invitation or setup is not reported.
 */
export async function noticeNewBrowserSignIn(
  c: AppContext,
  input: { orgId: string; userId: string; membershipId: string; authMethod: AuthMethod },
): Promise<void> {
  const deps = c.var.deps;
  if (await isKnownDevice(c, input.userId)) return;
  const [before] = await deps.db
    .select({ id: sessions.id })
    .from(sessions)
    .where(and(eq(sessions.orgId, input.orgId), eq(sessions.membershipId, input.membershipId)))
    .limit(1);
  if (!before) return;
  const [org] = await deps.db
    .select({ name: organisations.name })
    .from(organisations)
    .where(eq(organisations.id, input.orgId));
  await sendSecurityNotice(deps.db, deps, {
    orgId: input.orgId,
    to: { membershipIds: [input.membershipId] },
    title: "New sign-in to your Crow HR account",
    body: `Someone signed in to your ${org?.name ?? "Crow HR"} account with ${METHOD_PHRASE[input.authMethod]} from a browser that hasn't been used with it before, on ${sgDateTimePhrase(deps.clock.now())}. If this wasn't you, choose "Sign out everywhere" in My sessions, change your password and tell your administrator.`,
  });
}
