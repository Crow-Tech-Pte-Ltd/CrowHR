import { Button, Card, Skeleton, textStyle } from "@crowhr/ui";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { ChevronLeft, ChevronRight } from "lucide-react";
import * as React from "react";
import {
  type DayRecord,
  duration,
  sheetQuery,
  statusQuery,
  type Totals,
  timesheetsQuery,
} from "../../../attendance/api.ts";
import { AttendanceNav } from "../../../attendance/attendance-nav.tsx";
import { DayTable } from "../../../attendance/day-table.tsx";
import { ClaimDialog, OvertimeAction } from "../../../attendance/overtime-claim.tsx";
import { PeriodNav, TimesheetStatusCard } from "../../../attendance/timesheet-approval.tsx";
import { can, useMe } from "../../../auth/session.ts";
import { PageHeader } from "../../../components/page-header.tsx";
import { ErrorNote } from "../../../components/section.tsx";
import { useLocale, useT } from "../../../i18n/index.ts";
import { addDays, dateRange, mondayOf, todaySg } from "../../../leave/format.ts";

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
  const tWorkflow = useT("workflows");
  const me = useMe();
  const status = useQuery({ ...statusQuery, refetchInterval: false });
  if (status.isPending) {
    return (
      <>
        <PageHeader title={tWorkflow("Attendance")} />
        <AttendanceNav current="timesheet" />
        <Skeleton className="h-64 w-full" />
      </>
    );
  }
  // Without an employee record the weekly page explains there is nothing to show.
  return status.data?.timesheets.approval && me.employeeId ? <MyPeriodPage /> : <MyTimesheetPage />;
}

function MyPeriodPage() {
  const tWorkflow = useT("workflows");
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
        title={tWorkflow("Attendance")}
        description={tWorkflow(
          "Your timesheet for the period: check the days, claim overtime, then submit it for approval.",
        )}
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
                  label={tWorkflow("My timesheet {arg1}", { arg1: period.label })}
                  days={q.data.days}
                  today={today}
                  action={(d) => (
                    <OvertimeAction
                      day={d}
                      today={today}
                      onClaim={can(me, "attendance:create") ? setClaiming : undefined}
                    />
                  )}
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

function MyTimesheetPage() {
  const locale = useLocale();
  const tWorkflow = useT("workflows");
  const me = useMe();
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
        title={tWorkflow("Attendance")}
        description={tWorkflow("Your week: hours, lateness and overtime. Claim overtime for a day here.")}
      />
      <AttendanceNav current="timesheet" />
      <div className="mb-4 flex items-center gap-2">
        <Button
          size="icon-sm"
          aria-label={tWorkflow("Previous week")}
          onClick={() => void navigate({ search: { week: addDays(from, -7) } })}
        >
          <ChevronLeft />
        </Button>
        <Button
          size="icon-sm"
          aria-label={tWorkflow("Next week")}
          onClick={() => void navigate({ search: { week: addDays(from, 7) } })}
        >
          <ChevronRight />
        </Button>
        <Button size="sm" variant="ghost" onClick={() => void navigate({ search: {} })}>
          {tWorkflow("This week")}
        </Button>
        <span className="num ml-1 text-ui font-medium">{dateRange(from, to, "full", "full", locale)}</span>
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
              label={tWorkflow("My timesheet")}
              days={q.data.days}
              today={today}
              action={(d) => (
                <OvertimeAction
                  day={d}
                  today={today}
                  onClaim={can(me, "attendance:create") ? setClaiming : undefined}
                />
              )}
            />
            {t ? <TotalsRow totals={t} /> : null}
          </>
        )}
      </Card>
      {claiming ? <ClaimDialog day={claiming} onClose={() => setClaiming(null)} /> : null}
    </>
  );
}
