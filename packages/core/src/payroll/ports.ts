import { attendanceDaysWorkedSource, attendanceOvertimeSource } from "../attendance/outputs.ts";
import { createClaimsReimbursementSource } from "../claims/reimbursement.ts";
import type { Db } from "../db/types.ts";
import type { AppDeps } from "../deps.ts";
import { leaveUnpaidSource } from "../leave/outputs.ts";
import { schedulingScheduledDaysSource } from "../scheduling/feeds.ts";

/**
 * Collaborators of the payroll module. Each is an interface with a production default and a test
 * double (src/testing/payroll-doubles.ts), so payroll does not wait for the modules behind them:
 *
 * | Port | Owner (to wire) | Default here | Tests |
 * | --- | --- | --- | --- |
 * | `reimbursements` | WS6 claims (`ReimbursementSource`, add-claims design §5) | `createClaimsReimbursementSource(deps)` (approved claims) | `createMemoryReimbursements()` |
 * | `overtime` | WS5 attendance (approved OT) | `attendanceOvertimeSource` | `createMemoryOvertime()` / `manualOvertimeOnly` |
 * | `unpaidLeave` | WS5 leave (no-pay, unpaid infant care) | `leaveUnpaidSource` | `noUnpaidLeave` |
 * | `daysWorked` | WS5 attendance (rostered staff) | `attendanceDaysWorkedSource` | `noDaysWorked` |
 * | `scheduledDays` | WS5 scheduling (published rosters) | `schedulingScheduledDaysSource` | `noScheduledDays` |
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
  /** Snapshotted at compute: taxable cash reimbursement (IR8A d1), independent of CPF wages. */
  taxable?: boolean;
  claimId: string;
  employeeId: string;
  typeName: string;
  amountCents: number;
  /**
   * Set when the claim was reserved or paid by a run this adjustment replaces: the adjustment
   * carries the reimbursement (the replaced run's net already included it) but does not reserve it.
   */
  carriedFromRunId?: string;
}

/** Options for `listPayable` / `markPaid`. */
export interface ReimbursementRunOpts {
  /** The run asking: claims reserved by other runs are left out, its own stay listed. */
  runId?: string;
  /**
   * An adjustment's replaced chain (original, that one's original, …): claims those runs reserved
   * or paid are listed too (with `carriedFromRunId`), whatever their approval date.
   */
  carryFromRunIds?: string[];
}

export interface ReimbursementSource {
  /**
   * Approved, unpaid claims approved on or before `periodEnd`. With `runId`, claims reserved by
   * another run are left out (claims reserved by this run stay listed, so a recompute keeps them).
   */
  listPayable(orgId: string, periodEnd: string, opts?: ReimbursementRunOpts): Promise<PayableClaim[]>;
  /** Fails if any claim is already reserved by another run or paid. */
  reserve(tx: Db, orgId: string, runId: string, claimIds: string[]): Promise<void>;
  release(tx: Db, orgId: string, runId: string): Promise<void>;
  /**
   * Pays this run's reserved claims. With `carryFromRunIds` (an adjustment), claims still reserved
   * (approved, unpaid) by the replaced chain move to this run and are paid too.
   */
  markPaid(
    tx: Db,
    orgId: string,
    runId: string,
    paymentDate: string,
    opts?: { carryFromRunIds?: string[] },
  ): Promise<void>;
}

/** Nothing payable: a test double for payroll tests that don't involve claims. */
export const noClaimsYet: ReimbursementSource = {
  listPayable: async () => [],
  reserve: async () => {},
  release: async () => {},
  markPaid: async () => {},
};

export interface ApprovedOvertime {
  /** Optional contractual amount provided by a host feed. */
  amountCents?: number | null;
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

/** Overtime entered by hand on the run only (tests; hosts without attendance). The default is attendance's approved OT. */
export const manualOvertimeOnly: OvertimeSource = { listApproved: async () => [] };

/** One date of approved unpaid leave (no-pay, unpaid infant care): an `unpaid_leave` run item. */
export interface UnpaidLeaveDay {
  /** Stable: the leave request day's id. */
  sourceId: string;
  requestId: string;
  employeeId: string;
  date: string;
  /** Multiples of 0.5. */
  days: number;
  leaveTypeCode: string;
  leaveTypeName: string;
}

export interface UnpaidLeaveSource {
  listUnpaid(orgId: string, periodStart: string, periodEnd: string): Promise<UnpaidLeaveDay[]>;
}

/** Days worked by rostered staff (no fixed week): a `days_worked` run item (EA s 20A). */
export interface RosterDaysWorked {
  sourceId: string;
  employeeId: string;
  /** Includes public holidays and paid leave; excludes no-pay leave. Multiples of 0.5. */
  daysWorked: number;
  periodStart: string;
  periodEnd: string;
}

export interface DaysWorkedSource {
  listDaysWorked(orgId: string, periodStart: string, periodEnd: string): Promise<RosterDaysWorked[]>;
}

/**
 * Scheduled working days of rostered staff (no fixed week) from published rosters: the
 * denominator of EA s 20A's incomplete-month formula (`scheduled_days` run item).
 */
export interface RosterScheduledDays {
  sourceId: string;
  employeeId: string;
  /** Days the roster required, including public holidays and leave days. Whole days. */
  scheduledDays: number;
  periodStart: string;
  periodEnd: string;
}

export interface ScheduledDaysSource {
  listScheduledDays(orgId: string, periodStart: string, periodEnd: string): Promise<RosterScheduledDays[]>;
}

export const noScheduledDays: ScheduledDaysSource = { listScheduledDays: async () => [] };
export const noUnpaidLeave: UnpaidLeaveSource = { listUnpaid: async () => [] };
export const noDaysWorked: DaysWorkedSource = { listDaysWorked: async () => [] };

export interface PayrollPorts {
  reimbursements: ReimbursementSource;
  overtime: OvertimeSource;
  /** WS5 leave: approved unpaid leave per date (pro-ration). */
  unpaidLeave: UnpaidLeaveSource;
  /** WS5 attendance: days worked by rostered staff who clock in. */
  daysWorked: DaysWorkedSource;
  /** WS5 scheduling: scheduled days of rostered staff whose period is fully published. A manual item wins. */
  scheduledDays: ScheduledDaysSource;
}

export type PayrollAppDeps = AppDeps & { payroll?: Partial<PayrollPorts> };

export function payrollPorts(deps: AppDeps): PayrollPorts {
  const p = (deps as PayrollAppDeps).payroll ?? {};
  return {
    reimbursements: p.reimbursements ?? createClaimsReimbursementSource(deps),
    overtime: p.overtime ?? attendanceOvertimeSource(deps),
    unpaidLeave: p.unpaidLeave ?? leaveUnpaidSource(deps),
    daysWorked: p.daysWorked ?? attendanceDaysWorkedSource(deps),
    scheduledDays: p.scheduledDays ?? schedulingScheduledDaysSource(deps),
  };
}
