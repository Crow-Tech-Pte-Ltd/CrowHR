import {
  Avatar,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  type ColumnDef,
  cn,
  DataTable,
  formatDate,
  formatMoney,
  maskNric,
  StatusPill,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  toast,
} from "@crowhr/ui";
import { Link } from "@tanstack/react-router";
import { ArrowRight, CalendarDays, Check, Clock, Receipt, X } from "lucide-react";
import { PageHeader } from "../components/page-header.tsx";
import { SampleDataNotice } from "../components/sample-data-notice.tsx";
import {
  FIXTURE_TODAY,
  type SampleApproval,
  sampleApprovals,
  samplePasses,
  samplePayrollRun,
  sampleUpcoming,
} from "../fixtures/home.ts";
import { daysBetween, relativeDays, weekday } from "./dates.ts";

const KIND = {
  leave: { label: "Leave", icon: CalendarDays },
  claim: { label: "Claim", icon: Receipt },
  timesheet: { label: "Overtime", icon: Clock },
} as const;

function quantity(q: SampleApproval["quantity"]): string {
  if (q.unit === "cents") return formatMoney(q.value);
  if (q.unit === "days") return `${q.value.toFixed(1)} d`;
  return `${(q.value / 100).toFixed(1)} h`;
}

const notConnected = (what: string) =>
  toast("Sample data", { description: `${what} isn't connected yet. Nothing was changed.` });

export function AdminHome() {
  const passesSoon = samplePasses.filter((p) => daysBetween(FIXTURE_TODAY, p.expires) <= 90);
  const due = daysBetween(FIXTURE_TODAY, samplePayrollRun.payDate);
  return (
    <>
      <PageHeader
        kicker={
          <span className="num">
            {weekday(FIXTURE_TODAY)} · {formatDate(FIXTURE_TODAY)}
          </span>
        }
        title="Work to do"
        description={
          <>
            <span className="num">{sampleApprovals.length}</span> approvals, <span className="num">1</span> payroll run
            and <span className="num">{passesSoon.length}</span> work passes need attention.
          </>
        }
      />
      <div className="mb-6">
        <SampleDataNotice />
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex min-w-0 flex-col gap-6">
          <PayrollRunCard dueInDays={due} />
          <ApprovalsCard />
        </div>
        <div className="flex min-w-0 flex-col gap-6">
          <PassesCard passes={passesSoon} />
          <UpcomingCard />
        </div>
      </div>
    </>
  );
}

const STEPS = ["Prepare", "Review", "Approve", "Pay"] as const;

function PayrollRunCard({ dueInDays }: { dueInDays: number }) {
  const run = samplePayrollRun;
  const current = 1; // "Review"
  return (
    <Card variant="emphasis" aria-labelledby="payroll-run-title">
      <div className="flex flex-col gap-5 p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex flex-col gap-1">
            <p className="font-azeret text-2xs font-medium uppercase tracking-wider text-primary-200">
              Payroll · {run.period}
            </p>
            <h2 id="payroll-run-title" className="text-lg font-semibold leading-6">
              October payroll is waiting for your review
            </h2>
          </div>
          <StatusPill tone={dueInDays <= 7 ? "warning" : "neutral"}>Pay date {relativeDays(dueInDays)}</StatusPill>
        </div>

        <ol className="grid grid-cols-4 gap-1.5" aria-label="Payroll run progress">
          {STEPS.map((step, i) => (
            <li key={step} className="flex flex-col gap-1.5" aria-current={i === current ? "step" : undefined}>
              <span
                className={cn(
                  "h-1.5 rounded-full",
                  i < current ? "bg-ink" : i === current ? "bg-kuning-300 ring-1 ring-ink" : "bg-surface-200",
                )}
              />
              <span
                className={cn(
                  "flex items-center gap-1 font-azeret text-2xs",
                  i <= current ? "text-ink" : "text-primary-200",
                  i === current && "font-semibold",
                )}
              >
                {i < current ? <Check className="size-3" aria-label="done" /> : null}
                {step}
              </span>
            </li>
          ))}
        </ol>

        <dl className="grid grid-cols-2 gap-x-6 gap-y-3 border-t border-border pt-4 sm:grid-cols-4">
          <Fact label="Employees" value={String(run.employees)} />
          <Fact label="Gross pay" value={formatMoney(run.grossCents)} />
          <Fact label="Net pay" value={formatMoney(run.netCents)} />
          <Fact label="Pay date" value={formatDate(run.payDate)} />
        </dl>

        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-ui text-primary-300">
            <span className="num">{run.changesSinceLastRun}</span> changes since September: one new joiner, one
            resignation, one salary revision.
          </p>
          <Button variant="primary" asChild>
            <Link to="/payroll">
              Continue review
              <ArrowRight />
            </Link>
          </Button>
        </div>
      </div>
    </Card>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="font-azeret text-[10px] font-medium uppercase tracking-wider text-primary-200">{label}</dt>
      <dd className="num truncate text-sm font-medium">{value}</dd>
    </div>
  );
}

function ApprovalActions({ approval }: { approval: SampleApproval }) {
  return (
    <div className="flex justify-end gap-1">
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label={`Decline ${approval.employee}'s request`}
            onClick={(e) => {
              e.stopPropagation();
              notConnected("Declining requests");
            }}
          >
            <X />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Decline</TooltipContent>
      </Tooltip>
      <Button
        size="sm"
        variant="secondary"
        onClick={(e) => {
          e.stopPropagation();
          notConnected("Approving requests");
        }}
      >
        <Check />
        Approve
      </Button>
    </div>
  );
}

const approvalColumns: ColumnDef<SampleApproval, unknown>[] = [
  {
    id: "employee",
    header: "Employee",
    accessorFn: (a) => a.employee,
    cell: ({ row }) => (
      <div className="flex min-w-0 items-center gap-2.5">
        <Avatar name={row.original.employee} size="sm" />
        <div className="min-w-0">
          <p className="truncate font-medium leading-4">{row.original.employee}</p>
          <p className="truncate text-2xs leading-4 text-primary-200">{row.original.team}</p>
        </div>
      </div>
    ),
  },
  {
    id: "request",
    header: "Request",
    accessorFn: (a) => a.kind,
    cell: ({ row }) => {
      const k = KIND[row.original.kind];
      const Icon = k.icon;
      return (
        <div className="flex min-w-0 items-center gap-2">
          <Icon className="size-4 shrink-0 text-primary-200" aria-hidden />
          <span className="truncate">
            <span className="font-medium">{k.label}</span>
            <span className="text-primary-300"> · {row.original.detail}</span>
          </span>
        </div>
      );
    },
  },
  {
    id: "submitted",
    header: "Submitted",
    accessorFn: (a) => a.submitted,
    meta: { numeric: true, cellClassName: "text-primary-300" },
    cell: ({ row }) => relativeDays(daysBetween(FIXTURE_TODAY, row.original.submitted)),
  },
  {
    id: "quantity",
    header: "Amount",
    enableSorting: false,
    meta: { numeric: true },
    cell: ({ row }) => quantity(row.original.quantity),
  },
  {
    id: "actions",
    header: () => <span className="sr-only">Actions</span>,
    enableSorting: false,
    cell: ({ row }) => <ApprovalActions approval={row.original} />,
  },
];

function ApprovalsCard() {
  return (
    <Card aria-labelledby="approvals-title">
      <CardHeader className="items-center">
        <div className="flex items-center gap-2">
          <CardTitle id="approvals-title">Approvals waiting</CardTitle>
          <Badge variant="ink" className="num">
            {sampleApprovals.length}
          </Badge>
        </div>
        <Button variant="link" size="sm" onClick={() => notConnected("The approvals queue")}>
          View all
        </Button>
      </CardHeader>
      <div className="hidden border-t border-border md:block">
        <DataTable
          label="Approvals waiting"
          columns={approvalColumns}
          data={sampleApprovals}
          getRowId={(a) => a.id}
          onRowActivate={(row) => notConnected(`${KIND[row.original.kind].label} details`)}
        />
      </div>
      <ul className="divide-y divide-border border-t border-border md:hidden">
        {sampleApprovals.map((a) => {
          const k = KIND[a.kind];
          return (
            <li key={a.id} className="flex flex-col gap-2 px-4 py-3">
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-center gap-2.5">
                  <Avatar name={a.employee} size="sm" />
                  <div className="min-w-0">
                    <p className="truncate font-medium leading-4">{a.employee}</p>
                    <p className="truncate text-2xs leading-4 text-primary-300">
                      {k.label} · {a.detail}
                    </p>
                  </div>
                </div>
                <span className="num shrink-0 text-ui">{quantity(a.quantity)}</span>
              </div>
              <div className="flex items-center justify-between pl-[34px]">
                <span className="num text-2xs text-primary-200">
                  {relativeDays(daysBetween(FIXTURE_TODAY, a.submitted))}
                </span>
                <ApprovalActions approval={a} />
              </div>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

function PassesCard({ passes }: { passes: typeof samplePasses }) {
  return (
    <Card aria-labelledby="passes-title">
      <CardHeader>
        <div>
          <CardTitle id="passes-title">Work passes expiring</CardTitle>
          <p className="mt-0.5 text-2xs text-primary-200">Next 90 days</p>
        </div>
      </CardHeader>
      <ul className="divide-y divide-border border-t border-border">
        {passes.map((p) => {
          const days = daysBetween(FIXTURE_TODAY, p.expires);
          return (
            <li key={p.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
              <div className="min-w-0">
                <p className="truncate font-medium leading-5">{p.employee}</p>
                <p className="flex items-center gap-1.5 text-2xs text-primary-300">
                  <span>{p.passType}</span>
                  <span aria-hidden className="text-primary-100">
                    ·
                  </span>
                  <span className="num" title="FIN, masked">
                    {maskNric(p.fin)}
                  </span>
                </p>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1">
                <StatusPill tone={days <= 30 ? "danger" : days <= 60 ? "warning" : "neutral"}>
                  <span className="num normal-case">{days} days</span>
                </StatusPill>
                <span className="num text-2xs text-primary-200">{formatDate(p.expires)}</span>
              </div>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

function UpcomingCard() {
  return (
    <Card aria-labelledby="upcoming-title">
      <CardHeader>
        <CardTitle id="upcoming-title">Coming up</CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        <ol className="flex flex-col">
          {sampleUpcoming.map((u) => (
            <li
              key={u.id}
              className="grid grid-cols-[3.25rem_1fr] gap-3 border-t border-border py-2.5 first:border-t-0"
            >
              <span className="num pt-0.5 text-2xs leading-4 text-primary-200">
                {formatDate(u.date).replace(/ \d{4}$/, "")}
              </span>
              <span className="min-w-0">
                <span className="block truncate font-medium leading-5">{u.employee}</span>
                <span className="block text-2xs text-primary-300">{u.label}</span>
              </span>
            </li>
          ))}
        </ol>
      </CardContent>
    </Card>
  );
}
