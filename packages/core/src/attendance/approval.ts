import { z } from "zod";
import { orgScope } from "../access/org-scope.ts";
import { singaporeDate } from "../access/scope.ts";
import {
  type AttendanceTimesheet,
  attendanceTimesheets,
  type TimesheetTotalsSnapshot,
} from "../db/schema/attendance.ts";
import type { Db } from "../db/types.ts";
import type { AppDeps } from "../deps.ts";
import { displayDate } from "../employees/dates.ts";
import { createReportingScopeResolver } from "../employees/reports/reporting-scope.ts";
import type { InboxSource, SubjectAdapter, WorkflowPlugin } from "../workflows/types.ts";
import { loadClaim, MONTHLY_OT_LIMIT_MINUTES, minutesText, monthMinutes, setClaimStatus } from "./overtime.ts";
import { latestEndedPeriod, periodLabel, submittableFrom } from "./periods.ts";
import { loadAttendanceSettings } from "./settings.ts";
import { timesheets, totalsOf } from "./timesheet.ts";
import { latestTimesheets, loadTimesheet, setDecided, toTimesheetViews, unsubmitted } from "./timesheet-approval.ts";

/**
 * The `overtime` subject (spec "Overtime and claims"): the manager approves; approval records the
 * approved minutes in the decision's transaction. The month's OT against the 72-hour limit is shown
 * as context and never blocks.
 */

const attributes = z.object({ typeCode: z.enum(["statutory", "contractual"]) });
type Attrs = z.output<typeof attributes>;

export function overtimeAdapter(deps: AppDeps): SubjectAdapter<Attrs> {
  return {
    type: "overtime",
    label: "Overtime",
    inlineDecision: true,
    attributes,
    defaultSteps: [{ approverRule: "manager", escalateAfterDays: 3 }],
    async summary(db, ref) {
      const claim = await loadClaim(db, ref.orgId, ref.subjectId);
      const others = await monthMinutes(db, ref.orgId, claim.employeeId, claim.workDate, claim.id);
      const withThis = others + claim.claimedMinutes;
      const month = displayDate(`${claim.workDate.slice(0, 7)}-01`).replace(/^1 /, "");
      const lines = [
        { label: "Date", value: displayDate(claim.workDate) },
        { label: "Claimed", value: minutesText(claim.claimedMinutes) },
        { label: "From timesheet", value: minutesText(claim.computedMinutes) },
        {
          label: "Basis",
          value: claim.statutory ? "Statutory (Employment Act Part 4)" : "Contractual (not covered by Part 4)",
        },
      ];
      if (claim.reason) lines.push({ label: "Reason", value: claim.reason });
      const over = withThis > MONTHLY_OT_LIMIT_MINUTES;
      return {
        title: `Overtime, ${displayDate(claim.workDate)}`,
        lines,
        context: [
          {
            label: `OT in ${month}`,
            value: `${minutesText(withThis)} of 72 h${over ? " (over the 72-hour monthly limit: lawful only with an MOM exemption)" : ""}`,
          },
        ],
      };
    },
    async onApproved(db, ref, decision) {
      const claim = await loadClaim(db, ref.orgId, ref.subjectId);
      await setClaimStatus(db, ref.orgId, ref.subjectId, "approved", decision.decidedAt, claim.claimedMinutes);
    },
    onRejected: (db, ref, decision) => setClaimStatus(db, ref.orgId, ref.subjectId, "rejected", decision.decidedAt),
    onWithdrawn: (db, ref) => setClaimStatus(db, ref.orgId, ref.subjectId, "withdrawn", deps.clock.now()),
    link: () => "/attendance",
  };
}

const sameTotals = (a: TimesheetTotalsSnapshot, b: TimesheetTotalsSnapshot) =>
  (Object.keys(a) as (keyof TimesheetTotalsSnapshot)[]).every((k) => a[k] === b[k]);

const countText = (n: number, minutes: number) => (n ? `${n}× · ${minutesText(minutes)}` : "None");

/**
 * The `timesheet` subject (add-timesheet-approval spec "Timesheet decisions"): the manager
 * approves or returns (rejects with a comment) a submitted period. Approval records the totals as
 * they are at that moment, in the decision's transaction; from then on the period is locked.
 */
export function timesheetAdapter(deps: AppDeps): SubjectAdapter {
  const live = async (db: Db, ts: AttendanceTimesheet) => {
    const sheet = await timesheets(
      db,
      ts.orgId,
      [ts.employeeId],
      ts.periodStart,
      ts.periodEnd,
      singaporeDate(deps.clock.now()),
    );
    const days = sheet.days.get(ts.employeeId) ?? [];
    return { days, totals: totalsOf(days), name: sheet.times.get(ts.employeeId)?.name ?? "Former employee", sheet };
  };
  return {
    type: "timesheet",
    label: "Timesheet",
    defaultSteps: [{ approverRule: "manager", escalateAfterDays: 3 }],
    async summary(db, ref) {
      const ts = await loadTimesheet(db, ref.orgId, ref.subjectId);
      const { days, totals, name, sheet } = await live(db, ts);
      const label = periodLabel({ start: ts.periodStart, end: ts.periodEnd });
      const claims = days.flatMap((d) => (d.otClaim ? [d.otClaim] : []));
      const approved = claims.filter((c) => c.status === "approved");
      const pending = claims.filter((c) => c.status === "pending");
      const sum = (list: typeof claims) => list.reduce((s, c) => s + (c.approvedMinutes ?? c.claimedMinutes), 0);
      const claimText = [
        approved.length ? `${approved.length} approved (${minutesText(sum(approved))})` : null,
        pending.length ? `${pending.length} waiting (${minutesText(sum(pending))})` : null,
      ]
        .filter(Boolean)
        .join(", ");
      const lines = [
        { label: "Employee", value: name },
        { label: "Period", value: label },
        { label: "Days worked", value: String(totals.daysWorked) },
        { label: "Hours worked", value: minutesText(totals.workedMinutes) },
        { label: "Overtime by the clock", value: totals.otMinutes ? minutesText(totals.otMinutes) : "None" },
        { label: "Overtime claims", value: claimText || "None" },
        { label: "Late", value: countText(totals.lateCount, totals.lateMinutes) },
        { label: "Early outs", value: totals.earlyOutCount ? String(totals.earlyOutCount) : "None" },
        { label: "Missing punches", value: totals.missingPunches ? String(totals.missingPunches) : "None" },
        { label: "Leave days", value: totals.leaveDays ? String(totals.leaveDays) : "None" },
      ];
      const context: { label: string; value: string }[] = [];
      const [view] = await toTimesheetViews(db, ref.orgId, [ts]);
      if (ts.submittedByMembershipId !== ref.requesterMembershipId && view?.submittedBy) {
        context.push({ label: "Submitted by", value: view.submittedBy });
      }
      if (ts.status === "submitted" && !sameTotals(totals, ts.submittedTotals)) {
        context.push({
          label: "Changed since it was sent",
          value: `Corrections changed the figures: ${minutesText(ts.submittedTotals.workedMinutes)} worked then, ${minutesText(totals.workedMinutes)} now. The figures above are current.`,
        });
      }
      if (sheet.settings.timesheetApproval && sheet.settings.payrollApprovedTimesheetsOnly) {
        context.push({
          label: "Payroll",
          value: "Uses approved timesheets only: approving releases this period's overtime and days worked to payroll.",
        });
      }
      context.push({
        label: "After approval",
        value: "The period is locked; only HR can change it, which reopens it.",
      });
      return { title: `Timesheet, ${label}`, lines, context };
    },
    async onApproved(db, ref, decision) {
      const ts = await loadTimesheet(db, ref.orgId, ref.subjectId);
      const { totals } = await live(db, ts);
      await setDecided(db, ref.orgId, ref.subjectId, {
        status: "approved",
        at: decision.decidedAt,
        by: decision.decidedByMembershipId,
        comment: decision.comment,
        approvedTotals: totals,
      });
    },
    onRejected: (db, ref, decision) =>
      setDecided(db, ref.orgId, ref.subjectId, {
        status: "returned",
        at: decision.decidedAt,
        by: decision.decidedByMembershipId,
        comment: decision.comment,
      }),
    onWithdrawn: (db, ref) => setDecided(db, ref.orgId, ref.subjectId, { status: "withdrawn", at: deps.clock.now() }),
    async canRead(db, viewer, ref) {
      // payroll_admin reads every timesheet (matrix attendance:read A); managers their team's.
      if (viewer.roles.includes("payroll_admin")) return true;
      if (!viewer.employeeId) return false;
      const ts = await orgScope(db, ref.orgId).findById(attendanceTimesheets, ref.subjectId);
      if (!ts) return false;
      const team = await createReportingScopeResolver(db).teamOf(
        ref.orgId,
        viewer.employeeId,
        singaporeDate(deps.clock.now()),
      );
      return team.has(ts.employeeId);
    },
    link: (ref) => `/attendance/timesheets?timesheet=${ref.subjectId}`,
  };
}

/**
 * Home items for timesheets not yet submitted (spec "Timesheets on Home"): the latest ended
 * period, for the employee (employee mode) or the manager's team (manager mode). No due date.
 */
export function timesheetsInbox(): InboxSource {
  return {
    id: "timesheets",
    label: "Timesheets",
    status: async () => "ready",
    async list(db, ctx) {
      if (ctx.active === false || !ctx.employeeId) return [];
      const settings = await loadAttendanceSettings(db, ctx.orgId);
      if (!settings.timesheetApproval) return [];
      const period = latestEndedPeriod(ctx.now, settings.timesheetPeriod);
      const label = periodLabel(period);
      const createdAt = submittableFrom(period).toISOString();
      if (settings.timesheetSubmitter === "employee") {
        const due = await unsubmitted(db, ctx.orgId, [ctx.employeeId], period);
        if (!due.length) return [];
        const last = (await latestTimesheets(db, ctx.orgId, [ctx.employeeId], period)).get(ctx.employeeId);
        const detail =
          last?.status === "returned"
            ? `Returned${last.comment ? `: ${last.comment}` : ""}. Fix it, then submit it again.`
            : last?.status === "reopened"
              ? `Reopened by HR${last.reopenReason ? `: ${last.reopenReason}` : ""}. Submit it again once it's right.`
              : "Check your days, then send it for approval.";
        return [
          {
            id: `timesheet:${period.start}`,
            source: "timesheets",
            kind: "timesheet_due",
            title: `Submit your timesheet for ${label}`,
            concerns: null,
            detail,
            dueOn: null,
            createdAt,
            href: `/attendance/timesheet?period=${period.start}`,
            actionLabel: "Submit",
            task: null,
          },
        ];
      }
      if (!ctx.isManager) return [];
      const team = await createReportingScopeResolver(db).teamOf(ctx.orgId, ctx.employeeId, ctx.today);
      const due = await unsubmitted(
        db,
        ctx.orgId,
        [...team].filter((id) => id !== ctx.employeeId),
        period,
      );
      if (!due.length) return [];
      return [
        {
          id: `timesheets:${period.start}`,
          source: "timesheets",
          kind: "timesheet_due",
          title: `Submit ${due.length === 1 ? "1 timesheet" : `${due.length} timesheets`} for ${label}`,
          concerns: null,
          detail: "Your team's timesheets go to approval once you submit them.",
          dueOn: null,
          createdAt,
          href: `/attendance/timesheets?date=${period.start}`,
          actionLabel: "Review",
          task: null,
        },
      ];
    },
  };
}

/** Attendance's workflows contributions (registered in `CORE_WORKFLOW_PLUGINS`). */
export function attendanceWorkflowPlugin(deps: AppDeps): WorkflowPlugin {
  return {
    name: "attendance",
    subjects: [overtimeAdapter(deps), timesheetAdapter(deps)],
    inbox: [timesheetsInbox()],
  };
}
