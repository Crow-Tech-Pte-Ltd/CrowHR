import { and, asc, eq } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { singaporeDate } from "../access/scope.ts";
import { memberships } from "../db/schema/access.ts";
import { users } from "../db/schema/users.ts";
import { approvalRequests, approvalTasks } from "../db/schema/workflows.ts";
import type { AppDeps } from "../deps.ts";
import { approverDirectory } from "./directory.ts";
import { decideBlocker } from "./engine.ts";
import { workflowRegistry } from "./registry.ts";
import type { InboxItem, InboxSource } from "./types.ts";

const onBehalfMembership = alias(memberships, "on_behalf_membership");
const onBehalfUser = alias(users, "on_behalf_user");

/** Open approval tasks of the member (including delegated, escalated and reassigned ones). One indexed query. */
export async function myOpenTasks(
  db: Parameters<InboxSource["list"]>[0],
  orgId: string,
  membershipId: string,
  deps: AppDeps,
) {
  const rows = await db
    .select({
      task: approvalTasks,
      request: approvalRequests,
      requesterName: users.displayName,
      onBehalfName: onBehalfUser.displayName,
    })
    .from(approvalTasks)
    .innerJoin(approvalRequests, eq(approvalRequests.id, approvalTasks.requestId))
    .innerJoin(memberships, eq(memberships.id, approvalRequests.requesterMembershipId))
    .innerJoin(users, eq(users.id, memberships.userId))
    .leftJoin(onBehalfMembership, eq(onBehalfMembership.id, approvalTasks.onBehalfOfMembershipId))
    .leftJoin(onBehalfUser, eq(onBehalfUser.id, onBehalfMembership.userId))
    .where(
      and(
        eq(approvalTasks.orgId, orgId),
        eq(approvalTasks.assigneeMembershipId, membershipId),
        eq(approvalTasks.status, "pending"),
        eq(approvalRequests.status, "pending"),
      ),
    )
    .orderBy(asc(approvalTasks.createdAt));
  const member = await approverDirectory(deps).member(db, orgId, membershipId);
  const eligible: typeof rows = [];
  for (const row of rows) {
    if (
      !(await decideBlocker(db, deps, row.request, member, {
        viaRole: row.task.viaRole,
        selfApproved: row.task.selfApproved,
      }))
    )
      eligible.push(row);
  }
  return eligible;
}

/** Built with deps at call time (labels and the inline flag come from the registered adapters). */
export function approvalsInbox(deps: AppDeps): InboxSource {
  return {
    id: "approvals",
    label: "Approvals",
    status: async () => "ready",
    async list(db, ctx) {
      if (ctx.active === false) return []; // former members decide nothing
      const registry = workflowRegistry(deps);
      const rows = await myOpenTasks(db, ctx.orgId, ctx.membershipId, deps);
      return rows.map(({ task, request, requesterName, onBehalfName }): InboxItem => {
        const adapter = registry.subjects.get(request.subjectType);
        const label = adapter?.label ?? request.subjectType.replace(/_/g, " ");
        return {
          id: `task:${task.id}`,
          source: "approvals",
          kind: "approval",
          title: request.title,
          concerns: requesterName,
          detail: label,
          dueOn: task.dueAt ? singaporeDate(task.dueAt) : null,
          createdAt: request.submittedAt.toISOString(),
          href: `/inbox?task=${task.id}`,
          actionLabel: "Review",
          task: {
            id: task.id,
            requestId: request.id,
            subjectType: request.subjectType,
            inline: !!adapter?.inlineDecision,
            origin: task.origin,
            onBehalfOf: onBehalfName ?? null,
          },
        };
      });
    },
  };
}
