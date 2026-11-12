import {
  Button,
  Card,
  DatePicker,
  EmptyState,
  FormField,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@crowhr/ui";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Download } from "lucide-react";
import * as React from "react";
import { duration, summaryCsvHref, summaryQuery } from "../../../attendance/api.ts";
import { AttendanceNav } from "../../../attendance/attendance-nav.tsx";
import { can, useMe } from "../../../auth/session.ts";
import { PageHeader } from "../../../components/page-header.tsx";
import { ErrorNote } from "../../../components/section.tsx";
import { todaySg } from "../../../leave/format.ts";

export const Route = createFileRoute("/_app/attendance/summary")({
  component: SummaryPage,
});

function SummaryPage() {
  const me = useMe();
  const today = todaySg();
  const [from, setFrom] = React.useState<string | null>(`${today.slice(0, 8)}01`);
  const [to, setTo] = React.useState<string | null>(today);
  const ok = !!from && !!to && from <= to;
  const q = useQuery({ ...summaryQuery(from ?? "", to ?? ""), enabled: ok });
  const items = q.data?.items ?? [];
  return (
    <>
      <PageHeader
        title="Attendance"
        description="Attendance per person for a period, up to 62 days. Export it for payroll or your records."
      />
      <AttendanceNav current="summary" />
      <div className="mb-4 flex flex-wrap items-end gap-2">
        <FormField label="From">
          <DatePicker value={from} onChange={setFrom} className="w-40" />
        </FormField>
        <FormField label="To">
          <DatePicker value={to} onChange={setTo} min={from} className="w-40" />
        </FormField>
        {can(me, "reports_attendance:export") ? (
          <Button asChild disabled={!ok}>
            <a href={ok ? summaryCsvHref(from, to) : undefined} download>
              <Download /> CSV
            </a>
          </Button>
        ) : null}
      </div>
      <Card>
        {!ok ? (
          <p className="p-4 text-ui text-danger-300">Pick a start date on or before the end date.</p>
        ) : q.isError ? (
          <ErrorNote error={q.error} retry={() => void q.refetch()} />
        ) : q.isPending ? (
          <div className="p-4">
            <Skeleton className="h-24 w-full" />
          </div>
        ) : items.length === 0 ? (
          <EmptyState
            variant="plain"
            title="No one to report on for these dates."
            description="The employees you can see show here with their days worked, hours, late arrivals and overtime."
          />
        ) : (
          <div className="overflow-x-auto">
            <Table aria-label="Attendance summary">
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead className="text-right">Days</TableHead>
                  <TableHead className="text-right">Worked</TableHead>
                  <TableHead className="hidden text-right sm:table-cell">Late</TableHead>
                  <TableHead className="hidden text-right md:table-cell">Early out</TableHead>
                  <TableHead className="hidden text-right md:table-cell">Missing</TableHead>
                  <TableHead className="hidden text-right lg:table-cell">OT (clock)</TableHead>
                  <TableHead className="text-right">OT approved</TableHead>
                  <TableHead className="hidden text-right lg:table-cell">Leave days</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((r) => (
                  <TableRow key={r.employeeId} data-testid="summary-row">
                    <TableCell className="max-w-[12rem] truncate font-medium">{r.name}</TableCell>
                    {/* A dash for zero, like the other columns: the zero itself isn't the information. */}
                    <TableCell className="num text-right">{r.daysWorked || "—"}</TableCell>
                    <TableCell className="num text-right">
                      {r.workedMinutes ? duration(r.workedMinutes) : "—"}
                    </TableCell>
                    <TableCell className="num hidden text-right sm:table-cell">
                      {r.lateCount ? `${r.lateCount}× ${duration(r.lateMinutes)}` : "—"}
                    </TableCell>
                    <TableCell className="num hidden text-right md:table-cell">{r.earlyOutCount || "—"}</TableCell>
                    <TableCell className="num hidden text-right md:table-cell">{r.missingPunches || "—"}</TableCell>
                    <TableCell className="num hidden text-right lg:table-cell">
                      {r.computedOtMinutes ? duration(r.computedOtMinutes) : "—"}
                    </TableCell>
                    <TableCell className="num text-right">
                      {r.approvedOtMinutes ? duration(r.approvedOtMinutes) : "—"}
                    </TableCell>
                    <TableCell className="num hidden text-right lg:table-cell">{r.leaveDays || "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </Card>
    </>
  );
}
