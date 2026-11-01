import { and, eq, isNull } from "drizzle-orm";
import { inviteMember } from "../access/invitations.ts";
import { markMembershipFormer } from "../access/members-routes.ts";
import { orgScope } from "../access/org-scope.ts";
import { type AuditContext, type AuditEventInput, recordAudit, systemAuditContext } from "../audit/audit.ts";
import type { SecretBox } from "../crypto/secret-box.ts";
import { membershipRoles, memberships as membershipsTable } from "../db/schema/access.ts";
import type { Db } from "../db/types.ts";
import type { AppDeps } from "../deps.ts";
import { AppError } from "../errors.ts";
import { payrollPeoplePort } from "../payroll/people-port.ts";
import { workflowsApprovalsPort } from "../workflows/people.ts";
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
 * | `memberships.inviteForEmployee` | identity's `inviteMember()` (email, or a copyable link without SMTP) | memory double |
 * | `approvals` | the workflows engine (`workflowsApprovalsPort`) | memory double |
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
  /** Appends `event` inside `tx`, the transaction that makes the audited change. */
  record(tx: Db, ctx: AuditContext, event: AuditEventInput): Promise<void>;
}

/** What happened to the sign-in invitation sent on hire. */
export interface HireInvite {
  /** `emailed`; `link` (no SMTP: show `inviteUrl` once to copy); `linked` (already a member: linked to the record); `skipped`. */
  status: "emailed" | "link" | "linked" | "skipped";
  inviteUrl: string | null;
  message: string;
}

export interface MembershipsPort {
  /** On hire: invite the employee by work email (copy-link when no mailer), linked to their record. */
  inviteForEmployee(
    input: { orgId: string; employeeId: string; email: string; displayName: string },
    ctx: AuditContext,
  ): Promise<HireInvite>;
  /**
   * Termination took effect: drop roles, mark the membership `former`. Idempotent. Pass `tx` to
   * make the change (and its audit event) part of the caller's transaction.
   */
  markFormer(input: { orgId: string; employeeId: string; lastWorkingDay: IsoDate }, tx?: Db): Promise<void>;
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
  /** Pass `tx` to submit in the transaction that creates the subject. */
  submit(input: ApprovalSubmission, tx?: Db): Promise<{ approvalRequestId: string | null }>;
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
  /**
   * Last day of the most recent finalised payroll period, or null when none is finalised. Pass the
   * caller's transaction as `db` when inside one (single-connection drivers would otherwise wait).
   */
  lastFinalisedPeriodEnd(orgId: string, db?: Db): Promise<IsoDate | null>;
  /** A retroactive compensation change was recorded; payroll owes a back-pay adjustment. */
  notifyBackPay(notice: BackPayNotice, db?: Db): Promise<void>;
}

export interface PeoplePorts {
  secretBox: SecretBox;
  audit: AuditSink;
  memberships: MembershipsPort;
  approvals: ApprovalsPort;
  payroll: PayrollPort;
}

/** No payroll: nothing is ever finalised (tests and hosts without payroll). Production uses `payrollPeoplePort`. */
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
      record: async (tx, ctx, event) => {
        await recordAudit(tx, deps, ctx, event);
      },
    },
    memberships: {
      inviteForEmployee: (input, ctx) => inviteHiredEmployee(deps, input, ctx),
      markFormer: async ({ orgId, employeeId }, tx) => {
        const audit = systemAuditContext(orgId, "system", "people.former");
        const run = async (db: Db) => {
          await markMembershipFormer(deps, db, audit, { orgId, employeeId });
        };
        await (tx ? run(tx) : deps.db.transaction(run));
      },
    },
    approvals: workflowsApprovalsPort(deps),
    payroll: payrollPeoplePort(deps),
  };
}

/**
 * Hire-time invitation through identity's invite service. A hire never fails because of its
 * invitation: an email that already has a membership is linked to the new record when that
 * membership has no employee yet and holds no roles, and anything else is reported back as
 * `skipped` with what to do. Linking a role holder would let whoever records the hire later end
 * that employment and so strip an owner's or admin's roles (review #6), so it is never automatic.
 */
export async function inviteHiredEmployee(
  deps: AppDeps,
  input: { orgId: string; employeeId: string; email: string; displayName: string },
  ctx: AuditContext,
): Promise<HireInvite> {
  try {
    const result = await inviteMember(deps, ctx, {
      orgId: input.orgId,
      email: input.email,
      displayName: input.displayName,
      employeeId: input.employeeId,
      invitedBy: ctx.actorMembershipId,
    });
    return result.inviteUrl
      ? {
          status: "link",
          inviteUrl: result.inviteUrl,
          message: "Email isn't set up, so copy this sign-in link and send it to them. It lasts 7 days.",
        }
      : { status: "emailed", inviteUrl: null, message: `We emailed a sign-in invitation to ${input.email}.` };
  } catch (err) {
    const existingId = (err as AppError).details as { membershipId?: string } | undefined;
    if (err instanceof AppError && err.code === "conflict" && existingId?.membershipId) {
      const membershipId = existingId.membershipId;
      return deps.db.transaction(async (tx) => {
        const [role] = await tx
          .select({ role: membershipRoles.role })
          .from(membershipRoles)
          .where(and(eq(membershipRoles.orgId, input.orgId), eq(membershipRoles.membershipId, membershipId)))
          .limit(1);
        if (role) {
          return {
            status: "skipped" as const,
            inviteUrl: null,
            message: `${input.email} already signs in as an owner or admin, so it wasn't linked to this record automatically: an owner has to link it.`,
          };
        }
        const [linked] = await tx
          .update(membershipsTable)
          .set({ employeeId: input.employeeId, updatedAt: deps.clock.now() })
          .where(
            orgScope(tx, input.orgId).where(
              membershipsTable,
              eq(membershipsTable.id, membershipId),
              isNull(membershipsTable.employeeId),
            ),
          )
          .returning({ id: membershipsTable.id });
        if (!linked) {
          return {
            status: "skipped" as const,
            inviteUrl: null,
            message: `${input.email} already belongs to a member linked to another employee record. Check Settings → Members.`,
          };
        }
        await recordAudit(tx, deps, ctx, {
          action: "member.employee_linked",
          targetType: "membership",
          targetId: membershipId,
          meta: { employeeId: input.employeeId },
        });
        return {
          status: "linked" as const,
          inviteUrl: null,
          message: `${input.email} already has a sign-in; it is now linked to this employee record.`,
        };
      });
    }
    deps.logger.error("Hire invitation failed", { err, orgId: input.orgId });
    return {
      status: "skipped",
      inviteUrl: null,
      message: "The employee was added, but the invitation could not be sent. Invite them from Settings → Members.",
    };
  }
}

export function peoplePorts(deps: AppDeps): PeoplePorts {
  return (deps as PeopleAppDeps).people ?? defaultPeoplePorts(deps);
}
