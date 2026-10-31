import { markMembershipFormer } from "../access/members-routes.ts";
import { type AuditContext, type AuditEventInput, recordAudit, systemAuditContext } from "../audit/audit.ts";
import type { SecretBox } from "../crypto/secret-box.ts";
import type { AppDeps } from "../deps.ts";
import type { IsoDate } from "./dates.ts";

/**
 * Collaborators of the people module. Identity's are real (SecretBox, audit,
 * the `former` hook); the rest are stand-ins until their owners land:
 *
 * | Port | Production default | Tests |
 * | --- | --- | --- |
 * | `secretBox` | `deps.secretBox` (identity) | same, with the test key |
 * | `audit` | `recordAudit()` hash-chained log (identity) | `createMemoryAuditSink()` |
 * | `memberships.markFormer` | `markMembershipFormer()` (identity) | memory double |
 * | `memberships.inviteForEmployee` | NOT IMPLEMENTED (needs an exported invite service from identity) | memory double |
 * | `approvals` | local: the request waits for `POST /people/change-requests/:id/decision` (workflows not built) | memory double |
 * | `payroll` | `noPayrollYet` (nothing finalised) | memory double |
 *
 * `ReportingScopeResolver` is implemented here (`reports/reporting-scope.ts`).
 */

export type { AuditContext, AuditEventInput, SecretBox };

/** SecretBox purposes used by this module (identity's names where they exist; adding one is free). */
export const PEOPLE_PURPOSES = {
  nric: "nric",
  bank: "bank-account",
  workPass: "work-pass",
  changeRequest: "change-request",
  import: "people-import",
} as const;

export interface AuditSink {
  record(ctx: AuditContext, event: AuditEventInput): Promise<void>;
}

export interface MembershipsPort {
  /** On hire: invite the employee by work email (copy-link when no mailer). */
  inviteForEmployee(input: {
    orgId: string;
    employeeId: string;
    email: string;
    invitedBy: string | null;
  }): Promise<void>;
  /** Termination took effect: drop roles, mark the membership `former`. Idempotent. */
  markFormer(input: { orgId: string; employeeId: string; lastWorkingDay: IsoDate }): Promise<void>;
}

export interface ApprovalSubmission {
  orgId: string;
  subjectType: "profile_change";
  subjectId: string;
  requesterUserId: string | null;
  routeToRole: "hr_admin" | "payroll_admin";
  summary: string;
}

/** Workflows stand-in: submit a subject for approval; the decision calls back into `decideChangeRequest`. */
export interface ApprovalsPort {
  submit(input: ApprovalSubmission): Promise<{ approvalRequestId: string | null }>;
  cancel(orgId: string, approvalRequestId: string): Promise<void>;
}

export interface BackPayNotice {
  orgId: string;
  employeeId: string;
  compensationRecordId: string;
  effectiveFrom: IsoDate;
  previousAmountCents: number | null;
  newAmountCents: number;
}

export interface PayrollPort {
  /** Last day of the most recent finalised payroll period, or null when none is finalised. */
  lastFinalisedPeriodEnd(orgId: string): Promise<IsoDate | null>;
  /** A retroactive compensation change was recorded; payroll owes a back-pay adjustment. */
  notifyBackPay(notice: BackPayNotice): Promise<void>;
}

export interface PeoplePorts {
  secretBox: SecretBox;
  audit: AuditSink;
  memberships: MembershipsPort;
  approvals: ApprovalsPort;
  payroll: PayrollPort;
}

/**
 * NOT IMPLEMENTED: payroll has not been built. No period is ever finalised,
 * so the retroactive-change guard never triggers outside tests, and back-pay
 * notices go nowhere.
 */
export const noPayrollYet: PayrollPort = {
  lastFinalisedPeriodEnd: async () => null,
  notifyBackPay: async () => {},
};

/**
 * NOT IMPLEMENTED (workflows): no approval task, inbox item or notification
 * is created. Requests wait in `profile_change_requests` and are listed by
 * `GET /people/inbox` for hr_admin / payroll_admin to decide.
 */
export const localApprovals: ApprovalsPort = {
  submit: async () => ({ approvalRequestId: null }),
  cancel: async () => {},
};

/** AppDeps plus optional people ports (tests and the demo inject doubles). */
export type PeopleAppDeps = AppDeps & { people?: PeoplePorts };

export function defaultPeoplePorts(deps: AppDeps): PeoplePorts {
  return {
    secretBox: deps.secretBox,
    audit: {
      record: async (ctx, event) => {
        await recordAudit(deps.db, deps, ctx, event);
      },
    },
    memberships: {
      inviteForEmployee: async ({ orgId }) => {
        // NOT IMPLEMENTED: identity has no exported invite service yet; HR invites from Settings → Members.
        deps.logger.info("Employee hired; invite them from Settings → Members", { orgId });
      },
      markFormer: async ({ orgId, employeeId }) => {
        await markMembershipFormer(deps, deps.db, systemAuditContext(orgId, "system", "people.former"), {
          orgId,
          employeeId,
        });
      },
    },
    approvals: localApprovals,
    payroll: noPayrollYet,
  };
}

export function peoplePorts(deps: AppDeps): PeoplePorts {
  return (deps as PeopleAppDeps).people ?? defaultPeoplePorts(deps);
}
