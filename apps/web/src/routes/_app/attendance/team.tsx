import {
  Alert,
  AlertDescription,
  Button,
  Card,
  cn,
  DatePicker,
  EmptyState,
  FormField,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
  Skeleton,
  StatusPill,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  textStyle,
  toast,
} from "@crowhr/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { ChevronLeft, ChevronRight } from "lucide-react";
import * as React from "react";
import {
  attKeys,
  type DayRecord,
  duration,
  FLAG_TEXT,
  type Punch,
  type PunchFlag,
  sgTime,
  teamQuery,
} from "../../../attendance/api.ts";
import { AttendanceNav } from "../../../attendance/attendance-nav.tsx";
import { dayLabel, dm, exceptions } from "../../../attendance/day-table.tsx";
import { ClaimDialog, OvertimeAction } from "../../../attendance/overtime-claim.tsx";
import { LockedMark } from "../../../attendance/timesheet-approval.tsx";
import { can, canForEmployee, useMe } from "../../../auth/session.ts";
import { PageHeader } from "../../../components/page-header.tsx";
import { ErrorNote } from "../../../components/section.tsx";
import { useT } from "../../../i18n/index.ts";
import { addDays, todaySg, weekdayOf } from "../../../leave/format.ts";
import { ApiError, apiPost } from "../../../lib/api.ts";

const ISO = /^\d{4}-\d{2}-\d{2}$/;

export const Route = createFileRoute("/_app/attendance/team")({
  validateSearch: (s: Record<string, unknown>): { date?: string } =>
    typeof s.date === "string" && ISO.test(s.date) ? { date: s.date } : {},
  component: TeamTimesheetPage,
});

interface Row {
  employee: { id: string; name: string };
  day: DayRecord;
}

function TeamTimesheetPage() {
  const tWorkflow = useT("workflows");
  const me = useMe();
  const search = Route.useSearch();
  const navigate = useNavigate({ from: "/attendance/team" });
  const today = todaySg();
  const date = search.date ?? today;
  const q = useQuery(teamQuery(date, date));
  const [editing, setEditing] = React.useState<Row | null>(null);
  const [claiming, setClaiming] = React.useState<Row | null>(null);
  const rows: Row[] = (q.data?.items ?? []).flatMap((s) =>
    s.days[0] ? [{ employee: s.employee, day: s.days[0] }] : [],
  );
  const go = (d: string | undefined) => void navigate({ search: d && d !== today ? { date: d } : {} });
  const counts = {
    in: rows.filter((r) => r.day.firstIn).length,
    late: rows.filter((r) => r.day.lateMinutes).length,
    missing: rows.filter((r) => r.day.missingPunches && !r.day.open).length,
  };
  return (
    <>
      <PageHeader
        title={tWorkflow("Attendance")}
        description={tWorkflow("Your team's day. Fix a missing or wrong punch with Correct; every change is audited.")}
      />
      <AttendanceNav current="team" />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Button size="icon-sm" aria-label={tWorkflow("Previous day")} onClick={() => go(addDays(date, -1))}>
          <ChevronLeft />
        </Button>
        <Button size="icon-sm" aria-label={tWorkflow("Next day")} onClick={() => go(addDays(date, 1))}>
          <ChevronRight />
        </Button>
        <DatePicker value={date} onChange={(d) => go(d ?? undefined)} className="w-40" aria-label={tWorkflow("Day")} />
        {date !== today ? (
          <Button size="sm" variant="ghost" onClick={() => go(undefined)}>
            {tWorkflow("Today")}
          </Button>
        ) : null}
        {q.data ? (
          <span className="num ml-auto text-ui text-primary-300">
            {counts.in} {tWorkflow("in ·")} {counts.late} {tWorkflow("late ·")} {counts.missing}{" "}
            {tWorkflow("missing a punch")}
          </span>
        ) : null}
      </div>
      <Card>
        {q.isError ? (
          <ErrorNote error={q.error} retry={() => void q.refetch()} />
        ) : q.isPending ? (
          <div className="flex flex-col gap-2 p-4">
            <Skeleton className="h-6 w-full" />
            <Skeleton className="h-6 w-full" />
          </div>
        ) : rows.length === 0 ? (
          <EmptyState
            variant="plain"
            title={tWorkflow("No one to show for {arg1} {arg2}.", { arg1: tWorkflow(weekdayOf(date)), arg2: dm(date) })}
            description={tWorkflow("The people you manage show here with their punches for the day.")}
          />
        ) : (
          <Table aria-label={tWorkflow("Team attendance {arg1}", { arg1: dm(date) })}>
            <TableHeader>
              <TableRow>
                <TableHead>{tWorkflow("Name")}</TableHead>
                <TableHead className="hidden md:table-cell">{tWorkflow("Day")}</TableHead>
                <TableHead className="text-right">{tWorkflow("In")}</TableHead>
                <TableHead className="text-right">{tWorkflow("Out")}</TableHead>
                <TableHead className="hidden text-right sm:table-cell">{tWorkflow("Worked")}</TableHead>
                <TableHead className="hidden lg:table-cell">{tWorkflow("Notes")}</TableHead>
                <TableHead className="text-right">
                  <span className="sr-only">{tWorkflow("Actions")}</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.employee.id} data-testid="team-row">
                  <TableCell className="max-w-[12rem] truncate font-medium">
                    {r.employee.id !== me.employeeId ? (
                      <button
                        type="button"
                        className="focus-ring inline-flex max-w-full items-center gap-1 rounded-sm text-left font-medium sm:hidden"
                        onClick={() => setEditing(r)}
                      >
                        <span className="truncate">{r.employee.name}</span>
                        <span className="sr-only">{tWorkflow(": correct punches")}</span>
                        <ChevronRight className="size-3.5 text-primary-200" aria-hidden />
                      </button>
                    ) : null}
                    <span className={cn(r.employee.id !== me.employeeId && "hidden sm:inline")}>{r.employee.name}</span>
                  </TableCell>
                  <TableCell className="hidden text-primary-300 md:table-cell">{dayLabel(r.day, tWorkflow)}</TableCell>
                  <TableCell className="num text-right">{r.day.firstIn ? sgTime(r.day.firstIn) : "—"}</TableCell>
                  <TableCell className="num text-right">
                    {r.day.lastOut ? sgTime(r.day.lastOut) : r.day.open ? "…" : "—"}
                  </TableCell>
                  <TableCell className="num hidden text-right sm:table-cell">
                    {r.day.workedMinutes ? duration(r.day.workedMinutes) : "—"}
                  </TableCell>
                  <TableCell className="hidden lg:table-cell">
                    <span className="flex flex-wrap items-center gap-1">
                      {r.day.locked ? <LockedMark /> : null}
                      {exceptions(r.day, tWorkflow).map((n) => (
                        <StatusPill key={n.text} tone={n.tone}>
                          {n.text}
                        </StatusPill>
                      ))}
                    </span>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex flex-wrap items-center justify-end gap-1">
                      <OvertimeAction
                        day={r.day}
                        today={today}
                        employeeName={r.employee.name}
                        showLock={false}
                        onClaim={
                          r.employee.id !== me.employeeId && canForEmployee(me, "attendance:create", r.employee.id)
                            ? () => setClaiming(r)
                            : undefined
                        }
                      />
                      {r.employee.id !== me.employeeId ? (
                        <Button size="sm" className="hidden sm:inline-flex" onClick={() => setEditing(r)}>
                          {tWorkflow("Correct")}
                        </Button>
                      ) : null}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
      {editing ? <CorrectionSheet row={editing} date={date} onClose={() => setEditing(null)} /> : null}
      {claiming ? (
        <ClaimDialog day={claiming.day} employee={claiming.employee} onClose={() => setClaiming(null)} />
      ) : null}
    </>
  );
}

function CorrectionSheet({ row, date, onClose }: { row: Row; date: string; onClose: () => void }) {
  const tWorkflow = useT("workflows");
  const qc = useQueryClient();
  const me = useMe();
  const live = useQuery(teamQuery(date, date));
  const day = live.data?.items.find((s) => s.employee.id === row.employee.id)?.days[0] ?? row.day;
  // An approved timesheet locks the day: HR's correction reopens it; managers can't change it.
  const canReopen = can(me, "attendance:reopen");
  const locked = day.locked;
  const readOnly = locked && !canReopen;
  const [kind, setKind] = React.useState<"in" | "out">(day.firstIn && !day.lastOut ? "out" : "in");
  const [time, setTime] = React.useState(kind === "out" ? "18:00" : (day.scheduledStart ?? "09:00"));
  const [reason, setReason] = React.useState("");
  const [voiding, setVoiding] = React.useState<Punch | null>(null);
  const [voidReason, setVoidReason] = React.useState("");
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const done = (msg: string) => {
    void qc.invalidateQueries({ queryKey: attKeys.all });
    toast.success(msg);
  };
  const fail = (err: unknown) => {
    if (err instanceof ApiError) {
      setErrors(err.fieldErrors);
      toast.error(err.message);
      // The day was locked (or unlocked) since the sheet opened: show its current state.
      if (err.code === "timesheet_locked") void qc.invalidateQueries({ queryKey: attKeys.all });
    } else toast.error(tWorkflow("That didn't save. Try again."));
  };
  const reopenNote = locked
    ? ` ${tWorkflow("The timesheet was reopened: it must be submitted and approved again.")}`
    : "";
  const add = useMutation({
    mutationFn: () =>
      apiPost<Punch>("/api/v1/attendance/corrections", {
        employeeId: row.employee.id,
        kind,
        time: `${date}T${time}:00+08:00`,
        reason: reason.trim(),
        ...(locked ? { reopen: true } : {}),
      }),
    onSuccess: () => {
      setReason("");
      setErrors({});
      done(
        tWorkflow("Punch added. The timesheet is updated and the change is in the audit log.{arg1}", {
          arg1: reopenNote,
        }),
      );
    },
    onError: fail,
  });
  const voidIt = useMutation({
    mutationFn: (p: Punch) =>
      apiPost<Punch>(`/api/v1/attendance/punches/${p.id}/void`, {
        reason: voidReason.trim(),
        ...(locked ? { reopen: true } : {}),
      }),
    onSuccess: () => {
      setVoiding(null);
      setVoidReason("");
      done(
        tWorkflow("Punch removed from the timesheet. The original is kept in the audit log.{arg1}", {
          arg1: reopenNote,
        }),
      );
    },
    onError: fail,
  });
  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-[min(32rem,100vw)] overflow-y-auto">
        <div className="border-b border-border px-5 pb-4 pt-5">
          <SheetTitle className="font-azeret text-sm font-semibold">
            {tWorkflow("Correct")} {row.employee.name}
          </SheetTitle>
          <SheetDescription className="num mt-1 text-ui text-primary-300">
            {tWorkflow(weekdayOf(date))} {dm(date)} · {dayLabel(day, tWorkflow)}
            {day.workedMinutes ? ` ${tWorkflow("· {arg1} worked", { arg1: duration(day.workedMinutes) })}` : ""}
          </SheetDescription>
        </div>
        {locked ? (
          <Alert variant={readOnly ? "info" : "warning"} className="mx-5 mt-4" data-testid="locked-notice">
            <AlertDescription>
              {readOnly
                ? tWorkflow(
                    "This day is in an approved timesheet, so it can't be corrected. Ask an HR admin: their correction reopens the timesheet.",
                  )
                : tWorkflow(
                    "This day is in an approved timesheet. Saving a correction reopens the timesheet: it must then be submitted and approved again. The reopening is audit-logged and the employee is told.",
                  )}
            </AlertDescription>
          </Alert>
        ) : null}
        <section className="border-b border-border px-5 py-4" aria-labelledby="punches-title">
          <h3 id="punches-title" className={cn(textStyle.group, "mb-2")}>
            {tWorkflow("Punches")}
          </h3>
          {day.punches.length === 0 ? (
            <p className="text-ui text-primary-300">{tWorkflow("No punches on this day.")}</p>
          ) : (
            <ul className="flex flex-col divide-y divide-border">
              {day.punches.map((p) => (
                <li key={p.id} className="py-2 text-ui" data-testid="correction-punch">
                  <div className={cn("flex items-center justify-between gap-3", p.voided && "text-primary-200")}>
                    <span className={cn(p.voided && "line-through")}>
                      <span className="num font-semibold">{sgTime(p.recordedAt)}</span>{" "}
                      {p.kind === "in" ? tWorkflow("In") : tWorkflow("Out")}
                      {p.source === "correction" ? (
                        <span className="text-primary-300"> {tWorkflow("· correction")}</span>
                      ) : null}
                    </span>
                    {p.voided ? (
                      <span className="text-2xs">
                        {tWorkflow("Removed:")} {p.voidReason}
                      </span>
                    ) : readOnly ? null : (
                      <Button size="sm" variant="ghost" onClick={() => setVoiding(p)}>
                        {tWorkflow("Remove")}
                      </Button>
                    )}
                  </div>
                  {p.reason ? (
                    <p className="text-2xs text-primary-300">
                      {tWorkflow("Reason:")} {p.reason}
                    </p>
                  ) : null}
                  {p.flags.length ? (
                    <p className="text-2xs text-warning-400">
                      {p.flags.map((f) => tWorkflow(FLAG_TEXT[f as PunchFlag])).join(" · ")}
                    </p>
                  ) : null}
                  {voiding?.id === p.id ? (
                    <form
                      className="mt-2 flex flex-col gap-2"
                      onSubmit={(e) => {
                        e.preventDefault();
                        voidIt.mutate(p);
                      }}
                    >
                      <FormField label={tWorkflow("Why remove it?")} required error={errors.reason}>
                        <Input
                          value={voidReason}
                          onChange={(e) => setVoidReason(e.target.value)}
                          placeholder={tWorkflow("Clocked in twice")}
                        />
                      </FormField>
                      <div className="flex justify-end gap-2">
                        <Button type="button" size="sm" variant="ghost" onClick={() => setVoiding(null)}>
                          {tWorkflow("Keep")}
                        </Button>
                        <Button
                          type="submit"
                          size="sm"
                          variant="ink"
                          disabled={voidReason.trim().length < 3 || voidIt.isPending}
                        >
                          {locked ? tWorkflow("Remove and reopen") : tWorkflow("Remove punch")}
                        </Button>
                      </div>
                    </form>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </section>
        <form
          hidden={readOnly}
          className="flex flex-col gap-3 px-5 py-4"
          onSubmit={(e) => {
            e.preventDefault();
            add.mutate();
          }}
        >
          <h3 className={textStyle.group}>{tWorkflow("Add a punch")}</h3>
          <div className="grid grid-cols-2 gap-3">
            <FormField label={tWorkflow("Kind")}>
              <Select value={kind} onValueChange={(v) => setKind(v as "in" | "out")}>
                <SelectTrigger aria-label={tWorkflow("Kind")}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="in">{tWorkflow("Clock in")}</SelectItem>
                  <SelectItem value="out">{tWorkflow("Clock out")}</SelectItem>
                </SelectContent>
              </Select>
            </FormField>
            <FormField label={tWorkflow("Time (SGT)")} error={errors.time}>
              <Input type="time" className="num" value={time} onChange={(e) => setTime(e.target.value)} />
            </FormField>
          </div>
          <FormField
            label={tWorkflow("Reason")}
            required
            error={errors.reason}
            hint={tWorkflow("Shown to the employee and kept in the audit log.")}
          >
            <Input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={tWorkflow("Forgot to clock out")}
              maxLength={300}
            />
          </FormField>
          <Button
            type="submit"
            variant="primary"
            className="self-start"
            disabled={reason.trim().length < 3 || !time || add.isPending}
          >
            {locked ? tWorkflow("Add punch and reopen") : tWorkflow("Add punch")}
          </Button>
        </form>
      </SheetContent>
    </Sheet>
  );
}
