import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  cn,
  StatusPill,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@crowhr/ui";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { AlertTriangle, CheckCircle2, Download, FileUp, RotateCcw } from "lucide-react";
import * as React from "react";
import { PageHeader } from "../../../components/page-header.tsx";
import { api, errorMessage, type ImportPreviewDto, invalidatePeople } from "./-lib/api.ts";

type Kind = "employees" | "compensation" | "ytd";

const KINDS: { kind: Kind; title: string; body: string; who: string }[] = [
  {
    kind: "employees",
    title: "Employees",
    body: "New hires and everyone moving from a spreadsheet: identity, job and optionally pay.",
    who: "HR admins",
  },
  {
    kind: "compensation",
    title: "Pay changes",
    body: "Basic pay from a date for existing employees, e.g. annual increments.",
    who: "Payroll admins",
  },
  {
    kind: "ytd",
    title: "Year-to-date balances",
    body: "OW, AW, CPF and SHG paid this year in your previous system, so CPF ceilings stay right.",
    who: "Payroll admins",
  },
];

export const Route = createFileRoute("/_app/people/import")({ component: ImportPage });

const MAX_BYTES = 5 * 1024 * 1024;

function ImportPage() {
  const qc = useQueryClient();
  const [kind, setKind] = React.useState<Kind>("employees");
  const [fileName, setFileName] = React.useState<string | null>(null);
  const [localError, setLocalError] = React.useState<string | null>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);

  const preview = useMutation({
    mutationFn: (file: { name: string; content: string }) =>
      api<ImportPreviewDto>("POST", `/people/imports/${kind}/preview`, { fileName: file.name, content: file.content }),
  });
  const commit = useMutation({
    mutationFn: (jobId: string) => api<ImportPreviewDto>("POST", `/people/imports/${jobId}/commit`),
    onSuccess: () => invalidatePeople(qc),
  });

  const onFile = async (file: File | undefined) => {
    setLocalError(null);
    commit.reset();
    if (!file) return;
    if (file.size > MAX_BYTES) {
      setLocalError("The file is larger than 5 MB. Split it into smaller files and import each.");
      return;
    }
    setFileName(file.name);
    preview.mutate({ name: file.name, content: await file.text() });
  };

  const reset = () => {
    preview.reset();
    commit.reset();
    setFileName(null);
    if (inputRef.current) inputRef.current.value = "";
  };

  const step = commit.isSuccess ? 3 : preview.data ? 2 : 1;
  const p = preview.data;

  return (
    <>
      <PageHeader
        crumbs={[{ label: "People", to: "/people" }]}
        title="Import from CSV"
        description="Nothing is saved until you confirm. Every row is checked with the same rules as the forms, then all rows go in together or none do."
      />
      <ol className="mb-6 flex flex-wrap gap-2 font-azeret text-2xs uppercase tracking-wider" aria-label="Steps">
        {["Choose and upload", "Check the preview", "Done"].map((s, i) => (
          <li
            key={s}
            aria-current={step === i + 1 ? "step" : undefined}
            className={cn(
              "rounded-md border px-2.5 py-1",
              step === i + 1
                ? "border-ink bg-kuning-200 text-ink"
                : step > i + 1
                  ? "border-border text-primary-300"
                  : "border-border text-primary-200",
            )}
          >
            <span className="num">{i + 1}</span> · {s}
          </li>
        ))}
      </ol>

      {step === 1 ? (
        <div className="flex max-w-4xl flex-col gap-5">
          <fieldset className="grid gap-3 sm:grid-cols-3">
            <legend className="mb-2 font-azeret text-2xs font-semibold uppercase tracking-wider">
              What are you importing?
            </legend>
            {KINDS.map((k) => (
              <label
                key={k.kind}
                className={cn(
                  "focus-within:ring-2 focus-within:ring-biru-300 flex cursor-pointer flex-col gap-1 rounded-lg border bg-surface-50 p-4",
                  kind === k.kind ? "border-ink" : "border-border hover:border-ink/40",
                )}
              >
                <span className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="kind"
                    value={k.kind}
                    checked={kind === k.kind}
                    onChange={() => setKind(k.kind)}
                  />
                  <span className="font-azeret text-xs font-semibold">{k.title}</span>
                </span>
                <span className="text-ui text-primary-300">{k.body}</span>
                <span className="text-2xs text-primary-200">{k.who}</span>
              </label>
            ))}
          </fieldset>
          <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface-50 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="font-medium">1. Start from the template</p>
              <p className="text-ui text-primary-300">
                One column per field, with an example row. Dates as YYYY-MM-DD or DD/MM/YYYY; money in dollars.
              </p>
            </div>
            <Button asChild size="sm">
              <a href={`/api/v1/people/imports/templates/${kind}`} download>
                <Download aria-hidden /> Download template
              </a>
            </Button>
          </div>
          <div className="flex flex-col gap-3 rounded-lg border border-dashed border-ink/30 bg-surface-50 p-6">
            <p className="font-medium">2. Upload the filled-in CSV</p>
            <p className="text-ui text-primary-300">
              UTF-8 CSV, at most 5 MB and 2,000 rows. In Excel: File → Save As → CSV UTF-8.
            </p>
            <div>
              <input
                ref={inputRef}
                id="import-file"
                type="file"
                accept=".csv,text/csv"
                className="sr-only"
                onChange={(e) => void onFile(e.target.files?.[0])}
              />
              <Button asChild variant="primary" disabled={preview.isPending}>
                <label htmlFor="import-file" className="cursor-pointer">
                  <FileUp aria-hidden /> {preview.isPending ? `Checking ${fileName ?? "file"}…` : "Choose CSV file"}
                </label>
              </Button>
            </div>
            {localError || preview.isError ? (
              <Alert variant="danger">
                <AlertTriangle aria-hidden />
                <div>
                  <AlertTitle>That file can't be read</AlertTitle>
                  <AlertDescription>{localError ?? errorMessage(preview.error)}</AlertDescription>
                </div>
              </Alert>
            ) : null}
          </div>
        </div>
      ) : null}

      {step === 2 && p ? (
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-ui text-primary-300">{p.fileName}</p>
              <p className="text-lg font-semibold">
                <span className="num">{p.validRows}</span> of <span className="num">{p.totalRows}</span> rows ready
                {p.errors.length ? (
                  <>
                    {" "}
                    · <span className="num text-danger-300">{p.errors.length}</span>{" "}
                    {p.errors.length === 1 ? "problem" : "problems"} to fix
                  </>
                ) : null}
              </p>
            </div>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={reset}>
                <RotateCcw aria-hidden /> Upload a fixed file
              </Button>
              <Button
                variant="primary"
                disabled={!p.canCommit || commit.isPending}
                onClick={() => commit.mutate(p.jobId)}
              >
                {commit.isPending
                  ? "Importing…"
                  : p.canCommit
                    ? `Import ${p.validRows} ${p.validRows === 1 ? "row" : "rows"}`
                    : "Import"}
              </Button>
            </div>
          </div>
          {!p.canCommit && p.errors.length ? (
            <Alert variant="warning">
              <AlertTriangle aria-hidden />
              <div>
                <AlertTitle>Fix these in the spreadsheet, then upload it again</AlertTitle>
                <AlertDescription>
                  Nothing has been imported. Import is all or nothing, so every row must pass first.
                </AlertDescription>
              </div>
            </Alert>
          ) : null}
          {commit.isError ? (
            <Alert variant="danger">
              <AlertTriangle aria-hidden />
              <div>
                <AlertTitle>Nothing was imported</AlertTitle>
                <AlertDescription>{errorMessage(commit.error)}</AlertDescription>
              </div>
            </Alert>
          ) : null}
          {p.errors.length ? (
            <Table aria-label="Problems in the file">
              <TableHeader>
                <TableRow>
                  <TableHead numeric className="w-16">
                    Row
                  </TableHead>
                  <TableHead className="w-48">Column</TableHead>
                  <TableHead className="w-40">Value</TableHead>
                  <TableHead>How to fix</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {p.errors.map((e) => (
                  <TableRow key={`${e.row}-${e.column}-${e.message}`}>
                    <TableCell numeric>{e.row}</TableCell>
                    <TableCell className="font-azeret text-2xs">{e.column}</TableCell>
                    <TableCell className="num truncate">
                      {e.value || <span className="text-primary-200">(empty)</span>}
                    </TableCell>
                    <TableCell>{e.message}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : null}
          <Table aria-label="Rows in the file">
            <TableHeader>
              <TableRow>
                <TableHead numeric className="w-16">
                  Row
                </TableHead>
                <TableHead>Will create</TableHead>
                <TableHead className="w-32">Check</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {p.rows.slice(0, 200).map((r) => (
                <TableRow key={r.row}>
                  <TableCell numeric>{r.row}</TableCell>
                  <TableCell>{r.summary}</TableCell>
                  <TableCell>
                    <StatusPill tone={r.valid ? "success" : "danger"}>{r.valid ? "Ready" : "Needs a fix"}</StatusPill>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {p.rows.length > 200 ? <p className="text-2xs text-primary-200">Showing the first 200 rows.</p> : null}
        </div>
      ) : null}

      {step === 3 && commit.data ? (
        <Alert variant="success" className="max-w-2xl">
          <CheckCircle2 aria-hidden />
          <div className="flex flex-col gap-2">
            <AlertTitle>
              Imported <span className="num">{commit.data.totalRows}</span>{" "}
              {commit.data.totalRows === 1 ? "row" : "rows"}
            </AlertTitle>
            <AlertDescription>
              {kind === "employees"
                ? "Onboarding checklists were created and invitations queued for work emails."
                : "The changes are in each employee's history."}
            </AlertDescription>
            <div className="flex gap-2">
              <Button asChild size="sm" variant="primary">
                <Link to="/people">Go to People</Link>
              </Button>
              <Button size="sm" variant="ghost" onClick={reset}>
                Import another file
              </Button>
            </div>
          </div>
        </Alert>
      ) : null}
    </>
  );
}
