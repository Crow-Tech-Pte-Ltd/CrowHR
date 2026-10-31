import { singaporeDate } from "../access/scope.ts";
import type { AppDeps } from "../deps.ts";
import { workflowRegistry } from "./registry.ts";
import { daysUntil } from "./reminders.ts";
import type { InboxContext, InboxItem } from "./types.ts";

export interface InboxSourceStatus {
  id: string;
  label: string;
  status: "ready" | "not_set_up";
}

/**
 * Overdue first (most overdue first), then by due date ascending, then items without a due date
 * by age (oldest first). Spec "Home work-to-do inbox".
 */
export function sortInbox(items: InboxItem[], today: string): InboxItem[] {
  const rank = (i: InboxItem) => (i.dueOn === null ? 2 : i.dueOn < today ? 0 : 1);
  return [...items].sort((a, b) => {
    const ra = rank(a);
    const rb = rank(b);
    if (ra !== rb) return ra - rb;
    if (ra < 2 && a.dueOn !== b.dueOn) return (a.dueOn ?? "") < (b.dueOn ?? "") ? -1 : 1;
    return a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0;
  });
}

export function dueState(item: Pick<InboxItem, "dueOn">, today: string) {
  if (!item.dueOn) return { overdueDays: 0, overdue: false };
  const left = daysUntil(today, item.dueOn);
  return { overdueDays: left < 0 ? -left : 0, overdue: left < 0 };
}

/** The member's actionable items from every source, merged and sorted (design decision 7). */
export async function loadInbox(deps: AppDeps, ctx: Omit<InboxContext, "today" | "now">) {
  const now = deps.clock.now();
  const full: InboxContext = { ...ctx, now, today: singaporeDate(now) };
  const registry = workflowRegistry(deps);
  const items: InboxItem[] = [];
  const sources: InboxSourceStatus[] = [];
  for (const source of registry.inbox) {
    const status = await source.status(deps.db, full);
    sources.push({ id: source.id, label: source.label, status });
    if (status !== "ready") continue;
    try {
      items.push(...(await source.list(deps.db, full)));
    } catch (err) {
      deps.logger.error("Inbox source failed", { source: source.id, error: String(err) });
    }
  }
  return { today: full.today, items: sortInbox(items, full.today), sources };
}
