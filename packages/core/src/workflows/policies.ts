import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { type AuditContext, recordAudit } from "../audit/audit.ts";
import {
  approvalPolicies,
  approvalPolicySteps,
  type PolicyCondition,
  type SubjectAttributes,
} from "../db/schema/workflows.ts";
import type { Db } from "../db/types.ts";
import type { AppDeps } from "../deps.ts";
import type { AnySubjectAdapter, ApproverRule, PolicyStepInput } from "./types.ts";

/** Escalation default (spec "Escalation and reassignment"). */
export const DEFAULT_ESCALATE_AFTER_DAYS = 3;
export const MAX_POLICY_STEPS = 5;

export const approverRuleSchema = z
  .string()
  .regex(/^(manager|manager_of_manager|role:(owner|hr_admin|payroll_admin)|member:[0-9a-f-]{36})$/i, {
    error: "Choose manager, manager's manager, a role (owner, HR admin, payroll admin) or a specific member.",
  })
  .transform((v) => v as ApproverRule);

export const policyStepSchema = z.object({
  approverRule: approverRuleSchema,
  escalateAfterDays: z
    .int({ error: "Escalation must be a whole number of days." })
    .min(0, { error: "Use 0 to turn escalation off." })
    .max(60, { error: "Escalate after 60 days at most." })
    .default(DEFAULT_ESCALATE_AFTER_DAYS),
});

export const policyConditionSchema = z
  .object({
    amountGte: z
      .int({ error: "Enter the amount in cents as a whole number." })
      .min(1, { error: "The amount must be more than S$0.00." })
      .max(1_000_000_000_00)
      .optional(),
    typeCodes: z
      .array(z.string().trim().min(1).max(40))
      .min(1, { error: "Pick at least one type, or remove the condition." })
      .max(50)
      .optional(),
  })
  .refine((c) => c.amountGte !== undefined || c.typeCodes !== undefined, {
    error: "A condition needs an amount threshold or a list of types.",
  });

export const policyInputSchema = z.object({
  name: z.string().trim().min(1, { error: "Give the policy a name, e.g. “Claims over S$500”." }).max(80),
  /** Null for the default policy of the type. */
  condition: policyConditionSchema.nullable().default(null),
  priority: z.int().min(0).max(1000).default(0),
  steps: z
    .array(policyStepSchema)
    .min(1, { error: "Add at least one approval step." })
    .max(MAX_POLICY_STEPS, { error: `A policy has at most ${MAX_POLICY_STEPS} steps.` }),
});
export type PolicyInput = z.output<typeof policyInputSchema>;

/**
 * Built-in defaults (spec "Approval policies"): payroll → owner; profile changes → payroll_admin
 * for bank fields, hr_admin for the rest; everything else → manager, then hr_admin.
 */
export function builtInDefaultSteps(
  subjectType: string,
  attributes: SubjectAttributes,
  adapter?: AnySubjectAdapter,
): PolicyStepInput[] {
  const d = DEFAULT_ESCALATE_AFTER_DAYS;
  if (adapter?.defaultSteps) return [...adapter.defaultSteps];
  if (subjectType === "payroll_run") return [{ approverRule: "role:owner", escalateAfterDays: d }];
  if (subjectType === "profile_change") {
    return [
      { approverRule: attributes.typeCode === "bank" ? "role:payroll_admin" : "role:hr_admin", escalateAfterDays: d },
    ];
  }
  return [
    { approverRule: "manager", escalateAfterDays: d },
    { approverRule: "role:hr_admin", escalateAfterDays: d },
  ];
}

export function conditionMatches(condition: PolicyCondition | null, attributes: SubjectAttributes): boolean {
  if (!condition) return true;
  if (condition.amountGte !== undefined) {
    if (attributes.amountCents === undefined || attributes.amountCents < condition.amountGte) return false;
  }
  if (condition.typeCodes !== undefined) {
    if (!attributes.typeCode || !condition.typeCodes.includes(attributes.typeCode)) return false;
  }
  return true;
}

export interface StoredPolicy {
  id: string;
  subjectType: string;
  name: string;
  condition: PolicyCondition | null;
  priority: number;
  isDefault: boolean;
  steps: PolicyStepInput[];
}

export async function loadPolicies(db: Db, orgId: string, subjectType?: string): Promise<StoredPolicy[]> {
  const rows = await db
    .select()
    .from(approvalPolicies)
    .where(
      and(
        eq(approvalPolicies.orgId, orgId),
        eq(approvalPolicies.active, true),
        subjectType ? eq(approvalPolicies.subjectType, subjectType) : undefined,
      ),
    )
    .orderBy(asc(approvalPolicies.subjectType), desc(approvalPolicies.isDefault), desc(approvalPolicies.priority));
  if (!rows.length) return [];
  const steps = await db
    .select()
    .from(approvalPolicySteps)
    .where(
      and(
        eq(approvalPolicySteps.orgId, orgId),
        inArray(
          approvalPolicySteps.policyId,
          rows.map((r) => r.id),
        ),
      ),
    )
    .orderBy(asc(approvalPolicySteps.position));
  return rows.map((r) => ({
    id: r.id,
    subjectType: r.subjectType,
    name: r.name,
    condition: r.condition ?? null,
    priority: r.priority,
    isDefault: r.isDefault,
    steps: steps
      .filter((s) => s.policyId === r.id)
      .map((s) => ({ approverRule: s.approverRule as ApproverRule, escalateAfterDays: s.escalateAfterDays })),
  }));
}

export interface ResolvedPolicy {
  policyId: string | null;
  name: string;
  steps: PolicyStepInput[];
}

/**
 * The policy for a new request: the highest-priority active policy whose condition matches,
 * else the org's stored default for the type, else the built-in default.
 */
export async function resolvePolicy(
  db: Db,
  orgId: string,
  subjectType: string,
  attributes: SubjectAttributes,
  adapter?: AnySubjectAdapter,
): Promise<ResolvedPolicy> {
  const policies = await loadPolicies(db, orgId, subjectType);
  const conditional = policies
    .filter((p) => !p.isDefault && p.condition && conditionMatches(p.condition, attributes))
    .sort((a, b) => b.priority - a.priority)[0];
  if (conditional) return { policyId: conditional.id, name: conditional.name, steps: conditional.steps };
  const stored = policies.find((p) => p.isDefault);
  if (stored) return { policyId: stored.id, name: stored.name, steps: stored.steps };
  return { policyId: null, name: "Default", steps: builtInDefaultSteps(subjectType, attributes, adapter) };
}

/**
 * Replaces every policy of one subject type (the Settings → Approvals editor saves a whole type
 * at once). Exactly one entry must have no condition: it becomes the default. In-flight requests
 * keep their snapshot.
 */
export async function replacePolicies(
  db: Db,
  deps: Pick<AppDeps, "clock" | "ids">,
  audit: AuditContext,
  orgId: string,
  subjectType: string,
  input: PolicyInput[],
): Promise<StoredPolicy[]> {
  const now = deps.clock.now();
  return db.transaction(async (tx) => {
    const before = await loadPolicies(tx, orgId, subjectType);
    await tx
      .update(approvalPolicies)
      .set({ active: false, updatedAt: now })
      .where(and(eq(approvalPolicies.orgId, orgId), eq(approvalPolicies.subjectType, subjectType)));
    for (const policy of input) {
      const id = deps.ids.newId();
      await tx.insert(approvalPolicies).values({
        id,
        orgId,
        subjectType,
        name: policy.name,
        condition: policy.condition,
        priority: policy.condition ? policy.priority : 0,
        isDefault: policy.condition === null,
        active: true,
        createdAt: now,
        updatedAt: now,
      });
      await tx.insert(approvalPolicySteps).values(
        policy.steps.map((s, i) => ({
          orgId,
          policyId: id,
          position: i + 1,
          approverRule: s.approverRule,
          escalateAfterDays: s.escalateAfterDays,
        })),
      );
    }
    const after = await loadPolicies(tx, orgId, subjectType);
    await recordAudit(tx, deps, audit, {
      action: "approval_policy.updated",
      targetType: "approval_policy",
      targetId: null,
      meta: {
        subjectType,
        before: before.map(describePolicy),
        after: after.map(describePolicy),
      },
    });
    return after;
  });
}

function describePolicy(p: StoredPolicy) {
  return { name: p.name, condition: p.condition, steps: p.steps.map((s) => s.approverRule) };
}
