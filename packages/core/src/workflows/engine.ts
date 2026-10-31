import { and, asc, eq, gte, inArray, isNull, lte, ne, or, sql } from "drizzle-orm";
import type { AssignedRole } from "../access/matrix.ts";
import { singaporeDate } from "../access/scope.ts";
import { selfApproval } from "../access/self-change.ts";
import { type AuditContext, recordAudit } from "../audit/audit.ts";
import {
  type ApprovalRequest,
  type ApprovalStep,
  type ApprovalTask,
  approvalComments,
  approvalRequests,
  approvalSteps,
  approvalTasks,
  delegations,
  type SubjectAttributes,
} from "../db/schema/workflows.ts";
import type { Db } from "../db/types.ts";
import type { AppDeps } from "../deps.ts";
import { AppError } from "../errors.ts";
import type { NotificationKind } from "../notifications/kinds.ts";
import { notify } from "../notifications/notify.ts";
import { approverDirectory } from "./directory.ts";
import { DEFAULT_ESCALATE_AFTER_DAYS, resolvePolicy } from "./policies.ts";
import { workflowRegistry } from "./registry.ts";
import type { AnySubjectAdapter, DirectoryMember, FinalDecision, ReadContext, SubjectRef } from "./types.ts";

/**
 * The approval engine ("workflows" spec; design decisions 2–4).
 *
 * - The chain is snapshotted at submission as approver *rules*; each step is resolved to people
 *   only when it becomes active (so delegation and manager re-routing work).
 * - Every decision locks the request row (`SELECT … FOR UPDATE`), checks the task is still
 *   pending, writes the decision, advances or finalises, runs the module callback, then writes
 *   audit and notifications, all in one transaction. A concurrent decision gets 409
 *   `already_decided`; a throwing callback rolls everything back.
 */

const DAY_MS = 86_400_000;
export const COMMENT_MAX = 500;

interface Ctx {
  db: Db;
  deps: AppDeps;
  audit: AuditContext;
  now: Date;
}

export type TaskOrigin = ApprovalTask["origin"];

function refOf(request: ApprovalRequest): SubjectRef {
  return {
    orgId: request.orgId,
    subjectType: request.subjectType,
    subjectId: request.subjectId,
    requestId: request.id,
    requesterMembershipId: request.requesterMembershipId,
    requesterEmployeeId: request.requesterEmployeeId,
    attributes: request.attributes ?? {},
  };
}

function adapterFor(deps: AppDeps, type: string): AnySubjectAdapter {
  return workflowRegistry(deps).subject(type);
}

export function subjectNoun(adapter: AnySubjectAdapter | undefined, type: string): string {
  return `${(adapter?.label ?? type.replace(/_/g, " ")).toLowerCase()} request`;
}

function requestLink(deps: AppDeps, request: ApprovalRequest): string {
  const adapter = workflowRegistry(deps).subjects.get(request.subjectType);
  return adapter?.link?.(refOf(request)) ?? `/inbox?request=${request.id}`;
}

async function memberName(ctx: Pick<Ctx, "db" | "deps">, orgId: string, membershipId: string): Promise<string> {
  const m = await approverDirectory(ctx.deps).member(ctx.db, orgId, membershipId);
  return m?.displayName ?? "Someone";
}

async function loadSteps(db: Db, requestId: string): Promise<ApprovalStep[]> {
  return db
    .select()
    .from(approvalSteps)
    .where(eq(approvalSteps.requestId, requestId))
    .orderBy(asc(approvalSteps.position));
}

async function lockRequest(db: Db, orgId: string, requestId: string): Promise<ApprovalRequest | null> {
  const [row] = await db
    .select()
    .from(approvalRequests)
    .where(and(eq(approvalRequests.orgId, orgId), eq(approvalRequests.id, requestId)))
    .for("update");
  return row ?? null;
}

// ---------------------------------------------------------------------------------------------
// Approver resolution
// ---------------------------------------------------------------------------------------------

export type SkipReason = "self" | "no_manager" | "inactive" | "no_members";

export interface Resolution {
  members: DirectoryMember[];
  skipReason: SkipReason | null;
  /** Role-based steps delegate only to members holding that role. */
  viaRole: AssignedRole | null;
  selfApproved?: boolean;
}

async function managerMember(
  ctx: Pick<Ctx, "db" | "deps" | "now">,
  orgId: string,
  employeeId: string,
): Promise<{ member: DirectoryMember | null; managerEmployeeId: string | null }> {
  const directory = approverDirectory(ctx.deps);
  const managerEmployeeId = await directory.managerOf(ctx.db, orgId, employeeId, singaporeDate(ctx.now));
  if (!managerEmployeeId || managerEmployeeId === employeeId) return { member: null, managerEmployeeId: null };
  return { member: await directory.memberForEmployee(ctx.db, orgId, managerEmployeeId), managerEmployeeId };
}

/** Resolves one approver rule for a request (spec "Approver resolution and fallback"). */
export async function resolveRule(
  ctx: Pick<Ctx, "db" | "deps" | "now">,
  request: Pick<ApprovalRequest, "orgId" | "requesterMembershipId" | "requesterEmployeeId">,
  rule: string,
): Promise<Resolution> {
  const directory = approverDirectory(ctx.deps);
  const requester = request.requesterMembershipId;
  const none = (skipReason: SkipReason): Resolution => ({ members: [], skipReason, viaRole: null });
  const single = (m: DirectoryMember | null, missing: SkipReason): Resolution => {
    if (!m) return none(missing);
    if (m.membershipId === requester) return none("self");
    if (m.status !== "active") return none("inactive");
    return { members: [m], skipReason: null, viaRole: null };
  };

  if (rule === "manager" || rule === "manager_of_manager") {
    if (!request.requesterEmployeeId) return none("no_manager");
    const first = await managerMember(ctx, request.orgId, request.requesterEmployeeId);
    if (rule === "manager") return single(first.member, "no_manager");
    if (!first.managerEmployeeId) return none("no_manager");
    const second = await managerMember(ctx, request.orgId, first.managerEmployeeId);
    return single(second.member, "no_manager");
  }
  if (rule.startsWith("role:")) {
    const role = rule.slice(5) as AssignedRole;
    const holders = (await directory.membersWithRole(ctx.db, request.orgId, role)).filter((m) => m.status === "active");
    const others = holders.filter((m) => m.membershipId !== requester);
    if (others.length) return { members: others, skipReason: null, viaRole: role };
    return none(holders.length ? "self" : "no_members");
  }
  if (rule.startsWith("member:")) {
    return single(await directory.member(ctx.db, request.orgId, rule.slice(7)), "no_members");
  }
  return none("no_members");
}

/**
 * When every configured step was skipped: hr_admins; for payroll (or when the requester is the
 * only hr_admin) owners; and if nobody but the requester is eligible, an owner-requester may
 * decide with the decision marked `self_approved`.
 */
async function fallbackResolution(ctx: Ctx, request: ApprovalRequest): Promise<(Resolution & { rule: string }) | null> {
  const directory = approverDirectory(ctx.deps);
  const requester = request.requesterMembershipId;
  if (request.subjectType !== "payroll_run") {
    const hr = (await directory.membersWithRole(ctx.db, request.orgId, "hr_admin")).filter(
      (m) => m.status === "active" && m.membershipId !== requester,
    );
    if (hr.length) return { rule: "role:hr_admin", members: hr, skipReason: null, viaRole: "hr_admin" };
  }
  const owners = (await directory.membersWithRole(ctx.db, request.orgId, "owner")).filter((m) => m.status === "active");
  const others = owners.filter((m) => m.membershipId !== requester);
  if (others.length) return { rule: "role:owner", members: others, skipReason: null, viaRole: "owner" };
  const self = owners.find((m) => m.membershipId === requester);
  if (self && selfApproval({ roles: self.roles }, 0).allowed) {
    return { rule: "role:owner", members: [self], skipReason: null, viaRole: "owner", selfApproved: true };
  }
  return null;
}

// ---------------------------------------------------------------------------------------------
// Tasks, delegation and notifications
// ---------------------------------------------------------------------------------------------

const KIND_FOR_ORIGIN: Record<TaskOrigin, NotificationKind> = {
  resolved: "task_assigned",
  delegated: "task_assigned",
  escalated: "task_escalated",
  reassigned: "task_reassigned",
};

async function notifyAssignees(ctx: Ctx, request: ApprovalRequest, tasks: ApprovalTask[]) {
  if (!tasks.length) return;
  const adapter = workflowRegistry(ctx.deps).subjects.get(request.subjectType);
  const requesterName = await memberName(ctx, request.orgId, request.requesterMembershipId);
  const noun = subjectNoun(adapter, request.subjectType);
  for (const task of tasks) {
    const kind = KIND_FOR_ORIGIN[task.origin];
    const onBehalf = task.onBehalfOfMembershipId
      ? await memberName(ctx, request.orgId, task.onBehalfOfMembershipId)
      : null;
    const prefix = kind === "task_escalated" ? "Escalated: " : kind === "task_reassigned" ? "Reassigned: " : "";
    const title = `${prefix}${requesterName}'s ${noun} needs your approval`;
    const detail = onBehalf ? `You are covering for ${onBehalf}.` : undefined;
    await notify(ctx.db, ctx.deps, {
      orgId: request.orgId,
      recipients: [task.assigneeMembershipId],
      kind,
      title,
      body: [request.title, detail].filter(Boolean).join(" · "),
      link: `/inbox?task=${task.id}`,
      subjectType: request.subjectType,
      subjectId: request.subjectId,
      email: {
        headline: `${requesterName} sent a ${noun} that needs your approval.`,
        ...(detail ? { detail } : {}),
        linkPath: `/inbox?task=${task.id}`,
        actionLabel: "Review request",
      },
    });
  }
}

interface NewTask {
  position: number;
  assignee: DirectoryMember;
  origin: TaskOrigin;
  onBehalfOf?: string | null;
  viaRole: AssignedRole | null;
  dueAt: Date | null;
  selfApproved?: boolean;
}

/** Inserts tasks (an existing open task for the same person and step is kept: idempotent). */
async function insertTasks(ctx: Ctx, request: ApprovalRequest, items: NewTask[]): Promise<ApprovalTask[]> {
  const created: ApprovalTask[] = [];
  for (const item of items) {
    if (item.assignee.membershipId === request.requesterMembershipId && !item.selfApproved) continue;
    const rows = await ctx.db
      .insert(approvalTasks)
      .values({
        id: ctx.deps.ids.newId(),
        orgId: request.orgId,
        requestId: request.id,
        position: item.position,
        assigneeMembershipId: item.assignee.membershipId,
        onBehalfOfMembershipId: item.onBehalfOf ?? null,
        origin: item.origin,
        status: "pending",
        viaRole: item.viaRole,
        dueAt: item.dueAt,
        selfApproved: item.selfApproved ?? false,
        createdAt: ctx.now,
      })
      .onConflictDoNothing()
      .returning();
    if (rows[0]) created.push(rows[0]);
  }
  return created;
}

/** Active delegations from `membershipId` covering `today` and `subjectType`. */
export async function activeDelegationsFrom(
  db: Db,
  orgId: string,
  membershipIds: readonly string[],
  today: string,
  subjectType?: string,
) {
  if (!membershipIds.length) return [];
  const rows = await db
    .select()
    .from(delegations)
    .where(
      and(
        eq(delegations.orgId, orgId),
        inArray(delegations.fromMembershipId, [...membershipIds]),
        isNull(delegations.revokedAt),
        lte(delegations.startsOn, today),
        gte(delegations.endsOn, today),
      ),
    );
  return rows.filter((d) => !subjectType || !d.subjectTypes?.length || d.subjectTypes.includes(subjectType));
}

/**
 * Adds delegate tasks for open tasks of members who are out of office (design decision 3).
 * Delegated tasks are never re-delegated, so A→B plus B→A cannot loop.
 */
export async function applyDelegations(
  ctx: Ctx,
  request: ApprovalRequest,
  tasks: ApprovalTask[],
): Promise<ApprovalTask[]> {
  const original = tasks.filter((t) => t.status === "pending" && t.origin !== "delegated");
  if (!original.length) return [];
  const today = singaporeDate(ctx.now);
  const found = await activeDelegationsFrom(
    ctx.db,
    request.orgId,
    original.map((t) => t.assigneeMembershipId),
    today,
    request.subjectType,
  );
  if (!found.length) return [];
  const directory = approverDirectory(ctx.deps);
  const items: NewTask[] = [];
  for (const task of original) {
    for (const d of found.filter((x) => x.fromMembershipId === task.assigneeMembershipId)) {
      if (d.toMembershipId === request.requesterMembershipId) continue; // never for their own request
      const delegate = await directory.member(ctx.db, request.orgId, d.toMembershipId);
      if (delegate?.status !== "active") continue;
      if (task.viaRole && !delegate.roles.includes(task.viaRole as AssignedRole)) continue;
      items.push({
        position: task.position,
        assignee: delegate,
        origin: "delegated",
        onBehalfOf: task.assigneeMembershipId,
        viaRole: (task.viaRole as AssignedRole | null) ?? null,
        dueAt: task.dueAt,
      });
    }
  }
  return insertTasks(ctx, request, items);
}

async function createStepTasks(
  ctx: Ctx,
  request: ApprovalRequest,
  step: Pick<ApprovalStep, "position" | "escalateAfterDays">,
  resolution: Resolution,
  origin: TaskOrigin = "resolved",
): Promise<ApprovalTask[]> {
  const dueAt =
    origin === "escalated" || step.escalateAfterDays <= 0
      ? null
      : new Date(ctx.now.getTime() + step.escalateAfterDays * DAY_MS);
  const created = await insertTasks(
    ctx,
    request,
    resolution.members.map((m) => ({
      position: step.position,
      assignee: m,
      origin,
      viaRole: resolution.viaRole,
      dueAt,
      selfApproved: resolution.selfApproved ?? false,
    })),
  );
  const delegated = await applyDelegations(ctx, request, created);
  await notifyAssignees(ctx, request, [...created, ...delegated]);
  return [...created, ...delegated];
}

// ---------------------------------------------------------------------------------------------
// Advancing and finalising
// ---------------------------------------------------------------------------------------------

/** Activates the next resolvable waiting step. Returns `approved` when the chain is complete. */
async function advance(ctx: Ctx, request: ApprovalRequest): Promise<"pending" | "approved"> {
  const steps = await loadSteps(ctx.db, request.id);
  const anyApproved = steps.some((s) => s.status === "approved");
  for (const step of steps.filter((s) => s.status === "waiting")) {
    const resolution = await resolveRule(ctx, request, step.approverRule);
    if (!resolution.members.length) {
      await ctx.db
        .update(approvalSteps)
        .set({ status: "skipped", skipReason: resolution.skipReason })
        .where(and(eq(approvalSteps.requestId, request.id), eq(approvalSteps.position, step.position)));
      continue;
    }
    await activateStep(ctx, request, step, resolution);
    return "pending";
  }
  if (anyApproved) return "approved";

  const fallback = await fallbackResolution(ctx, request);
  if (!fallback) {
    ctx.deps.logger.warn("Approval request has no eligible approver", { requestId: request.id });
    return "pending";
  }
  const position = Math.max(0, ...steps.map((s) => s.position)) + 1;
  const [step] = await ctx.db
    .insert(approvalSteps)
    .values({
      orgId: request.orgId,
      requestId: request.id,
      position,
      approverRule: fallback.rule,
      escalateAfterDays: DEFAULT_ESCALATE_AFTER_DAYS,
      status: "waiting",
      fallback: true,
    })
    .returning();
  if (step) await activateStep(ctx, request, step, fallback);
  return "pending";
}

async function activateStep(ctx: Ctx, request: ApprovalRequest, step: ApprovalStep, resolution: Resolution) {
  await ctx.db
    .update(approvalSteps)
    .set({ status: "active", activatedAt: ctx.now })
    .where(and(eq(approvalSteps.requestId, request.id), eq(approvalSteps.position, step.position)));
  await ctx.db
    .update(approvalRequests)
    .set({ currentPosition: step.position })
    .where(eq(approvalRequests.id, request.id));
  request.currentPosition = step.position;
  await createStepTasks(ctx, request, step, resolution);
}

async function supersedeOpenTasks(
  db: Db,
  requestId: string,
  reason: string,
  extra?: ReturnType<typeof eq>,
): Promise<ApprovalTask[]> {
  return db
    .update(approvalTasks)
    .set({ status: "superseded", supersededReason: reason })
    .where(and(eq(approvalTasks.requestId, requestId), eq(approvalTasks.status, "pending"), extra))
    .returning();
}

async function finalise(ctx: Ctx, request: ApprovalRequest, decision: FinalDecision): Promise<void> {
  const adapter = adapterFor(ctx.deps, request.subjectType);
  await ctx.db
    .update(approvalRequests)
    .set({ status: decision.outcome, decidedAt: decision.decidedAt })
    .where(eq(approvalRequests.id, request.id));
  request.status = decision.outcome;
  await supersedeOpenTasks(ctx.db, request.id, "decided_by_other");
  const ref = refOf(request);
  if (decision.outcome === "approved") await adapter.onApproved(ctx.db, ref, decision);
  else await adapter.onRejected(ctx.db, ref, decision);

  const noun = subjectNoun(adapter, request.subjectType);
  const deciderName = await memberName(ctx, request.orgId, decision.decidedByMembershipId);
  const approved = decision.outcome === "approved";
  const link = requestLink(ctx.deps, request);
  await notify(ctx.db, ctx.deps, {
    orgId: request.orgId,
    recipients: [request.requesterMembershipId],
    kind: approved ? "request_approved" : "request_rejected",
    title: approved ? `Your ${noun} was approved` : `Your ${noun} was not approved`,
    body: approved ? request.title : `${deciderName}: ${decision.comment ?? ""}`.trim(),
    link,
    subjectType: request.subjectType,
    subjectId: request.subjectId,
    email: {
      headline: approved ? `Your ${noun} was approved.` : `${deciderName} did not approve your ${noun}.`,
      ...(!approved && decision.comment ? { detail: `Comment: ${decision.comment}` } : {}),
      linkPath: link,
      actionLabel: "View request",
    },
  });
}

// ---------------------------------------------------------------------------------------------
// Public API: submit, decide, withdraw, comment, reassign, reroute
// ---------------------------------------------------------------------------------------------

export interface SubmitInput {
  orgId: string;
  subjectType: string;
  subjectId: string;
  requesterMembershipId: string;
  requesterEmployeeId?: string | null;
  attributes?: SubjectAttributes;
}

export interface SubmitResult {
  requestId: string;
  status: ApprovalRequest["status"];
  /** False when an open request for this subject already existed (idempotent resubmit). */
  created: boolean;
}

/**
 * Submits a subject for approval. Call it inside the module's own transaction so the subject row
 * and the request commit together:
 *
 *   await deps.db.transaction(async (tx) => {
 *     await tx.insert(leaveRequests).values(row);
 *     await submitApproval(tx, deps, auditContext(c), { orgId, subjectType: "leave", subjectId: row.id, … });
 *   });
 */
export async function submitApproval(
  db: Db,
  deps: AppDeps,
  audit: AuditContext,
  input: SubmitInput,
): Promise<SubmitResult> {
  const adapter = adapterFor(deps, input.subjectType);
  const parsed = adapter.attributes
    ? adapter.attributes.safeParse(input.attributes ?? {})
    : { success: true as const, data: input.attributes ?? {} };
  if (!parsed.success) {
    throw new AppError("validation_failed", "The request's details are not valid.", {
      issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
    });
  }
  const attributes = parsed.data as SubjectAttributes;
  if (attributes.amountCents !== undefined && !Number.isSafeInteger(attributes.amountCents)) {
    throw new AppError("validation_failed", "amountCents must be a whole number of cents.");
  }
  const [existing] = await db
    .select()
    .from(approvalRequests)
    .where(
      and(
        eq(approvalRequests.orgId, input.orgId),
        eq(approvalRequests.subjectType, input.subjectType),
        eq(approvalRequests.subjectId, input.subjectId),
        eq(approvalRequests.status, "pending"),
      ),
    );
  if (existing) return { requestId: existing.id, status: existing.status, created: false };

  const now = deps.clock.now();
  const ctx: Ctx = { db, deps, audit, now };
  const id = deps.ids.newId();
  const ref: SubjectRef = {
    orgId: input.orgId,
    subjectType: input.subjectType,
    subjectId: input.subjectId,
    requestId: id,
    requesterMembershipId: input.requesterMembershipId,
    requesterEmployeeId: input.requesterEmployeeId ?? null,
    attributes,
  };
  await adapter.validate?.(db, ref);
  const summary = await adapter.summary(db, ref);
  const policy = await resolvePolicy(db, input.orgId, input.subjectType, attributes, adapter);
  const [request] = await db
    .insert(approvalRequests)
    .values({
      id,
      orgId: input.orgId,
      subjectType: input.subjectType,
      subjectId: input.subjectId,
      requesterMembershipId: input.requesterMembershipId,
      requesterEmployeeId: input.requesterEmployeeId ?? null,
      policyId: policy.policyId,
      policyName: policy.name,
      status: "pending",
      currentPosition: 1,
      attributes,
      title: summary.title.slice(0, 200),
      submittedAt: now,
    })
    .returning();
  if (!request) throw new Error("approval request insert returned nothing");
  await db.insert(approvalSteps).values(
    policy.steps.map((s, i) => ({
      orgId: input.orgId,
      requestId: id,
      position: i + 1,
      approverRule: s.approverRule,
      escalateAfterDays: s.escalateAfterDays,
      status: "waiting" as const,
    })),
  );
  await recordAudit(db, deps, audit, {
    action: "approval.submitted",
    targetType: "approval_request",
    targetId: id,
    meta: { subjectType: input.subjectType, subjectId: input.subjectId, policy: policy.name },
  });
  const state = await advance(ctx, request);
  if (state === "approved") {
    // Cannot happen on submit (no step is approved yet); guarded for completeness.
    throw new Error("approval chain completed without a decision");
  }
  return { requestId: id, status: "pending", created: true };
}

export interface Actor {
  orgId: string;
  membershipId: string;
  roles: readonly AssignedRole[];
  audit: AuditContext;
}

export interface DecideInput {
  taskId: string;
  decision: "approve" | "reject";
  comment?: string | null;
}

export interface DecideResult {
  taskId: string;
  requestId: string;
  outcome: "approved" | "rejected";
  requestStatus: ApprovalRequest["status"];
  /** True when this exact decision had already been recorded by the same member (safe retry). */
  replayed: boolean;
}

async function alreadyDecided(db: Db, deps: AppDeps, request: ApprovalRequest, task: ApprovalTask): Promise<AppError> {
  const [decider] = await db
    .select()
    .from(approvalTasks)
    .where(
      and(
        eq(approvalTasks.requestId, request.id),
        eq(approvalTasks.position, task.position),
        inArray(approvalTasks.status, ["approved", "rejected"]),
      ),
    );
  const by = decider ? await memberName({ db, deps }, request.orgId, decider.assigneeMembershipId) : null;
  const what =
    request.status === "withdrawn"
      ? "This request was withdrawn."
      : by
        ? `${by} already ${decider?.status} this.`
        : "This request was already decided or moved to someone else.";
  return new AppError("already_decided", `${what} Nothing was changed.`, {
    decidedBy: by,
    decidedAt: decider?.decidedAt?.toISOString() ?? request.decidedAt?.toISOString() ?? null,
    outcome: decider?.status ?? request.status,
  });
}

/** Records a decision on one task (idempotent for an identical retry by the same member). */
export async function decideTask(deps: AppDeps, actor: Actor, input: DecideInput): Promise<DecideResult> {
  const comment = input.comment?.trim() || null;
  if (input.decision === "reject" && !comment) {
    throw new AppError("validation_failed", "Say why you're rejecting this, so the requester knows what to change.", {
      issues: [{ path: "comment", message: "Add a comment of 1 to 500 characters." }],
    });
  }
  if (comment && comment.length > COMMENT_MAX) {
    throw new AppError("validation_failed", `Keep the comment to ${COMMENT_MAX} characters.`, {
      issues: [{ path: "comment", message: `Shorten the comment to ${COMMENT_MAX} characters or fewer.` }],
    });
  }
  const outcome = input.decision === "approve" ? "approved" : "rejected";
  return deps.db.transaction(async (tx) => {
    const now = deps.clock.now();
    const ctx: Ctx = { db: tx, deps, audit: actor.audit, now };
    const [found] = await tx
      .select({ requestId: approvalTasks.requestId, assignee: approvalTasks.assigneeMembershipId })
      .from(approvalTasks)
      .where(and(eq(approvalTasks.orgId, actor.orgId), eq(approvalTasks.id, input.taskId)));
    if (!found || found.assignee !== actor.membershipId) {
      throw new AppError("not_found", "That approval task doesn't exist or isn't assigned to you.");
    }
    const request = await lockRequest(tx, actor.orgId, found.requestId);
    if (!request) throw new AppError("not_found", "That approval task doesn't exist or isn't assigned to you.");
    const [task] = await tx.select().from(approvalTasks).where(eq(approvalTasks.id, input.taskId));
    if (!task) throw new AppError("not_found", "That approval task doesn't exist or isn't assigned to you.");

    if (task.status !== "pending" || request.status !== "pending") {
      if (task.status === outcome && (task.comment ?? null) === comment) {
        return { taskId: task.id, requestId: request.id, outcome, requestStatus: request.status, replayed: true };
      }
      throw await alreadyDecided(tx, deps, request, task);
    }
    if (request.requesterMembershipId === actor.membershipId && !task.selfApproved) {
      throw new AppError("forbidden", "You can't decide your own request. Someone else needs to approve it.");
    }

    await tx
      .update(approvalTasks)
      .set({ status: outcome, decidedAt: now, comment })
      .where(eq(approvalTasks.id, task.id));
    await supersedeOpenTasks(tx, request.id, "decided_by_other", eq(approvalTasks.position, task.position));
    await tx
      .update(approvalSteps)
      .set({ status: outcome, decidedAt: now })
      .where(and(eq(approvalSteps.requestId, request.id), eq(approvalSteps.position, task.position)));

    const decision: FinalDecision = {
      outcome,
      decidedByMembershipId: actor.membershipId,
      onBehalfOfMembershipId: task.onBehalfOfMembershipId,
      comment,
      selfApproved: task.selfApproved,
      decidedAt: now,
    };
    let requestStatus: ApprovalRequest["status"] = "pending";
    if (outcome === "rejected") {
      await finalise(ctx, request, decision);
      requestStatus = "rejected";
    } else if ((await advance(ctx, request)) === "approved") {
      await finalise(ctx, request, decision);
      requestStatus = "approved";
    }
    await recordAudit(tx, deps, actor.audit, {
      action: "approval.decided",
      targetType: "approval_request",
      targetId: request.id,
      meta: {
        taskId: task.id,
        position: task.position,
        outcome,
        subjectType: request.subjectType,
        onBehalfOf: task.onBehalfOfMembershipId,
        selfApproved: task.selfApproved,
        requestStatus,
      },
    });
    return { taskId: task.id, requestId: request.id, outcome, requestStatus, replayed: false };
  });
}

/** The requester withdraws a pending request (spec "Withdraw and cancel"). */
export async function withdrawRequest(deps: AppDeps, actor: Actor, requestId: string) {
  return deps.db.transaction(async (tx) => {
    const request = await lockRequest(tx, actor.orgId, requestId);
    if (!request || request.requesterMembershipId !== actor.membershipId) {
      throw new AppError("not_found", "That request doesn't exist or isn't yours to withdraw.");
    }
    return withdrawLocked({ db: tx, deps, audit: actor.audit, now: deps.clock.now() }, request);
  });
}

/** For modules: withdraw the open request of a subject (e.g. the leave was deleted). */
export async function withdrawSubject(
  db: Db,
  deps: AppDeps,
  audit: AuditContext,
  input: { orgId: string; subjectType: string; subjectId: string },
): Promise<boolean> {
  const [open] = await db
    .select({ id: approvalRequests.id })
    .from(approvalRequests)
    .where(
      and(
        eq(approvalRequests.orgId, input.orgId),
        eq(approvalRequests.subjectType, input.subjectType),
        eq(approvalRequests.subjectId, input.subjectId),
        eq(approvalRequests.status, "pending"),
      ),
    );
  if (!open) return false;
  const request = await lockRequest(db, input.orgId, open.id);
  if (!request) return false;
  await withdrawLocked({ db, deps, audit, now: deps.clock.now() }, request);
  return true;
}

async function withdrawLocked(ctx: Ctx, request: ApprovalRequest) {
  if (request.status !== "pending") {
    throw new AppError("already_decided", `This request is already ${request.status}. Nothing was changed.`, {
      outcome: request.status,
      decidedAt: request.decidedAt?.toISOString() ?? null,
      decidedBy: null,
    });
  }
  await ctx.db
    .update(approvalRequests)
    .set({ status: "withdrawn", decidedAt: ctx.now })
    .where(eq(approvalRequests.id, request.id));
  request.status = "withdrawn";
  const closed = await supersedeOpenTasks(ctx.db, request.id, "withdrawn");
  const adapter = adapterFor(ctx.deps, request.subjectType);
  await adapter.onWithdrawn?.(ctx.db, refOf(request));
  const name = await memberName(ctx, request.orgId, request.requesterMembershipId);
  const noun = subjectNoun(adapter, request.subjectType);
  await notify(ctx.db, ctx.deps, {
    orgId: request.orgId,
    recipients: closed.map((t) => t.assigneeMembershipId),
    kind: "request_withdrawn",
    title: `${name} withdrew a ${noun}`,
    body: request.title,
    link: `/inbox?request=${request.id}`,
    subjectType: request.subjectType,
    subjectId: request.subjectId,
  });
  await recordAudit(ctx.db, ctx.deps, ctx.audit, {
    action: "approval.withdrawn",
    targetType: "approval_request",
    targetId: request.id,
    meta: { subjectType: request.subjectType },
  });
  return { requestId: request.id, status: "withdrawn" as const };
}

/** Who may read a request (and so the subject summary). Delegates only while their task is open. */
export async function canReadRequest(
  db: Db,
  deps: AppDeps,
  viewer: ReadContext,
  request: ApprovalRequest,
): Promise<boolean> {
  if (request.orgId !== viewer.orgId) return false;
  if (request.requesterMembershipId === viewer.membershipId) return true;
  const mine = await db
    .select({ origin: approvalTasks.origin, status: approvalTasks.status })
    .from(approvalTasks)
    .where(and(eq(approvalTasks.requestId, request.id), eq(approvalTasks.assigneeMembershipId, viewer.membershipId)));
  if (mine.some((t) => t.origin !== "delegated" || t.status === "pending")) return true;
  if (viewer.roles.includes("owner")) return true;
  if (viewer.roles.includes("hr_admin") && request.subjectType !== "payroll_run") return true;
  const adapter = workflowRegistry(deps).subjects.get(request.subjectType);
  return (await adapter?.canRead?.(db, viewer, refOf(request))) ?? false;
}

export async function addComment(
  deps: AppDeps,
  actor: Actor & ReadContext,
  requestId: string,
  body: string,
): Promise<{ id: string }> {
  const text = body.trim();
  if (!text || text.length > COMMENT_MAX) {
    throw new AppError("validation_failed", `Write a comment of 1 to ${COMMENT_MAX} characters.`, {
      issues: [{ path: "body", message: `Write 1 to ${COMMENT_MAX} characters.` }],
    });
  }
  return deps.db.transaction(async (tx) => {
    const request = await lockRequest(tx, actor.orgId, requestId);
    if (!request || !(await canReadRequest(tx, deps, actor, request))) {
      throw new AppError("not_found", "That request doesn't exist or you can't see it.");
    }
    const id = deps.ids.newId();
    const now = deps.clock.now();
    await tx.insert(approvalComments).values({
      id,
      orgId: actor.orgId,
      requestId,
      authorMembershipId: actor.membershipId,
      body: text,
      createdAt: now,
    });
    const open = await tx
      .select({ assignee: approvalTasks.assigneeMembershipId })
      .from(approvalTasks)
      .where(and(eq(approvalTasks.requestId, requestId), eq(approvalTasks.status, "pending")));
    const recipients = [request.requesterMembershipId, ...open.map((t) => t.assignee)].filter(
      (m) => m !== actor.membershipId,
    );
    const author = await memberName({ db: tx, deps }, actor.orgId, actor.membershipId);
    await notify(tx, deps, {
      orgId: actor.orgId,
      recipients,
      kind: "request_comment",
      title: `${author} commented on ${request.title}`,
      body: text,
      link: `/inbox?request=${requestId}`,
      subjectType: request.subjectType,
      subjectId: request.subjectId,
    });
    return { id };
  });
}

/** Owners and hr_admins move a pending task to another eligible member, with a reason. */
export async function reassignTask(
  deps: AppDeps,
  actor: Actor,
  input: { taskId: string; toMembershipId: string; reason: string },
) {
  const reason = input.reason.trim();
  if (!reason) {
    throw new AppError("validation_failed", "Say why you're reassigning this task.", {
      issues: [{ path: "reason", message: "Add a reason of 1 to 500 characters." }],
    });
  }
  return deps.db.transaction(async (tx) => {
    const now = deps.clock.now();
    const ctx: Ctx = { db: tx, deps, audit: actor.audit, now };
    const [found] = await tx
      .select()
      .from(approvalTasks)
      .where(and(eq(approvalTasks.orgId, actor.orgId), eq(approvalTasks.id, input.taskId)));
    if (!found) throw new AppError("not_found", "That approval task doesn't exist.");
    const request = await lockRequest(tx, actor.orgId, found.requestId);
    if (!request) throw new AppError("not_found", "That approval task doesn't exist.");
    if (request.subjectType === "payroll_run" && !actor.roles.includes("owner")) {
      throw new AppError("not_found", "That approval task doesn't exist.");
    }
    const [task] = await tx.select().from(approvalTasks).where(eq(approvalTasks.id, found.id));
    if (task?.status !== "pending" || request.status !== "pending")
      throw await alreadyDecided(tx, deps, request, found);
    const target = await approverDirectory(deps).member(tx, actor.orgId, input.toMembershipId);
    if (target?.status !== "active") {
      throw new AppError("validation_failed", "Choose an active member to reassign to.", {
        issues: [{ path: "toMembershipId", message: "Pick an active member of this organisation." }],
      });
    }
    if (target.membershipId === request.requesterMembershipId) {
      throw new AppError("validation_failed", "The requester can't approve their own request. Choose someone else.", {
        issues: [{ path: "toMembershipId", message: "Choose someone other than the requester." }],
      });
    }
    await tx
      .update(approvalTasks)
      .set({ status: "superseded", supersededReason: "reassigned" })
      .where(eq(approvalTasks.id, task.id));
    const created = await insertTasks(ctx, request, [
      { position: task.position, assignee: target, origin: "reassigned", viaRole: null, dueAt: task.dueAt },
    ]);
    const delegated = await applyDelegations(ctx, request, created);
    await notifyAssignees(ctx, request, [...created, ...delegated]);
    await recordAudit(tx, deps, actor.audit, {
      action: "approval.task_reassigned",
      targetType: "approval_request",
      targetId: request.id,
      meta: { taskId: task.id, from: task.assigneeMembershipId, to: target.membershipId, reason: reason.slice(0, 500) },
    });
    return { taskId: created[0]?.id ?? null, requestId: request.id };
  });
}

/**
 * Lifecycle hook for the people module: call it (inside the transaction that changes the
 * reporting line) when an employee's manager changes. Open `manager` / `manager_of_manager` tasks
 * on that employee's pending requests move to the new resolution (spec "Manager change reroutes").
 */
export async function onReportingLineChanged(
  db: Db,
  deps: AppDeps,
  audit: AuditContext,
  input: { orgId: string; employeeId: string },
): Promise<number> {
  const now = deps.clock.now();
  const ctx: Ctx = { db, deps, audit, now };
  const pending = await db
    .select({ id: approvalRequests.id })
    .from(approvalRequests)
    .where(
      and(
        eq(approvalRequests.orgId, input.orgId),
        eq(approvalRequests.requesterEmployeeId, input.employeeId),
        eq(approvalRequests.status, "pending"),
      ),
    );
  let moved = 0;
  for (const { id } of pending) {
    const request = await lockRequest(db, input.orgId, id);
    if (request?.status !== "pending") continue;
    const [step] = await db
      .select()
      .from(approvalSteps)
      .where(and(eq(approvalSteps.requestId, id), eq(approvalSteps.position, request.currentPosition)));
    if (step?.status !== "active") continue;
    if (step.approverRule !== "manager" && step.approverRule !== "manager_of_manager") continue;
    const resolution = await resolveRule(ctx, request, step.approverRule);
    const open = await db
      .select()
      .from(approvalTasks)
      .where(
        and(
          eq(approvalTasks.requestId, id),
          eq(approvalTasks.position, step.position),
          eq(approvalTasks.status, "pending"),
          or(eq(approvalTasks.origin, "resolved"), eq(approvalTasks.origin, "delegated")),
        ),
      );
    const current = new Set(open.filter((t) => t.origin === "resolved").map((t) => t.assigneeMembershipId));
    const next = new Set(resolution.members.map((m) => m.membershipId));
    if (current.size === next.size && [...next].every((m) => current.has(m))) continue;
    await db
      .update(approvalTasks)
      .set({ status: "superseded", supersededReason: "rerouted" })
      .where(
        and(
          eq(approvalTasks.requestId, id),
          eq(approvalTasks.position, step.position),
          eq(approvalTasks.status, "pending"),
          or(eq(approvalTasks.origin, "resolved"), eq(approvalTasks.origin, "delegated")),
        ),
      );
    if (resolution.members.length) {
      await createStepTasks(ctx, request, step, resolution);
    } else {
      const others = await db
        .select({ id: approvalTasks.id })
        .from(approvalTasks)
        .where(and(eq(approvalTasks.requestId, id), eq(approvalTasks.status, "pending")));
      if (!others.length) {
        await db
          .update(approvalSteps)
          .set({ status: "skipped", skipReason: resolution.skipReason })
          .where(and(eq(approvalSteps.requestId, id), eq(approvalSteps.position, step.position)));
        await advance(ctx, request);
      }
    }
    await recordAudit(db, deps, audit, {
      action: "approval.rerouted",
      targetType: "approval_request",
      targetId: id,
      meta: { position: step.position, from: [...current], to: [...next] },
    });
    moved++;
  }
  return moved;
}

/** Applies delegations that became active (or were just created) to existing open tasks. */
export async function applyDelegationsToOpenTasks(
  db: Db,
  deps: AppDeps,
  audit: AuditContext,
  input: { orgId: string; fromMembershipId: string },
): Promise<number> {
  const now = deps.clock.now();
  const ctx: Ctx = { db, deps, audit, now };
  const open = await db
    .select({ task: approvalTasks, request: approvalRequests })
    .from(approvalTasks)
    .innerJoin(approvalRequests, eq(approvalRequests.id, approvalTasks.requestId))
    .where(
      and(
        eq(approvalTasks.orgId, input.orgId),
        eq(approvalTasks.assigneeMembershipId, input.fromMembershipId),
        eq(approvalTasks.status, "pending"),
        ne(approvalTasks.origin, "delegated"),
        eq(approvalRequests.status, "pending"),
      ),
    );
  let added = 0;
  for (const { task, request } of open) {
    const created = await applyDelegations(ctx, request, [task]);
    await notifyAssignees(ctx, request, created);
    added += created.length;
  }
  return added;
}

/** Supersedes delegate tasks whose delegation has ended or was revoked. */
export async function closeEndedDelegations(db: Db, deps: AppDeps, orgId?: string): Promise<number> {
  const today = singaporeDate(deps.clock.now());
  const ended = await db
    .select()
    .from(delegations)
    .where(
      and(
        orgId ? eq(delegations.orgId, orgId) : undefined,
        or(sql`${delegations.endsOn} < ${today}`, sql`${delegations.revokedAt} is not null`),
      ),
    );
  let closed = 0;
  for (const d of ended) {
    const stillCovered = await activeDelegationsFrom(db, d.orgId, [d.fromMembershipId], today);
    if (stillCovered.some((x) => x.toMembershipId === d.toMembershipId)) continue;
    const rows = await db
      .update(approvalTasks)
      .set({ status: "superseded", supersededReason: "delegation_ended" })
      .where(
        and(
          eq(approvalTasks.orgId, d.orgId),
          eq(approvalTasks.assigneeMembershipId, d.toMembershipId),
          eq(approvalTasks.onBehalfOfMembershipId, d.fromMembershipId),
          eq(approvalTasks.origin, "delegated"),
          eq(approvalTasks.status, "pending"),
        ),
      )
      .returning({ id: approvalTasks.id });
    closed += rows.length;
  }
  return closed;
}

export type { Ctx as EngineContext };
export { createStepTasks, loadSteps, lockRequest, memberName, notifyAssignees, refOf, withdrawLocked };
