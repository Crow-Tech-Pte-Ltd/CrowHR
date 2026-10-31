import {
  Button,
  Checkbox,
  type ColumnDef,
  cn,
  DataTable,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  EmptyState,
  FormField,
  formatDate,
  formatMoney,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  toast,
  toIsoDate,
} from "@crowhr/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { BadgeCheck, Download, ReceiptText, Search } from "lucide-react";
import * as React from "react";
import { can, useMe } from "../../../auth/session.ts";
import { PageHeader } from "../../../components/page-header.tsx";
import { ErrorNote } from "../../../components/section.tsx";
import {
  api,
  type ClaimRowDto,
  type ClaimSummaryRowDto,
  claimKeys,
  claimListQuery,
  claimTypesQuery,
  errorMessage,
  exportHref,
  fieldErrors,
  STATUS_LABEL,
  summaryQuery,
} from "./-lib/api.ts";
import { ClaimStatusPill } from "./-lib/ui.tsx";

interface AdminSearch {
  status?: string;
  q?: string;
  type?: string;
  from?: string;
  to?: string;
}

export const Route = createFileRoute("/_app/claims/admin")({
  validateSearch: (s: Record<string, unknown>): AdminSearch => {
    const str = (k: string) => (typeof s[k] === "string" && s[k] ? (s[k] as string) : undefined);
    return { status: str("status"), q: str("q"), type: str("type"), from: str("from"), to: str("to") };
  },
  component: ClaimsAdminPage,
});

const TABS = [
  { value: "submitted", label: "Waiting" },
  { value: "approved", label: "To pay" },
  { value: "paid", label: "Paid" },
  { value: "rejected,withdrawn", label: "Closed" },
  { value: "all", label: "All" },
];

function monthRange(): { from: string; to: string } {
  const now = new Date();
  const from = toIsoDate(new Date(now.getFullYear(), now.getMonth(), 1));
  const to = toIsoDate(new Date(now.getFullYear(), now.getMonth() + 1, 0));
  return { from, to };
}

function ClaimsAdminPage() {
  const me = useMe();
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const qc = useQueryClient();
  const status = search.status ?? "submitted";
  const [q, setQ] = React.useState(search.q ?? "");
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [payOpen, setPayOpen] = React.useState(false);
  const scopes = me.permissions["claims:read"] ?? [];
  const isAll = scopes.includes("all");
  const canPay = can(me, "claims:pay");
  const canReport = can(me, "reports_claims:read");
  const range = monthRange();
  const from = search.from ?? range.from;
  const to = search.to ?? range.to;

  React.useEffect(() => {
    const id = setTimeout(() => {
      if ((search.q ?? "") !== q)
        void navigate({ search: (s: AdminSearch) => ({ ...s, q: q || undefined }), replace: true });
    }, 200);
    return () => clearTimeout(id);
  }, [q, search.q, navigate]);

  const list = useQuery(
    claimListQuery({
      status: status || undefined,
      q: search.q,
      claimTypeId: search.type,
      sort: status === "submitted" ? "submittedAt" : "-createdAt",
    }),
  );
  const types = useQuery({ ...claimTypesQuery(true), enabled: can(me, "claim_types:read") });
  const rows = list.data?.items ?? [];
  const payable = rows.filter((r) => r.status === "approved" && !r.reservedByPayrollRun);
  const selectedRows = rows.filter((r) => selected.has(r.id));
  // Clear the selection when the tab changes.
  const [lastStatus, setLastStatus] = React.useState(status);
  if (lastStatus !== status) {
    setLastStatus(status);
    setSelected(new Set());
  }

  const toggle = (id: string, on: boolean) =>
    setSelected((s) => {
      const next = new Set(s);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  const columns: ColumnDef<ClaimRowDto, unknown>[] = [
    ...(canPay && status === "approved"
      ? [
          {
            id: "select",
            header: () => (
              <Checkbox
                aria-label="Select all claims to mark paid"
                checked={payable.length > 0 && payable.every((r) => selected.has(r.id))}
                onCheckedChange={(v) => setSelected(v ? new Set(payable.map((r) => r.id)) : new Set())}
              />
            ),
            cell: ({ row }: { row: { original: ClaimRowDto } }) => (
              <Checkbox
                aria-label={`Select ${row.original.claimNumber}`}
                disabled={row.original.reservedByPayrollRun}
                checked={selected.has(row.original.id)}
                onClick={(e) => e.stopPropagation()}
                onCheckedChange={(v) => toggle(row.original.id, !!v)}
              />
            ),
          } as ColumnDef<ClaimRowDto, unknown>,
        ]
      : []),
    {
      id: "claim",
      header: "Claim",
      accessorFn: (r) => r.claimNumber ?? "",
      cell: ({ row }) => (
        <Link
          to="/claims/$claimId"
          params={{ claimId: row.original.id }}
          className="focus-ring num rounded-sm font-medium hover:underline"
          tabIndex={-1}
        >
          {row.original.claimNumber}
        </Link>
      ),
    },
    {
      id: "employee",
      header: "Employee",
      accessorFn: (r) => r.employee.name,
      cell: ({ row }) => (
        <span className="block max-w-[14rem] truncate whitespace-nowrap">
          {row.original.employee.name}
          <span className="num text-2xs text-primary-200"> {row.original.employee.employeeNumber}</span>
        </span>
      ),
    },
    {
      id: "department",
      header: "Department",
      accessorFn: (r) => r.employee.departmentName ?? "",
      cell: ({ getValue }) => <span className="whitespace-nowrap">{(getValue() as string) || "—"}</span>,
      meta: { headerClassName: "hidden xl:table-cell", cellClassName: "hidden xl:table-cell" },
    },
    {
      id: "types",
      header: "For",
      accessorFn: (r) => r.typeNames.join(", "),
      cell: ({ row }) => (
        <span className="block max-w-[14rem] truncate">
          {row.original.title ?? row.original.typeNames.join(", ")}
          {row.original.lineCount > 1 ? (
            <span className="num text-primary-200"> · {row.original.lineCount}</span>
          ) : null}
        </span>
      ),
    },
    {
      id: "dates",
      header: "Expenses",
      accessorFn: (r) => r.expenseFrom ?? "",
      cell: ({ row }) => (
        <span className="num whitespace-nowrap">
          {row.original.expenseFrom ? formatDate(row.original.expenseFrom) : "—"}
          {row.original.expenseTo && row.original.expenseTo !== row.original.expenseFrom ? " –" : ""}
        </span>
      ),
      meta: { headerClassName: "hidden lg:table-cell", cellClassName: "hidden lg:table-cell" },
    },
    {
      id: "amount",
      header: "Amount",
      accessorFn: (r) => r.totalCents,
      cell: ({ row }) => <span className="num">{formatMoney(row.original.totalCents)}</span>,
      meta: { numeric: true },
    },
    {
      id: "state",
      header: "Status",
      accessorFn: (r) => r.status,
      cell: ({ row }) => {
        const r = row.original;
        return (
          <span className="flex items-center gap-2 whitespace-nowrap">
            <ClaimStatusPill status={r.status} />
            {r.status === "submitted" && r.daysWaiting !== null && r.daysWaiting > 7 ? (
              <span className="num text-2xs font-medium text-warning-400">{r.daysWaiting} days</span>
            ) : null}
            {r.approverTask && r.status === "submitted" ? (
              <Link to="/inbox" className="text-2xs font-medium text-biru-400 hover:underline">
                Decide in Inbox
              </Link>
            ) : null}
          </span>
        );
      },
    },
    {
      id: "payout",
      header: "Payout",
      accessorFn: (r) => r.paidOn ?? r.approvedOn ?? "",
      cell: ({ row }) => {
        const r = row.original;
        if (r.status === "paid")
          return (
            <span className="num whitespace-nowrap">
              {r.paidOn ? formatDate(r.paidOn) : ""}
              <span className="text-primary-200">
                {" "}
                · {r.paidVia === "payroll" ? "payroll" : (r.paidReference ?? "transfer")}
              </span>
            </span>
          );
        if (r.status === "approved")
          return (
            <span className="whitespace-nowrap text-primary-300">
              {r.reservedByPayrollRun ? "In payroll run" : r.payoutMethod === "payroll" ? "Next payroll" : "Transfer"}
            </span>
          );
        return <span className="text-primary-200">—</span>;
      },
      meta: { headerClassName: "hidden md:table-cell", cellClassName: "hidden md:table-cell" },
    },
  ];

  const total = rows.reduce((s, r) => s + r.totalCents, 0);

  return (
    <>
      <PageHeader
        crumbs={[{ label: "Claims", to: "/claims" }]}
        title={isAll ? "All claims" : "Team claims"}
        description={
          list.data ? (
            <span className="num">
              {list.data.total} {list.data.total === 1 ? "claim" : "claims"} · {formatMoney(total)}
            </span>
          ) : (
            "Claims from your team, waiting, approved and paid."
          )
        }
        actions={
          canReport ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" variant="secondary">
                  <Download aria-hidden /> Export
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuLabel className="num">
                  Expenses {formatDate(from)} – {formatDate(to)}
                </DropdownMenuLabel>
                {(
                  [
                    ["lines", "Line register"],
                    ["summary", "Totals by type"],
                    ["payouts", "Payout register"],
                  ] as const
                ).map(([report, label]) => (
                  <React.Fragment key={report}>
                    <DropdownMenuItem asChild>
                      <a href={exportHref({ report, by: "type", from, to, format: "csv" })} download>
                        {label} (CSV)
                      </a>
                    </DropdownMenuItem>
                    <DropdownMenuItem asChild>
                      <a href={exportHref({ report, by: "type", from, to, format: "xlsx" })} download>
                        {label} (Excel)
                      </a>
                    </DropdownMenuItem>
                  </React.Fragment>
                ))}
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild>
                  <a href={exportHref({ report: "summary", by: "department", from, to, format: "xlsx" })} download>
                    Totals by department (Excel)
                  </a>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <a href={exportHref({ report: "summary", by: "employee", from, to, format: "xlsx" })} download>
                    Totals by employee (Excel)
                  </a>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null
        }
      />

      <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        <div className="flex gap-1 overflow-x-auto" role="tablist" aria-label="Claim status">
          {TABS.map((t) => {
            const active = status === t.value;
            return (
              <button
                key={t.value}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() =>
                  void navigate({
                    search: (s: AdminSearch) => ({ ...s, status: t.value === "submitted" ? undefined : t.value }),
                  })
                }
                className={cn(
                  "focus-ring h-8 shrink-0 rounded-md border px-3 font-azeret text-2xs font-medium",
                  active ? "border-ink bg-kuning-200 text-ink" : "border-transparent text-primary-300 hover:bg-ink/5",
                )}
              >
                {t.label}
              </button>
            );
          })}
        </div>
        <div className="relative sm:ml-auto sm:w-64">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-primary-200" aria-hidden />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Claim number or employee"
            className="pl-8"
            aria-label="Search claims"
          />
        </div>
        {types.data?.items.length ? (
          <Select
            value={search.type ?? "any"}
            onValueChange={(v) =>
              void navigate({ search: (s: AdminSearch) => ({ ...s, type: v === "any" ? undefined : v }) })
            }
          >
            <SelectTrigger className="sm:w-48" aria-label="Claim type">
              <SelectValue placeholder="Any type" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="any">Any type</SelectItem>
              {types.data.items.map((t) => (
                <SelectItem key={t.id} value={t.id}>
                  {t.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}
      </div>

      {canPay && status === "approved" ? (
        <div className="mb-3 flex flex-wrap items-center gap-3 rounded-md border border-border bg-surface-100/60 px-3 py-2 text-ui">
          <span className="text-primary-300">
            Approved claims with payroll payout are paid with the next payroll run automatically. Pay the rest by
            transfer and record it here.
          </span>
          <Button
            size="sm"
            variant="primary"
            className="ml-auto"
            disabled={selected.size === 0}
            onClick={() => setPayOpen(true)}
            data-testid="mark-paid"
          >
            <BadgeCheck aria-hidden /> Mark {selected.size || ""} paid
          </Button>
        </div>
      ) : null}

      {list.isError ? <ErrorNote error={list.error} retry={() => void list.refetch()} /> : null}
      <DataTable
        label="Claims"
        columns={columns}
        data={rows}
        getRowId={(r) => r.id}
        loading={list.isPending}
        onRowActivate={(row) => void navigate({ to: "/claims/$claimId", params: { claimId: row.original.id } })}
        empty={
          <EmptyState
            variant="plain"
            icon={<ReceiptText />}
            title={
              status === "submitted"
                ? "No claims waiting"
                : `No ${status ? (STATUS_LABEL[status as "paid"] ?? "").toLowerCase() : ""} claims`
            }
            description={
              search.q || search.type
                ? "Nothing matches these filters."
                : "Claims appear here once employees submit them."
            }
          />
        }
      />

      {canReport ? (
        <SummarySection
          from={from}
          to={to}
          onRange={(f, t) => void navigate({ search: (s: AdminSearch) => ({ ...s, from: f, to: t }) })}
        />
      ) : null}

      <MarkPaidDialog
        open={payOpen}
        onOpenChange={setPayOpen}
        claims={selectedRows}
        onDone={() => {
          setSelected(new Set());
          void qc.invalidateQueries({ queryKey: claimKeys.all });
        }}
      />
    </>
  );
}

function MarkPaidDialog({
  open,
  onOpenChange,
  claims,
  onDone,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  claims: ClaimRowDto[];
  onDone: () => void;
}) {
  const [paidOn, setPaidOn] = React.useState(toIsoDate(new Date()));
  const [reference, setReference] = React.useState("");
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const total = claims.reduce((s, c) => s + c.totalCents, 0);
  const pay = useMutation({
    mutationFn: () =>
      api<{ paid: number }>("POST", "/claims/mark-paid", { claimIds: claims.map((c) => c.id), paidOn, reference }),
    onSuccess: (r) => {
      toast.success(`${r.paid} ${r.paid === 1 ? "claim" : "claims"} marked paid`);
      onOpenChange(false);
      setReference("");
      onDone();
    },
    onError: (err) => {
      setErrors(fieldErrors(err));
      toast.error(errorMessage(err));
    },
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Mark paid outside payroll</DialogTitle>
          <DialogDescription>
            <span className="num">
              {claims.length} {claims.length === 1 ? "claim" : "claims"}, {formatMoney(total)}
            </span>
            . They won't be paid again with payroll.
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            pay.mutate();
          }}
        >
          <FormField label="Paid on" error={errors.paidOn} required>
            <Input type="date" className="num" value={paidOn} onChange={(e) => setPaidOn(e.target.value)} />
          </FormField>
          <FormField
            label="Payment reference"
            hint="The bank or FAST/PayNow reference, e.g. FAST 4 Nov."
            error={errors.reference}
            required
          >
            <Input
              value={reference}
              maxLength={100}
              onChange={(e) => setReference(e.target.value)}
              placeholder="FAST 4 Nov"
            />
          </FormField>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={pay.isPending || !reference.trim()}>
              Mark paid
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

const BY = [
  { value: "type", label: "Type" },
  { value: "department", label: "Department" },
  { value: "employee", label: "Employee" },
  { value: "month", label: "Month" },
] as const;

function SummarySection({
  from,
  to,
  onRange,
}: {
  from: string;
  to: string;
  onRange: (from: string, to: string) => void;
}) {
  const [by, setBy] = React.useState<(typeof BY)[number]["value"]>("type");
  const q = useQuery(summaryQuery(by, from, to));
  // Fold statuses into one row per group: submitted, approved, paid (rejected/withdrawn left out of totals).
  const groups = new Map<
    string,
    { label: string; count: number; waiting: number; approved: number; paid: number; gst: number }
  >();
  for (const r of (q.data?.items ?? []) as ClaimSummaryRowDto[]) {
    if (r.status === "rejected" || r.status === "withdrawn") continue;
    const g = groups.get(r.key) ?? { label: r.label, count: 0, waiting: 0, approved: 0, paid: 0, gst: 0 };
    g.count += r.claimCount;
    g.gst += r.gstCents;
    if (r.status === "submitted") g.waiting += r.totalCents;
    if (r.status === "approved") g.approved += r.totalCents;
    if (r.status === "paid") g.paid += r.totalCents;
    groups.set(r.key, g);
  }
  const rows = [...groups.values()];
  const sum = (k: "waiting" | "approved" | "paid" | "gst") => rows.reduce((s, r) => s + r[k], 0);
  return (
    <section className="mt-8" aria-labelledby="claims-summary-title" data-testid="claims-summary">
      <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 id="claims-summary-title" className="font-azeret text-xs font-semibold uppercase tracking-wider">
            Totals by expense date
          </h2>
          <p className="mt-1 text-ui text-primary-300">Waiting, approved and paid, with GST, for the period.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Input
            type="date"
            className="num w-36"
            aria-label="From"
            value={from}
            onChange={(e) => onRange(e.target.value, to)}
          />
          <span className="text-primary-200">–</span>
          <Input
            type="date"
            className="num w-36"
            aria-label="To"
            value={to}
            onChange={(e) => onRange(from, e.target.value)}
          />
          <Select value={by} onValueChange={(v) => setBy(v as typeof by)}>
            <SelectTrigger className="w-36" aria-label="Group by">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {BY.map((b) => (
                <SelectItem key={b.value} value={b.value}>
                  By {b.label.toLowerCase()}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="overflow-x-auto rounded-md border border-border bg-surface-50">
        <table className="w-full text-ui">
          <thead className="bg-surface-100/70 font-azeret text-2xs uppercase tracking-wider text-primary-300">
            <tr className="h-9">
              <th className="px-3 text-left font-semibold">{BY.find((b) => b.value === by)?.label}</th>
              <th className="px-3 text-right font-semibold">Claims</th>
              <th className="px-3 text-right font-semibold">Waiting</th>
              <th className="px-3 text-right font-semibold">Approved</th>
              <th className="px-3 text-right font-semibold">Paid</th>
              <th className="px-3 text-right font-semibold">GST</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {q.isPending ? (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-primary-200">
                  Loading…
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-primary-200">
                  No claims with expenses in this period.
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={r.label} className="h-9">
                  <td className="px-3">{r.label}</td>
                  <td className="num px-3 text-right">{r.count}</td>
                  <td className="num px-3 text-right">{formatMoney(r.waiting)}</td>
                  <td className="num px-3 text-right">{formatMoney(r.approved)}</td>
                  <td className="num px-3 text-right">{formatMoney(r.paid)}</td>
                  <td className="num px-3 text-right">{formatMoney(r.gst)}</td>
                </tr>
              ))
            )}
          </tbody>
          {rows.length ? (
            <tfoot className="border-t border-ink/20 font-medium">
              <tr className="h-9">
                <td className="px-3">Total</td>
                <td className="num px-3 text-right">{rows.reduce((s, r) => s + r.count, 0)}</td>
                <td className="num px-3 text-right">{formatMoney(sum("waiting"))}</td>
                <td className="num px-3 text-right">{formatMoney(sum("approved"))}</td>
                <td className="num px-3 text-right">{formatMoney(sum("paid"))}</td>
                <td className="num px-3 text-right">{formatMoney(sum("gst"))}</td>
              </tr>
            </tfoot>
          ) : null}
        </table>
      </div>
      <p className="mt-2 text-2xs text-primary-200">
        Each claim counts once per group. Rejected and withdrawn claims are left out.
      </p>
    </section>
  );
}
