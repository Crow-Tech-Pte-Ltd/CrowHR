import { and, eq, inArray, isNull, or } from "drizzle-orm";
import { z } from "zod";
import type { AuditContext } from "../audit/audit.ts";
import { membershipRoles, memberships } from "../db/schema/access.ts";
import { payrollRuns, payrollSettings } from "../db/schema/payroll.ts";
import { users } from "../db/schema/users.ts";
import type { Db } from "../db/types.ts";
import type { AppDeps } from "../deps.ts";
import { selfEarningsEditors } from "../workflows/payroll-eligibility.ts";
import type {
  DueReminder,
  FinalDecision,
  InboxItem,
  InboxSource,
  ReminderSource,
  SubjectAdapter,
  SubjectRef,
  WorkflowPlugin,
} from "../workflows/types.ts";
import { dateLabel, monthBounds, monthLabel, sgd } from "./engine/dates.ts";
import { applyDecision, defaultPayDate, loadRun } from "./service.ts";

/**
 * Payroll's workflows plugin (add-approvals-and-notifications): the `payroll_run` subject adapter,
 * the payroll-cutoff reminder (WS3 task 4.3) and the open-runs inbox source. Registered in
 * `CORE_WORKFLOW_PLUGINS` (workflows/registry.ts). The engine calls `onApproved` / `onRejected` /
 * `onWithdrawn` inside the transaction that records the decision, so a run's state can never
 * disagree with its approval request.
 */

const attributes = z.object({
  amountCents: z.number().int().optional(),
  typeCode: z.enum(["regular", "off_cycle", "adjustment"]).optional(),
});

async function deciderAudit(
  db: Db,
  orgId: string,
  membershipId: string,
): Promise<{ audit: AuditContext; userId: string }> {
  const [m] = await db
    .select({ userId: memberships.userId, email: users.email })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(and(eq(memberships.orgId, orgId), eq(memberships.id, membershipId)));
  return {
    userId: m?.userId ?? membershipId,
    audit: {
      orgId,
      actorType: "member",
      actorMembershipId: membershipId,
      actorLabel: m?.email ?? null,
      requestId: null,
      ip: null,
      userAgent: null,
    },
  };
}

export function payrollRunAdapter(deps: AppDeps): SubjectAdapter<z.output<typeof attributes>> {
  const decide = async (db: Db, ref: SubjectRef, decision: FinalDecision) => {
    const who = await deciderAudit(db, ref.orgId, decision.decidedByMembershipId);
    await applyDecision(db, deps, who.audit, ref.orgId, ref.subjectId, {
      outcome: decision.outcome,
      decidedByUserId: who.userId,
      decidedByMembershipId: decision.decidedByMembershipId,
      decidedAt: decision.decidedAt,
      comment: decision.comment,
      selfApproved: decision.selfApproved,
    });
  };
  return {
    type: "payroll_run",
    label: "Payroll run",
    attributes,
    ownerOnlyPolicy: true,
    async canDecide(db, decider, ref) {
      return (
        decider.roles.includes("owner") &&
        !(await selfEarningsEditors(db, ref.orgId, ref.subjectId)).some((m) => m.membershipId === decider.membershipId)
      );
    },
    async summary(db, ref) {
      const run = await loadRun(db, ref.orgId, ref.subjectId);
      const t = run.totals;
      const selfEditors = await selfEarningsEditors(db, ref.orgId, ref.subjectId);
      const kind =
        run.kind === "regular" ? "payroll" : run.kind === "adjustment" ? "payroll adjustment" : "off-cycle run";
      return {
        title: `${monthLabel(run.month)} ${kind}`,
        lines: [
          { label: "People", value: String(t?.headcount ?? 0) },
          { label: "Net pay", value: sgd(t?.netPayableCents ?? 0) },
          { label: "Employer CPF", value: sgd(t?.cpfEmployerCents ?? 0) },
          { label: "SDL", value: sgd(t?.sdlChargedCents ?? 0) },
          { label: "Pay date", value: dateLabel(run.payDate) },
        ],
        context: [
          ...selfEditors.map((m) => ({ label: "Entered own earnings — excluded from approval", value: m.name })),
          { label: "Blocking issues", value: String(t?.blocking ?? 0) },
          { label: "Warnings", value: String(t?.warnings ?? 0) },
        ],
      };
    },
    onApproved: decide,
    onRejected: decide,
    async onWithdrawn(db, ref) {
      await db
        .update(payrollRuns)
        .set({ status: "draft", approvalRequestId: null, updatedAt: deps.clock.now() })
        .where(
          and(eq(payrollRuns.orgId, ref.orgId), eq(payrollRuns.id, ref.subjectId), eq(payrollRuns.status, "in_review")),
        );
    },
    /** Owners and payroll admins read runs; the engine adds task holders itself. */
    async canRead(_db, viewer) {
      return viewer.roles.includes("owner") || viewer.roles.includes("payroll_admin");
    },
    link: (ref) => `/payroll/runs/${ref.subjectId}`,
  };
}

async function activePayrollAdmins(db: Db, orgId: string): Promise<string[]> {
  const rows = await db
    .selectDistinct({ id: membershipRoles.membershipId })
    .from(membershipRoles)
    .innerJoin(memberships, eq(memberships.id, membershipRoles.membershipId))
    .where(
      and(
        eq(membershipRoles.orgId, orgId),
        eq(membershipRoles.role, "payroll_admin"),
        eq(memberships.status, "active"),
      ),
    );
  return rows.map((r) => r.id).sort();
}

function shiftDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** The cutoff for a month: `cutoffDay` in payroll settings, else the default pay date. */
export function cutoffFor(month: string, s: { cutoffDay: number | null; payDay: number | null }): string {
  return defaultPayDate(month, s.cutoffDay ?? s.payDay);
}

/**
 * Payroll cutoff (WS3 task 4.3): 3 days before the month's cutoff, to payroll admins, while that
 * month's regular run is not yet approved. One reminder per org and month (de-duplicated by the sweep).
 */
export function payrollCutoffReminder(): ReminderSource {
  return {
    id: "payroll_cutoff",
    async due(db, { today }) {
      const month = today.slice(0, 7);
      const settings = await db.select().from(payrollSettings);
      const out: DueReminder[] = [];
      for (const s of settings) {
        const cutoffOn = cutoffFor(month, s);
        if (today < shiftDays(cutoffOn, -3) || today > cutoffOn) continue;
        const [done] = await db
          .select({ id: payrollRuns.id })
          .from(payrollRuns)
          .where(
            and(
              eq(payrollRuns.orgId, s.orgId),
              eq(payrollRuns.month, month),
              eq(payrollRuns.kind, "regular"),
              inArray(payrollRuns.status, ["approved", "paid"]),
            ),
          );
        if (done) continue;
        const recipients = await activePayrollAdmins(db, s.orgId);
        if (!recipients.length) continue;
        out.push({
          orgId: s.orgId,
          subjectKey: month,
          threshold: "d3",
          dueOn: cutoffOn,
          recipients,
          kind: "payroll_cutoff",
          title: `${monthLabel(month)} payroll cutoff is on ${dateLabel(cutoffOn)}`,
          link: "/payroll",
          concerns: null,
        });
      }
      return out;
    },
  };
}

/** Home items for owners and payroll admins: open runs, and this month's run when it is not started. */
export function payrollInbox(): InboxSource {
  return {
    id: "payroll",
    label: "Payroll",
    async status(db, ctx) {
      if (!ctx.roles.includes("owner") && !ctx.roles.includes("payroll_admin")) return "ready";
      const [any] = await db
        .select({ id: payrollRuns.id })
        .from(payrollRuns)
        .where(eq(payrollRuns.orgId, ctx.orgId))
        .limit(1);
      const [s] = await db.select().from(payrollSettings).where(eq(payrollSettings.orgId, ctx.orgId));
      return any || s ? "ready" : "not_set_up";
    },
    async list(db, ctx) {
      if (!ctx.roles.includes("owner") && !ctx.roles.includes("payroll_admin")) return [];
      const month = ctx.today.slice(0, 7);
      const runs = await db
        .select()
        .from(payrollRuns)
        .where(
          and(
            eq(payrollRuns.orgId, ctx.orgId),
            or(
              inArray(payrollRuns.status, ["draft", "in_review"]),
              and(eq(payrollRuns.status, "approved"), isNull(payrollRuns.releasedAt)),
            ),
          ),
        );
      const [s] = await db.select().from(payrollSettings).where(eq(payrollSettings.orgId, ctx.orgId));
      const items: InboxItem[] = runs
        .filter((r) => r.status !== "in_review" || ctx.roles.includes("payroll_admin"))
        .map((r) => ({
          id: `payroll:${r.id}`,
          source: "payroll",
          kind: "payroll_due",
          title: `${monthLabel(r.month)} ${r.kind === "regular" ? "payroll" : r.kind === "adjustment" ? "adjustment" : "off-cycle run"}: ${
            r.status === "draft"
              ? "prepare and submit"
              : r.status === "in_review"
                ? "waiting for approval"
                : "release payslips"
          }`,
          concerns: null,
          detail: r.totals
            ? `${r.totals.headcount} people${r.totals.blocking ? `, ${r.totals.blocking} blocking` : ""}`
            : "Not computed yet",
          dueOn: r.payDate,
          createdAt: r.createdAt.toISOString(),
          href: `/payroll/runs/${r.id}`,
          actionLabel: r.status === "approved" ? "Release" : "Open run",
          task: null,
        }));
      const hasRegular = await db
        .select({ id: payrollRuns.id })
        .from(payrollRuns)
        .where(and(eq(payrollRuns.orgId, ctx.orgId), eq(payrollRuns.month, month), eq(payrollRuns.kind, "regular")));
      if (s && hasRegular.length === 0) {
        items.push({
          id: `payroll:due:${month}`,
          source: "payroll",
          kind: "payroll_due",
          title: `${monthLabel(month)} payroll not started`,
          concerns: null,
          detail: `Period ${dateLabel(monthBounds(month).start)} – ${dateLabel(monthBounds(month).end)}`,
          dueOn: cutoffFor(month, s),
          createdAt: s.updatedAt.toISOString(),
          href: "/payroll",
          actionLabel: "Start run",
          task: null,
        });
      }
      return items;
    },
  };
}

export function payrollWorkflowPlugin(deps: AppDeps): WorkflowPlugin {
  return {
    name: "payroll",
    subjects: [payrollRunAdapter(deps)],
    reminders: [payrollCutoffReminder()],
    inbox: [payrollInbox()],
  };
}
