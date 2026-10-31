import { and, eq } from "drizzle-orm";
import { systemAuditContext } from "../audit/audit.ts";
import { payrollRuns } from "../db/schema/payroll.ts";
import { approvalTasks } from "../db/schema/workflows.ts";
import type { AppDeps } from "../deps.ts";
import { AppError } from "../errors.ts";
import {
  addItem,
  computeRun,
  createRun,
  markPaid,
  type PayrollActor,
  releaseRun,
  submitRun,
  updateSettings,
} from "../payroll/service.ts";
import { decideTask } from "../workflows/engine.ts";
import type { SeededPeople } from "./seed-people.ts";

/**
 * Fictional payroll history for the seeded café group (seed-people.ts), through the real payroll
 * services: September 2026 approved, paid and released; October 2026 computed as a draft with the
 * month's items (overtime, a bonus, no-pay leave, a deduction, part-timer hours). Used by the
 * payroll dev server (e2e, screenshots) and available to the demo.
 */
export interface PayrollSeedActors {
  /** Prepares and submits (payroll_admin). */
  preparer: { userId: string; membershipId: string };
  /** Approves (owner). */
  approver: { userId: string; membershipId: string };
}

export async function seedPayroll(deps: AppDeps, orgId: string, people: SeededPeople, who: PayrollSeedActors) {
  const actor = (a: { userId: string; membershipId: string }, isOwner: boolean): PayrollActor => ({
    orgId,
    userId: a.userId,
    membershipId: a.membershipId,
    employeeId: null,
    isOwner,
    audit: { ...systemAuditContext(orgId, "system", "seed"), actorType: "member", actorMembershipId: a.membershipId },
  });
  const prep = actor(who.preparer, false);
  const boss = actor(who.approver, true);
  const e = people.employees;
  await updateSettings(deps, prep, {
    payDay: 28,
    fwlSector: "SERVICES",
    fwlTier: "TIER_1",
    fwlSkill: "BASIC_SKILLED",
    debitBankBic: "DBSSSGSG",
    debitAccountNumber: "0720123456",
    debitAccountName: "Kopi Kaki Pte. Ltd.",
  });

  const sep = await createRun(deps, prep, { kind: "regular", month: "2026-09" });
  if (e.pt1)
    await addItem(deps, prep, sep.id, { employeeId: e.pt1, kind: "hours", label: "Hours worked", minutes: 84 * 60 });
  if (e.tp_lead)
    await addItem(deps, prep, sep.id, { employeeId: e.tp_lead, kind: "overtime", label: "Overtime", minutes: 4 * 60 });
  await computeRun(deps, prep, sep.id);
  await submitRun(deps, prep, sep.id);
  await approveThroughEngine(deps, orgId, sep.id, boss);
  await releaseRun(deps, prep, sep.id);
  await markPaid(deps, prep, sep.id);

  const oct = await createRun(deps, prep, { kind: "regular", month: "2026-10" });
  const add = (employeeId: string | undefined, item: Omit<Parameters<typeof addItem>[3], "employeeId">) =>
    employeeId ? addItem(deps, prep, oct.id, { ...item, employeeId }) : Promise.resolve("");
  await add(e.pt1, { kind: "hours", label: "Hours worked", minutes: 92 * 60 });
  await add(e.tp_lead, { kind: "overtime", label: "Overtime", minutes: 6 * 60 + 30 });
  await add(e.jp_lead, { kind: "overtime", label: "Overtime", minutes: 3 * 60 });
  await add(e.chef, {
    kind: "bonus",
    label: "Deepavali bonus",
    amountCents: 120_000,
    wageClass: "AW",
    awPayableDate: "2026-10-28",
  });
  await add(e.opsmgr, {
    kind: "commission",
    label: "Catering commission (Q3)",
    amountCents: 250_000,
    wageClass: "AW",
    awPayableDate: "2026-10-28",
  });
  await add(e.barista2, { kind: "unpaid_leave", label: "No-pay leave", days: 2 });
  await add(e.barista1, {
    kind: "deduction",
    label: "Broken grinder burr (after inquiry)",
    amountCents: 60_000,
    deductionCategory: "damage_loss",
  });
  await computeRun(deps, prep, oct.id);
  return { september: sep.id, october: oct.id };
}

/** Approves a submitted run as `approver` through the workflows engine (the approver's open task). */
export async function approveThroughEngine(deps: AppDeps, orgId: string, runId: string, approver: PayrollActor) {
  const [run] = await deps.db
    .select({ requestId: payrollRuns.approvalRequestId })
    .from(payrollRuns)
    .where(and(eq(payrollRuns.orgId, orgId), eq(payrollRuns.id, runId)));
  if (!run?.requestId) throw new AppError("conflict", "The run has no approval request.");
  const [task] = await deps.db
    .select({ id: approvalTasks.id })
    .from(approvalTasks)
    .where(
      and(
        eq(approvalTasks.orgId, orgId),
        eq(approvalTasks.requestId, run.requestId),
        eq(approvalTasks.assigneeMembershipId, approver.membershipId),
        eq(approvalTasks.status, "pending"),
      ),
    );
  if (!task) throw new AppError("not_found", "No open approval task for that member.");
  await decideTask(
    deps,
    { orgId, membershipId: approver.membershipId, roles: ["owner"], audit: approver.audit },
    { taskId: task.id, decision: "approve" },
  );
}
