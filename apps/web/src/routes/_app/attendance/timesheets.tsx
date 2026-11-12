import {
  Button,
  Card,
  EmptyState,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@crowhr/ui";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ClipboardCheck, Users } from "lucide-react";
import * as React from "react";
import {
  duration,
  sheetQuery,
  type TimesheetOverview,
  type TimesheetRow,
  timesheetRecordQuery,
  timesheetsQuery,
} from "../../../attendance/api.ts";
import { AttendanceNav } from "../../../attendance/attendance-nav.tsx";
import { DayTable } from "../../../attendance/day-table.tsx";
import {
  LockedMark,
  PeriodNav,
  TimesheetStatusCard,
  TimesheetStatusPill,
} from "../../../attendance/timesheet-approval.tsx";
import { can, useMe } from "../../../auth/session.ts";
import { PageHeader } from "../../../components/page-header.tsx";
import { ErrorNote } from "../../../components/section.tsx";
import { todaySg } from "../../../leave/format.ts";

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f-]{36}$/i;

interface Search {
  date?: string;
  employee?: string;
  /** An approval's link: resolved to its period and employee. */
  timesheet?: string;
}

export const Route = createFileRoute("/_app/attendance/timesheets")({
  validateSearch: (s: Record<string, unknown>): Search => ({
    ...(typeof s.date === "string" && ISO.test(s.date) ? { date: s.date } : {}),
    ...(typeof s.employee === "string" && UUID.test(s.employee) ? { employee: s.employee } : {}),
    ...(typeof s.timesheet === "string" && UUID.test(s.timesheet) ? { timesheet: s.timesheet } : {}),
  }),
  component: TimesheetsPage,
});

function TimesheetsPage() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: "/attendance/timesheets" });
  // An approval task links here by timesheet ID: open its period and person.
  const record = useQuery({ ...timesheetRecordQuery(search.timesheet ?? ""), enabled: !!search.timesheet });
  React.useEffect(() => {
    if (record.data) {
      void navigate({
        search: { date: record.data.periodStart, employee: record.data.employee.id },
        replace: true,
      });
    }
  }, [record.data, navigate]);
  if (search.timesheet) {
    return (
      <>
        <PageHeader title="Attendance" />
        <AttendanceNav current="timesheets" />
        {record.isError ? (
          <ErrorNote error={record.error} retry={() => void record.refetch()} />
        ) : (
          <Skeleton className="h-64 w-full" />
        )}
      </>
    );
  }
  return <PeriodList date={search.date} employee={search.employee} />;
}

function PeriodList({ date, employee }: { date?: string; employee?: string }) {
  const me = useMe();
  const navigate = useNavigate({ from: "/attendance/timesheets" });
  const today = todaySg();
  const q = useQuery(timesheetsQuery(date ?? today));
  const data = q.data;
  const open = data?.items.find((i) => i.employee.id === employee) ?? null;
  const go = (search: { date?: string; employee?: string }) => void navigate({ search });
  return (
    <>
      <PageHeader
        title="Attendance"
        description="Timesheets for the period: who has submitted, what waits for your approval, and what is approved and locked."
      />
      <AttendanceNav current="timesheets" />
      {q.isError ? (
        <ErrorNote error={q.error} retry={() => void q.refetch()} />
      ) : !data ? (
        <Skeleton className="h-64 w-full" />
      ) : !data.settings.approval ? (
        <Card>
          <EmptyState
            variant="plain"
            icon={<ClipboardCheck />}
            title="Timesheet approval is off"
            description="Managers and HR correct attendance directly. Turn approval on to have timesheets submitted, approved and locked."
            actions={
              can(me, "policies:update") ? (
                <Button asChild size="sm">
                  <Link to="/settings/attendance">Open Settings → Attendance</Link>
                </Button>
              ) : undefined
            }
          />
        </Card>
      ) : (
        <>
          <PeriodNav
            period={data.period}
            previous={data.previous}
            next={data.next}
            current={data.period.start <= today && today <= data.period.end}
            onGo={(start) => go(start ? { date: start } : {})}
          />
          <Counts data={data} />
          <Card>
            {data.items.length === 0 ? (
              <EmptyState
                variant="plain"
                icon={<Users />}
                title="Nobody to show"
                description="People you manage, and their timesheets, appear here."
              />
            ) : (
              <Table aria-label={`Timesheets ${data.period.label}`}>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead className="hidden text-right sm:table-cell">Days</TableHead>
                    <TableHead className="text-right">Worked</TableHead>
                    <TableHead className="hidden text-right md:table-cell">OT</TableHead>
                    <TableHead className="hidden text-right md:table-cell">Missing</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">
                      <span className="sr-only">Actions</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.items.map((r) => {
                    // Submitting is the manager's job only when managers submit; otherwise HR opens it.
                    const verb = r.taskId
                      ? "Review"
                      : r.canSubmit && data.settings.submittedBy === "manager"
                        ? "Submit"
                        : "Open";
                    return (
                      <TableRow key={r.employee.id} data-testid="timesheet-row">
                        <TableCell className="max-w-[12rem] truncate font-medium">{r.employee.name}</TableCell>
                        <TableCell className="num hidden text-right sm:table-cell">{r.totals.daysWorked}</TableCell>
                        <TableCell className="num text-right">
                          {r.totals.workedMinutes ? duration(r.totals.workedMinutes) : "—"}
                        </TableCell>
                        <TableCell className="num hidden text-right md:table-cell">
                          {r.totals.otMinutes ? duration(r.totals.otMinutes) : "—"}
                        </TableCell>
                        <TableCell className="num hidden text-right md:table-cell">
                          {r.totals.missingPunches || "—"}
                        </TableCell>
                        <TableCell>
                          <TimesheetStatusPill status={r.status} />
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            size="sm"
                            variant={verb === "Open" ? "ghost" : "secondary"}
                            onClick={() => go({ date: data.period.start, employee: r.employee.id })}
                            aria-label={`${verb} ${r.employee.name}'s timesheet`}
                          >
                            {verb}
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </Card>
        </>
      )}
      {data && open ? (
        <PersonSheet
          data={data}
          row={open}
          mine={open.employee.id === me.employeeId}
          onClose={() => go({ date: data.period.start })}
        />
      ) : null}
    </>
  );
}

function Counts({ data }: { data: TimesheetOverview }) {
  const n = (s: TimesheetRow["status"][]) => data.items.filter((i) => s.includes(i.status)).length;
  const mine = data.items.filter((i) => i.taskId).length;
  return (
    <p className="num mb-3 text-ui text-primary-300" data-testid="timesheet-counts">
      {n(["approved"])} approved · {n(["submitted"])} waiting{mine ? ` (${mine} for you)` : ""} ·{" "}
      {n(["not_submitted", "returned", "withdrawn", "reopened"])} to submit
    </p>
  );
}

function PersonSheet({
  data,
  row,
  mine,
  onClose,
}: {
  data: TimesheetOverview;
  row: TimesheetRow;
  mine: boolean;
  onClose: () => void;
}) {
  const today = todaySg();
  const days = useQuery(sheetQuery(data.period.start, data.period.end, row.employee.id));
  const me = useMe();
  const canCorrect = can(me, "attendance:update") && !mine;
  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-[min(46rem,100vw)] overflow-y-auto" data-testid="timesheet-sheet">
        <div className="border-b border-border px-5 pb-4 pt-5">
          <SheetTitle className="font-azeret text-sm font-semibold">{row.employee.name}</SheetTitle>
          <SheetDescription className="num mt-1 text-ui text-primary-300">
            {data.period.label} · {row.totals.daysWorked} days · {duration(row.totals.workedMinutes)} worked
            {row.totals.otMinutes ? ` · ${duration(row.totals.otMinutes)} OT` : ""}
          </SheetDescription>
        </div>
        <div className="px-5 pt-4">
          <TimesheetStatusCard
            row={row}
            over={data.over}
            submittableFrom={data.submittableFrom}
            mine={mine}
            submittedBy={data.settings.submittedBy}
            periodStart={data.period.start}
          />
        </div>
        <div className="px-5 pb-5">
          {days.isError ? (
            <ErrorNote error={days.error} retry={() => void days.refetch()} />
          ) : days.isPending ? (
            <Skeleton className="h-48 w-full" />
          ) : (
            <div className="rounded-md border border-border">
              <DayTable
                label={`${row.employee.name} ${data.period.label}`}
                days={days.data.days}
                today={today}
                action={(d) =>
                  d.locked ? (
                    <LockedMark />
                  ) : canCorrect && d.dayType !== "not_employed" && d.date <= today ? (
                    <Button asChild size="sm" variant="ghost">
                      <Link to="/attendance/team" search={{ date: d.date }}>
                        Correct
                      </Link>
                    </Button>
                  ) : null
                }
              />
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
