import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { singaporeDate } from "../access/scope.ts";
import type { AuditContext } from "../audit/audit.ts";
import { claims, claimTypes, type PayoutMethod } from "../db/schema/claims.ts";
import type { Db } from "../db/types.ts";
import type { AppDeps } from "../deps.ts";
import { displayDate } from "../employees/dates.ts";
import { createReportingScopeResolver } from "../employees/reports/reporting-scope.ts";
import { AppError } from "../errors.ts";
import { fileScannerOf, runScanSweep } from "../files/scanner.ts";
import type { SubjectAdapter, SubjectRef, WorkflowPlugin } from "../workflows/types.ts";
import { assertWithinCaps, claimCapUsage, lockCaps } from "./caps.ts";
import { fxWarnings, fxWarningText } from "./fx-check.ts";
import { formatMinor, formatRateMicros, sgd } from "./money.ts";
import { employeeSummaries } from "./people.ts";
import { sweepUnattachedReceipts } from "./receipt-cleanup.ts";
import { loadClaim } from "./service.ts";
import type { ClaimTypeRow } from "./types.ts";

/**
 * The `claim` subject of the workflows engine (spec "Submission and approval"). The engine owns
 * who approves (policies with `amountCents` thresholds and `typeCode` conditions); this adapter
 * owns what a decision does to the claim. Callbacks run in the decision's transaction: approval
 * re-checks caps under the same advisory lock as submission (approved + paid only) and throws
 * `cap_exceeded` to refuse, which rolls the decision back so the approver can reject instead.
 */

const attributes = z.object({ amountCents: z.int().min(1), typeCode: z.string().min(1) });
type Attrs = z.output<typeof attributes>;

async function typesFor(db: Db, orgId: string, ids: string[]): Promise<Map<string, ClaimTypeRow>> {
  if (!ids.length) return new Map();
  const rows = await db
    .select()
    .from(claimTypes)
    .where(and(eq(claimTypes.orgId, orgId), inArray(claimTypes.id, [...new Set(ids)])));
  return new Map(rows.map((r) => [r.id, r]));
}

/** Payroll unless every line's type pays outside payroll (mixed → payroll, spec). */
export function payoutFor(types: readonly Pick<ClaimTypeRow, "defaultPayout">[]): PayoutMethod {
  return types.length > 0 && types.every((t) => t.defaultPayout === "outside") ? "outside" : "payroll";
}

function typeList(names: string[]): string {
  const unique = [...new Set(names)];
  if (unique.length <= 1) return unique[0] ?? "Expense";
  return `${unique.slice(0, -1).join(", ")} and ${unique[unique.length - 1]}`;
}

export function claimSubjectAdapter(deps: AppDeps): SubjectAdapter<Attrs> {
  const decided = async (db: Db, ref: SubjectRef, set: Partial<typeof claims.$inferInsert>) => {
    await db
      .update(claims)
      .set({ ...set, updatedAt: deps.clock.now() })
      .where(and(eq(claims.orgId, ref.orgId), eq(claims.id, ref.subjectId), eq(claims.status, "submitted")));
  };
  return {
    type: "claim",
    label: "Claim",
    inlineDecision: true,
    attributes,
    async summary(db, ref) {
      const { claim, lines } = await loadClaim(db, ref.orgId, ref.subjectId);
      const types = await typesFor(
        db,
        ref.orgId,
        lines.map((l) => l.claimTypeId),
      );
      const names = lines.map((l) => types.get(l.claimTypeId)?.name ?? "Expense");
      const today = singaporeDate(deps.clock.now());
      const person = (await employeeSummaries(db, ref.orgId, [claim.employeeId], today)).get(claim.employeeId);
      const out = lines.map((l) => {
        const t = types.get(l.claimTypeId);
        const fx =
          l.currency === "SGD"
            ? ""
            : ` (${formatMinor(l.currency, l.amountMinor)} @ ${formatRateMicros(l.rateMicros ?? 0)})`;
        // Medical merchant and description stay out of the summary: it is shown to anyone who can read the request.
        const what = t?.category === "medical" ? (t?.name ?? "Medical") : `${t?.name ?? "Expense"} · ${l.merchant}`;
        const receipts = l.receipts.length
          ? ` · ${l.receipts.length} receipt${l.receipts.length === 1 ? "" : "s"}`
          : "";
        return { label: `${displayDate(l.expenseDate)}`, value: `${what}: ${sgd(l.sgdCents)}${fx}${receipts}` };
      });
      const usage = await claimCapUsage(db, {
        orgId: ref.orgId,
        employeeId: claim.employeeId,
        claimId: claim.id,
        lines: lines.map((l, index) => ({
          index,
          claimTypeId: l.claimTypeId,
          expenseDate: l.expenseDate,
          sgdCents: l.sgdCents,
        })),
        types,
      });
      // Rates far from the last one used in the organisation (a warning, not a block).
      const fx = await fxWarnings(db, ref.orgId, claim, lines);
      const rateChecks = lines.flatMap((l, i) => {
        const warning = fx[i];
        return warning && l.rateMicros !== null
          ? [{ label: "Exchange rate", value: fxWarningText(l.currency, formatRateMicros(l.rateMicros), warning) }]
          : [];
      });
      // The claim's own title when it has one, so the request reads as it does in My claims. Not for
      // medical claims: like the merchant and description, a medical title stays out of the request.
      const medical = lines.some((l) => types.get(l.claimTypeId)?.category === "medical");
      return {
        title: claim.title && !medical ? claim.title : `${typeList(names)} claim`,
        lines: [
          ...(claim.claimNumber ? [{ label: "Claim", value: claim.claimNumber }] : []),
          { label: "Total", value: sgd(claim.totalCents) },
          ...out,
        ],
        context: [
          ...rateChecks,
          ...(person?.departmentName ? [{ label: "Department", value: person.departmentName }] : []),
          ...usage.map((u) => ({
            label: `${u.typeName} cap (${u.period === "per_claim" ? "per claim" : u.periodLabel})`,
            value: `${sgd(u.usedCents)} approved, ${sgd(u.pendingCents)} pending of ${sgd(u.capCents)}`,
          })),
        ],
      };
    },
    async onApproved(db, ref, decision) {
      const { claim, lines } = await loadClaim(db, ref.orgId, ref.subjectId, { lock: true });
      if (claim.status !== "submitted") return;
      const types = await typesFor(
        db,
        ref.orgId,
        lines.map((l) => l.claimTypeId),
      );
      await lockCaps(
        db,
        ref.orgId,
        claim.employeeId,
        lines.map((l) => l.claimTypeId),
      );
      const usage = await claimCapUsage(db, {
        orgId: ref.orgId,
        employeeId: claim.employeeId,
        claimId: claim.id,
        lines: lines.map((l, index) => ({
          index,
          claimTypeId: l.claimTypeId,
          expenseDate: l.expenseDate,
          sgdCents: l.sgdCents,
        })),
        types,
      });
      assertWithinCaps(usage, "approve");
      await decided(db, ref, {
        status: "approved",
        payoutMethod: payoutFor([...types.values()]),
        decidedAt: decision.decidedAt,
        approvedOn: singaporeDate(decision.decidedAt),
        decisionComment: decision.comment,
      });
    },
    async onRejected(db, ref, decision) {
      await decided(db, ref, { status: "rejected", decidedAt: decision.decidedAt, decisionComment: decision.comment });
    },
    async onWithdrawn(db, ref) {
      await decided(db, ref, { status: "withdrawn", decidedAt: deps.clock.now() });
    },
    async canRead(db, viewer, ref) {
      // payroll_admin reads every claim (matrix claims:read A); managers read their team's via the module.
      if (viewer.roles.includes("payroll_admin")) return true;
      const [row] = await db
        .select({ employeeId: claims.employeeId })
        .from(claims)
        .where(and(eq(claims.orgId, ref.orgId), eq(claims.id, ref.subjectId)));
      if (!row || !viewer.employeeId) return false;
      // The decision's connection (`db`), never deps.db: PGlite has one connection.
      const team = await createReportingScopeResolver(db).teamOf(
        ref.orgId,
        viewer.employeeId,
        singaporeDate(deps.clock.now()),
      );
      return team.has(row.employeeId);
    },
    link: (ref) => `/claims/${ref.subjectId}`,
  };
}

/** The scan sweep as a `tick` transition (no-op without a configured scanner). */
export function receiptScanTransition(deps: AppDeps) {
  return { id: "claim_receipt_scan", run: () => runScanSweep(deps) };
}

/** Deletes receipts on no claim line uploaded more than 7 days ago, as a `tick` transition. */
export function receiptCleanupTransition(deps: AppDeps) {
  return {
    id: "claim_receipt_cleanup",
    run: (db: Db, input: { now: Date; audit: (orgId: string) => AuditContext }) =>
      sweepUnattachedReceipts(db, deps, input),
  };
}

/** Workflows contributions of the claims module (registered in workflows/registry.ts). */
export function claimsWorkflowPlugin(deps: AppDeps): WorkflowPlugin {
  return {
    name: "claims",
    subjects: [claimSubjectAdapter(deps)],
    // The scan sweep only exists when the host configured a scanner.
    transitions: [...(fileScannerOf(deps) ? [receiptScanTransition(deps)] : []), receiptCleanupTransition(deps)],
  };
}

/** For tests that need to assert the refusal shape without the engine. */
export function isCapRefusal(err: unknown): err is AppError {
  return err instanceof AppError && err.code === "cap_exceeded";
}
