import {
  Button,
  Card,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  FormField,
  Input,
  Skeleton,
  StatusPill,
  Textarea,
  textStyle,
  toast,
} from "@crowhr/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { ChevronLeft, ChevronRight } from "lucide-react";
import * as React from "react";
import {
  attKeys,
  type Claim,
  type DayRecord,
  duration,
  sheetQuery,
  statusQuery,
  type Totals,
  timesheetsQuery,
} from "../../../attendance/api.ts";
import { AttendanceNav } from "../../../attendance/attendance-nav.tsx";
import { DayTable, dm } from "../../../attendance/day-table.tsx";
import { LockedMark, PeriodNav, TimesheetStatusCard } from "../../../attendance/timesheet-approval.tsx";
import { useMe } from "../../../auth/session.ts";
import { PageHeader } from "../../../components/page-header.tsx";
import { ErrorNote } from "../../../components/section.tsx";
import { addDays, dateRange, mondayOf, todaySg } from "../../../leave/format.ts";
import { ApiError, apiPost } from "../../../lib/api.ts";

const ISO = /^\d{4}-\d{2}-\d{2}$/;

export const Route = createFileRoute("/_app/attendance/timesheet")({
  validateSearch: (s: Record<string, unknown>): { week?: string; period?: string } => ({
    ...(typeof s.week === "string" && ISO.test(s.week) ? { week: s.week } : {}),
    ...(typeof s.period === "string" && ISO.test(s.period) ? { period: s.period } : {}),
  }),
  component: TimesheetRoute,
});

/** With timesheet approval on, My timesheet shows a period and its approval; otherwise a week. */
function TimesheetRoute() {
  const me = useMe();
  const status = useQuery({ ...statusQuery, refetchInterval: false });
  if (status.isPending) {
    return (
      <>
        <PageHeader title="Attendance" />
        <AttendanceNav current="timesheet" />
        <Skeleton className="h-64 w-full" />
      </>
    );
  }
  // Without an employee record the weekly page explains there is nothing to show.
  return status.data?.timesheets.approval && me.employeeId ? <MyPeriodPage /> : <MyTimesheetPage />;
}

function MyPeriodPage() {
  const me = useMe();
  const search = Route.useSearch();
  const navigate = useNavigate({ from: "/attendance/timesheet" });
  const today = todaySg();
  const overview = useQuery(timesheetsQuery(search.period ?? today, me.employeeId ?? undefined));
  const period = overview.data?.period;
  const q = useQuery({
    ...sheetQuery(period?.start ?? today, period?.end ?? today),
    enabled: !!period,
  });
  const [claiming, setClaiming] = React.useState<DayRecord | null>(null);
  const row = overview.data?.items[0];
  const t = q.data?.totals;
  return (
    <>
      <PageHeader
        title="Attendance"
        description="Your timesheet for the period: check the days, claim overtime, then submit it for approval."
      />
      <AttendanceNav current="timesheet" />
      {overview.isError ? (
        <ErrorNote error={overview.error} retry={() => void overview.refetch()} />
      ) : !overview.data || !period ? (
        <Skeleton className="h-64 w-full" />
      ) : (
        <>
          <PeriodNav
            period={period}
            previous={overview.data.previous}
            next={overview.data.next}
            current={period.start <= today && today <= period.end}
            onGo={(start) => void navigate({ search: start ? { period: start } : {} })}
          />
          {row ? (
            <TimesheetStatusCard
              row={row}
              over={overview.data.over}
              submittableFrom={overview.data.submittableFrom}
              mine
              submittedBy={overview.data.settings.submittedBy}
              periodStart={period.start}
            />
          ) : null}
          <Card>
            {q.isError ? (
              <ErrorNote error={q.error} retry={() => void q.refetch()} />
            ) : q.isPending ? (
              <div className="flex flex-col gap-2 p-4">
                <Skeleton className="h-6 w-full" />
                <Skeleton className="h-6 w-full" />
                <Skeleton className="h-6 w-2/3" />
              </div>
            ) : (
              <>
                <DayTable
                  label={`My timesheet ${period.label}`}
                  days={q.data.days}
                  today={today}
                  action={(d) => <DayAction day={d} today={today} onClaim={setClaiming} />}
                />
                {t ? <TotalsRow totals={t} /> : null}
              </>
            )}
          </Card>
        </>
      )}
      {claiming ? <ClaimDialog day={claiming} onClose={() => setClaiming(null)} /> : null}
    </>
  );
}

function DayAction({ day, today, onClaim }: { day: DayRecord; today: string; onClaim: (d: DayRecord) => void }) {
  if (day.otClaim) {
    return (
      <StatusPill tone={CLAIM_TONE[day.otClaim.status]}>
        {CLAIM_LABEL[day.otClaim.status]} {duration(day.otClaim.approvedMinutes ?? day.otClaim.claimedMinutes)}
      </StatusPill>
    );
  }
  if (day.locked) return <LockedMark />;
  if (day.otMinutes > 0 && day.date <= today) {
    return (
      <Button size="sm" onClick={() => onClaim(day)} data-testid="claim-ot">
        Claim OT
      </Button>
    );
  }
  return null;
}

function TotalsRow({ totals: t }: { totals: Totals }) {
  return (
    <dl className="grid grid-cols-2 gap-x-6 gap-y-2 border-t border-border px-4 py-3 text-ui sm:grid-cols-4">
      {/* Zero is a dash, as in the table above. */}
      {[
        ["Worked", t.workedMinutes ? duration(t.workedMinutes) : "—"],
        ["Overtime", t.otMinutes ? duration(t.otMinutes) : "—"],
        ["Late", t.lateCount ? `${t.lateCount}× · ${duration(t.lateMinutes)}` : "—"],
        ["Missing punches", t.missingPunches ? String(t.missingPunches) : "—"],
      ].map(([k, v]) => (
        <div key={k} className="flex flex-col gap-0.5">
          <dt className={textStyle.field}>{k}</dt>
          <dd className="num font-semibold">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

const CLAIM_LABEL = {
  pending: "OT claimed",
  approved: "OT approved",
  rejected: "OT not approved",
  withdrawn: "Withdrawn",
};
const CLAIM_TONE = { pending: "warning", approved: "success", rejected: "danger", withdrawn: "neutral" } as const;

function MyTimesheetPage() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: "/attendance/timesheet" });
  const today = todaySg();
  const from = search.week ?? mondayOf(today);
  const to = addDays(from, 6);
  const q = useQuery(sheetQuery(from, to));
  const [claiming, setClaiming] = React.useState<DayRecord | null>(null);
  const t = q.data?.totals;
  return (
    <>
      <PageHeader
        title="Attendance"
        description="Your week: hours, lateness and overtime. Claim overtime for a day here."
      />
      <AttendanceNav current="timesheet" />
      <div className="mb-4 flex items-center gap-2">
        <Button
          size="icon-sm"
          aria-label="Previous week"
          onClick={() => void navigate({ search: { week: addDays(from, -7) } })}
        >
          <ChevronLeft />
        </Button>
        <Button
          size="icon-sm"
          aria-label="Next week"
          onClick={() => void navigate({ search: { week: addDays(from, 7) } })}
        >
          <ChevronRight />
        </Button>
        <Button size="sm" variant="ghost" onClick={() => void navigate({ search: {} })}>
          This week
        </Button>
        <span className="num ml-1 text-ui font-medium">{dateRange(from, to)}</span>
      </div>
      <Card>
        {q.isError ? (
          <ErrorNote error={q.error} retry={() => void q.refetch()} />
        ) : q.isPending ? (
          <div className="flex flex-col gap-2 p-4">
            <Skeleton className="h-6 w-full" />
            <Skeleton className="h-6 w-full" />
            <Skeleton className="h-6 w-2/3" />
          </div>
        ) : (
          <>
            <DayTable
              label="My timesheet"
              days={q.data.days}
              today={today}
              action={(d) => <DayAction day={d} today={today} onClaim={setClaiming} />}
            />
            {t ? <TotalsRow totals={t} /> : null}
          </>
        )}
      </Card>
      {claiming ? <ClaimDialog day={claiming} onClose={() => setClaiming(null)} /> : null}
    </>
  );
}

function ClaimDialog({ day, onClose }: { day: DayRecord; onClose: () => void }) {
  const qc = useQueryClient();
  const [minutes, setMinutes] = React.useState(String(day.otMinutes));
  const [reason, setReason] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const claim = useMutation({
    mutationFn: () =>
      apiPost<{ claim: Claim; warnings: string[] }>("/api/v1/attendance/overtime", {
        date: day.date,
        minutes: Number(minutes),
        reason: reason.trim() || null,
      }),
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: attKeys.all });
      for (const w of r.warnings) toast.warning(w);
      toast.success(
        `Overtime claimed: ${duration(r.claim.claimedMinutes)}${r.claim.statutory ? "" : " (contractual: not covered by Part 4)"}. Your manager has been told.`,
      );
      onClose();
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "That didn't send. Try again."),
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Claim overtime for {dm(day.date)}</DialogTitle>
          <DialogDescription>
            You worked {duration(day.workedMinutes)} against {duration(day.scheduledMinutes)} scheduled:{" "}
            <span className="num font-semibold">{duration(day.otMinutes)}</span> of overtime by the clock.
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            claim.mutate();
          }}
        >
          <FormField label="Minutes" hint={`Up to ${day.otMinutes} minutes for this day.`} error={error ?? undefined}>
            <Input
              className="num w-28"
              inputMode="numeric"
              value={minutes}
              onChange={(e) => setMinutes(e.target.value.replace(/\D/g, ""))}
            />
          </FormField>
          <FormField label="What was it for?" hint="Optional. Your approver sees it.">
            <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} />
          </FormField>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={!Number(minutes) || claim.isPending}>
              Send for approval
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
