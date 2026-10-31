import { and, eq, inArray } from "drizzle-orm";
import { recordAudit } from "../audit/audit.ts";
import { claims } from "../db/schema/claims.ts";
import type { AppDeps } from "../deps.ts";
import { AppError } from "../errors.ts";
import type { ClaimsActor } from "./access.ts";

/**
 * Payment outside payroll (spec "Payment outside payroll"): payroll_admins and owners mark one or
 * more approved claims paid with a date and a reference (e.g. "FAST 4 Nov"). All or nothing: a
 * claim reserved by a payroll run, already paid or not approved refuses the whole batch, so a
 * claim can never be paid both ways. Each claim gets its own audit event with the reference.
 */
export async function markPaidOutside(
  deps: AppDeps,
  actor: ClaimsActor,
  input: { claimIds: string[]; paidOn: string; reference: string },
) {
  const ids = [...new Set(input.claimIds)];
  const reference = input.reference.trim();
  if (!reference || reference.length > 100) {
    throw new AppError("validation_failed", "Enter a payment reference of 1 to 100 characters.", {
      issues: [{ path: "reference", message: "Add the bank or FAST reference, up to 100 characters." }],
    });
  }
  return deps.db.transaction(async (tx) => {
    const rows = await tx
      .select()
      .from(claims)
      .where(and(eq(claims.orgId, actor.orgId), inArray(claims.id, ids)))
      .orderBy(claims.id)
      .for("update");
    // Another organisation's claim is indistinguishable from a missing one.
    if (rows.length !== ids.length)
      throw new AppError("not_found", "One or more of those claims don't exist or you can't see them.");
    const problems: { claimId: string; claimNumber: string | null; reason: string }[] = [];
    for (const r of rows) {
      const reason =
        r.status === "paid"
          ? `already paid on ${r.paidOn}`
          : r.status !== "approved"
            ? `${r.status}, not approved`
            : r.payrollRunId
              ? "in a payroll run (it will be paid with that run; remove it from the run first)"
              : null;
      if (reason) problems.push({ claimId: r.id, claimNumber: r.claimNumber, reason });
    }
    if (problems.length) {
      throw new AppError(
        "conflict",
        `Nothing was marked paid. ${problems.map((p) => `${p.claimNumber ?? "A claim"} is ${p.reason}`).join("; ")}.`,
        { problems },
      );
    }
    const now = deps.clock.now();
    await tx
      .update(claims)
      .set({
        status: "paid",
        paidVia: "outside",
        paidOn: input.paidOn,
        paidReference: reference,
        paidByMembershipId: actor.membershipId,
        updatedAt: now,
      })
      .where(and(eq(claims.orgId, actor.orgId), inArray(claims.id, ids), eq(claims.status, "approved")));
    for (const r of rows) {
      await recordAudit(tx, deps, actor.auditCtx, {
        action: "claim.paid",
        targetType: "claim",
        targetId: r.id,
        meta: { via: "outside", paidOn: input.paidOn, reference, claimNumber: r.claimNumber },
      });
    }
    return { paid: rows.length };
  });
}
