import {
  Button,
  cn,
  DatePicker,
  FormField,
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
  Skeleton,
  Textarea,
  toast,
} from "@crowhr/ui";
import { useMutation, useQuery } from "@tanstack/react-query";
import { AlertTriangle, Info, Paperclip, X } from "lucide-react";
import * as React from "react";
import { ApiError, apiGet, apiPost } from "../lib/api.ts";
import {
  ACCEPTED_TYPES,
  type Attachment,
  childrenQuery,
  fileToBase64,
  type LeaveRequest,
  type LeaveTypeView,
  MAX_FILE_BYTES,
  type Quote,
  quote,
  type Session,
  typesQuery,
  useLeaveInvalidate,
} from "./api.ts";
import { addDays, fmt, qty, todaySg, weekdayOf } from "./format.ts";

const FAMILY = new Set(["maternity", "paternity", "shared_parental", "adoption", "infant_care"]);
const OTHER = new Set(["ns", "no_pay"]);

function groupTypes(types: LeaveTypeView[]) {
  const common = types.filter((t) => !FAMILY.has(t.statutoryCode ?? "") && !OTHER.has(t.statutoryCode ?? ""));
  const family = types.filter((t) => FAMILY.has(t.statutoryCode ?? ""));
  const other = types.filter((t) => OTHER.has(t.statutoryCode ?? ""));
  return [
    { label: "Common", items: common },
    { label: "Family", items: family },
    { label: "Other", items: other },
  ].filter((g) => g.items.length);
}

interface DirectoryRow {
  id: string;
  name: string;
}

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "9 Nov". */
export const shortDate = (iso: string) => `${Number(iso.slice(8))} ${MON[Number(iso.slice(5, 7)) - 1]}`;

/** Today, or the Monday after when today is a weekend. */
function nextWeekday(iso: string): string {
  const dow = new Date(`${iso}T00:00:00Z`).getUTCDay();
  return dow === 6 ? addDays(iso, 2) : dow === 0 ? addDays(iso, 1) : iso;
}

/** Debounced value. */
function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = React.useState(value);
  React.useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}

/**
 * The apply-leave sheet (spec "Applying for leave"): type, dates, half days, child, reason and
 * attachment, with a live quote of the counted days and the balance after.
 */
export function ApplySheet({
  open,
  onOpenChange,
  onBehalf,
  onApplied,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Owners and HR admins may choose the employee. */
  onBehalf: boolean;
  onApplied?: (r: LeaveRequest) => void;
}) {
  const types = useQuery(typesQuery);
  const people = useQuery({
    queryKey: ["leave", "people"],
    queryFn: () => apiGet<{ items: DirectoryRow[] }>("/api/v1/employees?pageSize=200&sort=name&status=active,leaving"),
    enabled: open && onBehalf,
    staleTime: 5 * 60_000,
  });
  const today = nextWeekday(todaySg());
  const [employeeId, setEmployeeId] = React.useState<string | undefined>(undefined);
  const [typeId, setTypeId] = React.useState<string>("");
  const [start, setStart] = React.useState<string | null>(today);
  const [end, setEnd] = React.useState<string | null>(today);
  const [startSession, setStartSession] = React.useState<Session>("full");
  const [endSession, setEndSession] = React.useState<Session>("full");
  const [childId, setChildId] = React.useState<string>("");
  const [reason, setReason] = React.useState("");
  const [file, setFile] = React.useState<File | null>(null);
  const [fileError, setFileError] = React.useState<string | null>(null);
  const [serverErrors, setServerErrors] = React.useState<Record<string, string>>({});
  const invalidate = useLeaveInvalidate();

  const allTypes = (types.data?.items ?? []).filter((t) => !t.archived);
  const type = allTypes.find((t) => t.id === typeId);
  React.useEffect(() => {
    if (!typeId && allTypes.length) setTypeId(allTypes.find((t) => t.code === "annual")?.id ?? allTypes[0]?.id ?? "");
  }, [typeId, allTypes]);
  const children = useQuery({ ...childrenQuery(employeeId), enabled: open && !!type?.needsChild });
  const single = start !== null && start === end;
  const halfOk = type?.halfDays ?? false;

  // Keep sessions valid for the type and range.
  React.useEffect(() => {
    if (!halfOk) {
      setStartSession("full");
      setEndSession("full");
    }
  }, [halfOk]);
  React.useEffect(() => {
    if (!single && startSession === "am") setStartSession("full");
    if (!single && endSession === "pm") setEndSession("full");
  }, [single, startSession, endSession]);

  const input =
    type && start && end
      ? {
          employeeId,
          leaveTypeId: type.id,
          startDate: start,
          endDate: end,
          startSession,
          endSession: single ? startSession : endSession,
          childId: type.needsChild ? childId || null : null,
        }
      : null;
  const debounced = useDebounced(input, 250);
  const q = useQuery({
    queryKey: ["leave", "quote", debounced],
    queryFn: () => quote(debounced as NonNullable<typeof debounced>),
    enabled: open && !!debounced,
    retry: false,
  });
  const stale = JSON.stringify(input) !== JSON.stringify(debounced) || q.isFetching;

  const apply = useMutation({
    mutationFn: async () => {
      if (!input) throw new Error("Choose a type and dates.");
      const attachments: Attachment[] = file
        ? [{ filename: file.name, contentType: file.type, dataBase64: await fileToBase64(file) }]
        : [];
      return apiPost<LeaveRequest>("/api/v1/leave/requests", {
        ...input,
        reason: reason.trim() || null,
        ...(attachments.length ? { attachments } : {}),
      });
    },
    onSuccess: (r) => {
      invalidate();
      toast.success(`${r.type.name} requested: ${qty(r.quantity, r.unit)}. Your approver has been told.`);
      onApplied?.(r);
      reset();
      onOpenChange(false);
    },
    onError: (err) => {
      if (err instanceof ApiError) {
        setServerErrors(err.fieldErrors);
        toast.error(err.message);
      } else toast.error(err instanceof Error ? err.message : "That didn't work. Try again.");
    },
  });

  function reset() {
    setReason("");
    setFile(null);
    setFileError(null);
    setServerErrors({});
    setStartSession("full");
    setEndSession("full");
  }

  const onFile = (f: File | null) => {
    setFileError(null);
    if (!f) return setFile(null);
    if (f.size > MAX_FILE_BYTES) return setFileError("This file is larger than 5 MB. Take a smaller photo or a PDF.");
    if (!ACCEPTED_TYPES.includes(f.type)) return setFileError("Attach a PDF, JPEG, PNG, WebP or HEIC file.");
    setFile(f);
  };

  const quoteData: Quote | undefined = q.data;
  const needFile = type?.attachment === "required" && !file;
  const blocked = !quoteData?.ok || stale || needFile;
  const issueFor = (path: string) => quoteData?.issues.find((i) => i.path === path)?.message ?? serverErrors[path];

  return (
    <Sheet
      open={open}
      onOpenChange={(o) => {
        if (!o) reset();
        onOpenChange(o);
      }}
    >
      <SheetContent className="w-[min(36rem,100vw)] overflow-y-auto" aria-describedby="apply-desc">
        <form
          className="flex min-h-full flex-col"
          onSubmit={(e) => {
            e.preventDefault();
            if (!blocked) apply.mutate();
          }}
        >
          <div className="border-b border-border px-5 pb-4 pt-5">
            <SheetTitle className="font-azeret text-sm font-semibold">Apply for leave</SheetTitle>
            <SheetDescription id="apply-desc" className="mt-1 text-ui text-primary-300">
              Rest days, off days and public holidays are left out automatically.
            </SheetDescription>
          </div>
          <div className="flex flex-col gap-4 px-5 py-4">
            {onBehalf ? (
              <FormField label="Employee" hint="Leave blank for your own leave.">
                <Select value={employeeId ?? "me"} onValueChange={(v) => setEmployeeId(v === "me" ? undefined : v)}>
                  <SelectTrigger aria-label="Employee">
                    <SelectValue placeholder="Me" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="me">Me</SelectItem>
                    {(people.data?.items ?? []).map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FormField>
            ) : null}
            {types.isPending ? (
              <Skeleton className="h-9 w-full" />
            ) : (
              <FormField label="Leave type" required error={issueFor("leaveTypeId")}>
                <Select value={typeId} onValueChange={setTypeId}>
                  <SelectTrigger aria-label="Leave type">
                    <SelectValue placeholder="Choose a type" />
                  </SelectTrigger>
                  <SelectContent>
                    {groupTypes(allTypes).map((g) => (
                      <SelectGroup key={g.label}>
                        <SelectLabel>{g.label}</SelectLabel>
                        {g.items.map((t) => (
                          <SelectItem key={t.id} value={t.id}>
                            {t.name}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    ))}
                  </SelectContent>
                </Select>
              </FormField>
            )}
            <div className="grid grid-cols-2 gap-3">
              <FormField label="From" required error={issueFor("startDate")}>
                <DatePicker
                  value={start}
                  onChange={(v) => {
                    setStart(v);
                    if (v && (!end || end < v)) setEnd(v);
                  }}
                />
              </FormField>
              <FormField label="To" required error={issueFor("endDate")}>
                <DatePicker value={end} onChange={setEnd} />
              </FormField>
            </div>
            {halfOk ? (
              single ? (
                <FormField label="Day" error={issueFor("startSession")}>
                  <SessionPicker
                    value={startSession}
                    onChange={setStartSession}
                    options={[
                      ["full", "Full day"],
                      ["am", "Morning"],
                      ["pm", "Afternoon"],
                    ]}
                  />
                </FormField>
              ) : (
                <div className="grid grid-cols-2 gap-3">
                  <FormField label="First day" error={issueFor("startSession")}>
                    <SessionPicker
                      value={startSession}
                      onChange={setStartSession}
                      options={[
                        ["full", "Full day"],
                        ["pm", "From noon"],
                      ]}
                    />
                  </FormField>
                  <FormField label="Last day" error={issueFor("endSession")}>
                    <SessionPicker
                      value={endSession}
                      onChange={setEndSession}
                      options={[
                        ["full", "Full day"],
                        ["am", "To noon"],
                      ]}
                    />
                  </FormField>
                </div>
              )
            ) : null}
            {type?.needsChild ? (
              <FormField
                label="Child"
                required
                error={issueFor("childId")}
                hint={
                  children.data && children.data.items.length === 0
                    ? "No children recorded yet. Add them under My leave → Children."
                    : undefined
                }
              >
                <Select value={childId} onValueChange={setChildId}>
                  <SelectTrigger aria-label="Child">
                    <SelectValue placeholder="Choose the child" />
                  </SelectTrigger>
                  <SelectContent>
                    {(children.data?.items ?? []).map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FormField>
            ) : null}
            <FormField label="Reason" hint="Optional. Your approver sees it.">
              <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} maxLength={500} />
            </FormField>
            {type && type.attachment !== "none" ? (
              <FormField
                label={type.attachmentLabel ?? "Attachment"}
                required={type.attachment === "required"}
                error={fileError ?? serverErrors.attachments ?? serverErrors["attachments.0"]}
                hint="PDF or photo, up to 5 MB."
              >
                <FileInput file={file} onFile={onFile} />
              </FormField>
            ) : null}
          </div>
          <QuotePanel quote={quoteData} loading={q.isPending && !!debounced} stale={stale} error={q.error} />
          <div className="sticky bottom-0 mt-auto flex items-center justify-end gap-2 border-t border-border bg-background px-5 py-3">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={blocked || apply.isPending}>
              {apply.isPending ? "Sending…" : "Send for approval"}
            </Button>
          </div>
        </form>
      </SheetContent>
    </Sheet>
  );
}

function SessionPicker({
  value,
  onChange,
  options,
  ...aria
}: {
  value: Session;
  onChange: (s: Session) => void;
  options: [Session, string][];
  id?: string;
}) {
  return (
    <div role="radiogroup" className="flex rounded-md border border-ink/20 p-0.5" id={aria.id}>
      {options.map(([v, label]) => (
        // biome-ignore lint/a11y/useSemanticElements: a segmented control; radios would need hidden inputs.
        <button
          key={v}
          type="button"
          role="radio"
          aria-checked={value === v}
          onClick={() => onChange(v)}
          className={cn(
            "focus-ring h-8 flex-1 whitespace-nowrap rounded-sm px-1.5 font-azeret text-2xs font-semibold",
            value === v ? "bg-kuning-200 text-ink" : "text-primary-300 hover:bg-ink/5",
          )}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function FileInput({ file, onFile, ...aria }: { file: File | null; onFile: (f: File | null) => void; id?: string }) {
  const ref = React.useRef<HTMLInputElement>(null);
  return (
    <div className="flex items-center gap-2">
      <input
        ref={ref}
        id={aria.id}
        type="file"
        accept={ACCEPTED_TYPES.join(",")}
        className="sr-only"
        data-testid="attachment-input"
        onChange={(e) => onFile(e.target.files?.[0] ?? null)}
      />
      <Button type="button" size="sm" onClick={() => ref.current?.click()}>
        <Paperclip /> {file ? "Change file" : "Choose file"}
      </Button>
      {file ? (
        <span className="flex min-w-0 items-center gap-1 text-ui">
          <span className="truncate">{file.name}</span>
          <span className="num shrink-0 text-2xs text-primary-200">{Math.ceil(file.size / 1024)} KB</span>
          <button
            type="button"
            className="focus-ring rounded-sm p-0.5 text-primary-200 hover:text-ink"
            aria-label="Remove file"
            onClick={() => {
              onFile(null);
              if (ref.current) ref.current.value = "";
            }}
          >
            <X className="size-3.5" />
          </button>
        </span>
      ) : (
        <span className="text-ui text-primary-200">No file chosen</span>
      )}
    </div>
  );
}

/** The live count: quantity, balance before → after per leave year, each date and every issue. */
function QuotePanel({
  quote: q,
  loading,
  stale,
  error,
}: {
  quote: Quote | undefined;
  loading: boolean;
  stale: boolean;
  error: unknown;
}) {
  const [showDays, setShowDays] = React.useState(false);
  if (error && !q) {
    return (
      <div
        className="mx-5 mb-4 rounded-md border border-danger-200/40 bg-danger-50 p-3 text-ui text-danger-300"
        role="alert"
      >
        {error instanceof Error ? error.message : "Couldn't work out the days."}
      </div>
    );
  }
  if (loading || !q) {
    return (
      <div className="mx-5 mb-4 flex flex-col gap-2 rounded-md border border-border p-3" aria-busy="true">
        <Skeleton className="h-5 w-24" />
        <Skeleton className="h-4 w-48" />
      </div>
    );
  }
  const counted = q.days.filter((d) => d.quantity > 0);
  const skipped = q.days.filter((d) => d.quantity === 0 && d.note);
  return (
    <section
      aria-label="Days and balance"
      aria-live="polite"
      data-testid="leave-quote"
      className={cn("mx-5 mb-4 rounded-md border border-border bg-surface-50", stale && "opacity-60")}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border px-3 py-2.5">
        <span className="font-azeret text-2xs font-medium uppercase tracking-wider text-primary-200">This request</span>
        <span className="num text-lg font-semibold" data-testid="quote-quantity">
          {qty(q.quantity, q.unit)}
        </span>
      </div>
      {q.years.length ? (
        <table className="w-full text-ui">
          <caption className="sr-only">Balance before and after</caption>
          <thead>
            <tr className="text-2xs text-primary-200">
              <th className="px-3 py-1.5 text-left font-azeret font-medium">Year</th>
              <th className="px-3 py-1.5 text-right font-azeret font-medium">Taking</th>
              <th className="px-3 py-1.5 text-right font-azeret font-medium">Available</th>
              <th className="px-3 py-1.5 text-right font-azeret font-medium">After</th>
            </tr>
          </thead>
          <tbody>
            {q.years.map((y) => (
              <tr key={y.year} className="border-t border-border">
                <td className="num px-3 py-1.5">{y.year}</td>
                <td className="num px-3 py-1.5 text-right">{fmt(y.quantity)}</td>
                <td className="num px-3 py-1.5 text-right">{y.available === null ? "No limit" : fmt(y.available)}</td>
                <td
                  className={cn(
                    "num px-3 py-1.5 text-right font-semibold",
                    y.after !== null && y.after < 0 && "text-danger-300",
                  )}
                  data-testid="quote-after"
                >
                  {y.after === null ? "—" : fmt(y.after)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
      {q.issues.length ? (
        <ul className="flex flex-col gap-1 border-t border-border px-3 py-2" data-testid="quote-issues">
          {q.issues.map((i) => (
            <li key={`${i.path}-${i.message}`} className="flex gap-2 text-ui text-danger-300">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              {i.message}
            </li>
          ))}
        </ul>
      ) : null}
      {q.warnings.length ? (
        <ul className="flex flex-col gap-1 border-t border-border px-3 py-2">
          {q.warnings.map((w) => (
            <li key={w} className="flex gap-2 text-ui text-warning-400">
              <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              {w}
            </li>
          ))}
        </ul>
      ) : null}
      {q.days.length ? (
        <div className="border-t border-border px-3 py-2">
          <button
            type="button"
            className="focus-ring rounded-sm font-azeret text-2xs font-semibold text-biru-400 hover:underline"
            aria-expanded={showDays}
            onClick={() => setShowDays((s) => !s)}
          >
            {showDays
              ? "Hide dates"
              : `Show dates (${counted.length} counted${skipped.length ? `, ${skipped.length} not` : ""})`}
          </button>
          {showDays || q.days.length <= 7 ? (
            <ul className="mt-1.5 flex flex-col">
              {q.days.map((d) => (
                <li key={d.date} className="flex items-baseline justify-between gap-3 py-0.5 text-ui">
                  <span className="num whitespace-nowrap">
                    <span className="inline-block w-9 text-primary-200">{weekdayOf(d.date)}</span>
                    {shortDate(d.date)}
                    {d.session !== "full" ? (
                      <span className="ml-1 text-primary-200">{d.session.toUpperCase()}</span>
                    ) : null}
                  </span>
                  <span className={cn("truncate text-right", d.quantity ? "num" : "text-primary-200")}>
                    {d.quantity ? fmt(d.quantity) : (d.note ?? "—")}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
