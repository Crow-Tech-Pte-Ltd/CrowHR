import { cn } from "@crowhr/ui";
import { AlertTriangle, Ban, Info, Plus } from "lucide-react";
import * as React from "react";
import {
  COLOUR_BAR,
  type Conflict,
  dayMonth,
  hours,
  type Roster,
  type RosterEmployee,
  type Shift,
  weekday,
} from "./api.ts";

/**
 * The roster week grid: employees as rows, Monday to Sunday as columns (design decision 3: one
 * request loads the whole week with its conflicts). Restrained by design: a shift is a hairline
 * chip with a thin colour marker, never a filled cell; conflicts are an icon plus a text label.
 *
 * Keyboard: arrows move between cells, Enter opens the editor, 1–9 apply the numbered shift
 * template, R marks a rest day, Delete clears the cell. Shifts can be dragged to another cell.
 */

export interface GridRow {
  key: string;
  employeeId: string | null;
  name: string;
  detail: string;
  editable: boolean;
  minutes: number;
  warnings: Conflict[];
}

export interface CellRef {
  employeeId: string | null;
  employeeName: string;
  date: string;
  shifts: Shift[];
}

const SEVERITY_ORDER: Record<Conflict["severity"], number> = { block: 0, ack: 1, warning: 2, hint: 3 };

export function ConflictTag({ c, compact = false }: { c: Conflict; compact?: boolean }) {
  const Icon = c.severity === "block" ? Ban : c.severity === "hint" ? Info : AlertTriangle;
  return (
    <span
      title={c.message}
      className={cn(
        "inline-flex items-center gap-1 whitespace-nowrap font-azeret text-[10px] font-medium leading-4",
        c.severity === "block" || c.severity === "ack"
          ? "text-danger-300"
          : c.severity === "warning"
            ? "text-warning-400"
            : "text-primary-300",
      )}
    >
      <Icon className="size-3 shrink-0" aria-hidden />
      {compact ? null : c.label}
      {compact ? <span className="sr-only">{c.label}</span> : null}
    </span>
  );
}

function ShiftChip({ shift, draggable, onOpen }: { shift: Shift; draggable: boolean; onOpen: () => void }) {
  if (shift.kind === "rest") {
    return (
      <button
        type="button"
        tabIndex={-1}
        onClick={(e) => {
          e.stopPropagation();
          onOpen();
        }}
        className="w-full rounded-sm px-1.5 py-0.5 text-left font-azeret text-[10px] font-semibold uppercase tracking-wider text-primary-200 hover:bg-ink/[0.04]"
        data-testid="rest-chip"
      >
        Rest day
      </button>
    );
  }
  const conflicts = [...shift.conflicts].sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
  const shown = conflicts.slice(0, 2);
  return (
    <button
      type="button"
      tabIndex={-1}
      draggable={draggable}
      onDragStart={(e) => {
        e.dataTransfer.setData("text/x-crowhr-shift", shift.id);
        e.dataTransfer.effectAllowed = "move";
      }}
      onClick={(e) => {
        e.stopPropagation();
        onOpen();
      }}
      data-testid="shift-chip"
      title={`${shift.start}–${shift.end}${shift.templateCode ? ` (${shift.templateCode})` : ""}, ${shift.paidMinutes} min paid`}
      className={cn(
        "group flex w-full min-w-0 flex-col gap-0.5 overflow-hidden rounded-sm border bg-surface-50 py-1 pl-2 pr-1.5 text-left",
        conflicts.some((c) => c.severity === "block" || c.severity === "ack")
          ? "border-danger-200/50"
          : "border-ink/10 hover:border-ink/30",
        draggable && "cursor-grab active:cursor-grabbing",
      )}
    >
      {/* Wide screens: one line. Narrower: start over end, so a 7-day week fits a tablet. */}
      <span className="flex w-full items-start gap-1.5">
        <span
          aria-hidden
          className={cn("mt-0.5 h-3.5 w-[3px] shrink-0 rounded-full min-[1400px]:h-3", COLOUR_BAR[shift.colour])}
        />
        <span className="num whitespace-nowrap text-[11px] font-medium leading-4">
          {shift.start}
          <span className="hidden min-[1400px]:inline">–{shift.end}</span>
          <span className="block font-normal text-primary-300 min-[1400px]:hidden">–{shift.end}</span>
        </span>
        {shift.templateCode ? (
          <span className="num ml-auto hidden rounded-sm border border-border px-0.5 text-[10px] leading-[14px] text-primary-300 min-[1400px]:inline">
            {shift.templateCode}
          </span>
        ) : null}
      </span>
      {shown.length || shift.pendingSwap ? (
        <span className="flex flex-wrap gap-x-1.5 pl-[9px]">
          {shown.map((c) => (
            <ConflictTag key={c.kind} c={c} />
          ))}
          {conflicts.length > 2 ? (
            <span
              className="num text-[10px] text-primary-300"
              title={conflicts
                .slice(2)
                .map((c) => c.label)
                .join(", ")}
            >
              +{conflicts.length - 2}
            </span>
          ) : null}
          {shift.pendingSwap ? <span className="font-azeret text-[10px] text-biru-400">Swap asked</span> : null}
        </span>
      ) : null}
    </button>
  );
}

export function WeekGrid({
  data,
  rows,
  onOpen,
  onKeyAction,
  onMove,
}: {
  data: Roster;
  rows: GridRow[];
  onOpen: (cell: CellRef, shift: Shift | null) => void;
  onKeyAction: (
    cell: CellRef,
    action: { type: "template"; index: number } | { type: "rest" } | { type: "clear" },
  ) => void;
  onMove: (shiftId: string, to: { employeeId: string | null; date: string }) => void;
}) {
  const ref = React.useRef<HTMLDivElement>(null);
  const [focus, setFocus] = React.useState<{ r: number; c: number }>({ r: 0, c: 0 });
  const [dropTarget, setDropTarget] = React.useState<string | null>(null);
  const byCell = React.useMemo(() => {
    const m = new Map<string, Shift[]>();
    for (const s of data.shifts) {
      const k = `${s.employeeId ?? "open"}:${s.date}`;
      m.set(k, [...(m.get(k) ?? []), s]);
    }
    return m;
  }, [data.shifts]);
  const cellOf = (r: number, c: number): CellRef | null => {
    const row = rows[r];
    const day = data.days[c];
    if (!row || !day) return null;
    return {
      employeeId: row.employeeId,
      employeeName: row.name,
      date: day.date,
      shifts: byCell.get(`${row.employeeId ?? "open"}:${day.date}`) ?? [],
    };
  };
  const move = (r: number, c: number) => {
    const next = { r: Math.max(0, Math.min(rows.length - 1, r)), c: Math.max(0, Math.min(6, c)) };
    setFocus(next);
    ref.current?.querySelector<HTMLElement>(`[data-cell="${next.r}:${next.c}"]`)?.focus();
  };
  const onKeyDown = (e: React.KeyboardEvent) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>("[data-cell]");
    if (!el) return;
    const [r, c] = (el.dataset.cell ?? "0:0").split(":").map(Number) as [number, number];
    const cell = cellOf(r, c);
    const row = rows[r];
    if (!cell || !row) return;
    const target: Record<string, [number, number]> = {
      ArrowUp: [r - 1, c],
      ArrowDown: [r + 1, c],
      ArrowLeft: [r, c - 1],
      ArrowRight: [r, c + 1],
      Home: [r, 0],
      End: [r, 6],
    };
    const to = target[e.key];
    if (to) {
      e.preventDefault();
      move(to[0], to[1]);
      return;
    }
    if (!row.editable) return;
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onOpen(cell, cell.shifts[0] ?? null);
    } else if (/^[1-9]$/.test(e.key) && !e.metaKey && !e.ctrlKey && !e.altKey) {
      e.preventDefault();
      onKeyAction(cell, { type: "template", index: Number(e.key) - 1 });
    } else if ((e.key === "r" || e.key === "R") && row.employeeId) {
      e.preventDefault();
      onKeyAction(cell, { type: "rest" });
    } else if ((e.key === "Delete" || e.key === "Backspace") && cell.shifts.length) {
      e.preventDefault();
      onKeyAction(cell, { type: "clear" });
    }
  };
  const total = data.days.reduce((n, d) => n + d.minutes, 0);
  return (
    <div
      ref={ref}
      className="relative max-h-[calc(100dvh-15rem)] min-h-[16rem] overflow-auto rounded-md border border-border bg-background"
      data-testid="week-grid"
    >
      <table
        aria-label={`Roster for ${data.roster.scopeLabel}`}
        className="w-full min-w-[680px] table-fixed border-separate border-spacing-0"
      >
        <thead>
          <tr>
            <th
              scope="col"
              className="sticky left-0 top-0 z-30 w-[148px] xl:w-[200px] border-b border-r border-border bg-surface-100 px-3 py-2 text-left font-azeret text-2xs font-semibold uppercase tracking-wider text-primary-300"
            >
              Employee
            </th>
            {data.days.map((d) => (
              <th
                key={d.date}
                scope="col"
                className="sticky top-0 z-20 border-b border-border bg-surface-100 px-2 py-1.5 text-left align-top"
              >
                <span className="flex flex-col min-[1400px]:flex-row min-[1400px]:items-baseline min-[1400px]:gap-1.5">
                  <span className="font-azeret text-2xs font-semibold uppercase tracking-wider">{weekday(d.date)}</span>
                  <span className="num text-2xs text-primary-300">{dayMonth(d.date)}</span>
                </span>
                {d.holiday ? (
                  <span
                    className="mt-0.5 flex items-center gap-1 text-[10px] leading-3 text-primary-300"
                    title="Public holiday"
                  >
                    <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-kuning-300" />
                    <span className="truncate">{d.holiday}</span>
                  </span>
                ) : null}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, r) => (
            <tr key={row.key} className="group/row" data-testid={`row-${row.employeeId ?? "open"}`}>
              <th
                scope="row"
                className={cn(
                  "sticky left-0 z-10 border-b border-r border-border bg-background px-3 py-1.5 text-left align-top font-normal group-hover/row:bg-surface-50",
                  row.employeeId === null && "bg-surface-50",
                )}
              >
                <span className="flex items-baseline justify-between gap-2">
                  <span className={cn("truncate text-ui font-medium", !row.editable && "text-primary-300")}>
                    {row.name}
                  </span>
                  <span className="num shrink-0 text-2xs text-primary-300" title="Rostered hours this week">
                    {row.minutes ? `${hours(row.minutes)} h` : ""}
                  </span>
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="truncate text-[10px] text-primary-200">{row.detail}</span>
                  {row.warnings.map((w) => (
                    <ConflictTag key={w.kind} c={w} compact />
                  ))}
                </span>
              </th>
              {data.days.map((d, c) => {
                const cell = cellOf(r, c) as CellRef;
                const key = `${r}:${c}`;
                return (
                  <td
                    key={d.date}
                    tabIndex={focus.r === r && focus.c === c ? 0 : -1}
                    data-cell={key}
                    onKeyDown={onKeyDown}
                    aria-label={`${row.name}, ${weekday(d.date)} ${dayMonth(d.date)}: ${
                      cell.shifts.length
                        ? cell.shifts
                            .map((s) =>
                              s.kind === "rest"
                                ? "rest day"
                                : `${s.start} to ${s.end}${s.conflicts.length ? `, ${s.conflicts.map((x) => x.label).join(", ")}` : ""}`,
                            )
                            .join("; ")
                        : "no shift"
                    }`}
                    onFocus={() => setFocus({ r, c })}
                    onClick={() => row.editable && onOpen(cell, null)}
                    onDragOver={(e) => {
                      if (!row.editable) return;
                      e.preventDefault();
                      setDropTarget(key);
                    }}
                    onDragLeave={() => setDropTarget((k) => (k === key ? null : k))}
                    onDrop={(e) => {
                      setDropTarget(null);
                      const id = e.dataTransfer.getData("text/x-crowhr-shift");
                      if (id && row.editable) {
                        e.preventDefault();
                        onMove(id, { employeeId: row.employeeId, date: d.date });
                      }
                    }}
                    className={cn(
                      "focus-ring group/cell h-11 border-b border-border px-1 py-1 align-top outline-none",
                      row.editable ? "cursor-pointer hover:bg-surface-50" : "cursor-default",
                      d.holiday && "bg-kuning-50/40",
                      dropTarget === key && "bg-biru-50 ring-1 ring-inset ring-biru-300",
                      "focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-biru-300",
                    )}
                  >
                    <div className="flex flex-col gap-1">
                      {cell.shifts.map((s) => (
                        <ShiftChip
                          key={s.id}
                          shift={s}
                          draggable={row.editable && s.kind === "shift"}
                          onOpen={() => row.editable && onOpen(cell, s)}
                        />
                      ))}
                      {row.editable && !cell.shifts.length ? (
                        <span className="flex h-7 items-center justify-center text-primary-200 opacity-0 group-hover/cell:opacity-100 group-focus-visible/cell:opacity-100">
                          <Plus className="size-3.5" aria-hidden />
                        </span>
                      ) : null}
                    </div>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <th
              scope="row"
              className="sticky bottom-0 left-0 z-20 border-r border-t border-border bg-surface-100 px-3 py-1.5 text-left font-azeret text-2xs font-semibold uppercase tracking-wider text-primary-300"
            >
              Hours <span className="num ml-1 text-ink">{hours(total)}</span>
            </th>
            {data.days.map((d) => (
              <td key={d.date} className="sticky bottom-0 z-10 border-t border-border bg-surface-100 px-2 py-1.5">
                <span className="num text-2xs font-semibold">{d.minutes ? hours(d.minutes) : "–"}</span>
              </td>
            ))}
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

/** Phone width: one day at a time, a list of people with their shifts. Editing one shift at a time. */
export function DayList({
  data,
  rows,
  date,
  onOpen,
}: {
  data: Roster;
  rows: GridRow[];
  date: string;
  onOpen: (cell: CellRef, shift: Shift | null) => void;
}) {
  const shifts = data.shifts.filter((s) => s.date === date);
  return (
    <ul className="divide-y divide-border rounded-md border border-border" data-testid="day-list">
      {rows.map((row) => {
        const mine = shifts.filter((s) => s.employeeId === row.employeeId);
        if (row.employeeId === null && !mine.length && !row.editable) return null;
        const cell: CellRef = { employeeId: row.employeeId, employeeName: row.name, date, shifts: mine };
        return (
          <li key={row.key} className="flex items-start justify-between gap-3 px-3 py-2.5">
            <span className="min-w-0">
              <span className="block truncate text-ui font-medium">{row.name}</span>
              <span className="text-2xs text-primary-300">
                {row.minutes ? `${hours(row.minutes)} h this week` : row.detail}
              </span>
            </span>
            <span className="flex min-w-[8rem] flex-col items-end gap-1">
              {mine.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  disabled={!row.editable}
                  onClick={() => onOpen(cell, s)}
                  className="focus-ring flex flex-col items-end rounded-sm px-1 text-right"
                >
                  {s.kind === "rest" ? (
                    <span className="font-azeret text-2xs uppercase text-primary-200">Rest day</span>
                  ) : (
                    <span className="flex items-center gap-1.5">
                      <span aria-hidden className={cn("h-3.5 w-[3px] rounded-full", COLOUR_BAR[s.colour])} />
                      <span className="num text-ui">
                        {s.start}–{s.end}
                      </span>
                    </span>
                  )}
                  {s.conflicts.slice(0, 2).map((c) => (
                    <ConflictTag key={c.kind} c={c} />
                  ))}
                </button>
              ))}
              {row.editable && !mine.length ? (
                <button
                  type="button"
                  onClick={() => onOpen(cell, null)}
                  className="focus-ring rounded-sm font-azeret text-2xs font-semibold text-biru-400"
                >
                  Add shift
                </button>
              ) : null}
              {!row.editable && !mine.length ? <span className="text-2xs text-primary-200">Off</span> : null}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

export function rowsOf(data: Roster): GridRow[] {
  const employees: GridRow[] = data.employees.map((e: RosterEmployee) => ({
    key: e.id,
    employeeId: e.id,
    name: e.name,
    detail: [
      e.schedule === "shift" ? "Rostered" : e.schedule === "fixed" ? "Fixed week" : "",
      e.restDayAssumed ? `rest ${weekday(e.restDayAssumed)} (assumed)` : "",
    ]
      .filter(Boolean)
      .join(" · "),
    editable: e.editable,
    minutes: e.minutes,
    warnings: e.warnings,
  }));
  const open = data.shifts.filter((s) => s.employeeId === null);
  if (data.mode === "edit" || open.length) {
    employees.push({
      key: "open",
      employeeId: null,
      name: "Open shifts",
      detail: "Anyone on the roster can ask to pick these up",
      editable: data.mode === "edit",
      minutes: 0,
      warnings: [],
    });
  }
  return employees;
}
