import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  FormField,
  Input,
  StatusPill,
  Textarea,
  toast,
} from "@crowhr/ui";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import * as React from "react";
import { useT } from "../i18n/index.ts";
import { ApiError, apiPost } from "../lib/api.ts";
import { inboxQuery, myRequestsQuery } from "../workflows/api.ts";
import { attKeys, type Claim, type DayRecord, duration } from "./api.ts";
import { dm } from "./day-table.tsx";
import { LockedMark } from "./timesheet-approval.tsx";

const CLAIM_LABEL = {
  pending: "OT claimed",
  approved: "OT approved",
  rejected: "OT not approved",
  withdrawn: "Withdrawn",
};
const CLAIM_TONE = { pending: "warning", approved: "success", rejected: "danger", withdrawn: "neutral" } as const;

export function OvertimeAction({
  day,
  today,
  onClaim,
  employeeName,
  showLock = true,
}: {
  day: DayRecord;
  today: string;
  onClaim?: (d: DayRecord) => void;
  employeeName?: string;
  showLock?: boolean;
}) {
  const tWorkflow = useT("workflows");
  const claim = day.otClaim;
  const mayRefile = claim?.status === "withdrawn" || claim?.status === "rejected";
  const mayClaim = onClaim && (!claim || mayRefile) && !day.locked && day.otMinutes > 0 && day.date <= today;
  if (!claim && !mayClaim) return day.locked && showLock ? <LockedMark /> : null;
  const label = tWorkflow(mayRefile ? "Refile OT" : "Claim OT");
  return (
    <span className="inline-flex flex-wrap items-center justify-end gap-1">
      {claim ? (
        <StatusPill tone={CLAIM_TONE[claim.status]}>
          {tWorkflow(CLAIM_LABEL[claim.status])} {duration(claim.approvedMinutes ?? claim.claimedMinutes)}
        </StatusPill>
      ) : null}
      {mayClaim ? (
        <Button
          size="sm"
          onClick={() => onClaim(day)}
          data-testid="claim-ot"
          aria-label={
            employeeName
              ? tWorkflow("{arg1} for {arg2}", { arg1: label, arg2: employeeName })
              : tWorkflow("{arg1} for {arg2}", { arg1: label, arg2: dm(day.date) })
          }
        >
          {label}
        </Button>
      ) : null}
    </span>
  );
}

export function ClaimDialog({
  day,
  employee,
  onClose,
}: {
  day: DayRecord;
  employee?: { id: string; name: string };
  onClose: () => void;
}) {
  const tWorkflow = useT("workflows");
  const qc = useQueryClient();
  const [minutes, setMinutes] = React.useState(String(day.otMinutes));
  const [reason, setReason] = React.useState("");
  const validMinutes = Number.isInteger(Number(minutes)) && Number(minutes) > 0 && Number(minutes) <= day.otMinutes;
  const claim = useMutation({
    mutationFn: () =>
      apiPost<{ claim: Claim; warnings: string[] }>("/api/v1/attendance/overtime", {
        employeeId: employee?.id,
        date: day.date,
        minutes: Number(minutes),
        reason: reason.trim() || null,
      }),
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: attKeys.all });
      void qc.invalidateQueries({ queryKey: inboxQuery.queryKey });
      void qc.invalidateQueries({ queryKey: myRequestsQuery.queryKey });
      for (const w of r.warnings) toast.warning(w);
      const details = `${duration(r.claim.claimedMinutes)}${r.claim.statutory ? "" : " (contractual)"}`;
      toast.success(
        employee
          ? tWorkflow("{arg1} claimed for {arg2}.", { arg1: details, arg2: employee.name })
          : tWorkflow("{arg1} of overtime sent for approval.", { arg1: details }),
      );
      onClose();
    },
    onError: (err) => {
      if (err instanceof ApiError && (err.code === "timesheet_locked" || err.code === "conflict")) {
        void qc.invalidateQueries({ queryKey: attKeys.all });
      }
    },
  });
  const errors = claim.error instanceof ApiError ? claim.error.fieldErrors : {};
  return (
    <Dialog open onOpenChange={(o) => !o && !claim.isPending && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{tWorkflow("Claim overtime for {date}", { date: dm(day.date) })}</DialogTitle>
          <DialogDescription>
            {employee
              ? tWorkflow("{name} worked {worked} against {scheduled} scheduled.", {
                  name: employee.name,
                  worked: duration(day.workedMinutes),
                  scheduled: duration(day.scheduledMinutes),
                })
              : tWorkflow("You worked {worked} against {scheduled} scheduled.", {
                  worked: duration(day.workedMinutes),
                  scheduled: duration(day.scheduledMinutes),
                })}{" "}
            {tWorkflow("The timesheet shows {overtime} of overtime.", { overtime: duration(day.otMinutes) })}
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!claim.isPending && validMinutes) claim.mutate();
          }}
        >
          <FormField
            label={tWorkflow("Minutes")}
            hint={tWorkflow("Up to {arg1} minutes for this day.", { arg1: day.otMinutes })}
            error={errors.minutes}
            required
          >
            <Input
              className="num w-28"
              type="number"
              min={1}
              max={day.otMinutes}
              value={minutes}
              onChange={(e) => setMinutes(e.target.value)}
            />
          </FormField>
          <FormField
            label={tWorkflow("What was it for?")}
            hint={tWorkflow("Optional. The approver sees it.")}
            error={errors.reason}
          >
            <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} />
          </FormField>
          {claim.error && !errors.minutes && !errors.reason ? (
            <p className="text-ui text-danger-300" role="alert">
              {claim.error.message}
            </p>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose} disabled={claim.isPending}>
              {tWorkflow("Cancel")}
            </Button>
            <Button type="submit" variant="primary" disabled={!validMinutes || claim.isPending}>
              {tWorkflow("Send for approval")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
