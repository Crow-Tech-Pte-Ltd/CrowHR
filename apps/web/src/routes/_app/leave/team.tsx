import { Button, Card, cn, EmptyState, Skeleton } from "@crowhr/ui";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { CalendarCheck2, ChevronLeft, ChevronRight } from "lucide-react";
import * as React from "react";
import { useMe } from "../../../auth/session.ts";
import { PageHeader } from "../../../components/page-header.tsx";
import { ErrorNote } from "../../../components/section.tsx";
import { type CalendarEntry, type CalendarView, calendarQuery } from "../../../leave/api.ts";
import { addDays, dateRange, mondayOf, todaySg, weekdayOf } from "../../../leave/format.ts";
import { LeaveNav } from "../../../leave/leave-nav.tsx";
import { RequestSheet } from "../../../leave/request-sheet.tsx";

interface TeamSearch {
  from?: string;
  view?: "team" | "org";
  request?: string;
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const SPAN = 14;

export const Route = createFileRoute("/_app/leave/team")({
  validateSearch: (s: Record<string, unknown>): TeamSearch => ({
    ...(typeof s.from === "string" && ISO.test(s.from) ? { from: s.from } : {}),
    ...(s.view === "team" || s.view === "org" ? { view: s.view } : {}),
    ...(typeof s.request === "string" ? { request: s.request } : {}),
  }),
  component: TeamCalendarPage,
});

function TeamCalendarPage() {
  const me = useMe();
  const search = Route.useSearch();
  const navigate = useNavigate({ from: "/leave/team" });
  const scopes = me.permissions["leave:read"] ?? [];
  const wide = scopes.includes("all") || scopes.includes("team");
  const view = search.view ?? (wide ? "team" : "org");
  const from = search.from ?? mondayOf(todaySg());
  const to = addDays(from, SPAN - 1);
  const q = useQuery(calendarQuery(from, to, view));
  const go = (next: Partial<TeamSearch>) => void navigate({ search: (s: TeamSearch) => ({ ...s, ...next }) });
  return (
    <>
      <PageHeader
        title="Leave"
        description={
          view === "org"
            ? "Who's away. Leave types stay private where they're sensitive, such as sick leave."
            : "Your team's leave by half day. Pending requests show with a dashed outline."
        }
      />
      <LeaveNav current="team" />
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <Button size="icon-sm" aria-label="Previous two weeks" onClick={() => go({ from: addDays(from, -SPAN) })}>
            <ChevronLeft />
          </Button>
          <Button size="icon-sm" aria-label="Next two weeks" onClick={() => go({ from: addDays(from, SPAN) })}>
            <ChevronRight />
          </Button>
          <Button size="sm" variant="ghost" onClick={() => go({ from: undefined })}>
            This week
          </Button>
          <span className="num ml-1 text-ui font-medium" data-testid="calendar-range">
            {dateRange(from, to)}
          </span>
        </div>
        {wide ? (
          // A view switch over the same calendar, so toggle buttons rather than tabs (no separate panels).
          <fieldset className="flex h-10 items-end gap-1 border-b border-border">
            <legend className="sr-only">Calendar view</legend>
            {(
              [
                ["team", scopes.includes("all") ? "Everyone" : "My team"],
                ["org", "Who's away"],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                aria-pressed={view === value}
                data-state={view === value ? "active" : "inactive"}
                onClick={() => go({ view: value })}
                className="focus-ring -mb-px inline-flex h-9 items-center whitespace-nowrap border-b-2 border-transparent px-3 font-azeret text-xs font-medium text-primary-200 transition-colors hover:text-ink data-[state=active]:border-ink data-[state=active]:text-ink"
              >
                {label}
              </button>
            ))}
          </fieldset>
        ) : null}
      </div>
      {q.isError ? (
        <Card>
          <ErrorNote error={q.error} retry={() => void q.refetch()} />
        </Card>
      ) : q.isPending ? (
        <Card className="p-4" aria-busy="true">
          <Skeleton className="mb-2 h-6 w-full" />
          <Skeleton className="mb-2 h-6 w-full" />
          <Skeleton className="h-6 w-2/3" />
        </Card>
      ) : q.data.people.length === 0 ? (
        <EmptyState
          icon={<CalendarCheck2 />}
          title="Nobody is on leave in these two weeks"
          description="Approved leave shows here. Try the next two weeks, or another view."
        />
      ) : (
        <>
          <div className="hidden md:block">
            <Grid data={q.data} onOpen={(id) => go({ request: id })} />
          </div>
          <div className="md:hidden">
            <DayList data={q.data} onOpen={(id) => go({ request: id })} />
          </div>
          <Legend />
        </>
      )}
      <RequestSheet id={search.request} onClose={() => go({ request: undefined })} />
    </>
  );
}

function days(data: CalendarView) {
  const out: string[] = [];
  for (let d = data.from; d <= data.to; d = addDays(d, 1)) out.push(d);
  return out;
}

const isWeekend = (d: string) => ["Sat", "Sun"].includes(weekdayOf(d));

function Grid({ data, onOpen }: { data: CalendarView; onOpen: (id: string) => void }) {
  const dates = days(data);
  const today = todaySg();
  const holiday = new Map(data.holidays.map((h) => [h.date, h.name]));
  const bodyRef = React.useRef<HTMLTableSectionElement>(null);
  const onKey = (e: React.KeyboardEvent<HTMLTableRowElement>) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const rows = Array.from(bodyRef.current?.querySelectorAll<HTMLTableRowElement>("tr") ?? []);
    const i = rows.indexOf(e.currentTarget);
    rows[e.key === "ArrowDown" ? i + 1 : i - 1]?.focus();
  };
  return (
    <Card className="overflow-x-auto">
      <table
        className="w-full min-w-[56rem] border-collapse text-ui"
        aria-label="Leave calendar"
        data-testid="leave-grid"
      >
        <thead className="sticky top-0 z-10 bg-background">
          <tr>
            <th
              scope="col"
              className="sticky left-0 z-10 w-48 border-b border-border bg-background px-3 py-2 text-left font-azeret text-2xs font-medium uppercase tracking-wider text-primary-200"
            >
              Name
            </th>
            {dates.map((d) => (
              <th
                key={d}
                scope="col"
                title={holiday.get(d)}
                className={cn(
                  "border-b border-l border-border px-0.5 py-1.5 text-center font-azeret text-2xs font-medium",
                  isWeekend(d) && "bg-surface-100 text-primary-200",
                  holiday.has(d) && "bg-oren-50/30 text-ink",
                )}
              >
                <span className="block">{weekdayOf(d)}</span>
                <span className={cn("num block text-xs", d === today && "rounded-sm bg-ink text-surface-50")}>
                  {Number(d.slice(8))}
                </span>
                {holiday.has(d) ? <span className="block text-[10px] font-semibold leading-3">PH</span> : null}
              </th>
            ))}
          </tr>
        </thead>
        <tbody ref={bodyRef}>
          {data.people.map((p) => (
            <tr
              key={p.employeeId}
              tabIndex={0}
              onKeyDown={onKey}
              className="focus-ring group"
              data-testid="calendar-person"
            >
              <th
                scope="row"
                className="sticky left-0 z-[1] h-10 max-w-48 truncate border-b border-border bg-background px-3 text-left font-normal group-hover:bg-surface-100"
              >
                {p.name}
                {p.self ? <span className="ml-1 text-2xs text-primary-200">(you)</span> : null}
              </th>
              {dates.map((d) => {
                const entries = p.entries.filter((e) => e.date === d);
                return (
                  <td
                    key={d}
                    className={cn(
                      "h-10 border-b border-l border-border p-0.5",
                      isWeekend(d) && "bg-surface-100",
                      holiday.has(d) && "bg-oren-50/30",
                    )}
                  >
                    <Cell entries={entries} onOpen={onOpen} name={p.name} date={d} />
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

function Cell({
  entries,
  onOpen,
  name,
  date,
}: {
  entries: CalendarEntry[];
  onOpen: (id: string) => void;
  name: string;
  date: string;
}) {
  if (!entries.length) return null;
  const full = entries.find((e) => e.session === "full");
  const am = full ?? entries.find((e) => e.session === "am");
  const pm = full ?? entries.find((e) => e.session === "pm");
  const block = (e: CalendarEntry | undefined, half: "am" | "pm" | "full") => {
    if (!e) return <span className="flex-1" />;
    const label = `${name}: ${e.label}${half === "full" ? "" : half === "am" ? " (morning)" : " (afternoon)"}, ${dateRange(date, date)}${e.status === "pending" ? ", pending" : ""}`;
    const text =
      half === "full" ? (
        <span aria-hidden className="truncate px-1 text-[10px] leading-none">
          {e.label.replace(/ leave.*$/i, "").replace(/ \(.*\)$/, "")}
        </span>
      ) : null;
    const cls = cn(
      "flex min-w-0 flex-1 items-center overflow-hidden rounded-[3px] border",
      e.status === "approved" ? "border-ink/40 bg-kuning-200" : "border-dashed border-ink/50 bg-surface-50",
    );
    return e.requestId ? (
      <button
        type="button"
        className={cn(cls, "focus-ring")}
        title={label}
        aria-label={label}
        onClick={() => onOpen(e.requestId as string)}
      >
        {text}
      </button>
    ) : (
      <span className={cls} title={label} role="img" aria-label={label}>
        {text}
      </span>
    );
  };
  if (full) return <div className="flex h-full">{block(full, "full")}</div>;
  return (
    <div className="flex h-full gap-px">
      {block(am, "am")}
      {block(pm, "pm")}
    </div>
  );
}

function DayList({ data, onOpen }: { data: CalendarView; onOpen: (id: string) => void }) {
  const holiday = new Map(data.holidays.map((h) => [h.date, h.name]));
  const byDay = days(data)
    .map((d) => ({
      date: d,
      people: data.people.flatMap((p) =>
        p.entries.filter((e) => e.date === d).map((e) => ({ name: p.name, self: p.self, e })),
      ),
    }))
    .filter((x) => x.people.length || holiday.has(x.date));
  if (!byDay.length) {
    return <p className="text-ui text-primary-300">Nobody is on leave in these two weeks.</p>;
  }
  return (
    <ol className="flex flex-col gap-3" data-testid="leave-day-list">
      {byDay.map(({ date, people }) => (
        <li key={date}>
          <h2 className="mb-1 flex items-baseline gap-2 font-azeret text-2xs font-semibold uppercase tracking-wider">
            <span className="num">
              {weekdayOf(date)} {dateRange(date, date)}
            </span>
            {holiday.has(date) ? <span className="normal-case text-ink">{holiday.get(date)}</span> : null}
          </h2>
          {people.length ? (
            <ul className="divide-y divide-border rounded-lg border border-border bg-surface-50">
              {people.map(({ name, self, e }) => (
                <li key={`${name}-${e.session}`}>
                  <button
                    type="button"
                    disabled={!e.requestId}
                    onClick={() => e.requestId && onOpen(e.requestId)}
                    className="focus-ring flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-ui disabled:cursor-default"
                  >
                    <span className="min-w-0 truncate">
                      {name}
                      {self ? <span className="text-primary-200"> (you)</span> : null}
                    </span>
                    <span className="flex shrink-0 items-center gap-2 text-primary-300">
                      {e.label}
                      {e.session !== "full" ? <span className="num text-2xs">{e.session.toUpperCase()}</span> : null}
                      <span
                        aria-hidden
                        className={cn(
                          "size-2.5 rounded-sm border",
                          e.status === "approved" ? "border-ink/40 bg-kuning-200" : "border-dashed border-ink/60",
                        )}
                      />
                      {e.status === "pending" ? <span className="sr-only">pending</span> : null}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-ui text-primary-200">Public holiday</p>
          )}
        </li>
      ))}
    </ol>
  );
}

function Legend() {
  return (
    <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-2xs text-primary-300" aria-hidden>
      <span className="flex items-center gap-1.5">
        <span className="size-3 rounded-sm border border-ink/40 bg-kuning-200" /> Approved
      </span>
      <span className="flex items-center gap-1.5">
        <span className="size-3 rounded-sm border border-dashed border-ink/60 bg-surface-50" /> Pending
      </span>
      <span className="flex items-center gap-1.5">
        <span className="h-3 w-1.5 rounded-sm border border-ink/40 bg-kuning-200" /> Half day
      </span>
      <span className="flex items-center gap-1.5">
        <span className="size-3 rounded-sm bg-oren-50/30 ring-1 ring-oren-200" /> Public holiday
      </span>
    </div>
  );
}
