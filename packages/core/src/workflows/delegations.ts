import { and, desc, eq, gte, isNull, or } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { z } from "zod";
import { singaporeDate } from "../access/scope.ts";
import { type AuditContext, recordAudit } from "../audit/audit.ts";
import { memberships } from "../db/schema/access.ts";
import { users } from "../db/schema/users.ts";
import { delegations } from "../db/schema/workflows.ts";
import type { AppDeps } from "../deps.ts";
import { AppError } from "../errors.ts";
import { approverDirectory } from "./directory.ts";
import { applyDelegationsToOpenTasks, closeEndedDelegations } from "./engine.ts";

const isoDate = z.iso.date({ error: "Use a date like 2026-12-01." });

export const delegationInput = z
  .object({
    /** Omit to set your own. hr_admins and owners may set it for anyone. */
    fromMembershipId: z.uuid().optional(),
    toMembershipId: z.uuid({ error: "Choose who covers for you." }),
    startsOn: isoDate,
    endsOn: isoDate,
    subjectTypes: z
      .array(z.string().regex(/^[a-z][a-z0-9_]{1,47}$/))
      .max(20)
      .nullable()
      .default(null),
  })
  .refine((d) => d.endsOn >= d.startsOn, {
    error: "The end date must be on or after the start date.",
    path: ["endsOn"],
  });
export type DelegationInput = z.output<typeof delegationInput>;

export const delegationOut = z.object({
  id: z.uuid(),
  from: z.object({ membershipId: z.uuid(), name: z.string() }),
  to: z.object({ membershipId: z.uuid(), name: z.string() }),
  startsOn: z.iso.date(),
  endsOn: z.iso.date(),
  subjectTypes: z.array(z.string()).nullable(),
  active: z.boolean(),
  createdAt: z.iso.datetime(),
});

const fromM = alias(memberships, "from_m");
const fromU = alias(users, "from_u");
const toM = alias(memberships, "to_m");
const toU = alias(users, "to_u");

export async function listDelegations(deps: AppDeps, orgId: string, opts: { membershipId?: string }) {
  const today = singaporeDate(deps.clock.now());
  const rows = await deps.db
    .select({ d: delegations, fromName: fromU.displayName, toName: toU.displayName })
    .from(delegations)
    .innerJoin(fromM, eq(fromM.id, delegations.fromMembershipId))
    .innerJoin(fromU, eq(fromU.id, fromM.userId))
    .innerJoin(toM, eq(toM.id, delegations.toMembershipId))
    .innerJoin(toU, eq(toU.id, toM.userId))
    .where(
      and(
        eq(delegations.orgId, orgId),
        isNull(delegations.revokedAt),
        gte(delegations.endsOn, today),
        opts.membershipId
          ? or(eq(delegations.fromMembershipId, opts.membershipId), eq(delegations.toMembershipId, opts.membershipId))
          : undefined,
      ),
    )
    .orderBy(desc(delegations.startsOn));
  return rows.map(({ d, fromName, toName }) => ({
    id: d.id,
    from: { membershipId: d.fromMembershipId, name: fromName },
    to: { membershipId: d.toMembershipId, name: toName },
    startsOn: d.startsOn,
    endsOn: d.endsOn,
    subjectTypes: d.subjectTypes ?? null,
    active: d.startsOn <= today && d.endsOn >= today,
    createdAt: d.createdAt.toISOString(),
  }));
}

export async function createDelegation(
  deps: AppDeps,
  actor: { orgId: string; membershipId: string; canManageOthers: boolean; audit: AuditContext },
  input: DelegationInput,
) {
  const from = input.fromMembershipId ?? actor.membershipId;
  if (from !== actor.membershipId && !actor.canManageOthers) {
    throw new AppError("forbidden", "Only HR admins and owners can set out-of-office cover for someone else.");
  }
  if (from === input.toMembershipId) {
    throw new AppError("validation_failed", "Choose someone else to cover.", {
      issues: [{ path: "toMembershipId", message: "Pick a different member from the person who is away." }],
    });
  }
  if (input.endsOn < singaporeDate(deps.clock.now())) {
    throw new AppError("validation_failed", "That cover has already ended. Choose an end date of today or later.", {
      issues: [{ path: "endsOn", message: "Choose an end date of today or later." }],
    });
  }
  const directory = approverDirectory(deps);
  const [fromMember, toMember] = await Promise.all([
    directory.member(deps.db, actor.orgId, from),
    directory.member(deps.db, actor.orgId, input.toMembershipId),
  ]);
  if (!fromMember) throw new AppError("not_found", "That member doesn't exist or you can't see them.");
  if (toMember?.status !== "active") {
    throw new AppError("validation_failed", "The person covering must be an active member.", {
      issues: [{ path: "toMembershipId", message: "Pick an active member of this organisation." }],
    });
  }
  const now = deps.clock.now();
  const id = deps.ids.newId();
  await deps.db.transaction(async (tx) => {
    await tx.insert(delegations).values({
      id,
      orgId: actor.orgId,
      fromMembershipId: from,
      toMembershipId: input.toMembershipId,
      startsOn: input.startsOn,
      endsOn: input.endsOn,
      subjectTypes: input.subjectTypes?.length ? input.subjectTypes : null,
      createdByMembershipId: actor.membershipId,
      createdAt: now,
    });
    await recordAudit(tx, deps, actor.audit, {
      action: "approval.delegation_set",
      targetType: "membership",
      targetId: from,
      meta: { delegationId: id, to: input.toMembershipId, startsOn: input.startsOn, endsOn: input.endsOn },
    });
    // Existing open tasks gain a delegate task now when the window has started (decision 3).
    await applyDelegationsToOpenTasks(tx, deps, actor.audit, { orgId: actor.orgId, fromMembershipId: from });
  });
  const [out] = (await listDelegations(deps, actor.orgId, {})).filter((d) => d.id === id);
  if (!out) throw new Error("delegation not found after insert");
  return out;
}

export async function revokeDelegation(
  deps: AppDeps,
  actor: { orgId: string; membershipId: string; canManageOthers: boolean; audit: AuditContext },
  id: string,
) {
  const [row] = await deps.db
    .select()
    .from(delegations)
    .where(and(eq(delegations.orgId, actor.orgId), eq(delegations.id, id), isNull(delegations.revokedAt)));
  if (!row || (row.fromMembershipId !== actor.membershipId && !actor.canManageOthers)) {
    throw new AppError("not_found", "That out-of-office cover doesn't exist or you can't change it.");
  }
  await deps.db.transaction(async (tx) => {
    await tx.update(delegations).set({ revokedAt: deps.clock.now() }).where(eq(delegations.id, id));
    await closeEndedDelegations(tx, deps, actor.orgId);
    await recordAudit(tx, deps, actor.audit, {
      action: "approval.delegation_removed",
      targetType: "membership",
      targetId: row.fromMembershipId,
      meta: { delegationId: id },
    });
  });
}
