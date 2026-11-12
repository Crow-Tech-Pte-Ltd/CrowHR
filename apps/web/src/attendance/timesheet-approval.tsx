import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  FormField,
  formatDate,
  StatusPill,
  Textarea,
  textStyle,
  toast,
} from "@crowhr/ui";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Lock } from "lucide-react";
import * as React from "react";
import { ApiError, apiPost } from "../lib/api.ts";
import { attKeys, type PeriodRef, TIMESHEET_STATUS, type Timesheet, type TimesheetRow } from "./api.ts";

/**
 * Timesheet approval pieces shared by My timesheet and the Timesheets tab
 * (openspec/changes/add-timesheet-approval). Approve and return go through the approvals
 * engine's decision endpoint, like every other approval.
 */

export function TimesheetStatusPill({ status }: { status: TimesheetRow["status"] }) {
  const s = TIMESHEET_STATUS[status];
  return (
    <StatusPill tone={s.tone} data-testid="timesheet-status">
      {s.label}
    </StatusPill>
  );
}

/** Previous | next | back to the current period, and the period's dates. */
export function PeriodNav({
  period,
  previous,
  next,
  current,
  onGo,
}: {
  period: PeriodRef;
  previous: PeriodRef;
  next: PeriodRef;
  /** True when `period` contains today. */
  current: boolean;
  onGo: (start: string | undefined) => void;
}) {
  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      <Button size="icon-sm" aria-label={`Previous period, ${previous.label}`} onClick={() => onGo(previous.start)}>
        <ChevronLeft />
      </Button>
      <Button size="icon-sm" aria-label={`Next period, ${next.label}`} onClick={() => onGo(next.start)}>
        <ChevronRight />
      </Button>
      {!current ? (
        <Button size="sm" variant="ghost" onClick={() => onGo(undefined)}>
          This period
        </Button>
      ) : null}
      <span className="num ml-1 text-ui font-medium" data-testid="period-label">
        {period.label}
      </span>
    </div>
  );
}

/** One line on what happened to the timesheet and what comes next. */
export function statusText(row: TimesheetRow, opts: { over: boolean; submittableFrom: string; mine: boolean }) {
  const t = row.timesheet;
  const from = formatDate(new Date(opts.submittableFrom));
  switch (row.status) {
    case "submitted":
      return `Sent ${formatDate(new Date(t?.submittedAt ?? Date.now()))}${t?.submittedBy && !opts.mine && t.submittedBy !== row.employee.name ? ` by ${t.submittedBy}` : ""}. Waiting for approval; corrections can still be made.`;
    case "approved":
      return `Approved by ${t?.decidedBy ?? "the approver"} on ${formatDate(new Date(t?.decidedAt ?? Date.now()))}. The period is locked: only HR can change it, and that reopens it.`;
    case "returned":
      return `Returned by ${t?.decidedBy ?? "the approver"}${t?.comment ? `: "${t.comment}"` : ""}. Fix it, then submit it again.`;
    case "reopened":
      return `Reopened by ${t?.reopenedBy ?? "HR"}${t?.reopenReason ? `: "${t.reopenReason}"` : ""}. Submit it again once it's right.`;
    case "withdrawn":
      return "Withdrawn. Submit it again when it's ready.";
    default:
      return opts.over
        ? "Not submitted yet. Check the days, then send it for approval."
        : `This period isn't over yet. It can be submitted from ${from}.`;
  }
}

function errorText(err: unknown, fallback: string) {
  return err instanceof ApiError ? err.message : fallback;
}

/** Submit, withdraw, reopen and decide, refreshing attendance, approvals and Home afterwards. */
export function useTimesheetActions() {
  const qc = useQueryClient();
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: attKeys.all });
    void qc.invalidateQueries({ queryKey: ["inbox"] });
    void qc.invalidateQueries({ queryKey: ["approvals"] });
  };
  const submit = useMutation({
    mutationFn: (vars: { date: string; employeeId?: string }) =>
      apiPost<{ timesheet: Timesheet; warnings: string[] }>("/api/v1/attendance/timesheets", vars),
    onSuccess: (r) => {
      refresh();
      for (const w of r.warnings) toast.warning(w);
      toast.success(`Timesheet for ${r.timesheet.periodLabel} sent for approval.`);
    },
    onError: (err) => toast.error(errorText(err, "That didn't send. Try again.")),
  });
  const withdraw = useMutation({
    mutationFn: (id: string) => apiPost<Timesheet>(`/api/v1/attendance/timesheets/${id}/withdraw`, {}),
    onSuccess: () => {
      refresh();
      toast.success("Timesheet withdrawn. Submit it again when it's ready.");
    },
    onError: (err) => toast.error(errorText(err, "That didn't withdraw. Try again.")),
  });
  const reopen = useMutation({
    mutationFn: (vars: { id: string; reason: string }) =>
      apiPost<Timesheet>(`/api/v1/attendance/timesheets/${vars.id}/reopen`, { reason: vars.reason }),
    onSuccess: () => {
      refresh();
      toast.success("Timesheet reopened. The employee has been told to submit it again.");
    },
    onError: (err) => toast.error(errorText(err, "That didn't reopen. Try again.")),
  });
  const decide = useMutation({
    mutationFn: (vars: { taskId: string; decision: "approve" | "reject"; comment?: string }) =>
      apiPost(`/api/v1/approvals/tasks/${vars.taskId}/decision`, {
        decision: vars.decision,
        comment: vars.comment ?? null,
      }),
    onSuccess: (_r, vars) => {
      refresh();
      toast.success(
        vars.decision === "approve"
          ? "Timesheet approved. The period is now locked."
          : "Timesheet returned. The employee has been told what to fix.",
      );
    },
    onError: (err) => toast.error(errorText(err, "Nothing was changed. Try again.")),
  });
  return { submit, withdraw, reopen, decide };
}

/** A reason dialog for returning (the approver's comment) or reopening (HR). */
export function ReasonDialog({
  open,
  onOpenChange,
  title,
  description,
  label,
  placeholder,
  confirm,
  min,
  max,
  pending,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  label: string;
  placeholder: string;
  confirm: string;
  min: number;
  max: number;
  pending?: boolean;
  onConfirm: (text: string) => void;
}) {
  const [text, setText] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  React.useEffect(() => {
    if (open) {
      setText("");
      setError(null);
    }
  }, [open]);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            const v = text.trim();
            if (v.length < min) return setError(`Say why in at least ${min} characters, so they know what to fix.`);
            if (v.length > max) return setError(`Shorten this to ${max} characters or fewer.`);
            onConfirm(v);
          }}
        >
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>
          <FormField label={label} required error={error ?? undefined}>
            <Textarea rows={3} value={text} onChange={(e) => setText(e.target.value)} placeholder={placeholder} />
          </FormField>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={pending}>
              {confirm}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Shown in the action column of a locked day. */
export function LockedMark() {
  return (
    <span className="inline-flex items-center gap-1 text-2xs text-primary-300" title="In an approved timesheet">
      <Lock className="size-3.5" aria-hidden />
      <span>Locked</span>
    </span>
  );
}

/**
 * The status card above a period's days: status, what happens next, and the actions the viewer
 * may take (submit, withdraw, approve, return, reopen).
 */
export function TimesheetStatusCard({
  row,
  over,
  submittableFrom,
  mine,
  submittedBy,
  periodStart,
}: {
  row: TimesheetRow;
  over: boolean;
  submittableFrom: string;
  /** The viewer's own timesheet. */
  mine: boolean;
  submittedBy: "employee" | "manager";
  periodStart: string;
}) {
  const actions = useTimesheetActions();
  const [returning, setReturning] = React.useState(false);
  const [reopening, setReopening] = React.useState(false);
  const t = row.timesheet;
  const label = t?.periodLabel ?? "this period";
  return (
    <div
      className="mb-4 flex flex-col gap-3 rounded-md border border-border bg-surface-50 p-4 sm:flex-row sm:items-center sm:justify-between"
      data-testid="timesheet-status-card"
    >
      <div className="flex min-w-0 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className={textStyle.group}>Timesheet</span>
          <TimesheetStatusPill status={row.status} />
          {row.status === "approved" ? <Lock className="size-3.5 text-primary-300" aria-label="Locked" /> : null}
        </div>
        <p className="text-ui text-primary-300" data-testid="timesheet-status-text">
          {statusText(row, { over, submittableFrom, mine })}
        </p>
        {mine && submittedBy === "manager" && !row.canSubmit && row.status !== "approved" ? (
          <p className="text-2xs text-primary-200">In your organisation, your manager submits your timesheet.</p>
        ) : null}
      </div>
      <div className="flex shrink-0 flex-wrap gap-2">
        {row.taskId ? (
          <>
            <Button
              variant="primary"
              size="sm"
              disabled={actions.decide.isPending}
              onClick={() => actions.decide.mutate({ taskId: row.taskId as string, decision: "approve" })}
            >
              Approve
            </Button>
            <Button size="sm" variant="secondary" onClick={() => setReturning(true)}>
              Return
            </Button>
          </>
        ) : null}
        {row.canSubmit ? (
          <Button
            variant="primary"
            size="sm"
            disabled={actions.submit.isPending}
            onClick={() =>
              actions.submit.mutate({ date: periodStart, ...(mine ? {} : { employeeId: row.employee.id }) })
            }
          >
            {row.status === "not_submitted" ? "Submit for approval" : "Submit again"}
          </Button>
        ) : null}
        {row.canWithdraw && t ? (
          <Button
            size="sm"
            variant="ghost"
            disabled={actions.withdraw.isPending}
            onClick={() => actions.withdraw.mutate(t.id)}
          >
            Withdraw
          </Button>
        ) : null}
        {row.canReopen && t ? (
          <Button size="sm" variant="secondary" onClick={() => setReopening(true)}>
            Reopen
          </Button>
        ) : null}
      </div>
      <ReasonDialog
        open={returning}
        onOpenChange={setReturning}
        title={`Return ${row.employee.name}'s timesheet`}
        description={`For ${label}. They see your comment, fix the days and submit it again.`}
        label="What needs fixing?"
        placeholder="Missing clock-out on 14 Oct"
        confirm="Return timesheet"
        min={1}
        max={500}
        pending={actions.decide.isPending}
        onConfirm={(comment) =>
          actions.decide.mutate(
            { taskId: row.taskId as string, decision: "reject", comment },
            { onSuccess: () => setReturning(false) },
          )
        }
      />
      <ReasonDialog
        open={reopening}
        onOpenChange={setReopening}
        title={`Reopen ${row.employee.name}'s timesheet`}
        description={`For ${label}. The period unlocks, and it must be submitted and approved again. This is audit-logged and ${row.employee.name} is told.`}
        label="Reason"
        placeholder="Missing clock-out on 14 Oct"
        confirm="Reopen timesheet"
        min={3}
        max={300}
        pending={actions.reopen.isPending}
        onConfirm={(reason) =>
          t && actions.reopen.mutate({ id: t.id, reason }, { onSuccess: () => setReopening(false) })
        }
      />
    </div>
  );
}
