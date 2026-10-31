import { eq } from "drizzle-orm";
import { z } from "zod";
import { orgScope } from "../access/org-scope.ts";
import { leaveAttachments, leaveChildren, leaveTypes } from "../db/schema/leave.ts";
import type { Db } from "../db/types.ts";
import type { AppDeps } from "../deps.ts";
import { displayDate } from "../employees/dates.ts";
import type { SubjectAdapter, SubjectSummary, WorkflowPlugin } from "../workflows/types.ts";
import { chargeRequest, loadRequest, restoreRequest, setStatus } from "./actions.ts";
import { childrenOf, computeBalance } from "./balances.ts";
import { loadEmployeeTime } from "./calendar.ts";
import { leaveYearEndTransition } from "./year-end.ts";

/**
 * Approvals (design decision 6): `leave` charges the balance on final approval, in the engine's
 * transaction; `leave_cancellation` restores it. A throwing callback refuses the decision and the
 * approver sees the message.
 */

const attributes = z.object({ typeCode: z.string().min(1) });
type Attrs = z.output<typeof attributes>;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** `4–6 Nov 2026`, `30 Dec 2026 – 2 Jan 2027`, `4 Nov 2026 (morning)`. */
export function dateRange(start: string, end: string, startSession = "full", endSession = "full"): string {
  const [ys, ms, ds] = start.split("-").map(Number) as [number, number, number];
  const [ye, me, de] = end.split("-").map(Number) as [number, number, number];
  const half = (s: string) => (s === "am" ? " (morning)" : s === "pm" ? " (afternoon)" : "");
  if (start === end) return `${displayDate(start)}${half(startSession)}`;
  const tail = `${endSession === "am" ? " (morning of the last day)" : ""}${startSession === "pm" ? " from the afternoon" : ""}`;
  if (ys === ye && ms === me) return `${ds}–${de} ${MONTHS[me - 1]} ${ye}${tail}`;
  if (ys === ye) return `${ds} ${MONTHS[ms - 1]} – ${de} ${MONTHS[me - 1]} ${ye}${tail}`;
  return `${displayDate(start)} – ${displayDate(end)}${tail}`;
}

export function quantityText(hundredths: number, unit: "days" | "hours"): string {
  const n = hundredths / 100;
  if (unit === "hours") return `${n} ${n === 1 ? "hour" : "hours"}`;
  return `${n} ${n === 1 ? "day" : "days"}`;
}

async function summaryFor(db: Db, orgId: string, requestId: string, cancellation: boolean): Promise<SubjectSummary> {
  const r = await loadRequest(db, orgId, requestId);
  const org = orgScope(db, orgId);
  const types = await db.select().from(leaveTypes).where(org.where(leaveTypes));
  const type = types.find((x) => x.id === r.leaveTypeId);
  const name = type?.name ?? "Leave";
  const range = dateRange(r.startDate, r.endDate, r.startSession, r.endSession);
  const lines = [
    { label: "Dates", value: range },
    { label: r.unit === "hours" ? "Hours" : "Days", value: quantityText(r.hundredths, r.unit) },
  ];
  if (r.reason) lines.push({ label: "Reason", value: r.reason });
  if (cancellation && r.cancelReason) lines.push({ label: "Why cancel", value: r.cancelReason });
  if (r.childId) {
    const [child] = await db.select().from(leaveChildren).where(org.whereId(leaveChildren, r.childId));
    if (child) lines.push({ label: "Child", value: child.name });
  }
  const files = await db
    .select()
    .from(leaveAttachments)
    .where(org.where(leaveAttachments, eq(leaveAttachments.requestId, r.id)));
  if (files.length) lines.push({ label: "Attachments", value: files.map((f) => f.filename).join(", ") });
  const context: SubjectSummary["context"] = [];
  if (type) {
    try {
      const t = await loadEmployeeTime(db, orgId, r.employeeId);
      const year = Number(r.startDate.slice(0, 4));
      const b = await computeBalance(db, t, type, {
        year,
        asOf: r.startDate,
        childId: r.childId,
        children: await childrenOf(db, orgId, r.employeeId),
        excludeRequestId: r.status === "pending" ? r.id : undefined,
        types,
      });
      if (b.available !== null) {
        const before = b.available;
        const after = cancellation ? before + r.hundredths : r.status === "pending" ? before - r.hundredths : before;
        context.push({
          label: `${name} left ${year}`,
          value: `${quantityText(before, b.unit)} → ${quantityText(after, b.unit)}`,
        });
      }
    } catch {
      // The summary must never block a decision; the charge re-checks the balance.
    }
  }
  return { title: cancellation ? `Cancel ${name.toLowerCase()}, ${range}` : `${name}, ${range}`, lines, context };
}

export function leaveAdapter(deps: AppDeps): SubjectAdapter<Attrs> {
  return {
    type: "leave",
    label: "Leave",
    inlineDecision: true,
    attributes,
    defaultSteps: [{ approverRule: "manager", escalateAfterDays: 3 }],
    summary: (db, ref) => summaryFor(db, ref.orgId, ref.subjectId, false),
    onApproved: (db, ref, decision) => chargeRequest(db, deps, ref.orgId, ref.subjectId, decision.decidedAt),
    onRejected: (db, ref, decision) =>
      setStatus(db, ref.orgId, ref.subjectId, ["pending"], "rejected", decision.decidedAt),
    onWithdrawn: (db, ref) => setStatus(db, ref.orgId, ref.subjectId, ["pending"], "withdrawn", deps.clock.now()),
    link: (ref) => `/leave?request=${ref.subjectId}`,
  };
}

export function leaveCancellationAdapter(deps: AppDeps): SubjectAdapter<Attrs> {
  const back = (db: Db, orgId: string, id: string) =>
    setStatus(db, orgId, id, ["cancellation_pending"], "approved", deps.clock.now());
  return {
    type: "leave_cancellation",
    label: "Leave cancellation",
    inlineDecision: true,
    attributes,
    defaultSteps: [{ approverRule: "manager", escalateAfterDays: 3 }],
    summary: (db, ref) => summaryFor(db, ref.orgId, ref.subjectId, true),
    onApproved: (db, ref, decision) => restoreRequest(db, deps, ref.orgId, ref.subjectId, decision.decidedAt, null),
    onRejected: (db, ref) => back(db, ref.orgId, ref.subjectId),
    onWithdrawn: (db, ref) => back(db, ref.orgId, ref.subjectId),
    link: (ref) => `/leave?request=${ref.subjectId}`,
  };
}

/** The leave module's workflows contributions (registered in `CORE_WORKFLOW_PLUGINS`). */
export function leaveWorkflowPlugin(deps: AppDeps): WorkflowPlugin {
  return {
    name: "leave",
    subjects: [leaveAdapter(deps), leaveCancellationAdapter(deps)],
    transitions: [leaveYearEndTransition(deps)],
  };
}
