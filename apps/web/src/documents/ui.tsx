import {
  Button,
  Checkbox,
  DatePicker,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  FormField,
  formatDate,
  Input,
  Pagination,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
  StatusPill,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Textarea,
  toast,
} from "@crowhr/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Download, Eye, FileText, Upload } from "lucide-react";
import * as React from "react";
import { ApiError, apiDelete, apiPost } from "../lib/api.ts";
import {
  type Block,
  categoriesQuery,
  type Doc,
  type DocCategory,
  errorText,
  fieldsQuery,
  fileHref,
  fileSize,
  LETTER_KIND_LABEL,
  sgDay,
  templatesQuery,
  uploadFile,
} from "./api.ts";
import { LetterPreview } from "./letter-preview.tsx";

export const invalidateDocuments = (qc: ReturnType<typeof useQueryClient>) =>
  qc.invalidateQueries({ queryKey: ["documents"] });

const dateTime = (iso: string) =>
  new Date(iso).toLocaleString("en-SG", {
    timeZone: "Asia/Singapore",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

export function ExpiryPill({ doc }: { doc: Pick<Doc, "expiry" | "expiresOn"> }) {
  if (!doc.expiry || !doc.expiresOn) return <span className="text-primary-200">—</span>;
  const tone = doc.expiry === "expired" ? "danger" : doc.expiry === "expiring" ? "warning" : "neutral";
  const label = doc.expiry === "expired" ? "Expired" : doc.expiry === "expiring" ? "Expiring" : "Valid";
  return (
    <span className="flex flex-wrap items-center gap-2">
      <StatusPill tone={tone}>{label}</StatusPill>
      <span className="num text-2xs text-primary-300">{formatDate(doc.expiresOn)}</span>
    </span>
  );
}

export function AckPill({ doc }: { doc: Doc }) {
  const a = doc.acknowledgement;
  if (!a) return null;
  if (a.status === "acknowledged" && a.current) return <StatusPill tone="success">Acknowledged</StatusPill>;
  if (a.status === "requested") return <StatusPill tone="info">To acknowledge</StatusPill>;
  return <StatusPill tone="warning">New version</StatusPill>;
}

/** Page controls under a document list, shown only when there is more than one page. */
export function DocumentsPager({
  list,
  page,
  onPage,
}: {
  list: { total: number; pageSize?: number } | undefined;
  page: number;
  onPage: (page: number) => void;
}) {
  if (!list?.pageSize || list.total <= list.pageSize) return null;
  return (
    <Pagination
      page={page}
      pageSize={list.pageSize}
      total={list.total}
      onPageChange={onPage}
      className="border-t border-border px-3"
    />
  );
}

/** Dense list of documents; click a row (or Enter) to open the detail sheet. */
export function DocumentTable({
  docs,
  onOpen,
  showEmployee = false,
  label,
}: {
  docs: Doc[];
  onOpen: (d: Doc) => void;
  showEmployee?: boolean;
  label: string;
}) {
  return (
    <div className="overflow-x-auto">
      <Table aria-label={label}>
        <TableHeader>
          <TableRow>
            <TableHead>Document</TableHead>
            {showEmployee ? <TableHead>Employee</TableHead> : null}
            <TableHead className="hidden sm:table-cell">Category</TableHead>
            <TableHead>Expiry</TableHead>
            <TableHead className="hidden md:table-cell">Added</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {docs.map((d) => (
            <TableRow
              key={d.id}
              tabIndex={0}
              className="cursor-pointer"
              onClick={() => onOpen(d)}
              onKeyDown={(e) => {
                if (e.key === "Enter") onOpen(d);
              }}
              data-testid="document-row"
            >
              <TableCell className="h-10 py-1.5">
                <span className="flex flex-wrap items-center gap-2">
                  <FileText className="size-4 shrink-0 text-primary-200" aria-hidden />
                  <span className="font-medium">{d.title}</span>
                  {d.source === "generated" ? (
                    <StatusPill tone="neutral" dot={false}>
                      Generated
                    </StatusPill>
                  ) : null}
                  <AckPill doc={d} />
                </span>
              </TableCell>
              {showEmployee ? <TableCell className="py-1.5">{d.employeeName}</TableCell> : null}
              <TableCell className="hidden py-1.5 text-primary-300 sm:table-cell">{d.category.name}</TableCell>
              <TableCell className="py-1.5">
                <ExpiryPill doc={d} />
              </TableCell>
              <TableCell className="num hidden py-1.5 text-primary-300 md:table-cell">{sgDay(d.createdAt)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

/** One document: open, acknowledge (employee), and the HR actions. */
export function DocumentSheet({ doc, onClose }: { doc: Doc | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [opened, setOpened] = React.useState(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset when another document opens.
  React.useEffect(() => setOpened(false), [doc?.id]);
  const ack = useMutation({
    mutationFn: (id: string) => apiPost<Doc>(`/api/v1/documents/${id}/acknowledge`),
    onSuccess: async () => {
      toast.success("Acknowledged. Thank you.");
      await invalidateDocuments(qc);
      await qc.invalidateQueries({ queryKey: ["inbox"] });
    },
    onError: (e) => toast.error(errorText(e)),
  });
  const requestAck = useMutation({
    mutationFn: (id: string) => apiPost<Doc>(`/api/v1/documents/${id}/acknowledgements`),
    onSuccess: async () => {
      toast.success("Acknowledgement requested. The employee sees it on Home.");
      await invalidateDocuments(qc);
    },
    onError: (e) => toast.error(errorText(e)),
  });
  const remove = useMutation({
    mutationFn: (id: string) => apiDelete(`/api/v1/documents/${id}?reason=${encodeURIComponent("Deleted by HR")}`),
    onSuccess: async () => {
      toast.success("Document deleted. An owner can still purge it permanently.");
      await invalidateDocuments(qc);
      onClose();
    },
    onError: (e) => toast.error(errorText(e)),
  });
  const replaceRef = React.useRef<HTMLInputElement>(null);
  const [replaceExpiry, setReplaceExpiry] = React.useState<string | null>(null);
  const replace = useMutation({
    mutationFn: async (file: File) =>
      uploadFile(`/api/v1/documents/${doc?.id}/versions`, file, replaceExpiry ? { expiresOn: replaceExpiry } : {}),
    onSuccess: async () => {
      toast.success("New version uploaded. The previous one is kept.");
      await invalidateDocuments(qc);
    },
    onError: (e) => toast.error(errorText(e)),
  });
  if (!doc) return null;
  const needsAck = doc.acknowledgement?.status === "requested" && doc.acknowledgement.current && !doc.canManage;
  const viewed = doc.viewed || opened;
  return (
    <Sheet open={!!doc} onOpenChange={(o) => (o ? null : onClose())}>
      <SheetContent className="gap-4 overflow-y-auto p-5 sm:w-[min(32rem,100vw)]" aria-describedby="doc-sheet-desc">
        <div className="pr-8">
          <SheetTitle className="font-azeret text-base font-semibold">{doc.title}</SheetTitle>
          <SheetDescription id="doc-sheet-desc" className="text-2xs text-primary-300">
            {doc.category.name} · {doc.employeeName}
          </SheetDescription>
        </div>
        <dl className="grid grid-cols-[8rem_1fr] gap-x-3 gap-y-2 text-ui">
          <dt className="text-primary-300">Expiry</dt>
          <dd>
            <ExpiryPill doc={doc} />
          </dd>
          <dt className="text-primary-300">File</dt>
          <dd className="truncate">
            {doc.current?.fileName ?? "—"}{" "}
            <span className="num text-2xs text-primary-300">{fileSize(doc.current?.sizeBytes ?? null)}</span>
          </dd>
          <dt className="text-primary-300">Version</dt>
          <dd className="num">{doc.current?.version ?? "—"}</dd>
          {doc.notes ? (
            <>
              <dt className="text-primary-300">Notes</dt>
              <dd>{doc.notes}</dd>
            </>
          ) : null}
          {doc.acknowledgement ? (
            <>
              <dt className="text-primary-300">Acknowledgement</dt>
              <dd data-testid="ack-status">
                {doc.acknowledgement.status === "acknowledged"
                  ? `Acknowledged ${dateTime(doc.acknowledgement.acknowledgedAt as string)}${doc.acknowledgement.current ? "" : " (an earlier version)"}`
                  : `Requested ${dateTime(doc.acknowledgement.requestedAt)}`}
                {doc.acknowledgement.fileSha256 ? (
                  <span className="num block truncate text-2xs text-primary-200" title={doc.acknowledgement.fileSha256}>
                    SHA-256 {doc.acknowledgement.fileSha256.slice(0, 16)}…
                  </span>
                ) : null}
              </dd>
            </>
          ) : null}
        </dl>
        <div className="flex flex-wrap gap-2">
          <Button asChild size="sm">
            <a
              href={fileHref(doc.id, { inline: true })}
              target="_blank"
              rel="noreferrer"
              onClick={() => setOpened(true)}
            >
              <Eye aria-hidden /> Open
            </a>
          </Button>
          <Button asChild size="sm" variant="ghost">
            <a href={fileHref(doc.id)} download onClick={() => setOpened(true)}>
              <Download aria-hidden /> Download
            </a>
          </Button>
        </div>
        {needsAck ? (
          <div className="rounded-md border border-ink/15 bg-surface-100 p-3">
            <p className="mb-2 text-ui">
              HR asked you to read this document and confirm you have. {viewed ? "" : "Open it first."}
            </p>
            <Button
              variant="primary"
              size="sm"
              disabled={!viewed || ack.isPending}
              onClick={() => ack.mutate(doc.id)}
              data-testid="acknowledge"
            >
              <CheckCircle2 aria-hidden /> I acknowledge
            </Button>
            <p className="mt-2 text-2xs text-primary-300">
              We record the time, your device and a fingerprint of the exact file. Acknowledging is not a signature.
            </p>
          </div>
        ) : null}
        {doc.canManage ? (
          <section className="flex flex-col gap-3 border-t border-ink/10 pt-4" aria-label="HR actions">
            <div className="flex flex-wrap gap-2">
              <Button size="sm" onClick={() => requestAck.mutate(doc.id)} disabled={requestAck.isPending}>
                Request acknowledgement
              </Button>
              <Button size="sm" variant="ghost" onClick={() => remove.mutate(doc.id)} disabled={remove.isPending}>
                Delete
              </Button>
            </div>
            <div className="flex flex-wrap items-end gap-2">
              <FormField label="New expiry (optional)">
                <DatePicker value={replaceExpiry} onChange={setReplaceExpiry} className="w-40" />
              </FormField>
              <Button size="sm" onClick={() => replaceRef.current?.click()} disabled={replace.isPending}>
                <Upload aria-hidden /> Replace file
              </Button>
              <input
                ref={replaceRef}
                type="file"
                className="hidden"
                accept=".pdf,.jpg,.jpeg,.png,.webp,.docx,.xlsx"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) replace.mutate(f);
                  e.target.value = "";
                }}
              />
            </div>
            {doc.previousVersions.length ? (
              <details>
                <summary className="cursor-pointer text-ui">Previous versions ({doc.previousVersions.length})</summary>
                <ul className="mt-2 flex flex-col gap-1 text-ui">
                  {doc.previousVersions.map((v) => (
                    <li key={v.id} className="flex items-center justify-between gap-2">
                      <span className="num text-2xs">
                        v{v.version} · {sgDay(v.createdAt)}
                        {v.expiresOn ? ` · expires ${formatDate(v.expiresOn)}` : ""}
                      </span>
                      <a className="text-biru-400 underline" href={fileHref(doc.id, { version: v.id })} download>
                        Download
                      </a>
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
          </section>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

/** Upload for an employee. Employees see only their own employee-uploadable categories. */
export function UploadDialog({
  open,
  onOpenChange,
  employeeId,
  self,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  employeeId: string;
  self: boolean;
}) {
  const qc = useQueryClient();
  const cats = useQuery(categoriesQuery);
  const options = (cats.data?.items ?? []).filter((c) => !self || c.employeeUploadable);
  const [categoryId, setCategoryId] = React.useState("");
  const [title, setTitle] = React.useState("");
  const [expiresOn, setExpiresOn] = React.useState<string | null>(null);
  const [file, setFile] = React.useState<File | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const category = options.find((c) => c.id === categoryId);
  const save = useMutation({
    mutationFn: () =>
      uploadFile("/api/v1/documents/upload", file as File, {
        employeeId,
        categoryId,
        title,
        ...(expiresOn ? { expiresOn } : {}),
      }),
    onSuccess: async () => {
      toast.success("Document uploaded");
      await invalidateDocuments(qc);
      onOpenChange(false);
      setTitle("");
      setFile(null);
      setExpiresOn(null);
    },
    onError: (e) => setError(errorText(e)),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent aria-describedby="upload-desc">
        <DialogHeader>
          <DialogTitle>Upload a document</DialogTitle>
          <DialogDescription id="upload-desc">PDF, JPEG, PNG, WebP, DOCX or XLSX, up to 20 MB.</DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            setError(null);
            save.mutate();
          }}
        >
          <FormField label="Category" required>
            <Select value={categoryId} onValueChange={setCategoryId}>
              <SelectTrigger aria-label="Category">
                <SelectValue placeholder="Pick a category" />
              </SelectTrigger>
              <SelectContent>
                {options.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>
          <FormField label="Title" required>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} />
          </FormField>
          <FormField
            label="Expiry date"
            required={category?.expiryRequired}
            hint="For passes, licences and certificates."
          >
            <DatePicker value={expiresOn} onChange={setExpiresOn} />
          </FormField>
          <FormField label="File" required>
            <Input
              type="file"
              accept=".pdf,.jpg,.jpeg,.png,.webp,.docx,.xlsx"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </FormField>
          {error ? (
            <p role="alert" className="text-ui text-danger-300">
              {error}
            </p>
          ) : null}
          <DialogFooter>
            <Button type="submit" variant="primary" disabled={!file || !categoryId || !title.trim() || save.isPending}>
              Upload
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

interface GenerateResult {
  documentId: string | null;
  missing: { id: string; label: string; where: string }[];
  values: Record<string, string>;
  blocks: Block[];
}

/**
 * Generate a letter: pick a template, preview it as at a date, fill any values the record doesn't
 * hold (kept on this document only), then generate and optionally ask for an acknowledgement.
 */
export function GenerateDialog({
  open,
  onOpenChange,
  employeeId,
  defaultKind,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  employeeId: string;
  defaultKind?: string;
}) {
  const qc = useQueryClient();
  const templates = useQuery({ ...templatesQuery, enabled: open });
  const fields = useQuery({ ...fieldsQuery, enabled: open });
  const cats = useQuery({ ...categoriesQuery, enabled: open });
  const active = (templates.data?.items ?? []).filter((t) => t.active);
  const [templateId, setTemplateId] = React.useState("");
  React.useEffect(() => {
    if (!templateId && active.length) {
      setTemplateId((active.find((t) => t.kind === defaultKind) ?? active[0])?.id ?? "");
    }
  }, [active, templateId, defaultKind]);
  const [asAt, setAsAt] = React.useState<string | null>(null);
  const [overrides, setOverrides] = React.useState<Record<string, string>>({});
  const [ackRequest, setAckRequest] = React.useState(true);
  const [preview, setPreview] = React.useState<GenerateResult | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  // A letter filed in a category the employee can't see can't be acknowledged by them (the server refuses).
  const targetCategory = cats.data?.items.find(
    (c) => c.id === active.find((t) => t.id === templateId)?.targetCategoryId,
  );
  const hiddenFromEmployee = !!targetCategory && !targetCategory.employeeVisible;
  const body = (dryRun: boolean) => ({
    templateId,
    employeeId,
    ...(asAt ? { asAt } : {}),
    overrides: Object.fromEntries(Object.entries(overrides).filter(([, v]) => v.trim())),
    requestAcknowledgement: ackRequest && !hiddenFromEmployee,
    dryRun,
  });
  const run = useMutation({
    mutationFn: (dryRun: boolean) => apiPost<GenerateResult>("/api/v1/documents/generate", body(dryRun)),
    onSuccess: async (r, dryRun) => {
      setError(null);
      setPreview(r);
      if (!dryRun) {
        toast.success(
          ackRequest && !hiddenFromEmployee ? "Letter generated and sent for acknowledgement" : "Letter generated",
        );
        await invalidateDocuments(qc);
        onOpenChange(false);
        setPreview(null);
        setOverrides({});
      }
    },
    onError: (e) => {
      if (e instanceof ApiError && e.code === "missing_fields") void run.mutate(true);
      setError(errorText(e));
    },
  });
  // Preview whenever the template or date changes.
  // biome-ignore lint/correctness/useExhaustiveDependencies: preview on template/date change only.
  React.useEffect(() => {
    if (open && templateId) run.mutate(true);
  }, [open, templateId, asAt]);
  const label = (id: string) => fields.data?.items.find((f) => f.id === id)?.label ?? id;
  const missing = preview?.missing ?? [];
  const template = active.find((t) => t.id === templateId);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-3xl" aria-describedby="generate-desc">
        <DialogHeader>
          <DialogTitle>Generate a letter</DialogTitle>
          <DialogDescription id="generate-desc">
            Merge fields come from the employee's record as at the date. Values you enter here are kept on this document
            only.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 md:grid-cols-[minmax(0,18rem)_1fr]">
          <div className="flex flex-col gap-3">
            <FormField label="Template">
              <Select value={templateId} onValueChange={(v) => setTemplateId(v)}>
                <SelectTrigger aria-label="Template">
                  <SelectValue placeholder="Pick a template" />
                </SelectTrigger>
                <SelectContent>
                  {active.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
            {template ? (
              <p className="text-2xs text-primary-300">
                {LETTER_KIND_LABEL[template.kind] ?? template.kind} · version {template.version}
                {template.usesSalary ? " · uses salary fields (payroll admin or owner)" : ""}
              </p>
            ) : null}
            <FormField label="As at" hint="Defaults to today.">
              <DatePicker value={asAt} onChange={setAsAt} />
            </FormField>
            {missing.length ? (
              <fieldset
                className="flex flex-col gap-3 rounded-md border border-warning-300/50 bg-warning-50 p-3"
                data-testid="missing-fields"
              >
                <legend className="px-1 font-azeret text-2xs font-semibold uppercase tracking-wider">
                  Fill in before generating ({missing.length})
                </legend>
                {missing.map((m) => (
                  <FormField
                    key={m.id}
                    label={label(m.id)}
                    hint={m.where ? `${m.where.charAt(0).toUpperCase()}${m.where.slice(1)}.` : undefined}
                  >
                    <Textarea
                      rows={2}
                      className="min-h-0"
                      value={overrides[m.id] ?? ""}
                      onChange={(e) => setOverrides((o) => ({ ...o, [m.id]: e.target.value }))}
                    />
                  </FormField>
                ))}
                <Button size="sm" onClick={() => run.mutate(true)} disabled={run.isPending}>
                  Update preview
                </Button>
              </fieldset>
            ) : null}
            <div className="flex flex-col gap-1 text-ui">
              <div className="flex items-center gap-2">
                <Checkbox
                  id="generate-ack"
                  checked={ackRequest && !hiddenFromEmployee}
                  disabled={hiddenFromEmployee}
                  aria-describedby={hiddenFromEmployee ? "generate-ack-note" : undefined}
                  onCheckedChange={(v) => setAckRequest(!!v)}
                />
                <label htmlFor="generate-ack">Ask the employee to acknowledge it</label>
              </div>
              {hiddenFromEmployee ? (
                <p id="generate-ack-note" className="text-2xs text-primary-300">
                  This template files into {targetCategory?.name}, which employees can't see, so they can't acknowledge
                  it. Change who sees that category in Settings → Documents.
                </p>
              ) : null}
            </div>
            {error ? (
              <p role="alert" className="text-ui text-danger-300">
                {error}
              </p>
            ) : null}
          </div>
          <div className="min-h-[16rem] rounded-md border border-ink/10 bg-surface-50 p-4">
            {preview ? (
              <LetterPreview blocks={preview.blocks} />
            ) : (
              <p className="text-ui text-primary-300">Pick a template to preview the letter.</p>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button
            variant="primary"
            disabled={!templateId || run.isPending || missing.some((m) => !overrides[m.id]?.trim())}
            onClick={() => run.mutate(false)}
            data-testid="generate"
          >
            Generate PDF
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function RequestLetterDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const [purpose, setPurpose] = React.useState("");
  const send = useMutation({
    mutationFn: () => apiPost("/api/v1/documents/requests", { kind: "employment_certificate", purpose }),
    onSuccess: async () => {
      toast.success("Request sent to HR. The letter appears here once they approve it.");
      await invalidateDocuments(qc);
      onOpenChange(false);
      setPurpose("");
    },
    onError: (e) => toast.error(errorText(e)),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent aria-describedby="request-desc">
        <DialogHeader>
          <DialogTitle>Request an employment letter</DialogTitle>
          <DialogDescription id="request-desc">
            HR approves the request and the letter is generated from your employment record.
          </DialogDescription>
        </DialogHeader>
        <FormField label="What is it for?" required hint="For example a visa application or a bank loan.">
          <Input value={purpose} onChange={(e) => setPurpose(e.target.value)} maxLength={200} />
        </FormField>
        <DialogFooter>
          <Button variant="primary" disabled={!purpose.trim() || send.isPending} onClick={() => send.mutate()}>
            Send request
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function DocumentsEmpty({ title, description }: { title: string; description: string }) {
  return <EmptyState variant="plain" icon={<FileText />} title={title} description={description} />;
}

export type { DocCategory };
