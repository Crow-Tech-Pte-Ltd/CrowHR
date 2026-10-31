import {
  Button,
  type ColumnDef,
  cn,
  DataTable,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  FormField,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  StatusPill,
  Switch,
  toast,
} from "@crowhr/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Archive, CalendarClock, Pencil, Plus, RotateCcw } from "lucide-react";
import * as React from "react";
import { can, useMe } from "../../../auth/session.ts";
import { PageHeader } from "../../../components/page-header.tsx";
import { ErrorNote } from "../../../components/section.tsx";
import { ApiError, apiDelete, apiPost, apiPut } from "../../../lib/api.ts";
import {
  COLOUR_BAR,
  hm,
  SHIFT_COLOURS,
  schedKeys,
  scopesQuery,
  type Template,
  type TemplateInput,
  templatesQuery,
} from "../../../schedules/api.ts";

export const Route = createFileRoute("/_app/settings/shift-templates")({
  component: ShiftTemplatesPage,
});

const errorText = (err: unknown) => (err instanceof Error ? err.message : "That didn't save. Try again.");

/** Paid time of a template being edited (end − start − break; an end at or before the start is the next day). */
function paidOf(f: Pick<TemplateInput, "startTime" | "endTime" | "breakMinutes">): number | null {
  const ok = /^\d\d:\d\d$/;
  if (!ok.test(f.startTime) || !ok.test(f.endTime)) return null;
  const m = (s: string) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3));
  const span = m(f.endTime) > m(f.startTime) ? m(f.endTime) - m(f.startTime) : m(f.endTime) + 1440 - m(f.startTime);
  return span - f.breakMinutes;
}

function ShiftTemplatesPage() {
  const me = useMe();
  const editable = can(me, "shift_templates:update");
  const [showArchived, setShowArchived] = React.useState(false);
  const list = useQuery(templatesQuery(true));
  const [editing, setEditing] = React.useState<Template | "new" | null>(null);
  const qc = useQueryClient();
  const archive = useMutation({
    mutationFn: (t: Template) => apiPost(`/api/v1/scheduling/templates/${t.id}/${t.archived ? "restore" : "archive"}`),
    onSuccess: (_r, t) => {
      toast.success(t.archived ? `${t.name} restored` : `${t.name} archived`);
      void qc.invalidateQueries({ queryKey: schedKeys.all });
    },
    onError: (err) => toast.error(errorText(err)),
  });
  const remove = useMutation({
    mutationFn: (t: Template) => apiDelete(`/api/v1/scheduling/templates/${t.id}`),
    onSuccess: (_r, t) => {
      toast.success(`${t.name} deleted`);
      void qc.invalidateQueries({ queryKey: schedKeys.all });
    },
    onError: (err) => toast.error(errorText(err)),
  });
  const items = (list.data?.items ?? []).filter((t) => showArchived || !t.archived);
  const columns: ColumnDef<Template, unknown>[] = [
    {
      id: "name",
      header: "Shift",
      accessorFn: (t) => t.name,
      cell: ({ row }) => (
        <span className="flex items-center gap-2 whitespace-nowrap">
          <span aria-hidden className={cn("h-4 w-1 rounded-full", COLOUR_BAR[row.original.colour])} />
          <span className="font-medium">{row.original.name}</span>
          <span className="num text-2xs text-primary-200">{row.original.code}</span>
          {row.original.archived ? (
            <StatusPill tone="neutral" dot={false}>
              Archived
            </StatusPill>
          ) : null}
        </span>
      ),
    },
    {
      id: "time",
      header: "Time",
      accessorFn: (t) => `${t.startTime}–${t.endTime}`,
      cell: ({ row }) => (
        <span className="num whitespace-nowrap">
          {row.original.startTime}–{row.original.endTime}
          {row.original.overnight ? <span className="ml-1 text-2xs text-primary-300">next day</span> : null}
        </span>
      ),
    },
    {
      id: "break",
      header: () => <span className="block text-right">Break</span>,
      accessorFn: (t) => t.breakMinutes,
      cell: ({ row }) => <span className="num block text-right">{row.original.breakMinutes} min</span>,
    },
    {
      id: "paid",
      header: () => <span className="block text-right">Paid</span>,
      accessorFn: (t) => t.paidMinutes,
      cell: ({ row }) => <span className="num block text-right">{hm(row.original.paidMinutes)}</span>,
    },
    {
      id: "location",
      header: "Location",
      accessorFn: (t) => t.locationName ?? "All locations",
      meta: { headerClassName: "hidden md:table-cell", cellClassName: "hidden md:table-cell" },
    },
    ...(editable
      ? [
          {
            id: "actions",
            header: () => <span className="sr-only">Actions</span>,
            cell: ({ row }: { row: { original: Template } }) => (
              <span className="flex justify-end gap-1">
                {!row.original.archived ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setEditing(row.original)}
                    aria-label={`Edit ${row.original.name}`}
                  >
                    <Pencil aria-hidden /> Edit
                  </Button>
                ) : null}
                {row.original.inUse || row.original.archived ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => archive.mutate(row.original)}
                    aria-label={`${row.original.archived ? "Restore" : "Archive"} ${row.original.name}`}
                  >
                    {row.original.archived ? <RotateCcw aria-hidden /> : <Archive aria-hidden />}
                    {row.original.archived ? "Restore" : "Archive"}
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => remove.mutate(row.original)}
                    aria-label={`Delete ${row.original.name}`}
                  >
                    Delete
                  </Button>
                )}
              </span>
            ),
          } as ColumnDef<Template, unknown>,
        ]
      : []),
  ];
  return (
    <>
      <PageHeader
        crumbs={[{ label: "Settings", to: "/settings" }]}
        title="Shift templates"
        description="The shifts managers pick from when they build a roster. Changing a template doesn't move shifts already on a roster."
        actions={
          editable ? (
            <Button variant="primary" size="sm" onClick={() => setEditing("new")}>
              <Plus aria-hidden /> Add shift
            </Button>
          ) : null
        }
      />
      {list.isError ? <ErrorNote error={list.error} retry={() => void list.refetch()} /> : null}
      {list.isPending ? (
        <Skeleton className="h-40 w-full" />
      ) : (list.data?.items ?? []).length === 0 ? (
        <EmptyState
          icon={<CalendarClock />}
          title="No shift templates yet"
          description="Add the shifts you run, like Morning 07:00–15:00 or Close 15:00–23:00. Managers can still type custom times on the roster."
          actions={
            editable ? (
              <Button variant="primary" onClick={() => setEditing("new")}>
                <Plus aria-hidden /> Add your first shift
              </Button>
            ) : undefined
          }
          note={editable ? undefined : "Ask an owner or HR admin to add shift templates."}
        />
      ) : (
        <>
          <div className="mb-3 flex items-center gap-2 text-ui">
            <Switch id="show-archived" checked={showArchived} onCheckedChange={setShowArchived} />
            <label htmlFor="show-archived" className="text-primary-300">
              Show archived
            </label>
          </div>
          <DataTable label="Shift templates" columns={columns} data={items} getRowId={(t) => t.id} />
        </>
      )}
      {editing ? (
        <TemplateDialog template={editing === "new" ? null : editing} onClose={() => setEditing(null)} />
      ) : null}
    </>
  );
}

function TemplateDialog({ template, onClose }: { template: Template | null; onClose: () => void }) {
  const qc = useQueryClient();
  const scopes = useQuery(scopesQuery);
  const [form, setForm] = React.useState<TemplateInput>(() =>
    template
      ? {
          name: template.name,
          code: template.code,
          startTime: template.startTime,
          endTime: template.endTime,
          breakMinutes: template.breakMinutes,
          locationId: template.locationId,
          colour: template.colour,
        }
      : {
          name: "",
          code: "",
          startTime: "09:00",
          endTime: "17:00",
          breakMinutes: 60,
          locationId: null,
          colour: "plain",
        },
  );
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const set = <K extends keyof TemplateInput>(k: K, v: TemplateInput[K]) => setForm((f) => ({ ...f, [k]: v }));
  const save = useMutation({
    mutationFn: () =>
      template
        ? apiPut(`/api/v1/scheduling/templates/${template.id}`, form)
        : apiPost<{ id: string }>("/api/v1/scheduling/templates", form),
    onSuccess: () => {
      toast.success(`${form.name} saved`);
      void qc.invalidateQueries({ queryKey: schedKeys.all });
      onClose();
    },
    onError: (err) => {
      if (err instanceof ApiError) setErrors(err.fieldErrors);
      toast.error(errorText(err));
    },
  });
  const paid = paidOf(form);
  return (
    <Dialog open onOpenChange={(o) => (o ? null : onClose())}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{template ? `Edit ${template.name}` : "New shift"}</DialogTitle>
          <DialogDescription>
            {template?.inUse
              ? "New shifts use the new times. Shifts already on a roster keep theirs."
              : "Managers see the code on the roster grid."}
          </DialogDescription>
        </DialogHeader>
        <form
          id="template-form"
          className="grid gap-4 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
        >
          <FormField label="Name" error={errors.name} required>
            <Input value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="Morning" />
          </FormField>
          <FormField label="Code" hint="1 to 6 letters or digits." error={errors.code} required>
            <Input
              className="num uppercase"
              maxLength={6}
              value={form.code}
              onChange={(e) => set("code", e.target.value.toUpperCase())}
              placeholder="AM"
            />
          </FormField>
          <FormField label="Starts" error={errors.startTime} required>
            <Input
              type="time"
              className="num"
              value={form.startTime}
              onChange={(e) => set("startTime", e.target.value)}
            />
          </FormField>
          <FormField
            label="Ends"
            hint={form.endTime <= form.startTime ? "Ends the next day." : undefined}
            error={errors.endTime}
            required
          >
            <Input type="time" className="num" value={form.endTime} onChange={(e) => set("endTime", e.target.value)} />
          </FormField>
          <FormField label="Unpaid break (minutes)" error={errors.breakMinutes}>
            <Input
              className="num text-right"
              inputMode="numeric"
              value={String(form.breakMinutes)}
              onChange={(e) => set("breakMinutes", Number(e.target.value.replace(/\D/g, "") || 0))}
            />
          </FormField>
          <div className="flex flex-col justify-end gap-1.5 pb-2 text-ui">
            <span className="text-2xs text-primary-300">Paid time</span>
            <span className="num font-semibold" data-testid="paid-preview">
              {paid !== null && paid > 0 ? hm(paid) : "—"}
            </span>
          </div>
          <FormField label="Location" hint="Leave as all locations unless only one outlet runs it.">
            <Select value={form.locationId ?? "all"} onValueChange={(v) => set("locationId", v === "all" ? null : v)}>
              <SelectTrigger aria-label="Location">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All locations</SelectItem>
                {(scopes.data?.locations ?? []).map((l) => (
                  <SelectItem key={l.id} value={l.id}>
                    {l.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>
          <fieldset>
            <legend className="mb-1.5 text-ui font-medium">Marker</legend>
            <div className="flex gap-1.5">
              {SHIFT_COLOURS.map((c) => (
                <button
                  key={c.value}
                  type="button"
                  aria-pressed={form.colour === c.value}
                  aria-label={c.label}
                  title={c.label}
                  onClick={() => set("colour", c.value)}
                  className={cn(
                    "focus-ring flex h-8 w-8 items-center justify-center rounded-md border",
                    form.colour === c.value ? "border-ink" : "border-border",
                  )}
                >
                  <span className={cn("h-4 w-1.5 rounded-full", COLOUR_BAR[c.value])} />
                </button>
              ))}
            </div>
          </fieldset>
        </form>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" form="template-form" disabled={save.isPending}>
            {save.isPending ? "Saving…" : "Save shift"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
