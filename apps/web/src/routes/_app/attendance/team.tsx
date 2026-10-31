import {
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
  toast,
} from "@crowhr/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { ChevronLeft, ChevronRight, Users } from "lucide-react";
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
import { useMe } from "../../../auth/session.ts";
import { PageHeader } from "../../../components/page-header.tsx";
import { ErrorNote } from "../../../components/section.tsx";
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
  const me = useMe();
  const search = Route.useSearch();
  const navigate = useNavigate({ from: "/attendance/team" });
  const today = todaySg();
  const date = search.date ?? today;
  const q = useQuery(teamQuery(date, date));
  const [editing, setEditing] = React.useState<Row | null>(null);
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
        title="Attendance"
        description="Your team's day. Fix a missing or wrong punch with Correct; every change is audited."
      />
      <AttendanceNav current="team" />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Button size="icon-sm" aria-label="Previous day" onClick={() => go(addDays(date, -1))}>
          <ChevronLeft />
        </Button>
        <Button size="icon-sm" aria-label="Next day" onClick={() => go(addDays(date, 1))}>
          <ChevronRight />
        </Button>
        <DatePicker value={date} onChange={(d) => go(d ?? undefined)} className="w-40" aria-label="Day" />
        {date !== today ? (
          <Button size="sm" variant="ghost" onClick={() => go(undefined)}>
            Today
          </Button>
        ) : null}
        {q.data ? (
          <span className="num ml-auto text-ui text-primary-300">
            {counts.in} in · {counts.late} late · {counts.missing} missing a punch
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
            icon={<Users />}
            title="Nobody to show"
            description="People you manage appear here."
          />
        ) : (
          <Table aria-label={`Team attendance ${dm(date)}`}>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead className="hidden md:table-cell">Day</TableHead>
                <TableHead className="text-right">In</TableHead>
                <TableHead className="text-right">Out</TableHead>
                <TableHead className="hidden text-right sm:table-cell">Worked</TableHead>
                <TableHead className="hidden lg:table-cell">Notes</TableHead>
                <TableHead className="text-right">
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.employee.id} data-testid="team-row">
                  <TableCell className="max-w-[12rem] truncate font-medium">{r.employee.name}</TableCell>
                  <TableCell className="hidden text-primary-300 md:table-cell">{dayLabel(r.day)}</TableCell>
                  <TableCell className="num text-right">{r.day.firstIn ? sgTime(r.day.firstIn) : "—"}</TableCell>
                  <TableCell className="num text-right">
                    {r.day.lastOut ? sgTime(r.day.lastOut) : r.day.open ? "…" : "—"}
                  </TableCell>
                  <TableCell className="num hidden text-right sm:table-cell">
                    {r.day.workedMinutes ? duration(r.day.workedMinutes) : "—"}
                  </TableCell>
                  <TableCell className="hidden lg:table-cell">
                    <span className="flex flex-wrap gap-1">
                      {exceptions(r.day).map((n) => (
                        <StatusPill key={n.text} tone={n.tone} dot={false}>
                          {n.text}
                        </StatusPill>
                      ))}
                    </span>
                  </TableCell>
                  <TableCell className="text-right">
                    {r.employee.id !== me.employeeId ? (
                      <Button size="sm" onClick={() => setEditing(r)}>
                        Correct
                      </Button>
                    ) : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
      {editing ? <CorrectionSheet row={editing} date={date} onClose={() => setEditing(null)} /> : null}
    </>
  );
}

function CorrectionSheet({ row, date, onClose }: { row: Row; date: string; onClose: () => void }) {
  const qc = useQueryClient();
  const live = useQuery(teamQuery(date, date));
  const day = live.data?.items.find((s) => s.employee.id === row.employee.id)?.days[0] ?? row.day;
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
    } else toast.error("That didn't save. Try again.");
  };
  const add = useMutation({
    mutationFn: () =>
      apiPost<Punch>("/api/v1/attendance/corrections", {
        employeeId: row.employee.id,
        kind,
        time: `${date}T${time}:00+08:00`,
        reason: reason.trim(),
      }),
    onSuccess: () => {
      setReason("");
      setErrors({});
      done("Punch added. The timesheet is updated and the change is in the audit log.");
    },
    onError: fail,
  });
  const voidIt = useMutation({
    mutationFn: (p: Punch) => apiPost<Punch>(`/api/v1/attendance/punches/${p.id}/void`, { reason: voidReason.trim() }),
    onSuccess: () => {
      setVoiding(null);
      setVoidReason("");
      done("Punch removed from the timesheet. The original is kept in the audit log.");
    },
    onError: fail,
  });
  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-[min(32rem,100vw)] overflow-y-auto">
        <div className="border-b border-border px-5 pb-4 pt-5">
          <SheetTitle className="font-azeret text-sm font-semibold">Correct {row.employee.name}</SheetTitle>
          <SheetDescription className="num mt-1 text-ui text-primary-300">
            {weekdayOf(date)} {dm(date)} · {dayLabel(day)}
            {day.workedMinutes ? ` · ${duration(day.workedMinutes)} worked` : ""}
          </SheetDescription>
        </div>
        <section className="border-b border-border px-5 py-4" aria-labelledby="punches-title">
          <h3 id="punches-title" className="mb-2 font-azeret text-2xs font-semibold uppercase tracking-wider">
            Punches
          </h3>
          {day.punches.length === 0 ? (
            <p className="text-ui text-primary-300">No punches on this day.</p>
          ) : (
            <ul className="flex flex-col divide-y divide-border">
              {day.punches.map((p) => (
                <li key={p.id} className="py-2 text-ui" data-testid="correction-punch">
                  <div className={cn("flex items-center justify-between gap-3", p.voided && "text-primary-200")}>
                    <span className={cn(p.voided && "line-through")}>
                      <span className="num font-semibold">{sgTime(p.recordedAt)}</span> {p.kind === "in" ? "In" : "Out"}
                      {p.source === "correction" ? <span className="text-primary-300"> · correction</span> : null}
                    </span>
                    {!p.voided ? (
                      <Button size="sm" variant="ghost" onClick={() => setVoiding(p)}>
                        Remove
                      </Button>
                    ) : (
                      <span className="text-2xs">Removed: {p.voidReason}</span>
                    )}
                  </div>
                  {p.reason ? <p className="text-2xs text-primary-300">Reason: {p.reason}</p> : null}
                  {p.flags.length ? (
                    <p className="text-2xs text-warning-400">
                      {p.flags.map((f) => FLAG_TEXT[f as PunchFlag]).join(" · ")}
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
                      <FormField label="Why remove it?" required error={errors.reason}>
                        <Input
                          value={voidReason}
                          onChange={(e) => setVoidReason(e.target.value)}
                          placeholder="Clocked in twice"
                        />
                      </FormField>
                      <div className="flex justify-end gap-2">
                        <Button type="button" size="sm" variant="ghost" onClick={() => setVoiding(null)}>
                          Keep
                        </Button>
                        <Button
                          type="submit"
                          size="sm"
                          variant="ink"
                          disabled={voidReason.trim().length < 3 || voidIt.isPending}
                        >
                          Remove punch
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
          className="flex flex-col gap-3 px-5 py-4"
          onSubmit={(e) => {
            e.preventDefault();
            add.mutate();
          }}
        >
          <h3 className="font-azeret text-2xs font-semibold uppercase tracking-wider">Add a punch</h3>
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Kind">
              <Select value={kind} onValueChange={(v) => setKind(v as "in" | "out")}>
                <SelectTrigger aria-label="Kind">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="in">Clock in</SelectItem>
                  <SelectItem value="out">Clock out</SelectItem>
                </SelectContent>
              </Select>
            </FormField>
            <FormField label="Time (SGT)" error={errors.time}>
              <Input type="time" className="num" value={time} onChange={(e) => setTime(e.target.value)} />
            </FormField>
          </div>
          <FormField
            label="Reason"
            required
            error={errors.reason}
            hint="Shown to the employee and kept in the audit log."
          >
            <Input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Forgot to clock out"
              maxLength={300}
            />
          </FormField>
          <Button
            type="submit"
            variant="primary"
            className="self-start"
            disabled={reason.trim().length < 3 || !time || add.isPending}
          >
            Add punch
          </Button>
        </form>
      </SheetContent>
    </Sheet>
  );
}
