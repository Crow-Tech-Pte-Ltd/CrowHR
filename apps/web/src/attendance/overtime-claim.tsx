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
  const claim = day.otClaim;
  const mayRefile = claim?.status === "withdrawn" || claim?.status === "rejected";
  const mayClaim = onClaim && (!claim || mayRefile) && !day.locked && day.otMinutes > 0 && day.date <= today;
  if (!claim && !mayClaim) return day.locked && showLock ? <LockedMark /> : null;
  const label = mayRefile ? "Refile OT" : "Claim OT";
  return (
    <span className="inline-flex flex-wrap items-center justify-end gap-1">
      {claim ? (
        <StatusPill tone={CLAIM_TONE[claim.status]}>
          {CLAIM_LABEL[claim.status]} {duration(claim.approvedMinutes ?? claim.claimedMinutes)}
        </StatusPill>
      ) : null}
      {mayClaim ? (
        <Button
          size="sm"
          onClick={() => onClaim(day)}
          data-testid="claim-ot"
          aria-label={employeeName ? `${label} for ${employeeName}` : `${label} for ${dm(day.date)}`}
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
        employee ? `${details} claimed for ${employee.name}.` : `${details} of overtime sent for approval.`,
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
          <DialogTitle>Claim overtime for {dm(day.date)}</DialogTitle>
          <DialogDescription>
            {employee ? `${employee.name} worked` : "You worked"} {duration(day.workedMinutes)} against{" "}
            {duration(day.scheduledMinutes)} scheduled. The timesheet shows{" "}
            <span className="num font-semibold">{duration(day.otMinutes)}</span> of overtime.
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
            label="Minutes"
            hint={`Up to ${day.otMinutes} minutes for this day.`}
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
          <FormField label="What was it for?" hint="Optional. The approver sees it." error={errors.reason}>
            <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} />
          </FormField>
          {claim.error && !errors.minutes && !errors.reason ? (
            <p className="text-ui text-danger-300" role="alert">
              {claim.error.message}
            </p>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose} disabled={claim.isPending}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={!validMinutes || claim.isPending}>
              Send for approval
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
