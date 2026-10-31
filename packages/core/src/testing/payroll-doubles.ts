import { systemAuditContext } from "../audit/audit.ts";
import type { Db } from "../db/types.ts";
import type { AppDeps } from "../deps.ts";
import { payrollRunSubject } from "../payroll/approval.ts";
import type {
  ApprovalDecision,
  ApprovedOvertime,
  OvertimeSource,
  PayableClaim,
  PayrollApprovalRequest,
  PayrollApprovals,
  ReimbursementSource,
} from "../payroll/ports.ts";

/**
 * Test doubles for the payroll ports (runtime-agnostic, so the demo can reuse them). The approvals
 * double behaves like the workflows engine: submissions wait until `decide` is called, which runs the
 * registered `payroll_run` adapter inside one transaction, exactly as WS3's engine will.
 */
export function createMemoryPayrollApprovals(deps: () => AppDeps): PayrollApprovals & {
  requests: (PayrollApprovalRequest & { approvalRequestId: string; state: "pending" | "decided" | "withdrawn" })[];
  decide(
    approvalRequestId: string,
    decision: Omit<ApprovalDecision, "decidedAt"> & { decidedAt?: Date },
  ): Promise<void>;
} {
  const requests: (PayrollApprovalRequest & {
    approvalRequestId: string;
    state: "pending" | "decided" | "withdrawn";
  })[] = [];
  let n = 0;
  return {
    mode: "engine",
    requests,
    async submit(_tx, request) {
      n++;
      const approvalRequestId = `apr-${n}`;
      requests.push({ ...request, approvalRequestId, state: "pending" });
      return { approvalRequestId };
    },
    async withdraw(_tx, _orgId, approvalRequestId) {
      const r = requests.find((x) => x.approvalRequestId === approvalRequestId);
      if (r) r.state = "withdrawn";
    },
    async decide(approvalRequestId, decision) {
      const r = requests.find((x) => x.approvalRequestId === approvalRequestId);
      if (!r || r.state !== "pending") throw new Error("already decided");
      const d = deps();
      await d.db.transaction(async (tx) => {
        const ctx = { deps: d, orgId: r.orgId, audit: systemAuditContext(r.orgId, "system", "approvals-double") };
        const full: ApprovalDecision = { ...decision, decidedAt: decision.decidedAt ?? d.clock.now() };
        if (decision.outcome === "approved") await payrollRunSubject.onApproved(tx, ctx, r.subjectId, full);
        else await payrollRunSubject.onRejected(tx, ctx, r.subjectId, full);
      });
      r.state = "decided";
    },
  };
}

export function createMemoryReimbursements(claims: PayableClaim[] = []): ReimbursementSource & {
  claims: PayableClaim[];
  reserved: Map<string, string>;
  paid: Map<string, string>;
} {
  const reserved = new Map<string, string>();
  const paid = new Map<string, string>();
  return {
    claims,
    reserved,
    paid,
    listPayable: async () => claims.filter((c) => !paid.has(c.claimId)),
    async reserve(_tx: Db, _orgId, runId, claimIds) {
      for (const id of claimIds) {
        const holder = reserved.get(id);
        if ((holder && holder !== runId) || paid.has(id)) throw new Error(`claim ${id} is already reserved or paid`);
      }
      for (const id of claimIds) reserved.set(id, runId);
    },
    async release(_tx: Db, _orgId, runId) {
      for (const [id, r] of [...reserved]) if (r === runId) reserved.delete(id);
    },
    async markPaid(_tx: Db, _orgId, runId, paymentDate) {
      for (const [id, r] of [...reserved]) if (r === runId) paid.set(id, paymentDate);
    },
  };
}

export function createMemoryOvertime(
  entries: ApprovedOvertime[] = [],
): OvertimeSource & { entries: ApprovedOvertime[] } {
  return {
    entries,
    listApproved: async (_orgId, from, to) => entries.filter((e) => e.periodEnd >= from && e.periodStart <= to),
  };
}
