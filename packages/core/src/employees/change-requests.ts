import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { type ProfileChangeRequest, profileChangeRequests } from "../db/schema/employees.ts";
import type { AppDeps } from "../deps.ts";
import { AppError } from "../errors.ts";
import type { Actor } from "./access.ts";
import { recordAudit } from "./audit-helpers.ts";
import { normaliseAccountNumber } from "./banks.ts";
import { singaporeToday } from "./dates.ts";
import { maskIdNumber, maskTail, validateIdNumber } from "./nric.ts";
import type { PeoplePorts } from "./ports.ts";
import { applyPersonalPatch, setBankAccount } from "./profile.ts";
import { bankAccountInput, isoDate, personPatch } from "./schemas.ts";
import { fieldError, parseInput } from "./validation.ts";

/**
 * Sensitive self-service changes (spec: Employee self-service changes): the
 * employee proposes, `workflows` routes the request (bank → payroll_admin,
 * everything else → hr_admin), and the change is applied only on approval.
 * Until then current values stay in force everywhere.
 *
 * Workflows is not built yet (WS3): `ports.approvals` is a double, and the
 * decision endpoint below stands in for its `onApproved` callback.
 */

export const SENSITIVE_PERSONAL_FIELDS = [
  "legalName",
  "idType",
  "idNumber",
  "dob",
  "residencyStatus",
  "prStartDate",
  "race",
  "raceSecondary",
  "religion",
] as const;

const personalChange = personPatch.pick({
  legalName: true,
  idType: true,
  idNumber: true,
  dob: true,
  residencyStatus: true,
  prStartDate: true,
  race: true,
  raceSecondary: true,
  religion: true,
});

export const changeRequestInput = z
  .object({
    personal: personalChange.optional(),
    bank: bankAccountInput.omit({ effectiveFrom: true }).optional(),
    attachmentFileKey: z.string().max(512).nullish(),
    note: z.string().trim().max(500).nullish(),
  })
  .refine((v) => (v.personal && Object.keys(v.personal).length > 0) || v.bank, {
    message: "Change at least one field.",
  });

export interface ChangeRequestView {
  id: string;
  status: ProfileChangeRequest["status"];
  routeToRole: "hr_admin" | "payroll_admin";
  fieldNames: string[];
  /** Display values; sensitive ones masked. */
  proposed: Record<string, string | null>;
  submittedAt: string;
  decidedAt: string | null;
  effectiveFrom: string | null;
  decisionNote: string | null;
}

function toView(r: ProfileChangeRequest): ChangeRequestView {
  const display = (r.fields.display ?? {}) as Record<string, string | null>;
  return {
    id: r.id,
    status: r.status,
    routeToRole: r.routeToRole,
    fieldNames: r.fieldNames,
    proposed: display,
    submittedAt: r.createdAt.toISOString(),
    decidedAt: r.decidedAt ? r.decidedAt.toISOString() : null,
    effectiveFrom: r.effectiveFrom,
    decisionNote: r.decisionNote,
  };
}

export async function submitChangeRequest(
  deps: AppDeps,
  ports: PeoplePorts,
  actor: Actor,
  raw: unknown,
): Promise<ChangeRequestView[]> {
  if (!actor.employeeId) throw new AppError("not_found", "Your account is not linked to an employee record.");
  const employeeId = actor.employeeId;
  const input = parseInput(changeRequestInput, raw);
  const created: ProfileChangeRequest[] = [];

  const make = async (
    routeToRole: "hr_admin" | "payroll_admin",
    fieldNames: string[],
    sealed: Record<string, unknown>,
    display: Record<string, string | null>,
  ) => {
    const id = deps.ids.newId();
    const { approvalRequestId } = await ports.approvals.submit({
      orgId: actor.orgId,
      subjectType: "profile_change",
      subjectId: id,
      requesterUserId: actor.userId,
      routeToRole,
      summary: `Profile change: ${fieldNames.join(", ")}`,
    });
    const row = await deps.db.transaction(async (tx) => {
      const [inserted] = await tx
        .insert(profileChangeRequests)
        .values({
          id,
          orgId: actor.orgId,
          employeeId,
          fields: { values: sealed, display },
          fieldNames,
          routeToRole,
          attachmentFileKey: input.attachmentFileKey ?? null,
          approvalRequestId,
          requestedBy: actor.userId,
        })
        .returning();
      await recordAudit(tx, ports, actor, {
        action: "profile_change.submitted",
        targetType: "employee",
        targetId: employeeId,
        diff: Object.fromEntries(fieldNames.map((f) => [f, { changed: true as const }])),
        meta: { requestId: id, routeToRole },
      });
      return inserted;
    });
    created.push(row as ProfileChangeRequest);
  };

  if (input.personal && Object.keys(input.personal).length) {
    const p = { ...input.personal };
    const display: Record<string, string | null> = {};
    const values: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(p)) {
      if (v === undefined) continue;
      if (k === "idNumber") {
        const check = validateIdNumber((p.idType ?? "nric") as "nric" | "fin" | "other", String(v));
        if (!check.ok) throw fieldError("personal.idNumber", check.message);
        values.idNumber = await ports.secretBox.encrypt("change-request", check.value);
        display.idNumber = maskIdNumber(check.value);
      } else {
        values[k] = v;
        display[k] = v === null ? null : String(v);
      }
    }
    await make("hr_admin", Object.keys(display), values, display);
  }
  if (input.bank) {
    const digits = normaliseAccountNumber(input.bank.accountNumber);
    if (!digits) throw fieldError("bank.accountNumber", "Enter the account number using digits only (6 to 17 digits).");
    await make(
      "payroll_admin",
      ["bankCode", "accountNumber", "holderName"],
      {
        bankCode: input.bank.bankCode,
        accountNumber: await ports.secretBox.encrypt("change-request", digits),
        holderName: await ports.secretBox.encrypt("change-request", input.bank.holderName),
      },
      { bankCode: input.bank.bankCode, accountNumber: maskTail(digits), holderName: input.bank.holderName },
    );
  }
  return created.map(toView);
}

/** The employee's own requests (pending ones are shown as "Awaiting approval"). */
export async function ownChangeRequests(deps: AppDeps, actor: Actor): Promise<ChangeRequestView[]> {
  if (!actor.employeeId) return [];
  const rows = await deps.db
    .select()
    .from(profileChangeRequests)
    .where(and(eq(profileChangeRequests.orgId, actor.orgId), eq(profileChangeRequests.employeeId, actor.employeeId)))
    .orderBy(desc(profileChangeRequests.createdAt));
  return rows.map(toView);
}

/** Pending requests the actor may decide (their routed role, or owner). */
export async function decidableChangeRequests(deps: AppDeps, actor: Actor) {
  const rows = await deps.db
    .select()
    .from(profileChangeRequests)
    .where(and(eq(profileChangeRequests.orgId, actor.orgId), eq(profileChangeRequests.status, "pending")))
    .orderBy(desc(profileChangeRequests.createdAt));
  return rows
    .filter((r) => (actor.roles.has("owner") || actor.roles.has(r.routeToRole)) && r.employeeId !== actor.employeeId)
    .map((r) => ({ ...toView(r), employeeId: r.employeeId }));
}

export const decisionInput = z.object({
  decision: z.enum(["approve", "reject"]),
  effectiveFrom: isoDate.optional(),
  note: z.string().trim().max(500).nullish(),
});

/**
 * Decide a request (stands in for the workflows `onApproved` callback). The
 * approver needs the routed role (or owner) and may not decide their own
 * request. NOT IMPLEMENTED: the sole-owner self-approval exception
 * (`self_approved`) belongs to workflows.
 */
export async function decideChangeRequest(
  deps: AppDeps,
  ports: PeoplePorts,
  actor: Actor,
  requestId: string,
  raw: unknown,
): Promise<ChangeRequestView> {
  const input = parseInput(decisionInput, raw);
  const [r] = await deps.db
    .select()
    .from(profileChangeRequests)
    .where(and(eq(profileChangeRequests.orgId, actor.orgId), eq(profileChangeRequests.id, requestId)));
  if (!r) throw new AppError("not_found", "No such change request.");
  if (!(actor.roles.has("owner") || actor.roles.has(r.routeToRole))) {
    throw new AppError("forbidden", `Only a ${r.routeToRole.replace("_", " ")} can decide this request.`);
  }
  if (r.employeeId === actor.employeeId) {
    throw new AppError("self_change_requires_approval", "Another administrator must decide your own change request.");
  }
  if (r.status !== "pending") throw new AppError("conflict", `This request is already ${r.status}.`);
  const today = singaporeToday(deps.clock.now());
  const effectiveFrom = input.effectiveFrom ?? today;
  // One transaction: the applied change, the decision and its audit event commit together.
  const row = await deps.db.transaction(async (tx) => {
    const txDeps: AppDeps = { ...deps, db: tx };
    if (input.decision === "approve") {
      const values = (r.fields.values ?? {}) as Record<string, unknown>;
      if (r.routeToRole === "payroll_admin") {
        await setBankAccount(
          txDeps,
          ports,
          actor,
          r.employeeId,
          {
            bankCode: values.bankCode,
            accountNumber: await ports.secretBox.decrypt("change-request", String(values.accountNumber)),
            holderName: await ports.secretBox.decrypt("change-request", String(values.holderName)),
            effectiveFrom,
          },
          { viaChangeRequest: true },
        );
      } else {
        if (effectiveFrom > today) {
          // NOT IMPLEMENTED: personal details are not effective-dated, so a future date cannot be honoured.
          throw fieldError("effectiveFrom", "Personal details changes apply from today. Approve on or after the date.");
        }
        const patch: Record<string, unknown> = { ...values };
        if (typeof values.idNumber === "string") {
          patch.idNumber = await ports.secretBox.decrypt("change-request", values.idNumber);
        }
        await applyPersonalPatch(txDeps, ports, actor, r.employeeId, patch, { action: "employee.updated_by_request" });
      }
    }
    const [decided] = await tx
      .update(profileChangeRequests)
      .set({
        status: input.decision === "approve" ? "approved" : "rejected",
        decidedBy: actor.userId,
        decidedAt: deps.clock.now(),
        decisionNote: input.note ?? null,
        effectiveFrom: input.decision === "approve" ? effectiveFrom : null,
        // Drop the proposed ciphertext once decided; the audit log keeps the record.
        fields: { display: (r.fields.display ?? {}) as Record<string, unknown> },
      })
      .where(eq(profileChangeRequests.id, requestId))
      .returning();
    await recordAudit(tx, ports, actor, {
      action: `profile_change.${input.decision === "approve" ? "approved" : "rejected"}`,
      targetType: "employee",
      targetId: r.employeeId,
      meta: { requestId, effectiveFrom },
    });
    return decided;
  });
  return toView(row as ProfileChangeRequest);
}

export async function cancelOwnChangeRequest(deps: AppDeps, ports: PeoplePorts, actor: Actor, requestId: string) {
  const [r] = await deps.db
    .select()
    .from(profileChangeRequests)
    .where(and(eq(profileChangeRequests.orgId, actor.orgId), eq(profileChangeRequests.id, requestId)));
  if (!r || r.employeeId !== actor.employeeId) throw new AppError("not_found", "No such change request.");
  if (r.status !== "pending") throw new AppError("conflict", `This request is already ${r.status}.`);
  if (r.approvalRequestId) await ports.approvals.cancel(actor.orgId, r.approvalRequestId);
  await deps.db.transaction(async (tx) => {
    await tx
      .update(profileChangeRequests)
      .set({ status: "cancelled", fields: { display: (r.fields.display ?? {}) as Record<string, unknown> } })
      .where(eq(profileChangeRequests.id, requestId));
    await recordAudit(tx, ports, actor, {
      action: "profile_change.cancelled",
      targetType: "employee",
      targetId: r.employeeId,
      meta: { requestId },
    });
  });
}
