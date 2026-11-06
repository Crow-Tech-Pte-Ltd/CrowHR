import type { AppDeps } from "../deps.ts";
import { lastBackupRuns } from "../system/settings.ts";
import { BACKUP_STALE_HOURS } from "../system/status.ts";
import type { InboxItem, InboxSource, WorkflowPlugin } from "./types.ts";

/**
 * Home warning for owners when the last successful backup is older than 48 hours (self-hosting
 * spec "Backup and restore"). Active only where backups are expected: a host that reports a
 * backup schedule (the server with PostgreSQL), or any install that has run a backup before. When
 * plaintext schedules are disabled (no BACKUP_PASSPHRASE), that is reported, and an old last
 * backup is reported as well.
 */
export function backupInboxSource(deps: AppDeps): InboxSource {
  const expected = async () => {
    if (!deps.systemHost) return false;
    const host = await deps.systemHost.describe();
    return host.database.driver === "postgres" && host.backups.schedule !== null;
  };
  return {
    id: "backups",
    label: "Backups",
    status: async (db) => ((await expected()) || (await lastBackupRuns(db)).last ? "ready" : "not_set_up"),
    async list(db, ctx) {
      if (!ctx.roles.includes("owner")) return [];
      const host = await deps.systemHost?.describe();
      const items: InboxItem[] = [];
      const scheduleDisabled =
        host?.database.driver === "postgres" && !!host.backups.schedule && !host.backups.encrypted;
      if (scheduleDisabled) {
        items.push({
          id: "backups:encryption",
          source: "backups",
          kind: "backup_stale",
          title: "Scheduled backups are disabled",
          concerns: null,
          detail:
            "Set BACKUP_PASSPHRASE in .env (at least 12 characters), keep it outside this server and restart Crow HR. Automatic backups require encryption to protect the master key.",
          dueOn: ctx.today,
          createdAt: ctx.now.toISOString(),
          href: "/settings/system",
          actionLabel: "Check backups",
          task: null,
        });
      }
      const { lastSuccessful } = await lastBackupRuns(db);
      const ageMs = lastSuccessful ? ctx.now.getTime() - lastSuccessful.startedAt.getTime() : null;
      if (ageMs !== null && ageMs <= BACKUP_STALE_HOURS * 3_600_000) return items;
      // With schedules disabled and no backup ever, the encryption item already says why.
      if (scheduleDisabled && !lastSuccessful) return items;
      items.push({
        id: "backups:stale",
        source: "backups",
        kind: "backup_stale",
        title: lastSuccessful ? "No backup in the last 48 hours" : "No successful backup yet",
        concerns: null,
        detail: lastSuccessful
          ? `Last successful backup ${Math.floor((ageMs as number) / 3_600_000)} hours ago. Check Settings → System.`
          : "Check the backup settings and run one from Settings → System.",
        dueOn: ctx.today,
        createdAt: (lastSuccessful?.startedAt ?? ctx.now).toISOString(),
        href: "/settings/system",
        actionLabel: "Check backups",
        task: null,
      });
      return items;
    },
  };
}

export function systemWorkflowPlugin(deps: AppDeps): WorkflowPlugin {
  return { name: "system", inbox: [backupInboxSource(deps)] };
}
