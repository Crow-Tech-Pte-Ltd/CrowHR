import { and, eq, inArray, isNotNull, isNull, lte, ne } from "drizzle-orm";
import { singaporeDate } from "../access/scope.ts";
import { recordAudit, systemAuditContext } from "../audit/audit.ts";
import { type ApprovalTask, approvalRequests, approvalSteps, approvalTasks } from "../db/schema/workflows.ts";
import type { AppDeps } from "../deps.ts";
import { notify } from "../notifications/notify.ts";
import { approverDirectory } from "./directory.ts";
import { createStepTasks, type EngineContext, lockRequest, memberName, subjectNoun } from "./engine.ts";
import { workflowRegistry } from "./registry.ts";
import type { DirectoryMember } from "./types.ts";

const BATCH = 100;

/**
 * Escalation sweep (spec "Escalation and reassignment"; design decision 6). For every active step
 * with a pending task past its due time and not yet escalated: remind the assignees, add a task for
 * the next level (the assignee's manager, or the hr_admins when the assignee has no manager or is
 * an hr_admin), and mark the step escalated so it happens once. Due tasks are claimed with
 * `FOR UPDATE SKIP LOCKED`, so concurrent sweeps (two replicas) never double-process.
 */
export async function sweepEscalations(deps: AppDeps, now: Date): Promise<number> {
  let escalated = 0;
  for (;;) {
    const handled = await deps.db.transaction(async (tx) => {
      const due = await tx
        .select({ id: approvalTasks.id, requestId: approvalTasks.requestId, position: approvalTasks.position })
        .from(approvalTasks)
        .where(
          and(
            eq(approvalTasks.status, "pending"),
            isNotNull(approvalTasks.dueAt),
            lte(approvalTasks.dueAt, now),
            isNull(approvalTasks.escalatedAt),
          ),
        )
        .limit(BATCH)
        .for("update", { skipLocked: true });
      if (!due.length) return { claimed: 0, done: 0 };
      const groups = new Map<string, { requestId: string; position: number }>();
      for (const t of due) groups.set(`${t.requestId}:${t.position}`, t);
      let done = 0;
      for (const group of groups.values()) {
        try {
          // Savepoint per step: one broken request never blocks the rest of the batch.
          const ok = await tx.transaction(async (sp) =>
            escalateStep({ db: sp, deps, now }, group.requestId, group.position),
          );
          if (ok) done++;
        } catch (err) {
          deps.logger.error("Escalation failed", { requestId: group.requestId, error: String(err) });
          // Mark the claimed tasks so a permanent failure doesn't spin forever.
          await tx
            .update(approvalTasks)
            .set({ escalatedAt: now })
            .where(
              and(
                eq(approvalTasks.requestId, group.requestId),
                eq(approvalTasks.position, group.position),
                eq(approvalTasks.status, "pending"),
              ),
            );
        }
      }
      return { claimed: due.length, done };
    });
    escalated += handled.done;
    if (handled.claimed < BATCH) break;
  }
  return escalated;
}

async function escalateStep(
  base: Pick<EngineContext, "db" | "deps" | "now">,
  requestId: string,
  position: number,
): Promise<boolean> {
  const { db, deps, now } = base;
  const [peek] = await db
    .select({ orgId: approvalRequests.orgId })
    .from(approvalRequests)
    .where(eq(approvalRequests.id, requestId));
  if (!peek) return false;
  const request = await lockRequest(db, peek.orgId, requestId);
  const markTasks = () =>
    db
      .update(approvalTasks)
      .set({ escalatedAt: now })
      .where(
        and(
          eq(approvalTasks.requestId, requestId),
          eq(approvalTasks.position, position),
          eq(approvalTasks.status, "pending"),
        ),
      );
  if (request?.status !== "pending") {
    await markTasks();
    return false;
  }
  const [step] = await db
    .select()
    .from(approvalSteps)
    .where(and(eq(approvalSteps.requestId, requestId), eq(approvalSteps.position, position)));
  if (step?.status !== "active" || step.escalatedAt) {
    await markTasks();
    return false;
  }
  const audit = systemAuditContext(request.orgId, "system", "escalation sweep");
  const ctx: EngineContext = { db, deps, audit, now };
  const pending: ApprovalTask[] = await db
    .select()
    .from(approvalTasks)
    .where(
      and(
        eq(approvalTasks.requestId, requestId),
        eq(approvalTasks.position, position),
        eq(approvalTasks.status, "pending"),
      ),
    );

  // 1. Remind the current assignees.
  const adapter = workflowRegistry(deps).subjects.get(request.subjectType);
  const noun = subjectNoun(adapter, request.subjectType);
  const requesterName = await memberName(ctx, request.orgId, request.requesterMembershipId);
  await notify(db, deps, {
    orgId: request.orgId,
    recipients: pending.map((t) => t.assigneeMembershipId),
    kind: "task_reminder",
    title: `Reminder: ${requesterName}'s ${noun} is waiting for you`,
    body: request.title,
    link: "/inbox",
    subjectType: request.subjectType,
    subjectId: request.subjectId,
    email: {
      headline: `${requesterName}'s ${noun} has been waiting for ${step.escalateAfterDays} days and was escalated.`,
      linkPath: "/inbox",
      actionLabel: "Review request",
    },
  });

  // 2. One level up: each original assignee's manager, or the hr_admins.
  const directory = approverDirectory(deps);
  const targets = new Map<string, DirectoryMember>();
  let needHr = false;
  for (const task of pending.filter((t) => t.origin !== "delegated")) {
    const assignee = await directory.member(db, request.orgId, task.assigneeMembershipId);
    if (!assignee || assignee.roles.includes("hr_admin") || !assignee.employeeId) {
      needHr = true;
      continue;
    }
    const managerEmp = await directory.managerOf(db, request.orgId, assignee.employeeId, singaporeDate(now));
    const manager = managerEmp ? await directory.memberForEmployee(db, request.orgId, managerEmp) : null;
    if (manager && manager.status === "active") targets.set(manager.membershipId, manager);
    else needHr = true;
  }
  if (needHr) {
    for (const hr of await directory.membersWithRole(db, request.orgId, "hr_admin")) {
      if (hr.status === "active") targets.set(hr.membershipId, hr);
    }
  }
  const already = new Set(pending.map((t) => t.assigneeMembershipId));
  const members = [...targets.values()].filter(
    (m) => m.membershipId !== request.requesterMembershipId && !already.has(m.membershipId),
  );
  if (!members.length && needHr) {
    // No hr_admin other than the current assignees: owners.
    for (const o of await directory.membersWithRole(db, request.orgId, "owner")) {
      if (o.status === "active" && o.membershipId !== request.requesterMembershipId && !already.has(o.membershipId)) {
        members.push(o);
      }
    }
  }
  const created = members.length
    ? await createStepTasks(ctx, request, step, { members, skipReason: null, viaRole: null }, "escalated")
    : [];

  await db
    .update(approvalSteps)
    .set({ escalatedAt: now })
    .where(and(eq(approvalSteps.requestId, requestId), eq(approvalSteps.position, position)));
  await db
    .update(approvalTasks)
    .set({ escalatedAt: now })
    .where(
      and(
        eq(approvalTasks.requestId, requestId),
        eq(approvalTasks.position, position),
        ne(approvalTasks.origin, "escalated"),
        inArray(
          approvalTasks.id,
          pending.map((t) => t.id),
        ),
      ),
    );
  await recordAudit(db, deps, audit, {
    action: "approval.escalated",
    targetType: "approval_request",
    targetId: requestId,
    meta: { position, to: created.map((t) => t.assigneeMembershipId) },
  });
  return true;
}
