import type { PayrollOverviewDto, PayrollRowDto } from "@crowhr/core";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Card,
  cn,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  FormField,
  formatDate,
  formatMoney,
  Input,
  Kbd,
  Skeleton,
  Textarea,
  toast,
} from "@crowhr/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { AlertOctagon, CheckCircle2, Download, FileText, RotateCcw, Search, Send } from "lucide-react";
import * as React from "react";
import { useReauth } from "../../../auth/reauth.tsx";
import { PageHeader } from "../../../components/page-header.tsx";
import { ErrorNote } from "../../../components/section.tsx";
import {
  decide,
  downloadFile,
  type Excluded,
  errorMessage,
  invalidateRun,
  monthName,
  myRunTaskQuery,
  reopen,
  runAction,
  runQuery,
  runTitle,
} from "./-lib/api.ts";
import { EmployeeDrawer } from "./-lib/drawer.tsx";
import { Flags, IssueList, Money, RunStatusPill } from "./-lib/ui.tsx";

export const Route = createFileRoute("/_app/payroll/runs/$runId")({
  validateSearch: (s: Record<string, unknown>): { employee?: string } =>
    typeof s.employee === "string" ? { employee: s.employee } : {},
  component: RunPage,
});

function RunPage() {
  const { runId } = Route.useParams();
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const q = useQuery(runQuery(runId));
  const openEmployee = (employeeId: string | undefined) =>
    void navigate({ search: (s) => ({ ...s, employee: employeeId }), replace: true });

  if (q.isPending) {
    return (
      <div role="status" aria-label="Loading payroll run" className="flex flex-col gap-4">
        <Skeleton className="h-6 w-64" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-80 w-full" />
      </div>
    );
  }
  if (q.isError) {
    return (
      <Card>
        <ErrorNote error={q.error} retry={() => void q.refetch()} />
      </Card>
    );
  }
  const o = q.data;
  return (
    <>
      <RunHeader o={o} />
      <IssuesPanel o={o} onEmployee={openEmployee} />
      <TotalsCard o={o} />
      <ChangesPanel o={o} onEmployee={openEmployee} />
      <ReviewTable o={o} onOpen={openEmployee} />
      <EmployeeDrawer
        runId={runId}
        run={o.run}
        rows={o.rows}
        employeeId={search.employee ?? null}
        onNavigate={openEmployee}
      />
    </>
  );
}

function RunHeader({ o }: { o: PayrollOverviewDto }) {
  const { run } = o;
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [dialog, setDialog] = React.useState<null | "reject" | "reopen">(null);
  const act = useMutation({
    mutationFn: (fn: () => Promise<unknown>) => fn(),
    onSuccess: () => invalidateRun(qc, run.id),
    onError: (e) => toast.error(errorMessage(e)),
  });
  const myTask = useQuery(myRunTaskQuery(run.status === "in_review" ? run.approvalRequestId : null));
  const taskId = myTask.data?.taskId ?? null;
  const blocking = o.issues.filter((i) => i.severity === "blocking").length;
  const computed = !!run.computedAt;
  const busy = act.isPending;
  const actions: React.ReactNode[] = [];
  if (run.status === "draft") {
    actions.push(
      <Button
        key="compute"
        size="sm"
        disabled={busy}
        onClick={() =>
          act.mutate(() => runAction(run.id, "compute").then(() => toast.success("Computed from the current records")))
        }
      >
        <RotateCcw aria-hidden /> {computed ? "Recompute" : "Compute"}
      </Button>,
      <Button
        key="submit"
        variant="primary"
        size="sm"
        disabled={busy || !computed || blocking > 0}
        title={!computed ? "Compute the run first" : blocking ? "Resolve the blocking issues first" : undefined}
        onClick={() =>
          act.mutate(() => runAction(run.id, "submit").then(() => toast.success("Submitted for approval")))
        }
      >
        <Send aria-hidden /> Submit for approval
      </Button>,
    );
  }
  if (run.status === "in_review") {
    actions.push(
      <Button
        key="withdraw"
        variant="ghost"
        size="sm"
        disabled={busy}
        onClick={() => act.mutate(() => runAction(run.id, "withdraw"))}
      >
        Withdraw
      </Button>,
      ...(taskId
        ? [
            <Button key="reject" size="sm" disabled={busy} onClick={() => setDialog("reject")}>
              Reject
            </Button>,
            <Button
              key="approve"
              variant="primary"
              size="sm"
              disabled={busy}
              onClick={() =>
                act.mutate(() =>
                  decide(taskId, "approved").then(async () => {
                    await qc.invalidateQueries({ queryKey: ["approvals"] });
                    toast.success("Run approved");
                  }),
                )
              }
            >
              <CheckCircle2 aria-hidden /> Approve
            </Button>,
          ]
        : [
            <span key="waiting" className="self-center text-2xs text-primary-300">
              Waiting for the approver (an owner by default). It is in their Inbox.
            </span>,
          ]),
    );
  }
  if (run.status === "approved" || run.status === "paid") {
    if (!run.supersededByRunId) {
      actions.push(
        <Button key="reopen" variant="ghost" size="sm" disabled={busy} onClick={() => setDialog("reopen")}>
          Reopen
        </Button>,
      );
    }
    if (run.status === "approved") {
      actions.push(
        <Button
          key="paid"
          size="sm"
          disabled={busy}
          onClick={() => act.mutate(() => runAction(run.id, "mark-paid").then(() => toast.success("Marked paid")))}
        >
          Mark paid
        </Button>,
      );
    }
    if (!run.releasedAt) {
      actions.push(
        <Button
          key="release"
          variant="primary"
          size="sm"
          disabled={busy}
          onClick={() =>
            act.mutate(() => runAction(run.id, "release").then(() => toast.success("Payslips released to employees")))
          }
        >
          <FileText aria-hidden /> Release payslips
        </Button>,
      );
    }
  }
  const kindNote =
    run.kind === "adjustment"
      ? `Adjustment of ${o.adjustment ? monthName(o.adjustment.ofMonth) : "an earlier run"}: ${run.reopenReason ?? ""}`
      : run.kind === "off_cycle"
        ? run.offCycleReason === "final_pay"
          ? "Off-cycle final pay"
          : "Off-cycle bonus run: one-off items only"
        : null;
  return (
    <>
      <PageHeader
        crumbs={[{ label: "Payroll", to: "/payroll" }]}
        title={
          <span className="flex flex-wrap items-center gap-2.5">
            {runTitle(run)}
            <RunStatusPill status={run.status} superseded={!!run.supersededByRunId} />
            {run.releasedAt ? (
              <span className="font-azeret text-2xs uppercase tracking-wide text-primary-200">Payslips released</span>
            ) : null}
          </span>
        }
        description={
          <>
            Pay date <span className="num">{formatDate(run.payDate)}</span> · period{" "}
            <span className="num">
              {formatDate(run.periodStart)} – {formatDate(run.periodEnd)}
            </span>
            {kindNote ? <span className="block">{kindNote}</span> : null}
            {run.decisionComment && run.status === "draft" ? (
              <span className="block text-danger-300">Returned by the approver: “{run.decisionComment}”</span>
            ) : null}
            {run.supersededByRunId ? (
              <span className="block">
                Corrected by{" "}
                <Link
                  to="/payroll/runs/$runId"
                  params={{ runId: run.supersededByRunId }}
                  className="text-biru-400 hover:underline"
                >
                  a later adjustment
                </Link>
                ; these figures are kept as they were paid.
              </span>
            ) : null}
          </>
        }
        actions={actions.length ? actions : undefined}
      />
      <ReasonDialog
        open={dialog === "reject"}
        title="Reject this run"
        description="It goes back to draft with your comment, so the preparer knows what to fix."
        label="What needs fixing"
        confirm="Reject run"
        onClose={() => setDialog(null)}
        onConfirm={(reason) =>
          act
            .mutateAsync(() => decide(taskId as string, "rejected", reason))
            .then(async () => {
              await qc.invalidateQueries({ queryKey: ["approvals"] });
              setDialog(null);
            })
        }
      />
      <ReasonDialog
        open={dialog === "reopen"}
        title="Reopen as an adjustment"
        description="A new adjustment run starts from this run's items. This run's figures, payslips and files never change; employees get a revised payslip showing what is still payable."
        label="Reason (kept in the audit log)"
        confirm="Create adjustment"
        onClose={() => setDialog(null)}
        onConfirm={(reason) =>
          reopen(run.id, reason)
            .then(async (adj) => {
              await invalidateRun(qc, run.id);
              setDialog(null);
              void navigate({ to: "/payroll/runs/$runId", params: { runId: adj.id } });
            })
            .catch((e) => {
              toast.error(errorMessage(e));
            })
        }
      />
    </>
  );
}

function ReasonDialog(props: {
  open: boolean;
  title: string;
  description: string;
  label: string;
  confirm: string;
  onClose: () => void;
  onConfirm: (reason: string) => Promise<unknown>;
}) {
  const [text, setText] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  return (
    <Dialog open={props.open} onOpenChange={(o) => !o && props.onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{props.title}</DialogTitle>
          <DialogDescription>{props.description}</DialogDescription>
        </DialogHeader>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            try {
              await props.onConfirm(text);
              setText("");
            } finally {
              setBusy(false);
            }
          }}
          className="flex flex-col gap-3"
        >
          <FormField label={props.label} required>
            <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} />
          </FormField>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={props.onClose}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={busy || !text.trim()}>
              {props.confirm}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function IssuesPanel({ o, onEmployee }: { o: PayrollOverviewDto; onEmployee: (id: string) => void }) {
  if (!o.run.computedAt) {
    return (
      <Alert className="mb-5">
        <AlertOctagon aria-hidden />
        <div>
          <AlertTitle>Not computed yet</AlertTitle>
          <AlertDescription>
            Compute the run to read basic pay, allowances and CPF details from People and apply this run's items.
          </AlertDescription>
        </div>
      </Alert>
    );
  }
  const blocking = o.issues.filter((i) => i.severity === "blocking");
  const warnings = o.issues.filter((i) => i.severity === "warning");
  const stale = o.run.inputsChangedSinceCompute ? (
    <Alert variant="warning" className="mb-3">
      <RotateCcw aria-hidden />
      <div>
        <AlertTitle>Items changed since the last computation</AlertTitle>
        <AlertDescription>The figures below are from before the change. Recompute to apply it.</AlertDescription>
      </div>
    </Alert>
  ) : null;
  if (!blocking.length && !warnings.length) {
    return (
      <>
        {stale}
        <p className="mb-5 flex items-center gap-2 text-ui text-success-400">
          <CheckCircle2 className="size-4" aria-hidden /> No issues. Every employee computed without warnings.
        </p>
      </>
    );
  }
  return (
    <section aria-labelledby="issues-title" className="mb-5">
      {stale}
      <h2 id="issues-title" className="mb-2 font-azeret text-xs font-semibold uppercase tracking-wider">
        {blocking.length ? (
          <span className="text-danger-300">
            {blocking.length} blocking {blocking.length === 1 ? "issue" : "issues"}
          </span>
        ) : null}
        {blocking.length && warnings.length ? <span className="text-primary-200"> · </span> : null}
        {warnings.length ? (
          <span className="text-warning-400">
            {warnings.length} {warnings.length === 1 ? "warning" : "warnings"}
          </span>
        ) : null}
      </h2>
      <Card className={cn(blocking.length && "border-danger-200/50")}>
        <IssueList
          issues={[...blocking, ...warnings]}
          onEmployee={onEmployee}
          limit={blocking.length ? Math.max(blocking.length, 4) : 4}
        />
      </Card>
    </section>
  );
}

function TotalsCard({ o }: { o: PayrollOverviewDto }) {
  const t = o.run.totals;
  if (!t) return null;
  const cells: [string, number | string, string?][] = [
    ["People", String(t.headcount)],
    ["Gross pay", t.grossCents],
    ["Employee CPF", t.cpfEmployeeCents],
    ["SHG", t.shgCents],
    ["Employer CPF", t.cpfEmployerCents],
    ["SDL", t.sdlChargedCents, "Rounded down to the dollar for the month"],
    ["FWL estimate", t.fwlCents, "MOM's levy bill is authoritative"],
    ["Claims", t.reimbursementsCents],
  ];
  const editable = o.run.status === "draft" || o.run.status === "in_review";
  return (
    <Card variant={editable && !o.run.supersededByRunId ? "emphasis" : "default"} className="mb-5">
      <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-[inherit] bg-border sm:grid-cols-3 lg:grid-cols-9">
        {cells.map(([k, v, title]) => (
          <div key={k} className="bg-card px-3 py-2.5" title={title}>
            <dt className="font-azeret text-[10px] uppercase tracking-wider text-primary-200">{k}</dt>
            <dd className="num mt-0.5 text-ui">{typeof v === "number" ? formatMoney(v) : v}</dd>
          </div>
        ))}
        <div className="col-span-2 bg-kuning-50 px-3 py-2.5 sm:col-span-3 lg:col-span-1">
          <dt className="font-azeret text-[10px] uppercase tracking-wider text-primary-300">
            {o.run.kind === "adjustment" ? "Net to pay now" : "Net pay"}
          </dt>
          <dd className="num mt-0.5 text-base font-semibold">{formatMoney(t.netPayableCents)}</dd>
        </div>
      </dl>
    </Card>
  );
}

function ChangesPanel({ o, onEmployee }: { o: PayrollOverviewDto; onEmployee: (id: string) => void }) {
  if (!o.run.computedAt) return null;
  const { headline, items } = o.changes;
  return (
    <section aria-labelledby="changes-title" className="mb-5">
      <h2 id="changes-title" className="mb-2 font-azeret text-xs font-semibold uppercase tracking-wider">
        {headline}
      </h2>
      {items.length ? (
        <Card>
          <ul className="grid grid-cols-1 gap-x-6 px-4 py-1.5 lg:grid-cols-2">
            {items.map((c) => (
              <li key={`${c.employeeId}-${c.kind}-${c.text}`} className="flex gap-2 py-1.5 text-ui">
                <span className="w-20 shrink-0 font-azeret text-[10px] uppercase leading-5 tracking-wide text-primary-200">
                  {CHANGE[c.kind]}
                </span>
                <span className="min-w-0">
                  <button
                    type="button"
                    className="focus-ring rounded-sm font-medium hover:underline"
                    onClick={() => onEmployee(c.employeeId)}
                  >
                    {c.name}
                  </button>{" "}
                  <span className="text-primary-300">{c.text}</span>
                </span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </section>
  );
}

function FilesPanel({ runId }: { runId: string }) {
  const reauth = useReauth();
  const [excluded, setExcluded] = React.useState<{ file: string; list: Excluded[] } | null>(null);
  const get = (path: string) =>
    reauth(() => downloadFile(path))
      .then((r) => {
        const out = r as Awaited<ReturnType<typeof downloadFile>>;
        setExcluded(out.excluded.length ? { file: out.fileName, list: out.excluded } : null);
        toast.success(`Downloaded ${out.fileName}`);
      })
      .catch((e) => toast.error(errorMessage(e)));
  return (
    <section aria-labelledby="files-title" className="mt-6">
      <h2 id="files-title" className="mb-2 font-azeret text-xs font-semibold uppercase tracking-wider">
        Files
      </h2>
      <Card>
        <ul className="divide-y divide-border">
          <li className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-ui font-medium">CPF EZPay submission file</p>
              <p className="text-2xs text-primary-300">
                CPF Board's fixed-width FTP format (spec of 16 Jan 2025). Upload it in CPF EZPay; it holds the CPF, SHG
                and SDL this run charged.
              </p>
            </div>
            <Button size="sm" onClick={() => void get(`/payroll/runs/${runId}/files/cpf-ezpay`)}>
              <Download aria-hidden /> .DTL
            </Button>
          </li>
          <li className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-ui font-medium">Bank payment file (ISO 20022 pain.001)</p>
              <p className="text-2xs text-primary-300">
                Generic ISO 20022 file. Each bank has its own rules for this format (FAST or GIRO, fees, BIC length),
                and none is applied yet. Test it with your bank before the first payroll.
              </p>
            </div>
            <Button size="sm" onClick={() => void get(`/payroll/runs/${runId}/files/bank`)}>
              <Download aria-hidden /> XML
            </Button>
          </li>
        </ul>
        {excluded ? (
          <div className="border-t border-border px-4 py-3 text-ui">
            <p className="font-medium text-warning-400">Left out of {excluded.file}:</p>
            <ul className="mt-1 list-disc pl-5">
              {excluded.list.map((x) => (
                <li key={x.employeeName}>
                  {x.employeeName}: {x.reason}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </Card>
    </section>
  );
}

const CHANGE: Record<PayrollOverviewDto["changes"]["items"][number]["kind"], string> = {
  joined: "Joined",
  left: "Leaving",
  basic_changed: "Pay change",
  new_item: "Item",
  net_changed: "Net change",
  not_in_run: "Missing",
  residency: "Residency",
};

const COLS: { key: keyof PayrollRowDto; label: string; className?: string }[] = [
  { key: "basicCents", label: "Basic", className: "hidden sm:table-cell" },
  { key: "allowancesCents", label: "Allow.", className: "hidden lg:table-cell" },
  { key: "overtimeCents", label: "OT", className: "hidden lg:table-cell" },
  { key: "additionalCents", label: "Bonus/other", className: "hidden lg:table-cell" },
  { key: "nplCents", label: "No-pay", className: "hidden 2xl:table-cell" },
  { key: "grossCents", label: "Gross", className: "hidden sm:table-cell" },
  { key: "cpfEmployeeCents", label: "CPF ee", className: "hidden md:table-cell" },
  { key: "shgCents", label: "SHG", className: "hidden 2xl:table-cell" },
  { key: "otherDeductionsCents", label: "Deduct.", className: "hidden 2xl:table-cell" },
  { key: "reimbursementsCents", label: "Claims", className: "hidden 2xl:table-cell" },
  { key: "netPayableCents", label: "Net" },
  { key: "cpfEmployerCents", label: "CPF er", className: "hidden md:table-cell" },
];

function ReviewTable({ o, onOpen }: { o: PayrollOverviewDto; onOpen: (id: string) => void }) {
  const [filter, setFilter] = React.useState("");
  const [onlyIssues, setOnlyIssues] = React.useState(false);
  const filterRef = React.useRef<HTMLInputElement>(null);
  const bodyRef = React.useRef<HTMLTableSectionElement>(null);
  const rows = o.rows.filter(
    (r) =>
      (!onlyIssues || r.blocking + r.warnings > 0) &&
      (!filter || `${r.name} ${r.employeeNumber} ${r.department ?? ""}`.toLowerCase().includes(filter.toLowerCase())),
  );
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (
        e.key === "/" &&
        !(t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement) &&
        !document.querySelector("[role=dialog]")
      ) {
        e.preventDefault();
        filterRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const move = (e: React.KeyboardEvent<HTMLTableRowElement>, employeeId: string) => {
    const list = Array.from(bodyRef.current?.querySelectorAll<HTMLTableRowElement>("tr[data-row]") ?? []);
    const i = list.indexOf(e.currentTarget);
    if (e.key === "ArrowDown" || e.key === "j") {
      e.preventDefault();
      list[i + 1]?.focus();
    } else if (e.key === "ArrowUp" || e.key === "k") {
      e.preventDefault();
      list[i - 1]?.focus();
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onOpen(employeeId);
    }
  };
  if (!o.run.computedAt) return null;
  const sum = (k: keyof PayrollRowDto) => rows.reduce((s, r) => s + (r[k] as number), 0);
  return (
    <section aria-labelledby="employees-title">
      <div className="mb-2 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <h2 id="employees-title" className="font-azeret text-xs font-semibold uppercase tracking-wider">
          Employees <span className="num text-primary-200">{rows.length}</span>
        </h2>
        <div className="flex items-center gap-2">
          <label htmlFor="only-issues" className="flex items-center gap-1.5 text-2xs text-primary-300">
            <input
              id="only-issues"
              type="checkbox"
              className="focus-ring accent-ink"
              checked={onlyIssues}
              onChange={(e) => setOnlyIssues(e.target.checked)}
            />
            With issues only
          </label>
          <div className="relative">
            <Search
              className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-primary-200"
              aria-hidden
            />
            <Input
              ref={filterRef}
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter"
              aria-label="Filter employees"
              className="h-8 w-44 pl-8 text-ui"
              onKeyDown={(e) => {
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  bodyRef.current?.querySelector<HTMLTableRowElement>("tr[data-row]")?.focus();
                }
              }}
            />
          </div>
        </div>
      </div>
      <div className="max-h-[70vh] overflow-auto rounded-lg border border-border bg-card">
        <table className="w-full border-collapse text-ui" aria-label="Pay per employee">
          <thead className="sticky top-0 z-10 bg-surface-100">
            <tr className="h-9 border-b border-border">
              <th className="sticky left-0 z-10 bg-surface-100 px-3 text-left font-azeret text-[10px] font-medium uppercase tracking-wider text-primary-200">
                Employee
              </th>
              {COLS.map((c) => (
                <th
                  key={c.key}
                  className={cn(
                    "px-3 text-right font-azeret text-[10px] font-medium uppercase tracking-wider text-primary-200",
                    c.className,
                  )}
                >
                  {c.label}
                </th>
              ))}
              <th className="w-10 px-2">
                <span className="sr-only">Issues</span>
              </th>
            </tr>
          </thead>
          <tbody ref={bodyRef}>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={COLS.length + 2} className="px-3 py-8 text-center text-primary-300">
                  {o.rows.length
                    ? "No employees match the filter."
                    : "Nobody is in this run. Check hire dates and the off-cycle employee list."}
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr
                  key={r.employeeId}
                  data-row
                  tabIndex={0}
                  onKeyDown={(e) => move(e, r.employeeId)}
                  onClick={() => onOpen(r.employeeId)}
                  className="group h-10 cursor-pointer border-b border-border last:border-b-0 hover:bg-surface-200/40 focus-visible:bg-kuning-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                >
                  <td className="sticky left-0 bg-card px-3 py-1.5 group-hover:bg-surface-100 group-focus-visible:bg-kuning-50">
                    <span className="flex min-w-0 flex-col gap-0.5 sm:flex-row sm:items-center sm:gap-2">
                      <span className="truncate font-medium">{r.name}</span>
                      <span className="num text-[10px] text-primary-200">{r.employeeNumber}</span>
                      <span className="hidden 2xl:inline-flex">
                        <Flags flags={r.flags} />
                      </span>
                    </span>
                  </td>
                  {COLS.map((c) => (
                    <td
                      key={c.key}
                      className={cn(
                        "px-3 py-1.5 text-right",
                        c.className,
                        c.key === "netPayableCents" && "font-semibold",
                      )}
                    >
                      <Money cents={r[c.key] as number} dashZero />
                    </td>
                  ))}
                  <td className="px-2 text-center">
                    {r.blocking ? (
                      <AlertOctagon className="inline size-4 text-danger-300" aria-label={`${r.blocking} blocking`} />
                    ) : r.warnings ? (
                      <span className="inline-flex items-center">
                        <span aria-hidden className="inline-block size-2 rounded-full bg-warning-300" />
                        <span className="sr-only">{`${r.warnings} warnings`}</span>
                      </span>
                    ) : null}
                  </td>
                </tr>
              ))
            )}
          </tbody>
          {rows.length ? (
            <tfoot className="sticky bottom-0 bg-surface-100">
              <tr className="h-9 border-t border-ink/30">
                <td className="sticky left-0 bg-surface-100 px-3 font-azeret text-[10px] uppercase tracking-wider">
                  Total
                </td>
                {COLS.map((c) => (
                  <td key={c.key} className={cn("px-3 text-right font-semibold", c.className)}>
                    <Money cents={sum(c.key)} />
                  </td>
                ))}
                <td />
              </tr>
            </tfoot>
          ) : null}
        </table>
      </div>
      <p className="mt-2 hidden text-2xs text-primary-200 sm:block">
        <Kbd>j</Kbd> <Kbd>k</Kbd> or arrows to move · <Kbd>Enter</Kbd> to open the working · <Kbd>[</Kbd> <Kbd>]</Kbd>{" "}
        previous and next in the drawer · <Kbd>/</Kbd> to filter
      </p>
      {o.run.status === "approved" || o.run.status === "paid" ? <FilesPanel runId={o.run.id} /> : null}
    </section>
  );
}
