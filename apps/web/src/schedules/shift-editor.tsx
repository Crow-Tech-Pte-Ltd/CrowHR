import {
  Button,
  cn,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  FormField,
  Input,
  Textarea,
} from "@crowhr/ui";
import { Moon, Trash2 } from "lucide-react";
import * as React from "react";
import { COLOUR_BAR, hm, type Shift, shortDay, type Template } from "./api.ts";
import { ConflictTag } from "./week-grid.tsx";

export interface EditorTarget {
  employeeId: string | null;
  employeeName: string;
  date: string;
  shift: Shift | null;
}

export interface ShiftDraft {
  kind: "shift" | "rest";
  templateId: string | null;
  startTime?: string;
  endTime?: string;
  breakMinutes?: number;
  note: string | null;
}

function paid(start: string, end: string, brk: number): number | null {
  if (!/^\d\d:\d\d$/.test(start) || !/^\d\d:\d\d$/.test(end)) return null;
  const m = (s: string) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3));
  const span = m(end) > m(start) ? m(end) - m(start) : m(end) + 1440 - m(start);
  return span - brk;
}

/** Assign a template, enter custom times, mark a rest day, or remove: one shift at a time. */
export function ShiftEditor({
  target,
  templates,
  busy,
  error,
  onSave,
  onDelete,
  onClose,
}: {
  target: EditorTarget;
  templates: Template[];
  busy: boolean;
  error: string | null;
  onSave: (draft: ShiftDraft) => void;
  onDelete: (() => void) | null;
  onClose: () => void;
}) {
  const s = target.shift;
  const [templateId, setTemplateId] = React.useState<string | null>(s?.templateId ?? null);
  const [start, setStart] = React.useState(s?.start ?? "09:00");
  const [end, setEnd] = React.useState(s?.end ?? "17:00");
  const [brk, setBrk] = React.useState(String(s?.breakMinutes ?? 60));
  const [note, setNote] = React.useState(s?.note ?? "");
  const pick = (t: Template) => {
    setTemplateId(t.id);
    setStart(t.startTime);
    setEnd(t.endTime);
    setBrk(String(t.breakMinutes));
  };
  const chosen = templates.find((t) => t.id === templateId) ?? null;
  const custom = !chosen || chosen.startTime !== start || chosen.endTime !== end || String(chosen.breakMinutes) !== brk;
  const p = paid(start, end, Number(brk || 0));
  const save = () =>
    onSave({
      kind: "shift",
      templateId,
      ...(custom || !templateId ? { startTime: start, endTime: end, breakMinutes: Number(brk || 0) } : {}),
      note: note.trim() || null,
    });
  return (
    <Dialog open onOpenChange={(o) => (o ? null : onClose())}>
      <DialogContent className="max-w-lg" data-testid="shift-editor">
        <DialogHeader>
          <DialogTitle>
            {s?.kind === "rest" ? "Rest day" : s ? "Edit shift" : "Add shift"} · {shortDay(target.date)}
          </DialogTitle>
          <DialogDescription>
            {target.employeeId ? target.employeeName : "Open shift: anyone on the roster can ask to pick it up."}
          </DialogDescription>
        </DialogHeader>
        <form
          id="shift-form"
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          {templates.length ? (
            <fieldset>
              <legend className="mb-1.5 text-ui font-medium">Shift</legend>
              <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
                {templates.map((t, i) => (
                  <button
                    key={t.id}
                    type="button"
                    aria-pressed={templateId === t.id && !custom}
                    onClick={() => pick(t)}
                    className={cn(
                      "focus-ring flex items-center gap-2 rounded-md border px-2 py-1.5 text-left",
                      templateId === t.id && !custom ? "border-ink bg-kuning-50" : "border-border hover:border-ink/40",
                    )}
                  >
                    <span aria-hidden className={cn("h-7 w-1 shrink-0 rounded-full", COLOUR_BAR[t.colour])} />
                    <span className="min-w-0">
                      <span className="flex items-baseline gap-1.5">
                        <span className="num text-2xs font-semibold">{t.code}</span>
                        {i < 9 ? <span className="num text-[10px] text-primary-200">{i + 1}</span> : null}
                      </span>
                      <span className="num block text-2xs text-primary-300">
                        {t.startTime}–{t.endTime}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            </fieldset>
          ) : null}
          <div className="grid grid-cols-3 gap-3">
            <FormField label="Starts">
              <Input type="time" className="num" value={start} onChange={(e) => setStart(e.target.value)} />
            </FormField>
            <FormField label="Ends" hint={end <= start ? "Next day" : undefined}>
              <Input type="time" className="num" value={end} onChange={(e) => setEnd(e.target.value)} />
            </FormField>
            <FormField label="Break (min)">
              <Input
                className="num text-right"
                inputMode="numeric"
                value={brk}
                onChange={(e) => setBrk(e.target.value.replace(/\D/g, ""))}
              />
            </FormField>
          </div>
          <p className="text-2xs text-primary-300">
            Paid <span className="num font-semibold text-ink">{p !== null && p > 0 ? hm(p) : "—"}</span>
            {custom && templateId ? " · custom times" : ""}
          </p>
          {s?.conflicts.length ? (
            <ul
              className="flex flex-col gap-1.5 rounded-md border border-border bg-surface-50 px-3 py-2"
              data-testid="editor-conflicts"
            >
              {s.conflicts.map((c) => (
                <li key={c.kind} className="flex flex-col gap-0.5">
                  <ConflictTag c={c} />
                  <span className="text-2xs text-primary-300">{c.message}</span>
                </li>
              ))}
            </ul>
          ) : null}
          <FormField label="Note" hint="Shown to the employee. Up to 200 characters.">
            <Textarea rows={2} maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} />
          </FormField>
          {error ? (
            <p role="alert" className="text-ui text-danger-300">
              {error}
            </p>
          ) : null}
        </form>
        <DialogFooter className="flex-wrap gap-2 sm:justify-between">
          <div className="flex gap-2">
            {target.employeeId && s?.kind !== "rest" ? (
              <Button
                variant="ghost"
                size="sm"
                disabled={busy}
                onClick={() => onSave({ kind: "rest", templateId: null, note: null })}
              >
                <Moon aria-hidden /> Mark rest day
              </Button>
            ) : null}
            {onDelete ? (
              <Button variant="ghost" size="sm" disabled={busy} onClick={onDelete}>
                <Trash2 aria-hidden /> Remove
              </Button>
            ) : null}
          </div>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button variant="primary" type="submit" form="shift-form" disabled={busy || p === null || p <= 0}>
              {busy ? "Saving…" : "Save shift"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
