import { singaporeDate } from "../access/scope.ts";
import { remindersSent } from "../db/schema/notifications.ts";
import type { Db } from "../db/types.ts";
import type { AppDeps } from "../deps.ts";
import type { NotificationKind } from "../notifications/kinds.ts";
import { notify } from "../notifications/notify.ts";
import { approverDirectory } from "./directory.ts";
import { hasEmployees, peopleDates as realPeopleDates } from "./people.ts";
import type { DueReminder, InboxItem, InboxSource, ReminderSource } from "./types.ts";

/**
 * Reminders (spec "Reminders"): work pass expiry 90/60/30/7/0 days before to hr_admins, probation
 * end 14 days before to the manager and hr_admins. The people data comes from `deps.peopleDates`
 * (default: the people module's records); Home says "not set up yet" until the organisation has
 * employees.
 *
 * Only the most urgent threshold already reached is emitted, so a pass added with 20 days left
 * gets one 30-day reminder, not three at once. `reminders_sent` (unique per source, subject and
 * threshold) makes every reminder exactly-once across ticks and replicas.
 */
export const WORK_PASS_THRESHOLDS = [90, 60, 30, 7, 0] as const;
export const PROBATION_DAYS_BEFORE = 14;

export function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function daysUntil(today: string, iso: string): number {
  return Math.round((Date.parse(`${iso}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
}

export function formatSgDate(iso: string): string {
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const [y, m, d] = iso.split("-");
  return `${Number(d)} ${months[Number(m) - 1]} ${y}`;
}

/** The smallest threshold (days before) already reached, or null if none yet. */
export function currentThreshold(today: string, expiresOn: string, thresholds: readonly number[]): number | null {
  const left = daysUntil(today, expiresOn);
  const reached = thresholds.filter((t) => left <= t);
  return reached.length ? Math.min(...reached) : null;
}

async function activeRoleMembers(db: Db, deps: AppDeps, orgId: string, role: "hr_admin" | "owner") {
  return (await approverDirectory(deps).membersWithRole(db, orgId, role))
    .filter((m) => m.status === "active")
    .map((m) => m.membershipId);
}

/** hr_admins, or owners when the org has no hr_admin. */
async function hrRecipients(db: Db, deps: AppDeps, orgId: string): Promise<string[]> {
  const hr = await activeRoleMembers(db, deps, orgId, "hr_admin");
  return hr.length ? hr : activeRoleMembers(db, deps, orgId, "owner");
}

export function workPassReminderSource(deps: AppDeps): ReminderSource {
  return {
    id: "work_pass_expiry",
    async due(db, { today }) {
      const people = deps.peopleDates ?? realPeopleDates;
      const passes = await people.workPassesExpiring(db, {
        today,
        until: addDays(today, Math.max(...WORK_PASS_THRESHOLDS)),
      });
      const out: DueReminder[] = [];
      for (const p of passes) {
        const threshold = currentThreshold(today, p.expiresOn, WORK_PASS_THRESHOLDS);
        if (threshold === null || daysUntil(today, p.expiresOn) < 0) continue;
        const when = threshold === 0 ? "today" : `on ${formatSgDate(p.expiresOn)}`;
        out.push({
          orgId: p.orgId,
          subjectKey: p.passId,
          threshold: `d${threshold}`,
          dueOn: p.expiresOn,
          recipients: await hrRecipients(db, deps, p.orgId),
          kind: "work_pass_expiry",
          title: `${p.employeeName}'s ${p.passType} expires ${when}`,
          link: `/people/${p.employeeId}`,
          concerns: p.employeeName,
        });
      }
      return out;
    },
  };
}

export function probationReminderSource(deps: AppDeps): ReminderSource {
  return {
    id: "probation_end",
    async due(db, { today, now }) {
      const people = deps.peopleDates ?? realPeopleDates;
      const ending = await people.probationsEnding(db, { today, until: addDays(today, PROBATION_DAYS_BEFORE) });
      const directory = approverDirectory(deps);
      const out: DueReminder[] = [];
      for (const p of ending) {
        if (daysUntil(today, p.endsOn) < 0) continue;
        const recipients = new Set(await hrRecipients(db, deps, p.orgId));
        const managerEmp = await directory.managerOf(db, p.orgId, p.employeeId, singaporeDate(now));
        const manager = managerEmp ? await directory.memberForEmployee(db, p.orgId, managerEmp) : null;
        if (manager?.status === "active") recipients.add(manager.membershipId);
        out.push({
          orgId: p.orgId,
          subjectKey: `${p.employeeId}:${p.endsOn}`,
          threshold: `d${PROBATION_DAYS_BEFORE}`,
          dueOn: p.endsOn,
          recipients: [...recipients],
          kind: "probation_end",
          title: `${p.employeeName}'s probation ends on ${formatSgDate(p.endsOn)}`,
          link: `/people/${p.employeeId}`,
          concerns: p.employeeName,
        });
      }
      return out;
    },
  };
}

export function peopleReminderSources(deps: AppDeps): ReminderSource[] {
  return [workPassReminderSource(deps), probationReminderSource(deps)];
}

/** Sends every due reminder once. Returns how many were sent. */
export async function sweepReminders(deps: AppDeps, sources: readonly ReminderSource[], now: Date): Promise<number> {
  const today = singaporeDate(now);
  let sent = 0;
  for (const source of sources) {
    let due: DueReminder[];
    try {
      due = await source.due(deps.db, { today, now });
    } catch (err) {
      deps.logger.error("Reminder source failed", { source: source.id, error: String(err) });
      continue;
    }
    for (const r of due) {
      const inserted = await deps.db.transaction(async (tx) => {
        const rows = await tx
          .insert(remindersSent)
          .values({ orgId: r.orgId, source: source.id, subjectKey: r.subjectKey, threshold: r.threshold, sentAt: now })
          .onConflictDoNothing()
          .returning({ key: remindersSent.subjectKey });
        if (!rows.length) return false;
        await notify(tx, deps, {
          orgId: r.orgId,
          recipients: r.recipients,
          kind: r.kind as NotificationKind,
          title: r.title,
          link: r.link,
          email: { headline: `${r.title}.`, linkPath: r.link, actionLabel: "Open in Crow HR" },
        });
        return true;
      });
      if (inserted) sent++;
    }
  }
  return sent;
}

/** Home items for passes expiring within 90 days (hr_admins/owners) and probations ending within 14 days. */
export function peopleInboxSources(deps: AppDeps): InboxSource[] {
  const people = deps.peopleDates ?? realPeopleDates;
  const notSetUp = async (db: Parameters<InboxSource["status"]>[0], ctx: Parameters<InboxSource["status"]>[1]) =>
    // A host-supplied source (demo, tests) is always set up; the built-in one once there are employees.
    people !== realPeopleDates || (await hasEmployees(db, ctx.orgId)) ? ("ready" as const) : ("not_set_up" as const);
  return [
    {
      id: "work_passes",
      label: "Work passes expiring",
      status: notSetUp,
      async list(db, ctx) {
        if (!ctx.roles.includes("hr_admin") && !ctx.roles.includes("owner")) return [];
        const passes = await people.workPassesExpiring(db, {
          today: ctx.today,
          until: addDays(ctx.today, 90),
          orgId: ctx.orgId,
        });
        return passes
          .filter((p) => p.orgId === ctx.orgId)
          .map(
            (p): InboxItem => ({
              id: `work_pass:${p.passId}`,
              source: "work_passes",
              kind: "work_pass_expiry",
              title: `${p.passType} expires`,
              concerns: p.employeeName,
              detail: p.passType,
              dueOn: p.expiresOn,
              createdAt: ctx.now.toISOString(),
              href: `/people/${p.employeeId}`,
              actionLabel: "Renew pass",
              task: null,
            }),
          );
      },
    },
    {
      id: "probation",
      label: "Probation ending",
      status: notSetUp,
      async list(db, ctx) {
        const hr = ctx.roles.includes("hr_admin") || ctx.roles.includes("owner");
        if (!hr && !ctx.isManager) return [];
        const ending = (
          await people.probationsEnding(db, {
            today: ctx.today,
            until: addDays(ctx.today, PROBATION_DAYS_BEFORE),
            orgId: ctx.orgId,
          })
        ).filter((p) => p.orgId === ctx.orgId && daysUntil(ctx.today, p.endsOn) >= 0);
        const directory = approverDirectory(deps);
        const out: InboxItem[] = [];
        for (const p of ending) {
          if (!hr) {
            const managerEmp = await directory.managerOf(db, p.orgId, p.employeeId, ctx.today);
            if (!managerEmp || managerEmp !== ctx.employeeId) continue;
          }
          out.push({
            id: `probation:${p.employeeId}:${p.endsOn}`,
            source: "probation",
            kind: "probation_end",
            title: "Probation ends",
            concerns: p.employeeName,
            detail: "Confirm or extend probation",
            dueOn: p.endsOn,
            createdAt: ctx.now.toISOString(),
            href: `/people/${p.employeeId}`,
            actionLabel: "Review",
            task: null,
          });
        }
        return out;
      },
    },
  ];
}
