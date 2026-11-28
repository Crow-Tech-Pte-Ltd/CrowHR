import { asc, eq, gte } from "drizzle-orm";
import { authorize } from "../access/authorize.ts";
import { orgScope } from "../access/org-scope.ts";
import { auditContext, recordAudit } from "../audit/audit.ts";
import { type AppContext, requireAuth } from "../context.ts";
import { publishedShifts } from "../db/schema/scheduling.ts";
import { balancesView } from "../leave/routes.ts";
import { todaySg } from "../leave/views.ts";
import { myOpenTasks } from "../workflows/inbox-approvals.ts";

export const assistantTools = {
  my_annual_leave_balance: {
    description: "Get your available annual leave balance for this year, in days or hours.",
    async read(c: AppContext) {
      const auth = requireAuth(c);
      if (!auth.employeeId) return { employeeRecordLinked: false };
      const balances = await balancesView(c, auth, await authorize(c, "leave:read"), auth.employeeId, undefined);
      const balance = balances.find((row) => row.statutoryCode === "annual");
      return {
        year: Number(todaySg(c.var.deps).slice(0, 4)),
        available: balance?.available ?? null,
        unit: balance?.unit ?? null,
      };
    },
  },
  my_next_shift: {
    description:
      "Get the start and end times of your next published work shift. Times are in Singapore time when displayed in Crow HR.",
    async read(c: AppContext) {
      const auth = requireAuth(c);
      if (!auth.employeeId) return { employeeRecordLinked: false };
      const { db, clock } = c.var.deps;
      const org = orgScope(db, auth);
      const [shift] = await db
        .select({ date: publishedShifts.date, startsAt: publishedShifts.startsAt, endsAt: publishedShifts.endsAt })
        .from(publishedShifts)
        .where(
          org.where(
            publishedShifts,
            eq(publishedShifts.employeeId, auth.employeeId),
            eq(publishedShifts.kind, "shift"),
            gte(publishedShifts.startsAt, clock.now()),
          ),
        )
        .orderBy(asc(publishedShifts.startsAt))
        .limit(1);
      return { shift: shift ?? null, timeZone: "Asia/Singapore" };
    },
  },
  my_pending_approval_count: {
    description: "Count requests currently waiting for your approval. To review them, open the Crow HR inbox.",
    async read(c: AppContext) {
      const { orgId, membershipId } = requireAuth(c);
      const deps = c.var.deps;
      const tasks = await myOpenTasks(deps.db, orgId, membershipId, deps);
      return { pending: tasks.length };
    },
  },
} as const;

export async function readAssistantTool(c: AppContext, name: keyof typeof assistantTools) {
  const data = await assistantTools[name].read(c);
  const deps = c.var.deps;
  await recordAudit(deps.db, deps, auditContext(c), {
    action: "assistant.tool_read",
    targetType: "assistant_connection",
    targetId: requireAuth(c).session.id,
    meta: { tool: name },
  });
  return data;
}
