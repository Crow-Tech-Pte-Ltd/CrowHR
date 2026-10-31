import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { singaporeDate } from "../access/scope.ts";
import { memberships } from "../db/schema/access.ts";
import { users } from "../db/schema/users.ts";
import { approvalComments, approvalRequests, approvalSteps, approvalTasks } from "../db/schema/workflows.ts";
import type { Db } from "../db/types.ts";
import type { AppDeps } from "../deps.ts";
import { AppError } from "../errors.ts";
import { canReadRequest, refOf } from "./engine.ts";
import { myOpenTasks } from "./inbox-approvals.ts";
import { workflowRegistry } from "./registry.ts";
import { daysUntil } from "./reminders.ts";
import type { ReadContext } from "./types.ts";

export const RULE_LABEL: Record<string, string> = {
  manager: "Manager",
  manager_of_manager: "Manager's manager",
  "role:owner": "Owner",
  "role:hr_admin": "HR admin",
  "role:payroll_admin": "Payroll admin",
};

export const SKIP_LABEL: Record<string, string> = {
  self: "Skipped: the requester can't approve their own request",
  no_manager: "Skipped: no manager on record",
  inactive: "Skipped: approver is suspended or has left",
  no_members: "Skipped: nobody holds this role",
};

async function namesOf(db: Db, orgId: string, membershipIds: string[]): Promise<Map<string, string>> {
  const ids = [...new Set(membershipIds)];
  if (!ids.length) return new Map();
  const rows = await db
    .select({ id: memberships.id, name: users.displayName })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(and(eq(memberships.orgId, orgId), inArray(memberships.id, ids)));
  return new Map(rows.map((r) => [r.id, r.name]));
}

export function ruleLabel(rule: string, names: Map<string, string>): string {
  if (rule.startsWith("member:")) return names.get(rule.slice(7)) ?? "A specific member";
  return RULE_LABEL[rule] ?? rule;
}

const taskStatus = z.enum(["pending", "approved", "rejected", "superseded"]);
const origin = z.enum(["resolved", "delegated", "escalated", "reassigned"]);
const requestStatus = z.enum(["pending", "approved", "rejected", "withdrawn"]);
const labelValue = z.object({ label: z.string(), value: z.string() });

export const taskListItem = z.object({
  taskId: z.uuid(),
  requestId: z.uuid(),
  subjectType: z.string(),
  subjectLabel: z.string(),
  title: z.string(),
  requester: z.object({ name: z.string() }),
  submittedAt: z.iso.datetime(),
  dueOn: z.iso.date().nullable(),
  overdueDays: z.int(),
  origin,
  onBehalfOf: z.string().nullable(),
  inline: z.boolean(),
  step: z.object({ position: z.int(), of: z.int(), label: z.string() }),
});

export const requestDetail = z.object({
  id: z.uuid(),
  subjectType: z.string(),
  subjectLabel: z.string(),
  title: z.string(),
  status: requestStatus,
  policyName: z.string(),
  submittedAt: z.iso.datetime(),
  decidedAt: z.iso.datetime().nullable(),
  requester: z.object({ name: z.string() }),
  summary: z.object({ title: z.string(), lines: z.array(labelValue), context: z.array(labelValue) }).nullable(),
  link: z.string(),
  steps: z.array(
    z.object({
      position: z.int(),
      label: z.string(),
      status: z.enum(["waiting", "active", "approved", "rejected", "skipped"]),
      skipReason: z.string().nullable(),
      fallback: z.boolean(),
      escalated: z.boolean(),
      tasks: z.array(
        z.object({
          id: z.uuid(),
          assignee: z.string(),
          onBehalfOf: z.string().nullable(),
          origin,
          status: taskStatus,
          decidedAt: z.iso.datetime().nullable(),
          comment: z.string().nullable(),
          selfApproved: z.boolean(),
        }),
      ),
    }),
  ),
  comments: z.array(z.object({ id: z.uuid(), author: z.string(), body: z.string(), createdAt: z.iso.datetime() })),
  viewer: z.object({
    myTaskId: z.uuid().nullable(),
    canWithdraw: z.boolean(),
    canComment: z.boolean(),
  }),
});
export type RequestDetail = z.input<typeof requestDetail>;

export const myRequestItem = z.object({
  id: z.uuid(),
  subjectType: z.string(),
  subjectLabel: z.string(),
  title: z.string(),
  status: requestStatus,
  submittedAt: z.iso.datetime(),
  decidedAt: z.iso.datetime().nullable(),
  waitingOn: z.string().nullable(),
});

export async function listMyTasks(deps: AppDeps, viewer: ReadContext) {
  const registry = workflowRegistry(deps);
  const today = singaporeDate(deps.clock.now());
  const rows = await myOpenTasks(deps.db, viewer.orgId, viewer.membershipId);
  if (!rows.length) return [];
  const reqIds = rows.map((r) => r.request.id);
  const counts = await deps.db
    .select({ requestId: approvalSteps.requestId, n: sql<number>`count(*)::int` })
    .from(approvalSteps)
    .where(inArray(approvalSteps.requestId, reqIds))
    .groupBy(approvalSteps.requestId);
  const steps = await deps.db.select().from(approvalSteps).where(inArray(approvalSteps.requestId, reqIds));
  const memberRules = steps.filter((s) => s.approverRule.startsWith("member:")).map((s) => s.approverRule.slice(7));
  const names = await namesOf(deps.db, viewer.orgId, memberRules);
  return rows.map(({ task, request, requesterName, onBehalfName }) => {
    const adapter = registry.subjects.get(request.subjectType);
    const dueOn = task.dueAt ? singaporeDate(task.dueAt) : null;
    const left = dueOn ? daysUntil(today, dueOn) : 0;
    const step = steps.find((s) => s.requestId === request.id && s.position === task.position);
    return {
      taskId: task.id,
      requestId: request.id,
      subjectType: request.subjectType,
      subjectLabel: adapter?.label ?? request.subjectType,
      title: request.title,
      requester: { name: requesterName },
      submittedAt: request.submittedAt.toISOString(),
      dueOn,
      overdueDays: left < 0 ? -left : 0,
      origin: task.origin,
      onBehalfOf: onBehalfName ?? null,
      inline: !!adapter?.inlineDecision,
      step: {
        position: task.position,
        of: Number(counts.find((c) => c.requestId === request.id)?.n ?? task.position),
        label: step ? ruleLabel(step.approverRule, names) : "",
      },
    };
  });
}

export async function getRequestDetail(deps: AppDeps, viewer: ReadContext, requestId: string): Promise<RequestDetail> {
  const db = deps.db;
  const [request] = /^[0-9a-f-]{36}$/i.test(requestId)
    ? await db
        .select()
        .from(approvalRequests)
        .where(and(eq(approvalRequests.orgId, viewer.orgId), eq(approvalRequests.id, requestId)))
    : [];
  if (!request || !(await canReadRequest(db, deps, viewer, request))) {
    throw new AppError("not_found", "That request doesn't exist or you can't see it.");
  }
  const adapter = workflowRegistry(deps).subjects.get(request.subjectType);
  const steps = await db
    .select()
    .from(approvalSteps)
    .where(eq(approvalSteps.requestId, request.id))
    .orderBy(asc(approvalSteps.position));
  const tasks = await db
    .select()
    .from(approvalTasks)
    .where(eq(approvalTasks.requestId, request.id))
    .orderBy(asc(approvalTasks.createdAt));
  const comments = await db
    .select()
    .from(approvalComments)
    .where(eq(approvalComments.requestId, request.id))
    .orderBy(asc(approvalComments.createdAt));
  const names = await namesOf(db, viewer.orgId, [
    request.requesterMembershipId,
    ...tasks.flatMap((t) => [t.assigneeMembershipId, t.onBehalfOfMembershipId ?? ""]).filter(Boolean),
    ...comments.map((c) => c.authorMembershipId),
    ...steps.filter((s) => s.approverRule.startsWith("member:")).map((s) => s.approverRule.slice(7)),
  ]);
  const summary = adapter ? await adapter.summary(db, refOf(request)) : null;
  const myTask = tasks.find((t) => t.status === "pending" && t.assigneeMembershipId === viewer.membershipId);
  return {
    id: request.id,
    subjectType: request.subjectType,
    subjectLabel: adapter?.label ?? request.subjectType,
    title: request.title,
    status: request.status,
    policyName: request.policyName,
    submittedAt: request.submittedAt.toISOString(),
    decidedAt: request.decidedAt?.toISOString() ?? null,
    requester: { name: names.get(request.requesterMembershipId) ?? "Someone" },
    summary: summary ? { title: summary.title, lines: summary.lines, context: summary.context } : null,
    link: adapter?.link?.(refOf(request)) ?? `/inbox?request=${request.id}`,
    steps: steps.map((s) => ({
      position: s.position,
      label: s.fallback ? `${ruleLabel(s.approverRule, names)} (fallback)` : ruleLabel(s.approverRule, names),
      status: s.status,
      skipReason: s.skipReason ? (SKIP_LABEL[s.skipReason] ?? s.skipReason) : null,
      fallback: s.fallback,
      escalated: !!s.escalatedAt,
      tasks: tasks
        // Superseded tasks of other people are noise; keep the decisive and open ones.
        .filter((t) => t.position === s.position && (t.status !== "superseded" || t.supersededReason === "rerouted"))
        .map((t) => ({
          id: t.id,
          assignee: names.get(t.assigneeMembershipId) ?? "Someone",
          onBehalfOf: t.onBehalfOfMembershipId ? (names.get(t.onBehalfOfMembershipId) ?? "Someone") : null,
          origin: t.origin,
          status: t.status,
          decidedAt: t.decidedAt?.toISOString() ?? null,
          comment: t.comment,
          selfApproved: t.selfApproved,
        })),
    })),
    comments: comments.map((c) => ({
      id: c.id,
      author: names.get(c.authorMembershipId) ?? "Someone",
      body: c.body,
      createdAt: c.createdAt.toISOString(),
    })),
    viewer: {
      myTaskId: myTask?.id ?? null,
      canWithdraw: request.status === "pending" && request.requesterMembershipId === viewer.membershipId,
      canComment: request.status === "pending",
    },
  };
}

export async function listMyRequests(deps: AppDeps, viewer: ReadContext, limit = 20) {
  const registry = workflowRegistry(deps);
  const rows = await deps.db
    .select()
    .from(approvalRequests)
    .where(
      and(eq(approvalRequests.orgId, viewer.orgId), eq(approvalRequests.requesterMembershipId, viewer.membershipId)),
    )
    .orderBy(desc(approvalRequests.submittedAt))
    .limit(limit);
  const pendingIds = rows.filter((r) => r.status === "pending").map((r) => r.id);
  const open = pendingIds.length
    ? await deps.db
        .select({ requestId: approvalTasks.requestId, name: users.displayName })
        .from(approvalTasks)
        .innerJoin(memberships, eq(memberships.id, approvalTasks.assigneeMembershipId))
        .innerJoin(users, eq(users.id, memberships.userId))
        .where(
          and(
            inArray(approvalTasks.requestId, pendingIds),
            eq(approvalTasks.status, "pending"),
            sql`${approvalTasks.origin} <> 'delegated'`,
          ),
        )
    : [];
  return rows.map((r) => {
    const waiting = open.filter((o) => o.requestId === r.id).map((o) => o.name);
    return {
      id: r.id,
      subjectType: r.subjectType,
      subjectLabel: registry.subjects.get(r.subjectType)?.label ?? r.subjectType,
      title: r.title,
      status: r.status,
      submittedAt: r.submittedAt.toISOString(),
      decidedAt: r.decidedAt?.toISOString() ?? null,
      waitingOn: waiting.length
        ? waiting.length > 2
          ? `${waiting[0]} and ${waiting.length - 1} others`
          : waiting.join(" or ")
        : null,
    };
  });
}
