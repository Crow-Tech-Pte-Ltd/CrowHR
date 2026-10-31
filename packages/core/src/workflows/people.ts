import { and, count, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { singaporeDate } from "../access/scope.ts";
import { type AuditContext, recordAudit } from "../audit/audit.ts";
import { memberships } from "../db/schema/access.ts";
import { employees, profileChangeRequests } from "../db/schema/employees.ts";
import { users } from "../db/schema/users.ts";
import { approvalRequests } from "../db/schema/workflows.ts";
import type { Db } from "../db/types.ts";
import type { AppDeps } from "../deps.ts";
import { buildActor } from "../employees/access.ts";
import { decideChangeRequest } from "../employees/change-requests.ts";
import { checklistInbox } from "../employees/checklists.ts";
import { runFormerTransitions } from "../employees/former.ts";
import type { ApprovalSubmission, ApprovalsPort } from "../employees/ports.ts";
import { peoplePorts } from "../employees/ports.ts";
import { notify } from "../notifications/notify.ts";
import { setupChecklist } from "../organisation/setup-checklist.ts";
import { lockRequest, refOf, subjectNoun, submitApproval, withdrawLocked } from "./engine.ts";
import { workflowRegistry } from "./registry.ts";
import type {
  InboxItem,
  InboxSource,
  ManagerResolver,
  PeopleDates,
  ProbationEnd,
  SubjectAdapter,
  WorkflowPlugin,
  WorkPassExpiry,
} from "./types.ts";

/**
 * Wiring between workflows and the people module (WS2): reporting lines, work-pass and probation
 * dates, profile change requests as an approval subject, checklist and setup items on Home, and
 * the `former` membership transition in the sweep.
 */

function rowsOf<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  return ((result as { rows?: T[] }).rows ?? []) as T[];
}

/** The line manager from the employment record in force on `onDate`. */
export const peopleManagerResolver: ManagerResolver = {
  async managerOf(db, orgId, employeeId, onDate) {
    const result = await db.execute<{ manager: string | null }>(sql`
      select er.manager_employee_id as manager
        from employment_records er
       where er.org_id = ${orgId}
         and er.employee_id = ${employeeId}
         and er.effective_from <= ${onDate}
         and (er.effective_to is null or er.effective_to > ${onDate})
       order by er.effective_from desc
       limit 1
    `);
    return rowsOf<{ manager: string | null }>(result)[0]?.manager ?? null;
  },
};

/** Work passes and probation from employee records (current employees only). */
export const peopleDates: PeopleDates = {
  async workPassesExpiring(db, { today, until }) {
    // The current pass per employee: not cancelled, latest expiry. A renewal (a new pass with a
    // later expiry) replaces the old one, so its reminders stop.
    const result = await db.execute<{
      org_id: string;
      pass_id: string;
      employee_id: string;
      name: string;
      pass_type: string;
      expires_on: string;
    }>(sql`
      select * from (
        select distinct on (wp.org_id, wp.employee_id)
               wp.org_id, wp.id as pass_id, wp.employee_id, coalesce(e.preferred_name, e.legal_name) as name,
               wp.pass_type, wp.expires_on::text as expires_on
          from work_passes wp
          join employees e on e.org_id = wp.org_id and e.id = wp.employee_id
         where wp.cancelled_on is null
           and exists (select 1 from tenures t where t.org_id = wp.org_id and t.employee_id = wp.employee_id
                        and t.hire_date <= ${until}
                        and (t.last_working_day is null or t.last_working_day >= ${today}))
         order by wp.org_id, wp.employee_id, wp.expires_on desc
      ) current_pass
      where expires_on <= ${until}
    `);
    return rowsOf<{
      org_id: string;
      pass_id: string;
      employee_id: string;
      name: string;
      pass_type: string;
      expires_on: string;
    }>(result).map(
      (r): WorkPassExpiry => ({
        orgId: r.org_id,
        passId: r.pass_id,
        employeeId: r.employee_id,
        employeeName: r.name,
        passType: passTypeLabel(r.pass_type),
        expiresOn: r.expires_on,
      }),
    );
  },
  async probationsEnding(db, { today, until }) {
    // Probation end on the record in force today; confirmed probations (a non-cancelled
    // `probation_confirmed` event in the same tenure) are left out.
    const result = await db.execute<{ org_id: string; employee_id: string; name: string; ends_on: string }>(sql`
      select er.org_id, er.employee_id, coalesce(e.preferred_name, e.legal_name) as name,
             er.probation_end::text as ends_on
        from employment_records er
        join employees e on e.org_id = er.org_id and e.id = er.employee_id
       where er.probation_end is not null
         and er.probation_end <= ${until}
         and er.effective_from <= ${today}
         and (er.effective_to is null or er.effective_to > ${today})
         and not exists (select 1 from lifecycle_events le
                          where le.org_id = er.org_id and le.employee_id = er.employee_id
                            and le.tenure_id = er.tenure_id and le.type = 'probation_confirmed'
                            and le.cancelled_at is null)
    `);
    return rowsOf<{ org_id: string; employee_id: string; name: string; ends_on: string }>(result).map(
      (r): ProbationEnd => ({ orgId: r.org_id, employeeId: r.employee_id, employeeName: r.name, endsOn: r.ends_on }),
    );
  },
};

const PASS_LABEL: Record<string, string> = {
  EP: "Employment Pass",
  S_PASS: "S Pass",
  WP: "Work Permit",
  WORK_PERMIT: "Work Permit",
  PEP: "Personalised Employment Pass",
  ONE_PASS: "ONE Pass",
  LTVP: "LTVP",
  DP: "Dependant's Pass",
};

function passTypeLabel(code: string): string {
  return PASS_LABEL[code] ?? code.replace(/_/g, " ");
}

/** True when the organisation has at least one employee record (so people-based sources are "set up"). */
export async function hasEmployees(db: Db, orgId: string): Promise<boolean> {
  const [row] = await db.select({ n: count() }).from(employees).where(eq(employees.orgId, orgId));
  return Number(row?.n ?? 0) > 0;
}

// ---------------------------------------------------------------------------------------------
// Profile change requests as an approval subject
// ---------------------------------------------------------------------------------------------

const changeAttributes = z.object({ typeCode: z.enum(["bank", "personal"]) });

async function memberActor(db: Db, _deps: AppDeps, orgId: string, membershipId: string) {
  const [m] = await db
    .select({ userId: memberships.userId, employeeId: memberships.employeeId, email: users.email })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(and(eq(memberships.orgId, orgId), eq(memberships.id, membershipId)));
  return m ?? null;
}

function memberAudit(orgId: string, membershipId: string, email: string | null): AuditContext {
  return {
    orgId,
    actorType: "member",
    actorMembershipId: membershipId,
    actorLabel: email,
    requestId: null,
    ip: null,
    userAgent: null,
  };
}

/**
 * `profile_change` (people's self-service change requests). The engine decides; on the final
 * decision this applies (or rejects) the change through people's own service, in the same
 * transaction. The engine has already checked who may decide, so the people role check is
 * satisfied with the routed role.
 */
export function profileChangeAdapter(deps: AppDeps): SubjectAdapter<z.output<typeof changeAttributes>> {
  const decide = async (
    db: Db,
    ref: Parameters<SubjectAdapter["onApproved"]>[1],
    decision: Parameters<SubjectAdapter["onApproved"]>[2],
  ) => {
    const [row] = await db
      .select()
      .from(profileChangeRequests)
      .where(and(eq(profileChangeRequests.orgId, ref.orgId), eq(profileChangeRequests.id, ref.subjectId)));
    // Decided outside the engine already (legacy endpoint): nothing left to apply.
    if (row?.status !== "pending") return;
    const m = await memberActor(db, deps, ref.orgId, decision.decidedByMembershipId);
    const txDeps: AppDeps = { ...deps, db };
    const actor = buildActor({
      db,
      orgId: ref.orgId,
      userId: m?.userId ?? null,
      requestId: null,
      roles: [row.routeToRole],
      employeeId: decision.selfApproved ? null : (m?.employeeId ?? null),
      today: singaporeDate(decision.decidedAt),
      auditCtx: memberAudit(ref.orgId, decision.decidedByMembershipId, m?.email ?? null),
    });
    await decideChangeRequest(txDeps, peoplePorts(deps), actor, ref.subjectId, {
      decision: decision.outcome === "approved" ? "approve" : "reject",
      note: decision.comment,
    });
  };
  return {
    type: "profile_change",
    label: "Profile change",
    inlineDecision: true,
    attributes: changeAttributes,
    async summary(db, ref) {
      const [row] = await db
        .select()
        .from(profileChangeRequests)
        .where(and(eq(profileChangeRequests.orgId, ref.orgId), eq(profileChangeRequests.id, ref.subjectId)));
      const title = ref.attributes.typeCode === "bank" ? "Bank account change" : "Personal details change";
      const display = (row?.fields.display ?? {}) as Record<string, string | null>;
      return {
        title,
        lines: (row?.fieldNames ?? []).map((f) => ({ label: FIELD_LABEL[f] ?? f, value: display[f] ?? "(cleared)" })),
        context: row ? [{ label: "Applies from", value: "the day it is approved" }] : [],
      };
    },
    onApproved: decide,
    onRejected: decide,
    async onWithdrawn(db, ref) {
      await db
        .update(profileChangeRequests)
        .set({ status: "cancelled" })
        .where(
          and(
            eq(profileChangeRequests.orgId, ref.orgId),
            eq(profileChangeRequests.id, ref.subjectId),
            eq(profileChangeRequests.status, "pending"),
          ),
        );
    },
    link: () => "/me/profile",
  };
}

const FIELD_LABEL: Record<string, string> = {
  legalName: "Legal name",
  idType: "ID type",
  idNumber: "NRIC/FIN",
  dob: "Date of birth",
  residencyStatus: "Residency",
  prStartDate: "PR since",
  race: "Race",
  raceSecondary: "Race (second)",
  religion: "Religion",
  bankCode: "Bank",
  accountNumber: "Account number",
  holderName: "Account holder",
};

/**
 * The people module's `ApprovalsPort`, backed by the engine. `submit` runs in the caller's
 * transaction when one is passed; `cancel` withdraws the open request.
 */
export function workflowsApprovalsPort(deps: AppDeps): ApprovalsPort {
  return {
    async submit(input: ApprovalSubmission, tx?: Db) {
      if (!input.requesterUserId) return { approvalRequestId: null };
      const run = async (db: Db) => {
        const [m] = await db
          .select({ id: memberships.id, employeeId: memberships.employeeId, email: users.email })
          .from(memberships)
          .innerJoin(users, eq(users.id, memberships.userId))
          .where(and(eq(memberships.orgId, input.orgId), eq(memberships.userId, input.requesterUserId as string)));
        if (!m) return { approvalRequestId: null };
        const r = await submitApproval(db, deps, memberAudit(input.orgId, m.id, m.email), {
          orgId: input.orgId,
          subjectType: input.subjectType,
          subjectId: input.subjectId,
          requesterMembershipId: m.id,
          requesterEmployeeId: m.employeeId,
          attributes: { typeCode: input.routeToRole === "payroll_admin" ? "bank" : "personal" },
        });
        return { approvalRequestId: r.requestId };
      };
      return tx ? run(tx) : deps.db.transaction(run);
    },
    async cancel(orgId, approvalRequestId) {
      if (!/^[0-9a-f-]{36}$/i.test(approvalRequestId)) return;
      await deps.db.transaction(async (tx) => {
        const request = await lockRequest(tx, orgId, approvalRequestId);
        if (request?.status !== "pending") return;
        const audit = memberAudit(orgId, request.requesterMembershipId, null);
        await withdrawLocked({ db: tx, deps, audit, now: deps.clock.now() }, request);
      });
    },
  };
}

/**
 * A subject decided outside the engine (people's legacy decision endpoint): close the open request
 * so no approval task lingers, recording who decided. No module callback runs (it already applied).
 */
export async function closeDecidedElsewhere(
  db: Db,
  deps: AppDeps,
  audit: AuditContext,
  input: { orgId: string; subjectType: string; subjectId: string; outcome: "approved" | "rejected" },
): Promise<boolean> {
  const [open] = await db
    .select({ id: approvalRequests.id })
    .from(approvalRequests)
    .where(
      and(
        eq(approvalRequests.orgId, input.orgId),
        eq(approvalRequests.subjectType, input.subjectType),
        eq(approvalRequests.subjectId, input.subjectId),
        eq(approvalRequests.status, "pending"),
      ),
    );
  if (!open) return false;
  const request = await lockRequest(db, input.orgId, open.id);
  if (request?.status !== "pending") return false;
  const now = deps.clock.now();
  await db
    .update(approvalRequests)
    .set({ status: input.outcome, decidedAt: now })
    .where(eq(approvalRequests.id, request.id));
  await db.execute(
    sql`update approval_tasks set status = 'superseded', superseded_reason = 'decided_elsewhere' where request_id = ${request.id} and status = 'pending'`,
  );
  await db.execute(
    sql`update approval_steps set status = ${input.outcome}, decided_at = ${now.toISOString()}::timestamptz where request_id = ${request.id} and status = 'active'`,
  );
  const adapter = workflowRegistry(deps).subjects.get(request.subjectType);
  const noun = subjectNoun(adapter, request.subjectType);
  const link = adapter?.link?.(refOf(request)) ?? `/inbox?request=${request.id}`;
  await notify(db, deps, {
    orgId: request.orgId,
    recipients: [request.requesterMembershipId],
    kind: input.outcome === "approved" ? "request_approved" : "request_rejected",
    title: input.outcome === "approved" ? `Your ${noun} was approved` : `Your ${noun} was not approved`,
    body: request.title,
    link,
    subjectType: request.subjectType,
    subjectId: request.subjectId,
    email: {
      headline: input.outcome === "approved" ? `Your ${noun} was approved.` : `Your ${noun} was not approved.`,
      linkPath: link,
      actionLabel: "View request",
    },
  });
  await recordAudit(db, deps, audit, {
    action: "approval.decided_elsewhere",
    targetType: "approval_request",
    targetId: request.id,
    meta: { outcome: input.outcome, subjectType: request.subjectType },
  });
  return true;
}

// ---------------------------------------------------------------------------------------------
// Home items: checklists and organisation setup
// ---------------------------------------------------------------------------------------------

export function checklistInboxSource(deps: AppDeps): InboxSource {
  return {
    id: "checklists",
    label: "Onboarding and offboarding",
    status: async () => "ready",
    async list(db, ctx) {
      const actor = buildActor({
        db,
        orgId: ctx.orgId,
        userId: null,
        requestId: null,
        roles: ctx.roles,
        employeeId: ctx.employeeId,
        today: ctx.today,
      });
      const items = await checklistInbox({ ...deps, db }, actor);
      return items.map(
        (i): InboxItem => ({
          id: `checklist:${i.itemId}`,
          source: "checklists",
          kind: i.kind === "onboarding" ? "onboarding" : "offboarding",
          title: i.title,
          concerns: null,
          detail: i.kind === "onboarding" ? "Onboarding checklist" : "Offboarding checklist",
          dueOn: i.dueOn,
          createdAt: ctx.now.toISOString(),
          href: `/people/${i.employeeId}`,
          actionLabel: "Open checklist",
          task: null,
        }),
      );
    },
  };
}

/** "Finish setting up" steps for owners and hr_admins until the organisation is set up. */
export const setupInboxSource: InboxSource = {
  id: "setup",
  label: "Finish setting up",
  status: async () => "ready",
  async list(db, ctx) {
    if (!ctx.roles.includes("owner") && !ctx.roles.includes("hr_admin")) return [];
    const checklist = await setupChecklist(db, ctx.orgId);
    if (checklist.complete) return [];
    return checklist.steps
      .filter((s) => !s.done)
      .map(
        (s): InboxItem => ({
          id: `setup:${s.id}`,
          source: "setup",
          kind: "setup",
          title: s.title,
          concerns: null,
          detail: SETUP_DETAIL[s.id] ?? null,
          dueOn: null,
          // Keeps the steps in order (items without a due date sort by age).
          createdAt: new Date(Date.UTC(2000, 0, 1 + checklist.steps.indexOf(s))).toISOString(),
          href: s.href,
          actionLabel: "Set up",
          task: null,
        }),
      );
  },
};

const SETUP_DETAIL: Record<string, string> = {
  company_profile: "UEN, address and CPF submission number",
  department: "At least one department",
  work_schedule: "A default work week",
  employee: "Add or import your first employee",
};

/** The former-membership transition (people's `runFormerTransitions`) as a sweep step. */
export function formerTransition(deps: AppDeps) {
  return {
    id: "membership_former",
    run: (_db: Db, input: { now: Date }) => runFormerTransitions(deps, peoplePorts(deps).memberships, input.now),
  };
}

/** Workflows contributions of the people module. */
export function peopleWorkflowPlugin(deps: AppDeps): WorkflowPlugin {
  return {
    name: "people",
    subjects: [profileChangeAdapter(deps)],
    inbox: [checklistInboxSource(deps), setupInboxSource],
    transitions: [formerTransition(deps)],
  };
}
