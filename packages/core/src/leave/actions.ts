import { asc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import type { Grant } from "../access/authorize.ts";
import { orgScope } from "../access/org-scope.ts";
import { singaporeDate } from "../access/scope.ts";
import { recordAudit } from "../audit/audit.ts";
import {
  type LeaveRequest,
  leaveChildren,
  leaveLedger,
  leaveRequestDays,
  leaveRequests,
  leaveTypes,
} from "../db/schema/leave.ts";
import type { Db } from "../db/types.ts";
import type { AppDeps } from "../deps.ts";
import { AppError } from "../errors.ts";
import { submitApproval, withdrawSubject } from "../workflows/engine.ts";
import { memberForEmployee } from "./apply.ts";
import { childrenOf, computeBalance } from "./balances.ts";
import { loadEmployeeTime } from "./calendar.ts";
import { ensureLeaveSetup } from "./defaults.ts";
import { unitFor } from "./entitlement.ts";
import { getType, type LeaveActor, lockEmployeeLeave } from "./service.ts";

export async function loadRequest(db: Db, orgId: string, requestId: string): Promise<LeaveRequest> {
  const row = await orgScope(db, orgId).findById(leaveRequests, requestId);
  if (!row) throw new AppError("not_found", "That leave request doesn't exist or you can't see it.");
  return row;
}

export async function requestDays(db: Db, orgId: string, requestId: string) {
  return db
    .select()
    .from(leaveRequestDays)
    .where(orgScope(db, orgId).where(leaveRequestDays, eq(leaveRequestDays.requestId, requestId)))
    .orderBy(asc(leaveRequestDays.date));
}

export function byYear(days: readonly { leaveYear: number; hundredths: number }[]): [number, number][] {
  const m = new Map<number, number>();
  for (const d of days) m.set(d.leaveYear, (m.get(d.leaveYear) ?? 0) + d.hundredths);
  return [...m].sort((a, b) => a[0] - b[0]);
}

const clampToYear = (date: string, year: number) =>
  date < `${year}-01-01` ? `${year}-01-01` : date > `${year}-12-31` ? `${year}-12-31` : date;

/**
 * Final approval (design decision 5): re-check the balance without counting this request as
 * pending, then charge the days, one `taken` row per leave year, in the decision's transaction.
 */
export async function chargeRequest(db: Db, deps: AppDeps, orgId: string, requestId: string, decidedAt: Date) {
  const request = await loadRequest(db, orgId, requestId);
  if (request.status !== "pending") return;
  await lockEmployeeLeave(db, orgId, request.employeeId);
  const org = orgScope(db, orgId);
  const types = await db.select().from(leaveTypes).where(org.where(leaveTypes));
  const type = types.find((x) => x.id === request.leaveTypeId);
  if (!type) throw new AppError("not_found", "That leave type no longer exists.");
  const t = await loadEmployeeTime(db, orgId, request.employeeId);
  const days = await requestDays(db, orgId, requestId);
  const today = singaporeDate(decidedAt);
  const children = await childrenOf(db, orgId, request.employeeId);
  for (const [year, hundredths] of byYear(days)) {
    const last = days.filter((d) => d.leaveYear === year).at(-1)?.date ?? today;
    const b = await computeBalance(db, t, type, {
      year,
      // biome-ignore lint/complexity/useMathMinMax: ISO date strings compare as text, not numbers.
      asOf: clampToYear(last > today ? last : today, year),
      childId: request.childId,
      children,
      excludeRequestId: requestId,
      types,
    });
    if (b.tracked && b.available !== null && b.available < hundredths) {
      throw new AppError(
        "insufficient_balance",
        `${t.name} no longer has enough ${type.name.toLowerCase()} for ${year} (${Math.max(0, b.available) / 100} ${request.unit} left, ${hundredths / 100} asked). Reject the request, or adjust the balance first.`,
      );
    }
    await db.insert(leaveLedger).values({
      id: deps.ids.newId(),
      orgId,
      employeeId: request.employeeId,
      leaveTypeId: type.id,
      leaveYear: year,
      childId: request.childId,
      kind: "taken",
      unit: request.unit,
      hundredths: -hundredths,
      requestId,
    });
  }
  await db
    .update(leaveRequests)
    .set({ status: "approved", decidedAt, updatedAt: decidedAt })
    .where(org.whereId(leaveRequests, requestId));
}

/** Approved leave cancelled: put the days back (one `restored` row per charged year). */
export async function restoreRequest(
  db: Db,
  deps: AppDeps,
  orgId: string,
  requestId: string,
  at: Date,
  reason: string | null,
) {
  const request = await loadRequest(db, orgId, requestId);
  if (request.status !== "approved" && request.status !== "cancellation_pending") return;
  await lockEmployeeLeave(db, orgId, request.employeeId);
  const org = orgScope(db, orgId);
  const taken = await db
    .select()
    .from(leaveLedger)
    .where(org.where(leaveLedger, eq(leaveLedger.requestId, requestId), eq(leaveLedger.kind, "taken")));
  for (const row of taken) {
    await db.insert(leaveLedger).values({
      id: deps.ids.newId(),
      orgId,
      employeeId: row.employeeId,
      leaveTypeId: row.leaveTypeId,
      leaveYear: row.leaveYear,
      childId: row.childId,
      kind: "restored",
      unit: row.unit,
      hundredths: -row.hundredths,
      requestId,
      reason,
    });
  }
  await db
    .update(leaveRequests)
    .set({ status: "cancelled", cancelledAt: at, updatedAt: at, cancelReason: reason ?? request.cancelReason })
    .where(org.whereId(leaveRequests, requestId));
}

export async function setStatus(
  db: Db,
  orgId: string,
  requestId: string,
  from: LeaveRequest["status"][],
  to: LeaveRequest["status"],
  at: Date,
) {
  await db
    .update(leaveRequests)
    .set({ status: to, updatedAt: at, ...(to === "rejected" || to === "withdrawn" ? { decidedAt: at } : {}) })
    .where(
      orgScope(db, orgId).where(leaveRequests, eq(leaveRequests.id, requestId), inArray(leaveRequests.status, from)),
    );
}

const statusText = (s: LeaveRequest["status"]) => s.replace("_", " ");

/** Pending → withdrawn (the employee's own, or HR on behalf). */
export async function withdrawLeave(deps: AppDeps, actor: LeaveActor, grant: Grant, requestId: string) {
  return deps.db.transaction(async (tx) => {
    const request = await loadRequest(tx, actor.orgId, requestId);
    await grant.assertEmployee(request.employeeId, "leave request");
    if (request.status !== "pending") {
      throw new AppError(
        "conflict",
        `This request is ${statusText(request.status)}, so it can't be withdrawn. Cancel approved leave instead.`,
      );
    }
    const withdrawn = await withdrawSubject(tx, deps, actor.audit, {
      orgId: actor.orgId,
      subjectType: "leave",
      subjectId: requestId,
    });
    if (!withdrawn) await setStatus(tx, actor.orgId, requestId, ["pending"], "withdrawn", deps.clock.now());
    await recordAudit(tx, deps, actor.audit, {
      action: "leave.withdrawn",
      targetType: "leave_request",
      targetId: requestId,
    });
    return loadRequest(tx, actor.orgId, requestId);
  });
}

/**
 * Cancels approved leave. Owners and hr_admins may cancel directly (`direct`); otherwise the
 * cancellation goes for approval as `leave_cancellation` and the leave stays approved until then.
 */
export async function cancelLeave(
  deps: AppDeps,
  actor: LeaveActor,
  grant: Grant,
  requestId: string,
  input: { reason: string | null; direct: boolean },
) {
  const isAdmin = actor.roles.includes("owner") || actor.roles.includes("hr_admin");
  if (input.direct && !isAdmin) {
    throw new AppError(
      "forbidden",
      "Only owners and HR admins can cancel leave without approval. Ask for the cancellation instead.",
    );
  }
  return deps.db.transaction(async (tx) => {
    const request = await loadRequest(tx, actor.orgId, requestId);
    await grant.assertEmployee(request.employeeId, "leave request");
    const now = deps.clock.now();
    if (request.status === "pending") {
      throw new AppError("conflict", "This request isn't approved yet. Withdraw it instead.");
    }
    if (input.direct && actor.employeeId === request.employeeId) {
      throw new AppError(
        "self_change_requires_approval",
        "Ask for your own cancellation; another approver decides it.",
      );
    }
    if (input.direct) {
      if (request.status !== "approved" && request.status !== "cancellation_pending") {
        throw new AppError(
          "conflict",
          `This request is ${statusText(request.status)}; only approved leave can be cancelled.`,
        );
      }
      if (request.status === "cancellation_pending") {
        await withdrawSubject(tx, deps, actor.audit, {
          orgId: actor.orgId,
          subjectType: "leave_cancellation",
          subjectId: requestId,
        });
      }
      await restoreRequest(tx, deps, actor.orgId, requestId, now, input.reason);
      await recordAudit(tx, deps, actor.audit, {
        action: "leave.cancelled",
        targetType: "leave_request",
        targetId: requestId,
        meta: { direct: true, employeeId: request.employeeId, reason: input.reason },
      });
      return loadRequest(tx, actor.orgId, requestId);
    }
    if (request.status !== "approved") {
      throw new AppError(
        "conflict",
        `This request is ${statusText(request.status)}; only approved leave can be cancelled.`,
      );
    }
    const org = orgScope(tx, actor.orgId);
    await tx
      .update(leaveRequests)
      .set({ status: "cancellation_pending", cancelReason: input.reason, updatedAt: now })
      .where(org.whereId(leaveRequests, requestId));
    const requester =
      request.employeeId === actor.employeeId
        ? actor.membershipId
        : ((await memberForEmployee(tx, actor.orgId, request.employeeId)) ?? actor.membershipId);
    const type = await getType(tx, actor.orgId, request.leaveTypeId);
    const approval = await submitApproval(tx, deps, actor.audit, {
      orgId: actor.orgId,
      subjectType: "leave_cancellation",
      subjectId: requestId,
      requesterMembershipId: requester,
      requesterEmployeeId: request.employeeId,
      attributes: { typeCode: type.code },
    });
    await tx
      .update(leaveRequests)
      .set({ cancellationRequestId: approval.requestId })
      .where(org.whereId(leaveRequests, requestId));
    await recordAudit(tx, deps, actor.audit, {
      action: "leave.cancellation_requested",
      targetType: "leave_request",
      targetId: requestId,
      meta: { reason: input.reason },
    });
    return loadRequest(tx, actor.orgId, requestId);
  });
}

export const adjustmentInput = z.object({
  employeeId: z.uuid(),
  leaveTypeId: z.uuid(),
  year: z.int().min(2000).max(2100),
  /** Days (or hours for hour-based balances), non-zero; half days or tenths of an hour. */
  amount: z
    .number()
    .refine((n) => n !== 0 && Math.abs(n) <= 365, "Enter a non-zero amount up to 365.")
    .refine((n) => Math.abs(n * 10 - Math.round(n * 10)) < 1e-9, "Use steps of 0.5 days or 0.1 hours."),
  childId: z.uuid().nullish(),
  reason: z.string().trim().min(3, 'Say why, e.g. "Long service award".').max(300),
});

export async function adjustBalance(
  deps: AppDeps,
  actor: LeaveActor,
  grant: Grant,
  input: z.output<typeof adjustmentInput>,
) {
  await ensureLeaveSetup(deps, actor.orgId);
  await grant.assertEmployee(input.employeeId, "employee");
  if (actor.employeeId && actor.employeeId === input.employeeId) {
    throw new AppError("self_change_requires_approval", "You can't adjust your own leave balance. Ask another admin.");
  }
  return deps.db.transaction(async (tx) => {
    const type = await getType(tx, actor.orgId, input.leaveTypeId);
    const t = await loadEmployeeTime(tx, actor.orgId, input.employeeId);
    const unit = unitFor(t, type, `${input.year}-12-31`);
    if (unit === "days" && !Number.isInteger(Math.round(input.amount * 100) / 50)) {
      throw new AppError("validation_failed", "Adjust days in steps of half a day.", {
        issues: [{ path: "amount", message: "Use steps of 0.5 days." }],
      });
    }
    if (input.childId) {
      const c = await orgScope(tx, actor.orgId).findById(leaveChildren, input.childId);
      if (!c || c.employeeId !== input.employeeId) {
        throw new AppError("not_found", "That child isn't on this employee's record.");
      }
    }
    await lockEmployeeLeave(tx, actor.orgId, input.employeeId);
    const id = deps.ids.newId();
    const hundredths = Math.round(input.amount * 100);
    await tx.insert(leaveLedger).values({
      id,
      orgId: actor.orgId,
      employeeId: input.employeeId,
      leaveTypeId: type.id,
      leaveYear: input.year,
      childId: input.childId ?? null,
      kind: "adjustment",
      unit,
      hundredths,
      reason: input.reason,
      createdByMembershipId: actor.membershipId,
    });
    await recordAudit(tx, deps, actor.audit, {
      action: "leave.balance_adjusted",
      targetType: "employee",
      targetId: input.employeeId,
      meta: { type: type.code, year: input.year, amount: input.amount, unit, reason: input.reason },
    });
    return { id, hundredths, unit };
  });
}
