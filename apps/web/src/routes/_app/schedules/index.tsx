import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Button,
  Checkbox,
  cn,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  Kbd,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  StatusPill,
  textStyle,
  toast,
} from "@crowhr/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ChevronLeft, ChevronRight, Copy, Download, Eraser, Send, UserRound } from "lucide-react";
import * as React from "react";
import { canForAll, useMe } from "../../../auth/session.ts";
import { PageHeader } from "../../../components/page-header.tsx";
import { ErrorNote } from "../../../components/section.tsx";
import { ApiError, apiDelete, apiPatch, apiPost } from "../../../lib/api.ts";
import {
  addDays,
  COLOUR_BAR,
  defaultLocation,
  mondayOf,
  type Roster,
  type RosterRef,
  rosterQuery,
  type Shift,
  schedKeys,
  scopesQuery,
  shortDay,
  type Template,
  templatesQuery,
  todaySg,
  weekLabel,
} from "../../../schedules/api.ts";
import { type EditorTarget, type ShiftDraft, ShiftEditor } from "../../../schedules/shift-editor.tsx";
import { type CellRef, DayList, rowsOf, WeekGrid } from "../../../schedules/week-grid.tsx";

interface Search {
  week?: string;
  loc?: string;
  dept?: string;
  day?: string;
}

export const Route = createFileRoute("/_app/schedules/")({
  validateSearch: (s: Record<string, unknown>): Search => ({
    ...(typeof s.week === "string" && /^\d{4}-\d\d-\d\d$/.test(s.week) ? { week: s.week } : {}),
    ...(typeof s.loc === "string" ? { loc: s.loc } : {}),
    ...(typeof s.dept === "string" ? { dept: s.dept } : {}),
    ...(typeof s.day === "string" ? { day: s.day } : {}),
  }),
  component: SchedulesPage,
});

const errorText = (err: unknown) => (err instanceof Error ? err.message : "That didn't save. Try again.");

function SchedulesPage() {
  const me = useMe();
  const search = Route.useSearch();
  const navigate = useNavigate({ from: "/schedules/" });
  const scopes = useQuery(scopesQuery);
  const week = mondayOf(search.week ?? addDays(todaySg(), 7));
  // `loc=any`: a department-wide roster across locations.
  const loc = search.loc === "any" ? null : (search.loc ?? defaultLocation(scopes.data));
  const dept = search.dept ?? (search.loc || loc ? null : (scopes.data?.mine.departmentId ?? null));
  const ref: RosterRef = { weekStart: week, locationId: loc, departmentId: dept };
  const roster = useQuery(rosterQuery(ref));
  const templates = useQuery({ ...templatesQuery(false), enabled: !!scopes.data?.canEdit });
  const go = (patch: Partial<Search>) => void navigate({ search: (s: Search) => ({ ...s, ...patch }) });

  if (scopes.isPending) return <Skeleton className="h-64 w-full" />;
  if (scopes.isError) return <ErrorNote error={scopes.error} retry={() => void scopes.refetch()} />;
  const s = scopes.data;
  const noScope = !s.locations.length && !s.departments.length;
  return (
    <>
      <PageHeader
        title="Schedules"
        description={
          s.canEdit
            ? "Build the week, check the warnings, then publish. Staff see only what you publish."
            : "Your outlet's published roster. Your own shifts and swap requests are in My schedule."
        }
        actions={
          <Button asChild variant="secondary" size="sm">
            <Link to="/schedules/me">
              <UserRound aria-hidden /> My schedule
            </Link>
          </Button>
        }
      />
      {noScope ? (
        <EmptyState
          title="There are no locations or departments yet."
          description="Rosters are built per location or department. Add your outlets or departments first."
          actions={
            canForAll(me, "org_structure:create") ? (
              <Button asChild size="sm">
                <Link to="/settings/structure">Open Settings → Structure</Link>
              </Button>
            ) : undefined
          }
        />
      ) : (
        <>
          <Toolbar
            week={week}
            scopes={s}
            loc={ref.locationId}
            dept={ref.departmentId}
            onWeek={(w) => go({ week: w })}
            onScope={(l, d) => go({ loc: l ?? "any", dept: d ?? undefined })}
            roster={roster.data}
          />
          {!ref.locationId && !ref.departmentId ? (
            <EmptyState
              title="Pick a location or a department above."
              description="A roster covers one location, one department, or a department at one location."
            />
          ) : roster.isPending ? (
            <Skeleton className="h-96 w-full" />
          ) : roster.isError ? (
            roster.error instanceof ApiError && roster.error.status === 404 ? (
              <EmptyState
                title="There is nothing to show for this roster."
                description={
                  s.canEdit
                    ? "None of your team works here. Pick a location where your team works."
                    : "You're not on this roster. Pick your own location."
                }
              />
            ) : (
              <ErrorNote error={roster.error} retry={() => void roster.refetch()} />
            )
          ) : (
            <RosterBoard
              data={roster.data}
              rosterRef={ref}
              templates={templates.data?.items ?? []}
              day={search.day ?? week}
              onDay={(d) => go({ day: d })}
            />
          )}
        </>
      )}
    </>
  );
}

function Toolbar({
  week,
  scopes,
  loc,
  dept,
  onWeek,
  onScope,
  roster,
}: {
  week: string;
  scopes: { locations: { id: string; name: string }[]; departments: { id: string; name: string }[] };
  loc: string | null;
  dept: string | null;
  onWeek: (w: string) => void;
  onScope: (loc: string | null, dept: string | null) => void;
  roster: Roster | undefined;
}) {
  const thisWeek = mondayOf(todaySg());
  const r = roster?.roster;
  return (
    <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
      <div className="flex flex-wrap items-center gap-2">
        <Select value={loc ?? "none"} onValueChange={(v) => onScope(v === "none" ? null : v, dept)}>
          <SelectTrigger aria-label="Location" className="h-9 w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {scopes.locations.map((l) => (
              <SelectItem key={l.id} value={l.id}>
                {l.name}
              </SelectItem>
            ))}
            <SelectItem value="none">Any location</SelectItem>
          </SelectContent>
        </Select>
        <Select value={dept ?? "all"} onValueChange={(v) => onScope(loc, v === "all" ? null : v)}>
          <SelectTrigger aria-label="Department" className="h-9 w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All departments</SelectItem>
            {scopes.departments.map((d) => (
              <SelectItem key={d.id} value={d.id}>
                {d.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="flex items-center rounded-md border border-ink/20">
          <Button variant="ghost" size="icon-sm" aria-label="Previous week" onClick={() => onWeek(addDays(week, -7))}>
            <ChevronLeft />
          </Button>
          <span className="num min-w-[9.5rem] px-1 text-center text-xs font-semibold" data-testid="week-label">
            {weekLabel(week)}
          </span>
          <Button variant="ghost" size="icon-sm" aria-label="Next week" onClick={() => onWeek(addDays(week, 7))}>
            <ChevronRight />
          </Button>
        </div>
        {week !== thisWeek ? (
          <Button variant="link" size="sm" onClick={() => onWeek(thisWeek)}>
            This week
          </Button>
        ) : null}
      </div>
      {r ? (
        <div className="flex items-center gap-2 text-2xs text-primary-300" data-testid="roster-status">
          {r.status === "published" ? (
            r.hasChanges ? (
              <>
                <StatusPill tone="warning">Unpublished changes</StatusPill>
                <span>Staff still see version {r.version}.</span>
              </>
            ) : (
              <>
                <StatusPill tone="success">Published</StatusPill>
                <span className="num whitespace-nowrap">Version {r.version}</span>
              </>
            )
          ) : roster.mode === "edit" ? (
            <>
              <StatusPill tone="neutral">Draft</StatusPill>
              <span>Not visible to staff yet.</span>
            </>
          ) : (
            <StatusPill tone="neutral">Not published yet</StatusPill>
          )}
        </div>
      ) : null}
    </div>
  );
}

function RosterBoard({
  data,
  rosterRef,
  templates,
  day,
  onDay,
}: {
  data: Roster;
  rosterRef: RosterRef;
  templates: Template[];
  day: string;
  onDay: (d: string) => void;
}) {
  const qc = useQueryClient();
  const [editor, setEditor] = React.useState<EditorTarget | null>(null);
  const [editorError, setEditorError] = React.useState<string | null>(null);
  const [paint, setPaint] = React.useState<string | null>(null);
  const [publishing, setPublishing] = React.useState(false);
  const [clearing, setClearing] = React.useState(false);
  const rows = rowsOf(data);
  const editable = data.mode === "edit";
  const refresh = () => qc.invalidateQueries({ queryKey: schedKeys.all });
  const rosterId = React.useRef<string | null>(data.roster.id);
  rosterId.current = data.roster.id ?? rosterId.current;
  const ensureId = async () => {
    if (rosterId.current) return rosterId.current;
    const r = await apiPost<{ id: string }>("/api/v1/scheduling/rosters", rosterRef);
    rosterId.current = r.id;
    return r.id;
  };
  const save = useMutation({
    mutationFn: async (v: {
      target: { employeeId: string | null; date: string };
      shift: Shift | null;
      draft: ShiftDraft;
    }) => {
      const body = { employeeId: v.target.employeeId, date: v.target.date, ...v.draft };
      if (v.shift)
        return apiPatch(`/api/v1/scheduling/shifts/${v.shift.id}`, { ...body, expectedUpdatedAt: v.shift.updatedAt });
      return apiPost(`/api/v1/scheduling/rosters/${await ensureId()}/shifts`, body);
    },
    onSuccess: () => {
      setEditor(null);
      setEditorError(null);
      void refresh();
    },
    onError: (err) => {
      if (editor) setEditorError(errorText(err));
      else toast.error(errorText(err));
      if (err instanceof ApiError && err.code === "stale") void refresh();
    },
  });
  const remove = useMutation({
    mutationFn: async (ids: string[]) => {
      for (const id of ids) await apiDelete(`/api/v1/scheduling/shifts/${id}`);
    },
    onSuccess: () => {
      setEditor(null);
      void refresh();
    },
    onError: (err) => toast.error(errorText(err)),
  });
  const copy = useMutation({
    mutationFn: async () =>
      apiPost<{ message: string; copied: number }>(`/api/v1/scheduling/rosters/${await ensureId()}/copy-previous`),
    onSuccess: (r) => {
      toast.success(r.message);
      void refresh();
    },
    onError: (err) => toast.error(errorText(err)),
  });
  const clear = useMutation({
    mutationFn: async () => apiPost<{ removed: number }>(`/api/v1/scheduling/rosters/${await ensureId()}/clear`),
    onSuccess: (r) => {
      toast.success(`${r.removed} ${r.removed === 1 ? "shift" : "shifts"} removed`);
      setClearing(false);
      void refresh();
    },
    onError: (err) => toast.error(errorText(err)),
  });
  const draftOf = (t: Template): ShiftDraft => ({ kind: "shift", templateId: t.id, note: null });
  const open = (cell: CellRef, shift: Shift | null) => {
    if (!editable) return;
    const t = paint ? templates.find((x) => x.id === paint) : null;
    if (t && !shift && !cell.shifts.length) {
      save.mutate({ target: cell, shift: null, draft: draftOf(t) });
      return;
    }
    setEditorError(null);
    setEditor({ employeeId: cell.employeeId, employeeName: cell.employeeName, date: cell.date, shift });
  };
  const keyAction = (cell: CellRef, a: { type: "template"; index: number } | { type: "rest" } | { type: "clear" }) => {
    if (a.type === "clear") return remove.mutate(cell.shifts.map((s) => s.id));
    const first = cell.shifts[0] ?? null;
    if (a.type === "rest")
      return save.mutate({ target: cell, shift: first, draft: { kind: "rest", templateId: null, note: null } });
    const t = templates[a.index];
    if (!t) return toast.error(`There's no shift template ${a.index + 1}. Add more in Settings → Shift templates.`);
    save.mutate({ target: cell, shift: first, draft: draftOf(t) });
  };
  const moveShift = (id: string, to: { employeeId: string | null; date: string }) => {
    const s = data.shifts.find((x) => x.id === id);
    if (s?.kind !== "shift" || (s.employeeId === to.employeeId && s.date === to.date)) return;
    save.mutate({
      target: to,
      shift: s,
      draft: {
        kind: "shift",
        templateId: s.templateId,
        startTime: s.start ?? undefined,
        endTime: s.end ?? undefined,
        breakMinutes: s.breakMinutes,
        note: s.note,
      },
    });
  };
  const warnings =
    data.shifts.reduce((n, s) => n + s.conflicts.filter((c) => c.severity === "warning").length, 0) +
    data.employees.reduce((n, e) => n + e.warnings.length, 0);
  return (
    <>
      {editable ? (
        <div className="mb-3 flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex flex-wrap items-center gap-1.5" role="toolbar" aria-label="Shift templates">
            <span className={cn("mr-1", textStyle.group)}>Assign</span>
            {templates.length ? (
              templates.slice(0, 9).map((t, i) => (
                <button
                  key={t.id}
                  type="button"
                  aria-pressed={paint === t.id}
                  title={`${t.name} ${t.startTime}–${t.endTime}. Click a cell to assign, or press ${i + 1} on a cell.`}
                  onClick={() => setPaint((p) => (p === t.id ? null : t.id))}
                  className={cn(
                    "focus-ring flex h-8 items-center gap-1.5 rounded-md border px-2",
                    paint === t.id ? "border-ink bg-kuning-100" : "border-ink/15 bg-surface-50 hover:border-ink/40",
                  )}
                >
                  <span aria-hidden className={cn("h-4 w-[3px] rounded-full", COLOUR_BAR[t.colour])} />
                  <span className="num text-2xs font-semibold">{t.code}</span>
                  <span className="num hidden text-[10px] text-primary-300 2xl:inline">
                    {t.startTime}–{t.endTime}
                  </span>
                  <Kbd className="hidden lg:inline-flex">{i + 1}</Kbd>
                </button>
              ))
            ) : (
              <Link to="/settings/shift-templates" className="text-ui text-biru-400 hover:underline">
                Add shift templates
              </Link>
            )}
            {paint ? (
              <Button variant="link" size="sm" onClick={() => setPaint(null)}>
                Stop assigning
              </Button>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" size="sm" onClick={() => copy.mutate()} disabled={copy.isPending}>
              <Copy aria-hidden /> Copy last week
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setClearing(true)} disabled={!data.shifts.length}>
              <Eraser aria-hidden /> Clear week
            </Button>
            {data.roster.id ? (
              <Button asChild variant="ghost" size="sm">
                <a href={`/api/v1/scheduling/rosters/${data.roster.id}/export.csv`} download>
                  <Download aria-hidden /> CSV
                </a>
              </Button>
            ) : null}
            <Button
              variant="primary"
              size="sm"
              onClick={() => setPublishing(true)}
              disabled={!data.roster.id || (data.roster.status === "published" && !data.roster.hasChanges)}
              data-testid="publish"
            >
              <Send aria-hidden /> {data.roster.status === "published" ? "Publish changes" : "Publish"}
            </Button>
          </div>
        </div>
      ) : null}
      <div className="hidden md:block">
        <WeekGrid data={data} rows={rows} onOpen={open} onKeyAction={keyAction} onMove={moveShift} />
        {editable ? (
          <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-2xs text-primary-300">
            <span>
              <Kbd>←</Kbd> <Kbd>→</Kbd> <Kbd>↑</Kbd> <Kbd>↓</Kbd> move
            </span>
            <span>
              <Kbd>Enter</Kbd> edit
            </span>
            <span>
              <Kbd>1</Kbd>–<Kbd>9</Kbd> assign a shift
            </span>
            <span>
              <Kbd>R</Kbd> rest day
            </span>
            <span>
              <Kbd>Del</Kbd> clear
            </span>
            <span>Drag a shift to move it.</span>
            {warnings ? (
              <span className="ml-auto">{warnings} hour or rest-day warnings: hover a label to read it.</span>
            ) : null}
          </p>
        ) : null}
      </div>
      <div className="md:hidden">
        <div className="mb-3 grid grid-cols-7 gap-1" role="tablist" aria-label="Day">
          {data.days.map((d) => (
            <button
              key={d.date}
              type="button"
              role="tab"
              aria-selected={d.date === day}
              onClick={() => onDay(d.date)}
              className={cn(
                "focus-ring flex flex-col items-center rounded-md border py-1.5",
                d.date === day ? "border-ink bg-kuning-100" : "border-ink/15",
              )}
            >
              <span className="font-azeret text-[10px] font-semibold uppercase">{shortDay(d.date).slice(0, 3)}</span>
              <span className="num text-2xs">{Number(d.date.slice(8))}</span>
            </button>
          ))}
        </div>
        <DayList data={data} rows={rows} date={day} onOpen={open} />
      </div>
      {editor ? (
        <ShiftEditor
          target={editor}
          templates={templates}
          busy={save.isPending || remove.isPending}
          error={editorError}
          onClose={() => setEditor(null)}
          onSave={(draft) => save.mutate({ target: editor, shift: editor.shift, draft })}
          onDelete={editor.shift ? () => remove.mutate([editor.shift?.id as string]) : null}
        />
      ) : null}
      {publishing && data.roster.id ? (
        <PublishDialog
          data={data}
          rosterId={data.roster.id}
          onClose={() => setPublishing(false)}
          onDone={() => void refresh()}
        />
      ) : null}
      <AlertDialog open={clearing} onOpenChange={setClearing}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Clear the week of {weekLabel(data.roster.weekStart)}?</AlertDialogTitle>
            <AlertDialogDescription>
              Removes every shift you can edit from the draft. What staff already see stays until you publish again.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep shifts</AlertDialogCancel>
            <AlertDialogAction onClick={() => clear.mutate()}>Clear week</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function PublishDialog({
  data,
  rosterId,
  onClose,
  onDone,
}: {
  data: Roster;
  rosterId: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [checked, setChecked] = React.useState<Set<string>>(new Set());
  const key = (a: { shiftId: string; kind: string }) => `${a.shiftId}:${a.kind}`;
  const publish = useMutation({
    mutationFn: () =>
      apiPost<{ version: number; notified: number; changedEmployees: number }>(
        `/api/v1/scheduling/rosters/${rosterId}/publish`,
        {
          acknowledge: data.toAcknowledge
            .filter((a) => checked.has(key(a)))
            .map((a) => ({ shiftId: a.shiftId, kind: a.kind })),
        },
      ),
    onSuccess: (r) => {
      toast.success(
        r.notified
          ? `Published. ${r.notified} ${r.notified === 1 ? "person was" : "people were"} notified.`
          : "Published. Nobody's shifts changed, so nobody was notified.",
      );
      onDone();
      onClose();
    },
    onError: (err) => toast.error(errorText(err)),
  });
  const people = new Set(data.shifts.filter((s) => s.employeeId && s.kind === "shift").map((s) => s.employeeId)).size;
  const names = new Map(data.employees.map((e) => [e.id, e.name]));
  const warnings = [
    ...data.employees.flatMap((e) => e.warnings.map((w) => ({ key: `${e.id}-${w.kind}`, name: e.name, w }))),
    // Shift-level warnings (12-hour day, rest day, public holiday); hints like overtime stay on the grid.
    ...data.shifts.flatMap((s) =>
      s.conflicts
        .filter((c) => c.severity === "warning")
        .map((w) => ({
          key: `${s.id}-${w.kind}`,
          name: `${names.get(s.employeeId ?? "") ?? ""}, ${shortDay(s.date)}`,
          w,
        })),
    ),
  ];
  const all = data.toAcknowledge.every((a) => checked.has(key(a)));
  return (
    <Dialog open onOpenChange={(o) => (o ? null : onClose())}>
      <DialogContent className="max-h-[90dvh] max-w-xl overflow-y-auto" data-testid="publish-dialog">
        <DialogHeader>
          <DialogTitle>Publish {weekLabel(data.roster.weekStart)}</DialogTitle>
          <DialogDescription>
            {data.roster.status === "published"
              ? "Only people whose shifts changed are notified, with the old and new times."
              : `${people} ${people === 1 ? "person" : "people"} with shifts will be notified.`}{" "}
            Attendance, leave and payroll use the published roster.
          </DialogDescription>
        </DialogHeader>
        {data.toAcknowledge.length ? (
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-ui font-medium">Check these before publishing</legend>
            {data.toAcknowledge.map((a) => (
              <div
                key={key(a)}
                className="flex items-start gap-2 rounded-md border border-danger-200/40 px-3 py-2 text-ui"
              >
                <Checkbox
                  id={`ack-${key(a)}`}
                  className="mt-0.5"
                  checked={checked.has(key(a))}
                  onCheckedChange={(v) =>
                    setChecked((prev) => {
                      const next = new Set(prev);
                      if (v) next.add(key(a));
                      else next.delete(key(a));
                      return next;
                    })
                  }
                />
                <label htmlFor={`ack-${key(a)}`} className="cursor-pointer">
                  <span className="font-medium">{a.employeeName}</span>, {shortDay(a.date)}: {a.message}
                </label>
              </div>
            ))}
          </fieldset>
        ) : null}
        {warnings.length ? (
          <div className="text-ui">
            <p className="mb-1 font-medium">Warnings (you can still publish)</p>
            <ul className="max-h-48 list-disc overflow-y-auto pl-5 text-primary-300">
              {warnings.map(({ key: k, name, w }) => (
                <li key={k}>
                  {name}: {w.message}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Not yet
          </Button>
          <Button
            variant="primary"
            disabled={!all || publish.isPending}
            onClick={() => publish.mutate()}
            data-testid="confirm-publish"
          >
            <Send aria-hidden /> {publish.isPending ? "Publishing…" : "Publish"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
