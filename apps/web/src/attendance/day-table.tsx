import { cn, StatusPill, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@crowhr/ui";
import type * as React from "react";
import { weekdayOf } from "../leave/format.ts";
import { type DayRecord, duration, FLAG_TEXT, sgTime } from "./api.ts";

const TYPE_LABEL: Record<DayRecord["dayType"], string> = {
  working: "Working day",
  half: "Half day",
  off: "Off day",
  rest: "Rest day",
  public_holiday: "Public holiday",
  leave: "Leave",
  shift: "Shift",
  not_employed: "Not employed",
};

export function dayLabel(d: DayRecord): string {
  if (d.dayType === "public_holiday") return d.holiday ?? "Public holiday";
  if (d.dayType === "leave" || d.leave) return d.leave?.label ?? "Leave";
  return TYPE_LABEL[d.dayType];
}

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const dm = (iso: string) => `${Number(iso.slice(8))} ${MON[Number(iso.slice(5, 7)) - 1]}`;

/** The exceptions of a day in plain words (late, early, missing, flags). */
export function exceptions(d: DayRecord): { text: string; tone: "warning" | "danger" }[] {
  const out: { text: string; tone: "warning" | "danger" }[] = [];
  if (d.lateMinutes) out.push({ text: `Late ${duration(d.lateMinutes)}`, tone: "warning" });
  if (d.earlyOutMinutes) out.push({ text: `Left ${duration(d.earlyOutMinutes)} early`, tone: "warning" });
  if (d.missingPunches) out.push({ text: d.open ? "No clock-out" : "Missing punch", tone: "danger" });
  for (const f of d.flags) out.push({ text: FLAG_TEXT[f], tone: "warning" });
  return out;
}

/** A week of day records: one row per date, mono numbers right-aligned. */
export function DayTable({
  days,
  today,
  action,
  label,
}: {
  days: DayRecord[];
  today: string;
  action?: (d: DayRecord) => React.ReactNode;
  label: string;
}) {
  return (
    <Table aria-label={label}>
      <TableHeader>
        <TableRow>
          <TableHead>Day</TableHead>
          <TableHead className="hidden sm:table-cell">Type</TableHead>
          <TableHead className="text-right">In</TableHead>
          <TableHead className="text-right">Out</TableHead>
          <TableHead className="text-right">Worked</TableHead>
          <TableHead className="hidden text-right md:table-cell">OT</TableHead>
          <TableHead className="hidden lg:table-cell">Notes</TableHead>
          {action ? (
            <TableHead className="text-right">
              <span className="sr-only">Actions</span>
            </TableHead>
          ) : null}
        </TableRow>
      </TableHeader>
      <TableBody>
        {days.map((d) => {
          const off = ["off", "rest", "public_holiday", "not_employed"].includes(d.dayType) && !d.workedMinutes;
          const notes = exceptions(d);
          return (
            <TableRow key={d.date} data-testid="timesheet-day" className={cn(off && "text-primary-200")}>
              <TableCell className="num whitespace-nowrap">
                <span className="inline-block w-9 text-primary-200">{weekdayOf(d.date)}</span>
                <span className={cn(d.date === today && "font-semibold text-ink")}>{dm(d.date)}</span>
              </TableCell>
              <TableCell className="hidden max-w-[12rem] truncate sm:table-cell">{dayLabel(d)}</TableCell>
              <TableCell className="num text-right">{d.firstIn ? sgTime(d.firstIn) : "—"}</TableCell>
              <TableCell className="num text-right">{d.lastOut ? sgTime(d.lastOut) : d.open ? "…" : "—"}</TableCell>
              <TableCell className="num text-right">{d.workedMinutes ? duration(d.workedMinutes) : "—"}</TableCell>
              <TableCell className="num hidden text-right md:table-cell">
                {d.otMinutes ? duration(d.otMinutes) : "—"}
              </TableCell>
              <TableCell className="hidden lg:table-cell">
                <span className="flex flex-wrap gap-1">
                  {notes.map((n) => (
                    <StatusPill key={n.text} tone={n.tone} dot={false}>
                      {n.text}
                    </StatusPill>
                  ))}
                </span>
              </TableCell>
              {action ? <TableCell className="text-right">{action(d)}</TableCell> : null}
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
