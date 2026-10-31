import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { can } from "../access/authorize.ts";
import { effectiveRoles } from "../access/scope.ts";
import { auditContext } from "../audit/audit.ts";
import type { AppContext, AuthContext } from "../context.ts";
import { memberships } from "../db/schema/access.ts";
import { users } from "../db/schema/users.ts";
import { AppError } from "../errors.ts";
import { defineModule, defineRoute } from "../http/route.ts";
import { createDelegation, delegationInput, delegationOut, listDelegations, revokeDelegation } from "./delegations.ts";
import { addComment, COMMENT_MAX, decideTask, reassignTask, withdrawRequest } from "./engine.ts";
import { dueState, loadInbox } from "./inbox.ts";
import {
  builtInDefaultSteps,
  loadPolicies,
  policyConditionSchema,
  policyInputSchema,
  replacePolicies,
} from "./policies.ts";
import { workflowRegistry } from "./registry.ts";
import { KNOWN_SUBJECT_TYPES, type ReadContext } from "./types.ts";
import {
  getRequestDetail,
  listMyRequests,
  listMyTasks,
  myRequestItem,
  RULE_LABEL,
  requestDetail,
  taskListItem,
} from "./views.ts";

const id = z.object({ id: z.uuid() });

function viewerOf(auth: AuthContext): ReadContext {
  return { orgId: auth.orgId, membershipId: auth.membershipId, employeeId: auth.employeeId, roles: auth.roles };
}

function actorOf(c: AppContext, auth: AuthContext) {
  return { orgId: auth.orgId, membershipId: auth.membershipId, roles: auth.roles, audit: auditContext(c) };
}

const decisionBody = z.object({
  decision: z.enum(["approve", "reject"], { error: "Choose approve or reject." }),
  comment: z
    .string()
    .max(COMMENT_MAX, { error: `Keep the comment to ${COMMENT_MAX} characters.` })
    .nullish(),
});

const decisionResult = z.object({
  taskId: z.uuid(),
  requestId: z.uuid(),
  outcome: z.enum(["approved", "rejected"]),
  requestStatus: z.enum(["pending", "approved", "rejected", "withdrawn"]),
  replayed: z.boolean(),
});

const stepOut = z.object({
  approverRule: z.string(),
  label: z.string(),
  escalateAfterDays: z.int(),
});

const policyOut = z.object({
  id: z.uuid().nullable(),
  name: z.string(),
  condition: policyConditionSchema.nullable(),
  priority: z.int(),
  isDefault: z.boolean(),
  builtIn: z.boolean(),
  steps: z.array(stepOut),
});

const typeOut = z.object({
  subjectType: z.string(),
  label: z.string(),
  /** False until the module that submits these requests is installed. */
  installed: z.boolean(),
  ownerOnly: z.boolean(),
  canEdit: z.boolean(),
  policies: z.array(policyOut),
});

const TYPE_LABEL: Record<string, string> = {
  leave: "Leave",
  leave_cancellation: "Leave cancellation",
  claim: "Claims",
  overtime: "Overtime",
  timesheet: "Timesheets",
  profile_change: "Profile changes",
  shift_swap: "Shift swaps",
  payroll_run: "Payroll runs",
};

const inboxItemOut = z.object({
  id: z.string(),
  source: z.string(),
  kind: z.string(),
  title: z.string(),
  concerns: z.string().nullable(),
  detail: z.string().nullable(),
  dueOn: z.iso.date().nullable(),
  overdueDays: z.int(),
  createdAt: z.iso.datetime(),
  href: z.string(),
  actionLabel: z.string(),
  task: z
    .object({
      id: z.uuid(),
      requestId: z.uuid(),
      subjectType: z.string(),
      inline: z.boolean(),
      origin: z.enum(["resolved", "delegated", "escalated", "reassigned"]),
      onBehalfOf: z.string().nullable(),
    })
    .nullable(),
});

export const approvalsModule = defineModule({
  name: "approvals",
  basePath: "/approvals",
  tag: "Approvals",
  routes: [
    defineRoute({
      method: "get",
      path: "/tasks",
      summary: "List my open approval tasks",
      description: "Pending tasks assigned to the caller, including delegated, escalated and reassigned ones.",
      access: "authenticated",
      responses: { 200: z.object({ items: z.array(taskListItem) }) },
      handler: async ({ deps, auth }) => ({ items: await listMyTasks(deps, viewerOf(auth)) }),
    }),
    defineRoute({
      method: "post",
      path: "/tasks/:id/decision",
      summary: "Approve or reject a task",
      description:
        "Idempotent: repeating the same decision returns `replayed: true`. A task that someone else already decided answers 409 `already_decided` with who decided and when.",
      access: { permission: "approval_tasks:decide" },
      request: { params: id, body: decisionBody },
      responses: { 200: decisionResult },
      errors: ["not_found", "already_decided"],
      example: { body: { decision: "approve" } },
      handler: async ({ c, deps, auth, params, body }) =>
        decideTask(deps, actorOf(c, auth), {
          taskId: params.id,
          decision: body.decision,
          comment: body.comment ?? null,
        }),
    }),
    defineRoute({
      method: "post",
      path: "/tasks/decisions",
      summary: "Approve or reject several tasks",
      description: "Each task is decided in its own transaction; the result lists the outcome per task.",
      access: { permission: "approval_tasks:decide" },
      request: {
        body: z.object({
          taskIds: z.array(z.uuid()).min(1, { error: "Select at least one task." }).max(50),
          decision: decisionBody.shape.decision,
          comment: decisionBody.shape.comment,
        }),
      },
      responses: {
        200: z.object({
          results: z.array(
            z.object({
              taskId: z.uuid(),
              ok: z.boolean(),
              requestStatus: z.enum(["pending", "approved", "rejected", "withdrawn"]).nullable(),
              code: z.string().nullable(),
              message: z.string().nullable(),
            }),
          ),
        }),
      },
      handler: async ({ c, deps, auth, body }) => {
        const results = [];
        for (const taskId of [...new Set(body.taskIds)]) {
          try {
            const r = await decideTask(deps, actorOf(c, auth), {
              taskId,
              decision: body.decision,
              comment: body.comment,
            });
            results.push({ taskId, ok: true, requestStatus: r.requestStatus, code: null, message: null });
          } catch (err) {
            if (!(err instanceof AppError)) throw err;
            results.push({ taskId, ok: false, requestStatus: null, code: err.code, message: err.message });
          }
        }
        return { results };
      },
    }),
    defineRoute({
      method: "post",
      path: "/tasks/:id/reassign",
      summary: "Reassign a pending task",
      access: { permission: "approval_tasks:reassign" },
      request: {
        params: id,
        body: z.object({
          toMembershipId: z.uuid({ error: "Choose who should decide instead." }),
          reason: z.string().trim().min(1, { error: "Say why you're reassigning it." }).max(500),
        }),
      },
      responses: { 200: z.object({ taskId: z.uuid().nullable(), requestId: z.uuid() }) },
      errors: ["not_found", "already_decided"],
      example: { body: { toMembershipId: "00000000-0000-7000-8000-000000000001", reason: "On leave" } },
      handler: async ({ c, deps, auth, params, body }) =>
        reassignTask(deps, actorOf(c, auth), { taskId: params.id, ...body }),
    }),
    defineRoute({
      method: "get",
      path: "/requests",
      summary: "List my requests",
      description: "Requests the caller submitted, newest first.",
      access: "authenticated",
      request: { query: z.object({ limit: z.coerce.number().int().min(1).max(100).default(20) }) },
      responses: { 200: z.object({ items: z.array(myRequestItem) }) },
      handler: async ({ deps, auth, query }) => ({ items: await listMyRequests(deps, viewerOf(auth), query.limit) }),
    }),
    defineRoute({
      method: "get",
      path: "/requests/:id",
      summary: "Get a request with its approval chain",
      description:
        "Visible to the requester, approvers, delegates while their task is open, owners and hr_admins (not payroll runs), and whoever the module's `canRead` allows.",
      access: "authenticated",
      request: { params: id },
      responses: { 200: requestDetail },
      errors: ["not_found"],
      handler: async ({ deps, auth, params }) => getRequestDetail(deps, viewerOf(auth), params.id),
    }),
    defineRoute({
      method: "post",
      path: "/requests/:id/withdraw",
      summary: "Withdraw my pending request",
      access: "authenticated",
      request: { params: id },
      responses: { 200: z.object({ requestId: z.uuid(), status: z.literal("withdrawn") }) },
      errors: ["not_found", "already_decided"],
      handler: async ({ c, deps, auth, params }) => withdrawRequest(deps, actorOf(c, auth), params.id),
    }),
    defineRoute({
      method: "post",
      path: "/requests/:id/comments",
      summary: "Comment on a request",
      access: "authenticated",
      request: {
        params: id,
        body: z.object({ body: z.string().trim().min(1, { error: "Write a comment." }).max(COMMENT_MAX) }),
      },
      responses: { 201: z.object({ id: z.uuid() }) },
      errors: ["not_found"],
      example: { body: { body: "Can you attach the receipt?" } },
      handler: async ({ c, deps, auth, params, body }) =>
        addComment(deps, { ...actorOf(c, auth), ...viewerOf(auth) }, params.id, body.body),
    }),
    defineRoute({
      method: "get",
      path: "/policies",
      summary: "List approval policies per request type",
      description: "Types without a stored policy show the built-in default chain.",
      access: { permission: "policies:read" },
      responses: { 200: z.object({ types: z.array(typeOut) }) },
      handler: async ({ deps, auth }) => {
        const registry = workflowRegistry(deps);
        const stored = await loadPolicies(deps.db, auth.orgId);
        const types = [...new Set([...KNOWN_SUBJECT_TYPES, ...registry.subjects.keys()])];
        const memberIds = stored.flatMap((p) =>
          p.steps.filter((s) => s.approverRule.startsWith("member:")).map((s) => s.approverRule.slice(7)),
        );
        const names = new Map<string, string>();
        if (memberIds.length) {
          const rows = await deps.db
            .select({ id: memberships.id, name: users.displayName })
            .from(memberships)
            .innerJoin(users, eq(users.id, memberships.userId))
            .where(eq(memberships.orgId, auth.orgId));
          for (const r of rows) names.set(r.id, r.name);
        }
        const label = (rule: string) =>
          rule.startsWith("member:") ? (names.get(rule.slice(7)) ?? "A specific member") : (RULE_LABEL[rule] ?? rule);
        const isOwner = auth.roles.includes("owner");
        return {
          types: types.map((type) => {
            const adapter = registry.subjects.get(type);
            const ownerOnly = type === "payroll_run" || !!adapter?.ownerOnlyPolicy;
            const mine = stored.filter((p) => p.subjectType === type);
            const policies = mine.length
              ? mine
              : [
                  {
                    id: null,
                    name: "Default",
                    condition: null,
                    priority: 0,
                    isDefault: true,
                    steps: builtInDefaultSteps(type, {}, adapter),
                  },
                ];
            return {
              subjectType: type,
              label: TYPE_LABEL[type] ?? adapter?.label ?? type,
              installed: !!adapter,
              ownerOnly,
              canEdit: !ownerOnly || isOwner,
              policies: policies.map((p) => ({
                id: p.id,
                name: p.name,
                condition: p.condition,
                priority: p.priority,
                isDefault: p.isDefault,
                builtIn: p.id === null,
                steps: p.steps.map((s) => ({ ...s, label: label(s.approverRule) })),
              })),
            };
          }),
        };
      },
    }),
    defineRoute({
      method: "put",
      path: "/policies/:subjectType",
      summary: "Replace the approval policies of one request type",
      description:
        "Exactly one policy must have no condition (the default). Requests already submitted keep their chain. Payroll policies are owner-only.",
      access: { permission: "policies:update" },
      request: {
        params: z.object({
          subjectType: z.string().regex(/^[a-z][a-z0-9_]{1,47}$/, { error: "Unknown request type." }),
        }),
        body: z.object({ policies: z.array(policyInputSchema).min(1).max(10) }),
      },
      responses: { 200: z.object({ subjectType: z.string(), policies: z.array(policyOut) }) },
      errors: ["not_found"],
      crossOrgExempt: "the path names a request type, not a record",
      handler: async ({ c, deps, auth, params, body }) => {
        const registry = workflowRegistry(deps);
        const type = params.subjectType;
        if (!(KNOWN_SUBJECT_TYPES as readonly string[]).includes(type) && !registry.subjects.has(type)) {
          throw new AppError("not_found", `There is no "${type}" request type.`);
        }
        const adapter = registry.subjects.get(type);
        if ((type === "payroll_run" || adapter?.ownerOnlyPolicy) && !auth.roles.includes("owner")) {
          throw new AppError("forbidden", "Only an owner can change who approves payroll runs.");
        }
        const defaults = body.policies.filter((p) => p.condition === null);
        if (defaults.length !== 1) {
          throw new AppError(
            "validation_failed",
            "Keep exactly one policy without a condition: it applies when no rule matches.",
            {
              issues: [{ path: "policies", message: "Exactly one policy must have no condition." }],
            },
          );
        }
        for (const [i, p] of body.policies.entries()) {
          for (const [j, s] of p.steps.entries()) {
            if (!s.approverRule.startsWith("member:")) continue;
            const [m] = await deps.db
              .select({ id: memberships.id, status: memberships.status })
              .from(memberships)
              .where(and(eq(memberships.orgId, auth.orgId), eq(memberships.id, s.approverRule.slice(7))));
            if (m?.status !== "active") {
              throw new AppError("validation_failed", "One of the chosen approvers is not an active member.", {
                issues: [{ path: `policies.${i}.steps.${j}.approverRule`, message: "Pick an active member." }],
              });
            }
          }
        }
        const saved = await replacePolicies(deps.db, deps, auditContext(c), auth.orgId, type, body.policies);
        return {
          subjectType: type,
          policies: saved.map((p) => ({
            id: p.id,
            name: p.name,
            condition: p.condition,
            priority: p.priority,
            isDefault: p.isDefault,
            builtIn: false,
            steps: p.steps.map((s) => ({ ...s, label: RULE_LABEL[s.approverRule] ?? "A specific member" })),
          })),
        };
      },
    }),
    defineRoute({
      method: "get",
      path: "/people",
      summary: "List members who can approve or cover",
      description: "Active members of the organisation (name only), for delegate and approver pickers.",
      access: "authenticated",
      responses: { 200: z.object({ items: z.array(z.object({ membershipId: z.uuid(), name: z.string() })) }) },
      handler: async ({ deps, auth }) => {
        const rows = await deps.db
          .select({ membershipId: memberships.id, name: users.displayName })
          .from(memberships)
          .innerJoin(users, eq(users.id, memberships.userId))
          .where(and(eq(memberships.orgId, auth.orgId), eq(memberships.status, "active")))
          .orderBy(asc(users.displayName));
        return { items: rows };
      },
    }),
    defineRoute({
      method: "get",
      path: "/delegations",
      summary: "List out-of-office cover",
      description:
        "Current and upcoming cover involving the caller; hr_admins and owners see everyone's with `all=true`.",
      access: "authenticated",
      request: { query: z.object({ all: z.enum(["true", "false"]).default("false") }) },
      responses: { 200: z.object({ items: z.array(delegationOut) }) },
      handler: async ({ c, deps, auth, query }) => {
        const all = query.all === "true" && (await can(c, "approval_delegations:manage"));
        return { items: await listDelegations(deps, auth.orgId, all ? {} : { membershipId: auth.membershipId }) };
      },
    }),
    defineRoute({
      method: "post",
      path: "/delegations",
      summary: "Set out-of-office cover",
      description:
        "While active, the delegate also receives the member's approval tasks. hr_admins may set it for anyone.",
      access: "authenticated",
      request: { body: delegationInput },
      responses: { 201: delegationOut },
      errors: ["not_found"],
      handler: async ({ c, deps, auth, body }) =>
        createDelegation(
          deps,
          { ...actorOf(c, auth), canManageOthers: await can(c, "approval_delegations:manage") },
          body,
        ),
    }),
    defineRoute({
      method: "delete",
      path: "/delegations/:id",
      summary: "Remove out-of-office cover",
      access: "authenticated",
      request: { params: id },
      responses: { 204: null },
      errors: ["not_found"],
      handler: async ({ c, deps, auth, params }) => {
        await revokeDelegation(
          deps,
          { ...actorOf(c, auth), canManageOthers: await can(c, "approval_delegations:manage") },
          params.id,
        );
      },
    }),
  ],
});

export const inboxModule = defineModule({
  name: "inbox",
  basePath: "/inbox",
  tag: "Approvals",
  routes: [
    defineRoute({
      method: "get",
      path: "/",
      summary: "My work to do",
      description:
        "Actionable items from every source (approvals, reminders, setup, payroll due), overdue first, then by due date, then by age. `sources` says which sources are not set up yet.",
      access: "authenticated",
      responses: {
        200: z.object({
          today: z.iso.date(),
          items: z.array(inboxItemOut),
          sources: z.array(z.object({ id: z.string(), label: z.string(), status: z.enum(["ready", "not_set_up"]) })),
        }),
      },
      handler: async ({ c, deps, auth }) => {
        const roles = await effectiveRoles(c);
        const inbox = await loadInbox(deps, { ...viewerOf(auth), isManager: roles.has("manager") });
        return {
          today: inbox.today,
          sources: inbox.sources,
          items: inbox.items.map((i) => ({ ...i, overdueDays: dueState(i, inbox.today).overdueDays })),
        };
      },
    }),
  ],
});
