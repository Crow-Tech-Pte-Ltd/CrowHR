import type { PayrollRunSummaryDto } from "@crowhr/core";
import {
  Button,
  Card,
  Checkbox,
  type ColumnDef,
  DataTable,
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
  formatMoney,
  Input,
  Label,
  RadioGroup,
  RadioGroupItem,
  StatusPill,
  singaporeTodayIso,
  toast,
} from "@crowhr/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, Navigate, useNavigate } from "@tanstack/react-router";
import { ArrowRight, Plus, Settings2 } from "lucide-react";
import * as React from "react";
import { can, useMe } from "../../../auth/session.ts";
import { PageHeader } from "../../../components/page-header.tsx";
import { ErrorNote } from "../../../components/section.tsx";
import { directoryQuery } from "../people/-lib/api.ts";
import { createRun, errorMessage, fieldErrors, monthName, runsQuery, runTitle } from "./-lib/api.ts";
import { Ir8aPanel } from "./-lib/ir8a.tsx";
import { PayrollSettingsDialog } from "./-lib/settings-dialog.tsx";
import { Money, RunStatusPill } from "./-lib/ui.tsx";

export const Route = createFileRoute("/_app/payroll/")({
  // `?settings=open` opens the settings dialog (linked from Settings → Payroll).
  validateSearch: (s: Record<string, unknown>): { settings?: "open" } =>
    s.settings === "open" ? { settings: "open" } : {},
  component: PayrollPage,
});

function PayrollPage() {
  const me = useMe();
  if (!can(me, "payroll:read")) return <Navigate to="/me/payslips" />;
  return <Runs />;
}

const KIND: Record<PayrollRunSummaryDto["kind"], string> = {
  regular: "Monthly",
  off_cycle: "Off-cycle",
  adjustment: "Adjustment",
};

/**
 * A run's state in the list. Paid and released is the normal end of a run, so it is plain text; a
 * chip marks a run that still needs someone (to approve, pay or release it).
 */
export function RunState({ run }: { run: PayrollRunSummaryDto }) {
  if (run.supersededByRunId) return <span className="text-primary-200">Superseded by an adjustment</span>;
  if (run.status === "paid")
    return run.releasedAt ? (
      <span className="text-primary-300">Paid · released</span>
    ) : (
      <StatusPill tone="warning">Paid · payslips not released</StatusPill>
    );
  if (run.status === "approved")
    return (
      <StatusPill tone="info">{run.releasedAt ? "Approved · not marked paid" : "Approved · not released"}</StatusPill>
    );
  if (run.status === "in_review") return <StatusPill tone="info">In review</StatusPill>;
  return <StatusPill tone="neutral">Draft</StatusPill>;
}

/** Issues as counted on the run page: one per employee and issue. */
function RunIssues({ run }: { run: PayrollRunSummaryDto }) {
  const t = run.totals;
  if (!t) return <span className="text-primary-200">Not computed</span>;
  if (t.blocking) return <span className="font-medium text-danger-300">{t.blocking} blocking</span>;
  return t.warnings ? (
    <span className="text-warning-400">
      {t.warnings} {t.warnings === 1 ? "warning" : "warnings"}
    </span>
  ) : (
    <span className="text-primary-200">—</span>
  );
}

const columns: ColumnDef<PayrollRunSummaryDto, unknown>[] = [
  {
    id: "run",
    header: "Run",
    accessorFn: (r) => `${r.month}${r.kind}`,
    cell: ({ row }) => (
      <Link
        to="/payroll/runs/$runId"
        params={{ runId: row.original.id }}
        tabIndex={-1}
        className="focus-ring rounded-sm font-medium hover:underline"
      >
        {runTitle(row.original)}
      </Link>
    ),
  },
  {
    id: "kind",
    header: "Kind",
    accessorFn: (r) => KIND[r.kind],
    cell: ({ getValue }) => <span className="text-primary-300">{getValue() as string}</span>,
  },
  {
    id: "status",
    header: "Status",
    accessorFn: (r) => r.status,
    cell: ({ row }) => <RunState run={row.original} />,
  },
  {
    id: "payDate",
    header: "Pay date",
    accessorFn: (r) => r.payDate,
    cell: ({ getValue }) => formatDate(getValue() as string),
    meta: { numeric: true },
  },
  {
    id: "headcount",
    header: "People",
    accessorFn: (r) => r.totals?.headcount ?? 0,
    cell: ({ row }) => (row.original.totals ? row.original.totals.headcount : "–"),
    meta: { numeric: true },
  },
  {
    id: "net",
    header: "Net pay",
    accessorFn: (r) => r.totals?.netPayableCents ?? 0,
    cell: ({ row }) => (row.original.totals ? <Money cents={row.original.totals.netPayableCents} /> : "–"),
    meta: { numeric: true },
  },
  {
    id: "cpf",
    header: "CPF total",
    accessorFn: (r) => r.totals?.cpfTotalChargedCents ?? 0,
    cell: ({ row }) => (row.original.totals ? <Money cents={row.original.totals.cpfTotalChargedCents} /> : "–"),
    meta: { numeric: true, headerClassName: "hidden md:table-cell", cellClassName: "hidden md:table-cell" },
  },
  {
    id: "issues",
    header: "Issues",
    accessorFn: (r) => r.totals?.blocking ?? 0,
    cell: ({ row }) => <RunIssues run={row.original} />,
    meta: { headerClassName: "hidden sm:table-cell", cellClassName: "hidden sm:table-cell" },
  },
];

function nextMonth(): string {
  return singaporeTodayIso().slice(0, 7);
}

function Runs() {
  const runs = useQuery(runsQuery);
  const navigate = useNavigate();
  const [open, setOpen] = React.useState(false);
  const search = Route.useSearch();
  const [settingsOpen, setSettingsOpen] = React.useState(search.settings === "open");
  const onSettingsOpenChange = (open: boolean) => {
    setSettingsOpen(open);
    if (!open && search.settings) void navigate({ to: "/payroll", search: {}, replace: true });
  };
  const active = runs.data?.items.find((r) => r.status === "draft" || r.status === "in_review");
  // The open run is the card above; the table lists the others, so nothing shows twice.
  const others = (runs.data?.items ?? []).filter((r) => r.id !== active?.id);
  return (
    <>
      <PageHeader
        title="Payroll"
        description="Monthly and off-cycle runs. Open a run to see how each figure was worked out."
        actions={
          <>
            <Button size="sm" onClick={() => setSettingsOpen(true)}>
              <Settings2 aria-hidden /> Settings
            </Button>
            <Button variant="primary" size="sm" onClick={() => setOpen(true)}>
              <Plus aria-hidden /> New run
            </Button>
          </>
        }
      />
      {active ? (
        <Card variant="emphasis" className="mb-6">
          <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <h2 className="flex flex-wrap items-center gap-2 text-lg font-semibold">
                <Link
                  to="/payroll/runs/$runId"
                  params={{ runId: active.id }}
                  className="focus-ring rounded-sm hover:underline"
                >
                  {runTitle(active)}
                </Link>
                <RunStatusPill status={active.status} />
              </h2>
              <p className="mt-1 text-ui text-primary-300">
                Pay date <span className="num">{formatDate(active.payDate)}</span>
                {active.totals ? (
                  <>
                    {" · "}
                    <span className="num">{active.totals.headcount}</span> people · net{" "}
                    <span className="num">{formatMoney(active.totals.netPayableCents)}</span>
                    {active.totals.blocking || active.totals.warnings ? (
                      <>
                        {" · "}
                        <RunIssues run={active} />
                      </>
                    ) : null}
                  </>
                ) : (
                  " · not computed yet"
                )}
              </p>
            </div>
            <Button asChild variant="primary" size="sm">
              <Link to="/payroll/runs/$runId" params={{ runId: active.id }}>
                {active.status === "in_review" ? "Review and approve" : "Continue"} <ArrowRight aria-hidden />
              </Link>
            </Button>
          </div>
        </Card>
      ) : null}
      {runs.isError ? (
        <Card>
          <ErrorNote error={runs.error} retry={() => void runs.refetch()} />
        </Card>
      ) : (
        <>
          <MobileRunList runs={others} loading={runs.isPending} />
          <DataTable
            className={others.length ? "hidden sm:block" : undefined}
            label="Payroll runs"
            columns={columns}
            data={others}
            loading={runs.isPending}
            getRowId={(r) => r.id}
            onRowActivate={(row) => void navigate({ to: "/payroll/runs/$runId", params: { runId: row.original.id } })}
            empty={
              active ? (
                <EmptyState
                  variant="plain"
                  title="No earlier runs."
                  description={`${runTitle(active)} is the first. Once approved and paid, it is listed here.`}
                />
              ) : (
                <EmptyState
                  variant="plain"
                  title="No payroll runs yet."
                  description="Start the first monthly run with New run. Crow HR reads basic pay, allowances and CPF details from People, so check those first."
                />
              )
            }
          />
        </>
      )}
      {runs.data?.items.length ? (
        <Ir8aPanel
          years={[...new Set(runs.data.items.map((r) => Number(r.month.slice(0, 4))))].sort((x, y) => y - x)}
        />
      ) : null}
      <NewRunDialog open={open} onOpenChange={setOpen} />
      <PayrollSettingsDialog open={settingsOpen} onOpenChange={onSettingsOpenChange} />
    </>
  );
}

/** Phones: the runs as a list of rows instead of a table that scrolls sideways. */
function MobileRunList({ runs, loading }: { runs: PayrollRunSummaryDto[]; loading: boolean }) {
  if (loading || !runs.length) return null;
  return (
    <ul className="divide-y divide-border rounded-lg border border-border sm:hidden" aria-label="Payroll runs">
      {runs.map((r) => (
        <li key={r.id}>
          <Link
            to="/payroll/runs/$runId"
            params={{ runId: r.id }}
            className="focus-ring flex items-start gap-3 px-3 py-2.5 hover:bg-ink/[0.03]"
          >
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium">{runTitle(r)}</span>
              <span className="block text-2xs text-primary-300">
                Pay date <span className="num">{formatDate(r.payDate)}</span>
                {r.totals ? (
                  <>
                    {" · "}
                    <span className="num">{r.totals.headcount}</span> people
                  </>
                ) : null}
              </span>
              <span className="mt-1 block text-2xs">
                <RunState run={r} />
              </span>
            </span>
            <span className="flex shrink-0 flex-col items-end gap-0.5 text-right">
              {r.totals ? <span className="num">{formatMoney(r.totals.netPayableCents)}</span> : null}
              {/* Only when there is something to say: a lone dash reads as a missing figure on a card. */}
              {!r.totals || r.totals.blocking || r.totals.warnings ? (
                <span className="text-2xs">
                  <RunIssues run={r} />
                </span>
              ) : null}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

function NewRunDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [kind, setKind] = React.useState<"regular" | "final_pay" | "bonus">("regular");
  const [month, setMonth] = React.useState(nextMonth());
  const [payDate, setPayDate] = React.useState("");
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const people = useQuery({ ...directoryQuery({ status: "active,leaving" }), enabled: open && kind !== "regular" });
  const create = useMutation({
    mutationFn: () =>
      createRun({
        kind: kind === "regular" ? "regular" : "off_cycle",
        month,
        payDate: payDate || null,
        offCycleReason: kind === "regular" ? null : kind,
        employeeIds: kind === "regular" ? null : [...selected],
      }),
    onSuccess: async (run) => {
      await qc.invalidateQueries({ queryKey: runsQuery.queryKey });
      onOpenChange(false);
      toast.success(`${runTitle(run)} created`);
      void navigate({ to: "/payroll/runs/$runId", params: { runId: run.id } });
    },
  });
  const errors = fieldErrors(create.error);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>New payroll run</DialogTitle>
          <DialogDescription>
            Pay is computed from People records when you open the run; nothing is paid until it is approved.
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate();
          }}
        >
          <RadioGroup
            value={kind}
            onValueChange={(v) => setKind(v as typeof kind)}
            className="grid gap-2"
            aria-label="Kind of run"
          >
            {(
              [
                ["regular", "Monthly payroll", "Everyone employed in the month."],
                [
                  "final_pay",
                  "Final pay (off-cycle)",
                  "Pay leavers before the monthly run; they are then left out of it.",
                ],
                ["bonus", "Bonus (off-cycle)", "One-off payments only. CPF is recomputed for the whole month."],
              ] as const
            ).map(([value, title, hint]) => (
              <Label
                key={value}
                className="flex cursor-pointer items-start gap-2.5 rounded-md border border-border p-2.5 font-normal has-[[data-state=checked]]:border-ink"
              >
                <RadioGroupItem value={value} className="mt-0.5" />
                <span>
                  <span className="block text-ui font-medium">{title}</span>
                  <span className="block text-2xs text-primary-300">{hint}</span>
                </span>
              </Label>
            ))}
          </RadioGroup>
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Month" error={errors.month} hint={monthName(month.length === 7 ? month : nextMonth())}>
              <Input type="month" value={month} onChange={(e) => setMonth(e.target.value)} required />
            </FormField>
            <FormField label="Pay date" error={errors.payDate} hint="Leave empty for the default from settings.">
              <DatePicker
                value={payDate || null}
                onChange={(v) => setPayDate(v ?? "")}
                min={/^\d{4}-\d{2}$/.test(month) ? `${month}-01` : null}
                placeholder="From settings"
              />
            </FormField>
          </div>
          {kind !== "regular" ? (
            <FormField label="Employees" error={errors.employeeIds}>
              <div className="max-h-48 overflow-y-auto rounded-md border border-border">
                {(people.data?.items ?? []).map((p) => (
                  <Label
                    key={p.id}
                    className="flex cursor-pointer items-center gap-2 border-b border-border px-2.5 py-1.5 font-normal last:border-b-0"
                  >
                    <Checkbox
                      checked={selected.has(p.id)}
                      onCheckedChange={(c) => {
                        const next = new Set(selected);
                        if (c) next.add(p.id);
                        else next.delete(p.id);
                        setSelected(next);
                      }}
                    />
                    <span className="text-ui">{p.name}</span>
                    <span className="num ml-auto text-2xs text-primary-200">{p.employeeNumber}</span>
                  </Label>
                ))}
              </div>
            </FormField>
          ) : null}
          {create.isError && !Object.keys(errors).length ? (
            <p role="alert" className="text-ui text-danger-300">
              {errorMessage(create.error)}
            </p>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={create.isPending}>
              Create run
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
