import type { Db } from "../db/types.ts";
import type { AppDeps } from "../deps.ts";

/**
 * Collaborators of the payroll module. Each is an interface with a production default and a test
 * double (src/testing/payroll-doubles.ts), so payroll does not wait for the modules behind them:
 *
 * | Port | Owner (to wire) | Default here | Tests |
 * | --- | --- | --- | --- |
 * | `approvals` | WS3 workflows engine | `localPayrollApprovals`: decided via `POST /payroll/runs/:id/decision` | `createMemoryPayrollApprovals()` |
 * | `reimbursements` | WS6 claims (`ReimbursementSource`, add-claims design §5) | `noClaimsYet` (nothing payable) | `createMemoryReimbursements()` |
 * | `overtime` | WS5 attendance (approved OT) | `manualOvertimeOnly` (OT entered as run items) | `createMemoryOvertime()` |
 *
 * WS3 wiring: implement `PayrollApprovals` on the engine and register `payrollRunSubject` (from
 * `payroll/approval.ts`) as the `payroll_run` SubjectAdapter. Its `onApproved`/`onRejected` take the
 * engine's transaction, so the run's state changes in the same transaction as the decision.
 */

export interface ApprovalRequester {
  userId: string;
  membershipId: string;
  employeeId: string | null;
}

/** Mirrors workflows' typed request: subject type, id, requester and declared attributes. */
export interface PayrollApprovalRequest {
  orgId: string;
  subjectType: "payroll_run";
  subjectId: string;
  requester: ApprovalRequester;
  attributes: { amountCents: number; typeCode: "regular" | "off_cycle" | "adjustment" };
  summary: { title: string; lines: string[] };
}

export interface ApprovalDecision {
  outcome: "approved" | "rejected";
  decidedByUserId: string;
  decidedByMembershipId: string;
  decidedAt: Date;
  comment: string | null;
  /** The requester decided their own request (allowed only for an owner with nobody else eligible). */
  selfApproved: boolean;
}

export interface PayrollApprovals {
  /** Engine-backed: the decision arrives later through the registered adapter. `local` = decided via payroll's own route. */
  readonly mode: "engine" | "local";
  submit(tx: Db, request: PayrollApprovalRequest): Promise<{ approvalRequestId: string }>;
  /** The run went back to draft (withdrawn by payroll). */
  withdraw(tx: Db, orgId: string, approvalRequestId: string): Promise<void>;
}

/**
 * NOT IMPLEMENTED (workflows engine): no approval task, inbox item or notification. The request
 * waits on the run; an owner or payroll_admin decides it with `POST /payroll/runs/:id/decision`,
 * which calls the same adapter in one transaction.
 */
export const localPayrollApprovals: PayrollApprovals = {
  mode: "local",
  submit: async (_tx, request) => ({ approvalRequestId: `local:${request.subjectId}` }),
  withdraw: async () => {},
};

/** Claims payable through payroll (add-claims design §5). */
export interface PayableClaim {
  claimId: string;
  employeeId: string;
  typeName: string;
  amountCents: number;
}

export interface ReimbursementSource {
  listPayable(orgId: string, periodEnd: string): Promise<PayableClaim[]>;
  /** Fails if any claim is already reserved by another run or paid. */
  reserve(tx: Db, orgId: string, runId: string, claimIds: string[]): Promise<void>;
  release(tx: Db, orgId: string, runId: string): Promise<void>;
  markPaid(tx: Db, orgId: string, runId: string, paymentDate: string): Promise<void>;
}

/** NOT IMPLEMENTED (claims module): nothing is ever payable, so no reimbursement lines appear. */
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
  approvals: PayrollApprovals;
  reimbursements: ReimbursementSource;
  overtime: OvertimeSource;
}

export type PayrollAppDeps = AppDeps & { payroll?: Partial<PayrollPorts> };

export function payrollPorts(deps: AppDeps): PayrollPorts {
  const p = (deps as PayrollAppDeps).payroll ?? {};
  return {
    approvals: p.approvals ?? localPayrollApprovals,
    reimbursements: p.reimbursements ?? noClaimsYet,
    overtime: p.overtime ?? manualOvertimeOnly,
  };
}
