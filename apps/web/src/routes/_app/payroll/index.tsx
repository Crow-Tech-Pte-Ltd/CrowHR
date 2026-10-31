import type { PayrollRunSummaryDto } from "@crowhr/core";
import {
  Button,
  Card,
  Checkbox,
  type ColumnDef,
  DataTable,
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
  toast,
} from "@crowhr/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, Navigate, useNavigate } from "@tanstack/react-router";
import { ArrowRight, Plus, Settings2, Wallet } from "lucide-react";
import * as React from "react";
import { can, useMe } from "../../../auth/session.ts";
import { PageHeader } from "../../../components/page-header.tsx";
import { ErrorNote } from "../../../components/section.tsx";
import { directoryQuery } from "../people/-lib/api.ts";
import { createRun, errorMessage, fieldErrors, monthName, runsQuery, runTitle } from "./-lib/api.ts";
import { PayrollSettingsDialog } from "./-lib/settings-dialog.tsx";
import { Money, RunStatusPill } from "./-lib/ui.tsx";

export const Route = createFileRoute("/_app/payroll/")({
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
    cell: ({ row }) => (
      <span className="flex items-center gap-1.5">
        <RunStatusPill status={row.original.status} superseded={!!row.original.supersededByRunId} />
        {row.original.releasedAt ? (
          <span className="font-azeret text-[10px] uppercase text-primary-200">Released</span>
        ) : null}
      </span>
    ),
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
    cell: ({ row }) => {
      const t = row.original.totals;
      if (!t) return <span className="text-primary-200">Not computed</span>;
      if (t.blocking) return <span className="font-medium text-danger-300">{t.blocking} blocking</span>;
      return t.warnings ? (
        <span className="text-warning-400">{t.warnings} warnings</span>
      ) : (
        <span className="text-primary-200">None</span>
      );
    },
    meta: { headerClassName: "hidden sm:table-cell", cellClassName: "hidden sm:table-cell" },
  },
];

function nextMonth(): string {
  const now = new Date(Date.now() + 8 * 3_600_000);
  return now.toISOString().slice(0, 7);
}

function Runs() {
  const runs = useQuery(runsQuery);
  const navigate = useNavigate();
  const [open, setOpen] = React.useState(false);
  const [settingsOpen, setSettingsOpen] = React.useState(false);
  const active = runs.data?.items.find((r) => r.status === "draft" || r.status === "in_review");
  return (
    <>
      <PageHeader
        title="Payroll"
        description="Monthly and off-cycle runs. Every figure shows its working, with the rule and its source."
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
              <p className="font-azeret text-[10px] uppercase tracking-wider text-primary-200">Open run</p>
              <p className="mt-0.5 flex flex-wrap items-center gap-2 text-lg font-medium">
                {runTitle(active)} <RunStatusPill status={active.status} />
              </p>
              <p className="mt-1 text-ui text-primary-300">
                Pay date {formatDate(active.payDate)}
                {active.totals ? (
                  <>
                    {" · "}
                    {active.totals.headcount} people · net{" "}
                    <span className="num">{formatMoney(active.totals.netPayableCents)}</span>
                    {active.totals.blocking ? (
                      <span className="text-danger-300"> · {active.totals.blocking} blocking</span>
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
        <DataTable
          label="Payroll runs"
          columns={columns}
          data={runs.data?.items ?? []}
          loading={runs.isPending}
          getRowId={(r) => r.id}
          onRowActivate={(row) => void navigate({ to: "/payroll/runs/$runId", params: { runId: row.original.id } })}
          empty={
            <EmptyState
              variant="plain"
              icon={<Wallet />}
              title="No payroll runs yet"
              description="Create the first monthly run. Crow HR reads basic pay, allowances and CPF details from People, so check those first."
              actions={
                <Button variant="primary" size="sm" onClick={() => setOpen(true)}>
                  <Plus aria-hidden /> New run
                </Button>
              }
            />
          }
        />
      )}
      <NewRunDialog open={open} onOpenChange={setOpen} />
      <PayrollSettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
    </>
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
              <Input type="date" value={payDate} onChange={(e) => setPayDate(e.target.value)} />
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
