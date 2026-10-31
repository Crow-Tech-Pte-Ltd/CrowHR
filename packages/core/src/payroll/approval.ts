import { and, eq } from "drizzle-orm";
import type { AuditContext } from "../audit/audit.ts";
import { payrollRuns } from "../db/schema/payroll.ts";
import type { Db } from "../db/types.ts";
import type { AppDeps } from "../deps.ts";
import { dateLabel, monthLabel, sgd } from "./engine/dates.ts";
import type { ApprovalDecision } from "./ports.ts";
import { applyDecision, loadRun } from "./service.ts";

/**
 * The `payroll_run` subject adapter for the workflows engine (add-approvals-and-notifications
 * design §1, `SubjectAdapter<T>`). The engine calls `onApproved` / `onRejected` / `onWithdrawn`
 * inside the transaction that records the final decision, so the run's state can never disagree
 * with the decision; a throwing callback rolls the decision back.
 *
 * NOT WIRED: WS3 registers this adapter and implements `PayrollApprovals` (ports.ts). Until then
 * the local port and `POST /payroll/runs/:id/decision` call `applyDecision` directly.
 */
export interface PayrollSubjectContext {
  deps: AppDeps;
  orgId: string;
  /** Audit context of the decider (the engine builds it from the deciding member). */
  audit: AuditContext;
}

export const payrollRunSubject = {
  type: "payroll_run" as const,

  async attributes(tx: Db, ctx: PayrollSubjectContext, runId: string) {
    const run = await loadRun(tx, ctx.orgId, runId);
    return { amountCents: run.totals?.netPayableCents ?? 0, typeCode: run.kind };
  },

  async summary(tx: Db, ctx: PayrollSubjectContext, runId: string) {
    const run = await loadRun(tx, ctx.orgId, runId);
    const t = run.totals;
    return {
      title: `${monthLabel(run.month)} ${run.kind === "regular" ? "payroll" : run.kind === "adjustment" ? "payroll adjustment" : "off-cycle run"}`,
      lines: [
        `${t?.headcount ?? 0} employees, net pay ${sgd(t?.netPayableCents ?? 0)}`,
        `Employer CPF ${sgd(t?.cpfEmployerCents ?? 0)}, SDL ${sgd(t?.sdlChargedCents ?? 0)}`,
        `Pay date ${dateLabel(run.payDate)}`,
      ],
      context: [`/payroll/runs/${run.id}`],
    };
  },

  async onApproved(tx: Db, ctx: PayrollSubjectContext, runId: string, decision: ApprovalDecision) {
    await applyDecision(tx, ctx.deps, ctx.audit, ctx.orgId, runId, { ...decision, outcome: "approved" });
  },

  async onRejected(tx: Db, ctx: PayrollSubjectContext, runId: string, decision: ApprovalDecision) {
    await applyDecision(tx, ctx.deps, ctx.audit, ctx.orgId, runId, { ...decision, outcome: "rejected" });
  },

  async onWithdrawn(tx: Db, ctx: PayrollSubjectContext, runId: string) {
    await tx
      .update(payrollRuns)
      .set({ status: "draft", approvalRequestId: null, updatedAt: ctx.deps.clock.now() })
      .where(and(eq(payrollRuns.orgId, ctx.orgId), eq(payrollRuns.id, runId), eq(payrollRuns.status, "in_review")));
  },

  /** Approvers see the run summary; the full run needs `payroll:read`. */
  async canRead(_tx: Db, _ctx: PayrollSubjectContext, _runId: string) {
    return true;
  },
};
