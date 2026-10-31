import { createClaimsReimbursementSource } from "../claims/reimbursement.ts";
import type { Db } from "../db/types.ts";
import type { AppDeps } from "../deps.ts";

/**
 * Collaborators of the payroll module. Each is an interface with a production default and a test
 * double (src/testing/payroll-doubles.ts), so payroll does not wait for the modules behind them:
 *
 * | Port | Owner (to wire) | Default here | Tests |
 * | --- | --- | --- | --- |
 * | `reimbursements` | WS6 claims (`ReimbursementSource`, add-claims design §5) | `createClaimsReimbursementSource(deps)` (approved claims) | `createMemoryReimbursements()` |
 * | `overtime` | WS5 attendance (approved OT) | `manualOvertimeOnly` (OT entered as run items) | `createMemoryOvertime()` |
 *
 * Approvals go through the workflows engine: `payroll/approval.ts` registers the `payroll_run`
 * subject adapter in `CORE_WORKFLOW_PLUGINS`.
 */

/** A final decision as the payroll adapter applies it (mapped from the workflows engine's FinalDecision). */
export interface ApprovalDecision {
  outcome: "approved" | "rejected";
  decidedByUserId: string;
  decidedByMembershipId: string;
  decidedAt: Date;
  comment: string | null;
  /** The requester decided their own request (allowed only for an owner with nobody else eligible). */
  selfApproved: boolean;
}

/** Claims payable through payroll (add-claims design §5). */
export interface PayableClaim {
  claimId: string;
  employeeId: string;
  typeName: string;
  amountCents: number;
}

export interface ReimbursementSource {
  /**
   * Approved, unpaid claims approved on or before `periodEnd`. With `runId`, claims reserved by
   * another run are left out (claims reserved by this run stay listed, so a recompute keeps them).
   */
  listPayable(orgId: string, periodEnd: string, opts?: { runId?: string }): Promise<PayableClaim[]>;
  /** Fails if any claim is already reserved by another run or paid. */
  reserve(tx: Db, orgId: string, runId: string, claimIds: string[]): Promise<void>;
  release(tx: Db, orgId: string, runId: string): Promise<void>;
  markPaid(tx: Db, orgId: string, runId: string, paymentDate: string): Promise<void>;
}

/** Nothing payable: a test double for payroll tests that don't involve claims. */
export const noClaimsYet: ReimbursementSource = {
  listPayable: async () => [],
  reserve: async () => {},
  release: async () => {},
  markPaid: async () => {},
};

export interface ApprovedOvertime {
  /** Stable id from attendance (idempotent import). */
  sourceId: string;
  employeeId: string;
  minutes: number;
  periodStart: string;
  periodEnd: string;
}

export interface OvertimeSource {
  listApproved(orgId: string, periodStart: string, periodEnd: string): Promise<ApprovedOvertime[]>;
}

/** NOT IMPLEMENTED (attendance module): overtime is entered by hand on the run. */
export const manualOvertimeOnly: OvertimeSource = { listApproved: async () => [] };

export interface PayrollPorts {
  reimbursements: ReimbursementSource;
  overtime: OvertimeSource;
}

export type PayrollAppDeps = AppDeps & { payroll?: Partial<PayrollPorts> };

export function payrollPorts(deps: AppDeps): PayrollPorts {
  const p = (deps as PayrollAppDeps).payroll ?? {};
  return {
    reimbursements: p.reimbursements ?? createClaimsReimbursementSource(deps),
    overtime: p.overtime ?? manualOvertimeOnly,
  };
}
