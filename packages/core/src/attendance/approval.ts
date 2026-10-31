import { z } from "zod";
import type { AppDeps } from "../deps.ts";
import { displayDate } from "../employees/dates.ts";
import type { SubjectAdapter, WorkflowPlugin } from "../workflows/types.ts";
import { loadClaim, MONTHLY_OT_LIMIT_MINUTES, minutesText, monthMinutes, setClaimStatus } from "./overtime.ts";

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

/** Attendance's workflows contributions (registered in `CORE_WORKFLOW_PLUGINS`). */
export function attendanceWorkflowPlugin(deps: AppDeps): WorkflowPlugin {
  return { name: "attendance", subjects: [overtimeAdapter(deps)] };
}
