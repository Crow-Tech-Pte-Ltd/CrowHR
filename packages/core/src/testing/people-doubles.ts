import { createSecretBox } from "../crypto/secret-box.ts";
import type {
  ApprovalSubmission,
  ApprovalsPort,
  AuditContext,
  AuditEventInput,
  AuditSink,
  BackPayNotice,
  MembershipsPort,
  PayrollPort,
  PeoplePorts,
} from "../employees/ports.ts";

/**
 * Test doubles for the people ports. Runtime-agnostic, so the browser demo can
 * reuse them. The SecretBox is identity's real implementation with a fixed,
 * test-only key.
 */

export const PEOPLE_TEST_SECRET_KEY = new Uint8Array(32).fill(7);

export interface RecordedAuditEvent extends AuditEventInput {
  ctx: AuditContext;
}

export function createMemoryAuditSink(): AuditSink & { events: RecordedAuditEvent[] } {
  const events: RecordedAuditEvent[] = [];
  return {
    events,
    async record(_tx, ctx, event) {
      events.push({ ...event, ctx });
    },
  };
}

export function createMemoryMemberships(): MembershipsPort & {
  invitations: { orgId: string; employeeId: string; email: string }[];
  formers: { orgId: string; employeeId: string; lastWorkingDay: string }[];
} {
  const invitations: { orgId: string; employeeId: string; email: string }[] = [];
  const formers: { orgId: string; employeeId: string; lastWorkingDay: string }[] = [];
  return {
    invitations,
    formers,
    async inviteForEmployee({ orgId, employeeId, email }) {
      invitations.push({ orgId, employeeId, email });
      return { status: "link", inviteUrl: `https://hr.test/invite/test-${employeeId}`, message: "Copy this link." };
    },
    async markFormer(input) {
      if (!formers.some((f) => f.orgId === input.orgId && f.employeeId === input.employeeId)) formers.push(input);
    },
  };
}

export function createMemoryApprovals(): ApprovalsPort & {
  submissions: (ApprovalSubmission & { approvalRequestId: string; cancelled: boolean })[];
} {
  const submissions: (ApprovalSubmission & { approvalRequestId: string; cancelled: boolean })[] = [];
  return {
    submissions,
    async submit(input) {
      const approvalRequestId = `apr_${submissions.length + 1}`;
      submissions.push({ ...input, approvalRequestId, cancelled: false });
      return { approvalRequestId };
    },
    async cancel(_orgId, approvalRequestId) {
      const s = submissions.find((x) => x.approvalRequestId === approvalRequestId);
      if (s) s.cancelled = true;
    },
  };
}

export function createMemoryPayroll(lastFinalised: Record<string, string> = {}): PayrollPort & {
  backPay: BackPayNotice[];
  finalise(orgId: string, periodEnd: string): void;
} {
  const state = { ...lastFinalised };
  const backPay: BackPayNotice[] = [];
  return {
    backPay,
    finalise(orgId, periodEnd) {
      state[orgId] = periodEnd;
    },
    async lastFinalisedPeriodEnd(orgId) {
      return state[orgId] ?? null;
    },
    async notifyBackPay(notice) {
      backPay.push(notice);
    },
  };
}

export type TestPeoplePorts = PeoplePorts & {
  audit: ReturnType<typeof createMemoryAuditSink>;
  memberships: ReturnType<typeof createMemoryMemberships>;
  approvals: ReturnType<typeof createMemoryApprovals>;
  payroll: ReturnType<typeof createMemoryPayroll>;
};

export function createTestPeoplePorts(): TestPeoplePorts {
  return {
    secretBox: createSecretBox(PEOPLE_TEST_SECRET_KEY),
    audit: createMemoryAuditSink(),
    memberships: createMemoryMemberships(),
    approvals: createMemoryApprovals(),
    payroll: createMemoryPayroll(),
  };
}
