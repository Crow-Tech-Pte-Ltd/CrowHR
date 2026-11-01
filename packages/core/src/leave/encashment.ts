import { dailyRate, hourlyBasicRate, roundHalfUpToCent } from "@crowhr/sg-rules";
import { and, asc, eq, lte } from "drizzle-orm";
import { z } from "zod";
import type { Grant } from "../access/authorize.ts";
import { orgScope } from "../access/org-scope.ts";
import { singaporeDate } from "../access/scope.ts";
import { recordAudit } from "../audit/audit.ts";
import { compensationRecords } from "../db/schema/employees.ts";
import { type LeaveEncashment, type LeaveType, leaveEncashments, leaveLedger } from "../db/schema/leave.ts";
import { payrollFeedReservations, payrollRuns } from "../db/schema/payroll.ts";
import type { Db } from "../db/types.ts";
import type { AppDeps } from "../deps.ts";
import { findAsAt } from "../employees/effective.ts";
import { AppError } from "../errors.ts";
import type { EncashmentSource } from "../payroll/ports.ts";
import { submitApproval, withdrawSubject } from "../workflows/engine.ts";
import type { SubjectAdapter } from "../workflows/types.ts";
import { computeBalance } from "./balances.ts";
import { latestTenureBy, loadEmployeeTime, scheduleOn, workingDaysPerWeekOn } from "./calendar.ts";
import { ensureLeaveSetup } from "./defaults.ts";
import { getType, type LeaveActor, lockEmployeeLeave } from "./service.ts";

export const encashmentInput = z.object({
  employeeId: z.uuid().optional(),
  leaveTypeId: z.uuid(),
  days: z
    .number()
    .positive()
    .max(365)
    .refine((n) => Number.isInteger(n * 2), "Use whole or half days (or hours for an hourly balance)."),
  ledgerEntryId: z.uuid().optional(),
  workingDaysPerWeek: z
    .number()
    .min(0.5)
    .max(7)
    .refine((n) => Number.isInteger(n * 2), "Use whole or half days per week.")
    .optional(),
});
export const encashmentView = z.object({
  id: z.uuid(),
  employeeId: z.uuid(),
  leaveTypeId: z.uuid(),
  leaveYear: z.number(),
  unit: z.enum(["days", "hours"]),
  quantity: z.number(),
  amountCents: z.number().int(),
  rateText: z.string(),
  rateDate: z.string(),
  status: z.enum(["pending", "approved", "rejected", "withdrawn", "reserved", "paid"]),
  approvalRequestId: z.uuid().nullable(),
  payrollRunId: z.uuid().nullable(),
});
export const encashmentCandidateView = z.object({
  ledgerEntryId: z.uuid(),
  leaveTypeId: z.uuid(),
  leaveYear: z.number(),
  unit: z.enum(["days", "hours"]),
  quantity: z.number(),
});
const admin = (actor: LeaveActor) => actor.roles.some((r) => ["owner", "hr_admin", "payroll_admin"].includes(r));

/** Money is visible only to the beneficiary and HR/payroll, never to a team manager. */
export async function encashmentEmployee(db: Db, actor: LeaveActor, grant: Grant, target?: string) {
  const id = target ?? actor.employeeId;
  if (!id) throw new AppError("validation_failed", "Choose an employee linked to this organisation.");
  await loadEmployeeTime(db, actor.orgId, id); // tenant check even for an all-scope grant
  if (id !== actor.employeeId && !admin(actor))
    throw new AppError("not_found", "That employee's encashments aren't available to you.");
  // Payroll admins have compensation access but no leave:create grant; HTTP creation remains HR/owner/employee.
  await grant.assertEmployee(id);
  return id;
}

export async function listEncashments(db: Db, orgId: string, employeeId: string) {
  const org = orgScope(db, orgId);
  const rows = await db
    .select()
    .from(leaveEncashments)
    .where(org.where(leaveEncashments, eq(leaveEncashments.employeeId, employeeId)))
    .orderBy(asc(leaveEncashments.createdAt));
  const reservations = await db
    .select({ sourceId: payrollFeedReservations.sourceId, runId: payrollRuns.id, status: payrollRuns.status })
    .from(payrollFeedReservations)
    .innerJoin(
      payrollRuns,
      and(eq(payrollRuns.orgId, payrollFeedReservations.orgId), eq(payrollRuns.id, payrollFeedReservations.runId)),
    )
    .where(org.where(payrollFeedReservations, eq(payrollFeedReservations.employeeId, employeeId)));
  const ledger = await db
    .select()
    .from(leaveLedger)
    .where(org.where(leaveLedger, eq(leaveLedger.employeeId, employeeId), eq(leaveLedger.kind, "encashment")));
  return {
    items: rows.map((r) => {
      const reserved = reservations.find((x) => x.sourceId === `encashment:${r.id}`);
      return {
        id: r.id,
        employeeId,
        leaveTypeId: r.leaveTypeId,
        leaveYear: r.leaveYear,
        unit: r.unit,
        quantity: r.hundredths / 100,
        amountCents: r.amountCents,
        rateText: r.rateText,
        rateDate: r.rateDate,
        approvalRequestId: r.approvalRequestId,
        status: reserved ? (reserved.status === "paid" ? ("paid" as const) : ("reserved" as const)) : r.status,
        payrollRunId: reserved?.runId ?? null,
      };
    }),
    candidates: ledger
      .filter((l) => !rows.some((r) => r.ledgerEntryId === l.id) && l.hundredths < 0 && l.sourceRef?.startsWith("ye:"))
      .map((l) => ({
        ledgerEntryId: l.id,
        leaveTypeId: l.leaveTypeId,
        leaveYear: l.leaveYear,
        unit: l.unit,
        quantity: -l.hundredths / 100,
      })),
  };
}

async function checkBalance(
  db: Db,
  orgId: string,
  employeeId: string,
  type: LeaveType,
  year: number,
  date: string,
  hundredths: number,
  excludeEncashmentId?: string,
) {
  const t = await loadEmployeeTime(db, orgId, employeeId);
  const balance = await computeBalance(db, t, type, { year, asOf: date, excludeEncashmentId });
  if (!balance.eligible || balance.available === null || balance.available < hundredths) {
    throw new AppError(
      "insufficient_balance",
      "There isn't enough available leave. Reduce the quantity or ask HR to correct the balance first.",
    );
  }
  return { t, balance };
}

/** Snapshot the requested basic-salary basis. Exact rational multiplication; round once, half up to cents. */
async function price(
  db: Db,
  orgId: string,
  employeeId: string,
  date: string,
  unit: "days" | "hours",
  hundredths: number,
  requestedWorkdays?: number,
) {
  const org = orgScope(db, orgId);
  const comps = await db
    .select()
    .from(compensationRecords)
    .where(org.where(compensationRecords, eq(compensationRecords.employeeId, employeeId)));
  const comp = findAsAt(comps, date);
  if (!comp)
    throw new AppError(
      "validation_failed",
      "Record basic pay effective on the rate date before requesting encashment.",
    );
  const t = await loadEmployeeTime(db, orgId, employeeId);
  const sched = scheduleOn(t, date);
  if (!sched)
    throw new AppError(
      "validation_failed",
      "Record a work schedule effective on the rate date before requesting encashment.",
    );
  const shift = sched.schedule.kind !== "fixed";
  if (shift && unit === "days" && !requestedWorkdays)
    throw new AppError(
      "validation_failed",
      "Enter the contractual average workdays per week for this shift worker; the approver must verify the rate basis.",
    );
  const daysPerWeek = shift ? (requestedWorkdays ?? 5) : workingDaysPerWeekOn(t, date);
  const weeklyMinutes = sched.version.weeklyMinutes;
  const rate =
    comp.payBasis === "monthly"
      ? unit === "days"
        ? dailyRate({ monthlyCents: comp.amountCents, workingDaysPerWeek: daysPerWeek, kind: "basic" })
        : hourlyBasicRate({ date, monthlyBasicCents: comp.amountCents, weeklyHours: weeklyMinutes / 60 })
      : {
          exact:
            unit === "hours"
              ? { n: BigInt(comp.amountCents), d: 1n }
              : { n: BigInt(comp.amountCents) * BigInt(weeklyMinutes) * 2n, d: 60n * BigInt(daysPerWeek * 2) },
          text:
            unit === "hours"
              ? `Hourly basic rate = S$${(comp.amountCents / 100).toFixed(2)}`
              : `Daily basic rate = S$${(comp.amountCents / 100).toFixed(2)} hourly basic × ${weeklyMinutes / 60} weekly hours / ${daysPerWeek} days`,
        };
  const amountCents = roundHalfUpToCent({ n: rate.exact.n * BigInt(hundredths), d: rate.exact.d * 100n });
  if (!Number.isSafeInteger(amountCents) || amountCents <= 0)
    throw new AppError(
      "validation_failed",
      "Encashment must produce a positive amount within the supported money range.",
    );
  return {
    amountCents,
    rateText: `${rate.text}${shift && unit === "days" ? ` (contractual average ${daysPerWeek} workdays/week supplied for approval)` : ""}; basic salary effective ${date}, × ${hundredths / 100} ${unit}; rounded once half up to cents = S$${(amountCents / 100).toFixed(2)}.`,
  };
}

export async function requestEncashment(
  deps: AppDeps,
  actor: LeaveActor,
  grant: Grant,
  input: z.output<typeof encashmentInput>,
) {
  await ensureLeaveSetup(deps, actor.orgId);
  const employeeId = await encashmentEmployee(deps.db, actor, grant, input.employeeId);
  const id = deps.ids.newId();
  await deps.db.transaction(async (tx) => {
    const org = orgScope(tx, actor.orgId);
    await lockEmployeeLeave(tx, actor.orgId, employeeId);
    const type = await getType(tx, actor.orgId, input.leaveTypeId);
    if (!type.policy.encashable || type.archivedAt || !type.paid || type.policy.entitlement.basis === "unlimited")
      throw new AppError("forbidden", "This leave policy doesn't allow encashment. Ask HR to review the policy.");
    const hrRequest = actor.roles.some((r) => r === "owner" || r === "hr_admin");
    if (!hrRequest && !type.policy.employeeEncashmentRequests)
      throw new AppError("forbidden", "This policy allows HR to request encashment. Ask HR to submit it for you.");
    const today = singaporeDate(deps.clock.now());
    let year = Number(today.slice(0, 4));
    const t = await loadEmployeeTime(tx, actor.orgId, employeeId);
    const tenure = latestTenureBy(t, today);
    const rateDate = tenure?.lastWorkingDay && tenure.lastWorkingDay < today ? tenure.lastWorkingDay : today;
    let unit: "days" | "hours";
    const hundredths = input.days * 100;
    if (input.ledgerEntryId) {
      if (!hrRequest) throw new AppError("forbidden", "Ask HR to submit year-end encashment.");
      const entry = await org.getById(leaveLedger, input.ledgerEntryId, "year-end encashment");
      if (
        entry.employeeId !== employeeId ||
        entry.leaveTypeId !== type.id ||
        entry.kind !== "encashment" ||
        !entry.sourceRef?.startsWith("ye:")
      )
        throw new AppError("not_found", "Choose this employee's year-end encashment entry.");
      const [existing] = await tx
        .select()
        .from(leaveEncashments)
        .where(org.where(leaveEncashments, eq(leaveEncashments.ledgerEntryId, entry.id)));
      if (existing) throw new AppError("conflict", "This year-end entry already has an encashment request.");
      if (-entry.hundredths !== hundredths)
        throw new AppError("validation_failed", "Request the full quantity recorded in the year-end entry.");
      year = entry.leaveYear;
      unit = entry.unit;
    } else {
      const { balance } = await checkBalance(tx, actor.orgId, employeeId, type, year, rateDate, hundredths);
      unit = balance.unit;
      if (unit === "days" && !type.halfDays && input.days % 1)
        throw new AppError("validation_failed", "This policy only allows whole days.");
    }
    const priced = await price(tx, actor.orgId, employeeId, rateDate, unit, hundredths, input.workingDaysPerWeek);
    await tx.insert(leaveEncashments).values({
      id,
      orgId: actor.orgId,
      employeeId,
      leaveTypeId: type.id,
      leaveYear: year,
      unit,
      hundredths,
      ledgerEntryId: input.ledgerEntryId ?? null,
      ...priced,
      rateDate,
      status: "pending",
      requestedByMembershipId: actor.membershipId,
    });
    const approval = await submitApproval(tx, deps, actor.audit, {
      orgId: actor.orgId,
      subjectType: "leave_encashment",
      subjectId: id,
      requesterMembershipId: actor.membershipId,
      requesterEmployeeId: employeeId,
      attributes: { amountCents: priced.amountCents },
    });
    await tx
      .update(leaveEncashments)
      .set({ approvalRequestId: approval.requestId })
      .where(org.whereId(leaveEncashments, id));
    await recordAudit(tx, deps, actor.audit, {
      action: "leave.encashment_requested",
      targetType: "employee",
      targetId: employeeId,
      meta: { encashmentId: id, quantity: input.days, unit },
      diff: { amountCents: { changed: true } },
    });
  });
  const result = await listEncashments(deps.db, actor.orgId, employeeId);
  const created = result.items.find((r) => r.id === id);
  if (!created) throw new AppError("not_found", "The encashment request no longer exists.");
  return created;
}

async function load(db: Db, orgId: string, id: string): Promise<LeaveEncashment> {
  return orgScope(db, orgId).getById(leaveEncashments, id, "leave encashment");
}

export async function withdrawEncashment(deps: AppDeps, actor: LeaveActor, grant: Grant, id: string) {
  await deps.db.transaction(async (tx) => {
    const r = await load(tx, actor.orgId, id);
    await encashmentEmployee(tx, actor, grant, r.employeeId);
    if (r.status !== "pending")
      throw new AppError(
        "conflict",
        "Only pending encashment can be withdrawn. Ask payroll to correct approved payouts.",
      );
    const withdrawn = await withdrawSubject(tx, deps, actor.audit, {
      orgId: actor.orgId,
      subjectType: "leave_encashment",
      subjectId: id,
    });
    if (!withdrawn)
      throw new AppError(
        "conflict",
        "This encashment has already been decided. Refresh its status before making another change.",
      );
  });
}

export function leaveEncashmentAdapter(deps: AppDeps): SubjectAdapter<{ amountCents: number }> {
  async function finish(db: Db, orgId: string, id: string, status: "approved" | "rejected" | "withdrawn", at: Date) {
    const r = await load(db, orgId, id);
    if (r.status !== "pending")
      throw new AppError("conflict", "This encashment has already been decided. Refresh the request.");
    await lockEmployeeLeave(db, orgId, r.employeeId);
    const org = orgScope(db, orgId);
    if (status === "approved" && !r.ledgerEntryId) {
      const type = await getType(db, orgId, r.leaveTypeId);
      if (!type.policy.encashable || type.archivedAt)
        throw new AppError("forbidden", "Encashment is no longer enabled. Reject the request or correct the policy.");
      await checkBalance(db, orgId, r.employeeId, type, r.leaveYear, r.rateDate, r.hundredths, r.id);
      await db.insert(leaveLedger).values({
        id: deps.ids.newId(),
        orgId,
        employeeId: r.employeeId,
        leaveTypeId: r.leaveTypeId,
        leaveYear: r.leaveYear,
        unit: r.unit,
        hundredths: -r.hundredths,
        kind: "encashment",
        sourceRef: `encashment:${r.id}`,
      });
    } else if (status !== "approved" && r.ledgerEntryId) {
      await db.insert(leaveLedger).values({
        id: deps.ids.newId(),
        orgId,
        employeeId: r.employeeId,
        leaveTypeId: r.leaveTypeId,
        leaveYear: r.leaveYear,
        unit: r.unit,
        hundredths: r.hundredths,
        kind: "encashment",
        sourceRef: `encashment-restore:${r.id}`,
        reason: `Year-end payout ${status}`,
      });
    }
    await db
      .update(leaveEncashments)
      .set({ status, decidedAt: at, updatedAt: at })
      .where(org.whereId(leaveEncashments, id));
    // The workflows engine records the actor/decision audit in this same transaction.
  }
  return {
    type: "leave_encashment",
    label: "Leave encashment",
    inlineDecision: true,
    attributes: z.object({ amountCents: z.int().positive() }),
    defaultSteps: [{ approverRule: "role:hr_admin", escalateAfterDays: 3 }],
    canDecide: async (_db, member, ref) =>
      member.employeeId !== ref.requesterEmployeeId &&
      member.roles.some((r) => ["owner", "hr_admin", "payroll_admin"].includes(r)),
    async summary(db, ref) {
      const r = await load(db, ref.orgId, ref.subjectId);
      return {
        title: "Leave encashment",
        lines: [
          { label: "Quantity", value: `${r.hundredths / 100} ${r.unit} (${r.leaveYear})` },
          { label: "Amount", value: `S$${(r.amountCents / 100).toFixed(2)}; CPF Additional Wages` },
          { label: "Rate", value: r.rateText },
        ],
        context: [],
      };
    },
    onApproved: (db, ref, d) => finish(db, ref.orgId, ref.subjectId, "approved", d.decidedAt),
    onRejected: (db, ref, d) => finish(db, ref.orgId, ref.subjectId, "rejected", d.decidedAt),
    onWithdrawn: (db, ref) => finish(db, ref.orgId, ref.subjectId, "withdrawn", deps.clock.now()),
    link: () => "/leave",
  };
}

/**
 * CPF payable on unused leave, including final pay; this is earned leave, not termination compensation.
 * https://www.cpf.gov.sg/service/article/are-cpf-contributions-payable-on-encashment-of-leave
 * Accumulated leave is AW because it is not wholly for the payment month's employment:
 * https://www.cpf.gov.sg/employer/employer-obligations/what-constitutes-wages-for-cpf-contributions
 * Post-cessation AW still requires SC/SPR at cessation AND payable date (effective 1 Jan 2024):
 * https://www.cpf.gov.sg/service/article/are-cpf-contributions-payable-on-additional-wages-payable-to-ex-employees-after-they-have-left-employment
 */
export function leaveEncashmentSource(deps: AppDeps): EncashmentSource {
  return {
    async listApproved(orgId, periodEnd) {
      return deps.db
        .select()
        .from(leaveEncashments)
        .where(
          orgScope(deps.db, orgId).where(
            leaveEncashments,
            eq(leaveEncashments.status, "approved"),
            lte(leaveEncashments.decidedAt, new Date(`${periodEnd}T15:59:59.999Z`)),
          ),
        )
        .orderBy(asc(leaveEncashments.id));
    },
  };
}
