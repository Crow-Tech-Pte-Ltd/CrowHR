import { cn, StatusPill, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@crowhr/ui";
import type * as React from "react";
import { type Translate, useT } from "../i18n/index.ts";
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

export function dayLabel(d: DayRecord, t: Translate): string {
  if (d.dayType === "public_holiday") return d.holiday ?? t("Public holiday");
  if (d.dayType === "leave" || d.leave) return d.leave?.label ?? t("Leave");
  return t(TYPE_LABEL[d.dayType]);
}

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const dm = (iso: string) => `${Number(iso.slice(8))} ${MON[Number(iso.slice(5, 7)) - 1]}`;

/** The exceptions of a day in plain words (late, early, missing, flags). */
export function exceptions(d: DayRecord, t: Translate): { text: string; tone: "warning" | "danger" }[] {
  const out: { text: string; tone: "warning" | "danger" }[] = [];
  if (d.lateMinutes) out.push({ text: t("Late {arg1}", { arg1: duration(d.lateMinutes) }), tone: "warning" });
  if (d.earlyOutMinutes)
    out.push({ text: t("Left {arg1} early", { arg1: duration(d.earlyOutMinutes) }), tone: "warning" });
  if (d.missingPunches) out.push({ text: t(d.open ? "No clock-out" : "Missing punch"), tone: "danger" });
  for (const f of d.flags) out.push({ text: t(FLAG_TEXT[f]), tone: "warning" });
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
  const tWorkflow = useT("workflows");
  return (
    <Table aria-label={label}>
      <TableHeader>
        <TableRow>
          <TableHead>{tWorkflow("Day")}</TableHead>
          <TableHead className="hidden sm:table-cell">{tWorkflow("Type")}</TableHead>
          <TableHead className="text-right">{tWorkflow("In")}</TableHead>
          <TableHead className="text-right">{tWorkflow("Out")}</TableHead>
          <TableHead className="text-right">{tWorkflow("Worked")}</TableHead>
          <TableHead className="hidden text-right md:table-cell">{tWorkflow("OT")}</TableHead>
          <TableHead className="hidden lg:table-cell">{tWorkflow("Notes")}</TableHead>
          {action ? (
            <TableHead className="text-right">
              <span className="sr-only">{tWorkflow("Actions")}</span>
            </TableHead>
          ) : null}
        </TableRow>
      </TableHeader>
      <TableBody>
        {days.map((d) => {
          const off = ["off", "rest", "public_holiday", "not_employed"].includes(d.dayType) && !d.workedMinutes;
          const notes = exceptions(d, tWorkflow);
          return (
            <TableRow key={d.date} data-testid="timesheet-day" className={cn(off && "text-primary-200")}>
              <TableCell className="num whitespace-nowrap">
                <span className="inline-block w-9 text-primary-200">{tWorkflow(weekdayOf(d.date))}</span>
                <span className={cn(d.date === today && "font-semibold text-ink")}>{dm(d.date)}</span>
              </TableCell>
              <TableCell className="hidden max-w-[12rem] truncate sm:table-cell">{dayLabel(d, tWorkflow)}</TableCell>
              <TableCell className="num text-right">{d.firstIn ? sgTime(d.firstIn) : "—"}</TableCell>
              <TableCell className="num text-right">{d.lastOut ? sgTime(d.lastOut) : d.open ? "…" : "—"}</TableCell>
              <TableCell className="num text-right">{d.workedMinutes ? duration(d.workedMinutes) : "—"}</TableCell>
              <TableCell className="num hidden text-right md:table-cell">
                {d.otMinutes ? duration(d.otMinutes) : "—"}
              </TableCell>
              <TableCell className="hidden lg:table-cell">
                <span className="flex flex-wrap gap-1">
                  {notes.map((n) => (
                    <StatusPill key={n.text} tone={n.tone}>
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
