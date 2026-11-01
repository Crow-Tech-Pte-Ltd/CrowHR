import { and, eq, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { recordAudit, systemAuditContext } from "../audit/audit.ts";
import { claimLines, claims, claimTypes } from "../db/schema/claims.ts";
import type { Db } from "../db/types.ts";
import type { AppDeps } from "../deps.ts";
import { AppError } from "../errors.ts";
import type { PayableClaim, ReimbursementRunOpts, ReimbursementSource } from "../payroll/ports.ts";

/**
 * Reimbursement through payroll (spec "Reimbursement through payroll", design decision 5).
 *
 * Implements payroll's port (`payroll/ports.ts`); `payrollPorts(deps)` uses it by default, so the
 * server, tests and the demo get real claims unless they inject `deps.payroll.reimbursements`.
 *
 * State lives on the claim:
 * - payable = `approved`, payout `payroll`, approved on or before the period end (SGT date of the
 *   final approval), not paid. A claim approved after the cutoff therefore rolls to the next run.
 * - `reserve` sets `payroll_run_id` (row locks; refuses a claim reserved by another run, paid,
 *   or no longer approved). `release` clears this run's reservations (discarded / recomputed run).
 * - `markPaid` turns this run's reserved claims into `paid` with the run's payment date. It only
 *   touches `approved` rows, so calling it twice (or after a retry) never pays a claim twice and
 *   never changes the first payment date. Claims approved after the run was computed were never
 *   reserved, so they stay payable for the next run.
 */

export type { PayableClaim, ReimbursementSource };

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Payable claims, one entry per (claim, claim type) so the payslip shows one
 * "Claims reimbursement: <type>" line per type. Entries share the claim ID; `reserve` de-duplicates.
 *
 * Payroll passes `{ runId }`: claims reserved by other runs are left out, claims reserved by this
 * run stay listed (a recompute releases and re-reserves them). Without a run ID every payable claim
 * is listed, and `reserve` refuses any already held by another run.
 */
export async function listPayableClaims(
  db: Db,
  orgId: string,
  periodEnd: string,
  opts: ReimbursementRunOpts = {},
): Promise<PayableClaim[]> {
  if (!ISO_DATE.test(periodEnd)) throw new Error(`periodEnd must be YYYY-MM-DD, got ${periodEnd}`);
  const carry = [...new Set(opts.carryFromRunIds ?? [])];
  const payable = and(
    eq(claims.status, "approved"),
    eq(claims.payoutMethod, "payroll"),
    isNull(claims.paidOn),
    lte(claims.approvedOn, periodEnd),
    opts.runId ? sql`(${claims.payrollRunId} is null or ${claims.payrollRunId} = ${opts.runId})` : undefined,
  );
  // An adjustment carries what its replaced chain reserved or paid through payroll.
  const carried = carry.length
    ? and(
        inArray(claims.payrollRunId, carry),
        or(eq(claims.status, "approved"), and(eq(claims.status, "paid"), eq(claims.paidVia, "payroll"))),
      )
    : undefined;
  const rows = await db
    .select({
      claimId: claims.id,
      employeeId: claims.employeeId,
      typeName: claimTypes.name,
      taxable: claimTypes.taxable,
      payrollRunId: claims.payrollRunId,
      amount: sql<string>`sum(${claimLines.sgdCents})::text`,
    })
    .from(claims)
    .innerJoin(claimLines, and(eq(claimLines.orgId, claims.orgId), eq(claimLines.claimId, claims.id)))
    .innerJoin(claimTypes, and(eq(claimTypes.orgId, claimLines.orgId), eq(claimTypes.id, claimLines.claimTypeId)))
    .where(and(eq(claims.orgId, orgId), carried ? or(payable, carried) : payable))
    .groupBy(claims.id, claims.employeeId, claimTypes.name, claimTypes.taxable, claims.payrollRunId)
    .orderBy(claims.employeeId, claims.id, claimTypes.name);
  return rows.map((r) => ({
    claimId: r.claimId,
    employeeId: r.employeeId,
    typeName: r.typeName,
    taxable: r.taxable,
    amountCents: Number(r.amount),
    ...(r.payrollRunId && carry.includes(r.payrollRunId) ? { carriedFromRunId: r.payrollRunId } : {}),
  }));
}

export async function reserveClaims(deps: AppDeps, tx: Db, orgId: string, runId: string, claimIds: string[]) {
  const ids = [...new Set(claimIds)];
  if (!ids.length) return;
  const rows = await tx
    .select()
    .from(claims)
    .where(and(eq(claims.orgId, orgId), inArray(claims.id, ids)))
    .orderBy(claims.id)
    .for("update");
  const found = new Map(rows.map((r) => [r.id, r]));
  const problems: string[] = [];
  for (const id of ids) {
    const r = found.get(id);
    const label = r?.claimNumber ?? id;
    if (!r) problems.push(`${label} doesn't exist`);
    else if (r.status === "paid") problems.push(`${label} is already paid`);
    else if (r.status !== "approved") problems.push(`${label} is ${r.status}, not approved`);
    else if (r.payoutMethod !== "payroll") problems.push(`${label} is paid outside payroll`);
    else if (r.payrollRunId && r.payrollRunId !== runId) problems.push(`${label} is in another payroll run`);
  }
  if (problems.length) {
    throw new AppError(
      "conflict",
      `Some claims can't be added to this payroll run: ${problems.join("; ")}. Recompute the run.`,
      {
        problems,
      },
    );
  }
  await tx
    .update(claims)
    .set({ payrollRunId: runId, reservedAt: deps.clock.now() })
    .where(and(eq(claims.orgId, orgId), inArray(claims.id, ids), isNull(claims.payrollRunId)));
}

export async function releaseClaims(deps: AppDeps, tx: Db, orgId: string, runId: string) {
  await tx
    .update(claims)
    .set({ payrollRunId: null, reservedAt: null, updatedAt: deps.clock.now() })
    .where(and(eq(claims.orgId, orgId), eq(claims.payrollRunId, runId), eq(claims.status, "approved")));
}

export async function markClaimsPaidByRun(
  deps: AppDeps,
  tx: Db,
  orgId: string,
  runId: string,
  paymentDate: string,
  opts: { carryFromRunIds?: string[] } = {},
) {
  if (!ISO_DATE.test(paymentDate)) throw new Error(`paymentDate must be YYYY-MM-DD, got ${paymentDate}`);
  const holders = [...new Set([runId, ...(opts.carryFromRunIds ?? [])])];
  // An adjustment pays (and takes over) what its superseded chain reserved but never paid.
  const paid = await tx
    .update(claims)
    .set({ status: "paid", paidVia: "payroll", paidOn: paymentDate, payrollRunId: runId, updatedAt: deps.clock.now() })
    .where(and(eq(claims.orgId, orgId), inArray(claims.payrollRunId, holders), eq(claims.status, "approved")))
    .returning({ id: claims.id, claimNumber: claims.claimNumber, totalCents: claims.totalCents });
  const audit = systemAuditContext(orgId, "system", "payroll");
  for (const c of paid) {
    await recordAudit(tx, deps, audit, {
      action: "claim.paid",
      targetType: "claim",
      targetId: c.id,
      meta: { via: "payroll", payrollRunId: runId, paidOn: paymentDate, claimNumber: c.claimNumber },
    });
  }
  return paid.length;
}

/** The claims module's `ReimbursementSource` for payroll (`deps.payroll.reimbursements`). */
export function createClaimsReimbursementSource(deps: AppDeps): ReimbursementSource {
  return {
    listPayable: (orgId, periodEnd, opts) => listPayableClaims(deps.db, orgId, periodEnd, opts),
    reserve: (tx, orgId, runId, claimIds) => reserveClaims(deps, tx, orgId, runId, claimIds),
    release: (tx, orgId, runId) => releaseClaims(deps, tx, orgId, runId),
    markPaid: async (tx, orgId, runId, paymentDate, opts) => {
      await markClaimsPaidByRun(deps, tx, orgId, runId, paymentDate, opts);
    },
  };
}

/**
 * What a payroll run for the period ending `periodEnd` would pick up (the HTTP view of
 * `listPayable` for payroll_admins and owners), with claim numbers and employee names.
 */
export async function payableForPeriod(db: Db, orgId: string, periodEnd: string) {
  const entries = await listPayableClaims(db, orgId, periodEnd);
  const ids = [...new Set(entries.map((e) => e.claimId))];
  const rows = ids.length
    ? await db
        .select({
          id: claims.id,
          claimNumber: claims.claimNumber,
          approvedOn: claims.approvedOn,
          payrollRunId: claims.payrollRunId,
          name: sql<string>`(select coalesce(e.preferred_name, e.legal_name) from employees e where e.org_id = ${claims.orgId} and e.id = ${claims.employeeId})`,
        })
        .from(claims)
        .where(and(eq(claims.orgId, orgId), inArray(claims.id, ids)))
    : [];
  const byId = new Map(rows.map((r) => [r.id, r]));
  return entries.map((e) => {
    const r = byId.get(e.claimId);
    return {
      ...e,
      claimNumber: r?.claimNumber ?? null,
      employeeName: r?.name ?? "",
      approvedOn: r?.approvedOn ?? null,
      reserved: r?.payrollRunId != null,
    };
  });
}
