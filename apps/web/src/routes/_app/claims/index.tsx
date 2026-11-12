import { Button, type ColumnDef, cn, DataTable, EmptyState, formatDate, formatMoney, Skeleton } from "@crowhr/ui";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ChevronRight, Plus, ReceiptText, Users } from "lucide-react";
import * as React from "react";
import { can, canForAll, useMe } from "../../../auth/session.ts";
import { PageHeader } from "../../../components/page-header.tsx";
import { ErrorNote } from "../../../components/section.tsx";
import { type ClaimDto, type ClaimRowDto, claimListQuery, myTotalsQuery } from "./-lib/api.ts";
import { compareClaimNumbers } from "./-lib/claim-number.ts";
import { ClaimSheet } from "./-lib/claim-sheet.tsx";
import { ClaimStatusPill } from "./-lib/ui.tsx";

interface ClaimsSearch {
  status?: string;
  new?: boolean;
}

export const Route = createFileRoute("/_app/claims/")({
  validateSearch: (s: Record<string, unknown>): ClaimsSearch => ({
    status: typeof s.status === "string" && s.status ? s.status : undefined,
    new: s.new === true || s.new === "1" || s.new === 1 ? true : undefined,
  }),
  component: MyClaimsPage,
});

const FILTERS = [
  { value: "", label: "All" },
  { value: "submitted", label: "Waiting" },
  { value: "approved", label: "To be paid" },
  { value: "paid", label: "Paid" },
  { value: "draft", label: "Drafts" },
  { value: "rejected,withdrawn", label: "Closed" },
];

function dates(r: ClaimRowDto) {
  if (!r.expenseFrom) return "—";
  return r.expenseFrom === r.expenseTo
    ? formatDate(r.expenseFrom)
    : `${formatDate(r.expenseFrom)} – ${formatDate(r.expenseTo ?? r.expenseFrom)}`;
}

const what = (r: ClaimRowDto) => r.title ?? (r.typeNames.join(", ") || "Claim");

const columns: ColumnDef<ClaimRowDto, unknown>[] = [
  {
    id: "claim",
    header: "Claim",
    accessorFn: (r) => r.claimNumber ?? undefined,
    // Numeric (C-9999 before C-10000); drafts have no number and stay last either way.
    sortUndefined: "last",
    sortingFn: (a, b) => compareClaimNumbers(a.original.claimNumber, b.original.claimNumber),
    cell: ({ row }) => (
      <span className="num whitespace-nowrap">
        {row.original.claimNumber ?? <span className="text-primary-200">Draft</span>}
      </span>
    ),
  },
  {
    id: "what",
    header: "For",
    accessorFn: what,
    cell: ({ row }) => (
      <span className="block max-w-[18rem] truncate">
        {what(row.original)}
        {row.original.lineCount > 1 ? (
          <span className="num text-primary-200"> · {row.original.lineCount} items</span>
        ) : null}
      </span>
    ),
  },
  {
    id: "dates",
    header: "Expense dates",
    accessorFn: (r) => r.expenseFrom ?? "",
    cell: ({ row }) => <span className="num whitespace-nowrap">{dates(row.original)}</span>,
  },
  {
    id: "amount",
    header: "Amount",
    accessorFn: (r) => r.totalCents,
    cell: ({ row }) => <span className="num">{formatMoney(row.original.totalCents)}</span>,
    meta: { numeric: true },
  },
  {
    id: "status",
    header: "Status",
    accessorFn: (r) => r.status,
    cell: ({ row }) => <ClaimStatusPill status={row.original.status} />,
  },
  {
    id: "paid",
    header: "Paid",
    accessorFn: (r) => r.paidOn ?? "",
    cell: ({ row }) =>
      row.original.paidOn ? (
        <span className="num whitespace-nowrap">
          {formatDate(row.original.paidOn)}
          <span className="text-primary-200"> · {row.original.paidVia === "payroll" ? "payslip" : "bank"}</span>
        </span>
      ) : row.original.status === "approved" ? (
        <span className="text-primary-200">
          {row.original.payoutMethod === "payroll" ? "Next payroll" : "By transfer"}
        </span>
      ) : (
        "—"
      ),
    meta: { headerClassName: "hidden lg:table-cell", cellClassName: "hidden lg:table-cell" },
  },
];

function MyClaimsPage() {
  const me = useMe();
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const [sheet, setSheet] = React.useState(!!search.new);
  const list = useQuery({ ...claimListQuery({ mine: true, status: search.status }), enabled: !!me.employeeId });
  const totals = useQuery({ ...myTotalsQuery, enabled: !!me.employeeId });
  const scopes = me.permissions["claims:read"] ?? [];
  const reviewer = scopes.includes("all") || scopes.includes("team");
  // Owners and HR admins file claims for employees too (the sheet shows an employee picker).
  const onBehalf = canForAll(me, "claims:create");
  const openClaim = (claim: ClaimDto) => {
    if (claim.employee.id !== me.employeeId) void navigate({ to: "/claims/$claimId", params: { claimId: claim.id } });
  };
  const sheetProps = {
    open: sheet,
    onOpenChange: (open: boolean) => {
      setSheet(open);
      if (!open && search.new)
        void navigate({ search: (s: ClaimsSearch) => ({ ...s, new: undefined }), replace: true });
    },
    onDone: openClaim,
  };

  const reviewLink = reviewer ? (
    <Button asChild variant="ghost" size="sm">
      <Link to="/claims/admin">
        <Users aria-hidden /> {scopes.includes("all") ? "All claims" : "Team claims"}
      </Link>
    </Button>
  ) : null;

  if (!me.employeeId) {
    return (
      <>
        <PageHeader title="Claims" description="Expense claims, approvals and reimbursements." actions={reviewLink} />
        <EmptyState
          icon={<ReceiptText />}
          title="Your account isn't linked to an employee record"
          description={
            onBehalf
              ? "You can file a claim for an employee, and review everyone's claims in All claims."
              : can(me, "claims:read")
                ? "You can review everyone's claims, mark them paid and export reports in All claims."
                : "Ask HR to link your account to your employee record to submit claims."
          }
          actions={
            onBehalf || reviewer ? (
              <>
                {onBehalf ? (
                  <Button variant="primary" onClick={() => setSheet(true)} data-testid="new-claim">
                    <Plus aria-hidden /> New claim for an employee
                  </Button>
                ) : null}
                {reviewer ? (
                  <Button asChild variant={onBehalf ? "secondary" : "primary"}>
                    <Link to="/claims/admin">Open all claims</Link>
                  </Button>
                ) : null}
              </>
            ) : undefined
          }
        />
        {onBehalf ? <ClaimSheet {...sheetProps} /> : null}
      </>
    );
  }

  const rows = list.data?.items ?? [];
  return (
    <>
      <PageHeader
        title="My claims"
        description={
          totals.data ? (
            <span className="num" data-testid="claims-totals">
              {formatMoney(totals.data.submittedCents)} waiting for approval · {formatMoney(totals.data.approvedCents)}{" "}
              to be paid · {formatMoney(totals.data.paidThisYearCents)} paid this year
            </span>
          ) : (
            "Expense claims and reimbursements."
          )
        }
        actions={
          <>
            {reviewLink}
            <Button variant="primary" onClick={() => setSheet(true)} data-testid="new-claim">
              <Plus aria-hidden /> New claim
            </Button>
          </>
        }
      />
      <div className="mb-3 flex gap-1 overflow-x-auto pb-1" role="tablist" aria-label="Filter claims">
        {FILTERS.map((f) => {
          const active = (search.status ?? "") === f.value;
          return (
            <button
              key={f.value || "all"}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => void navigate({ search: (s: ClaimsSearch) => ({ ...s, status: f.value || undefined }) })}
              className={cn(
                "focus-ring h-8 shrink-0 rounded-md border px-3 font-azeret text-2xs font-medium",
                active ? "border-ink bg-kuning-200 text-ink" : "border-transparent text-primary-300 hover:bg-ink/5",
              )}
            >
              {f.label}
            </button>
          );
        })}
      </div>
      {list.isError ? <ErrorNote error={list.error} retry={() => void list.refetch()} /> : null}

      {/* Phones: cards. */}
      <ul className="flex flex-col gap-2 md:hidden" aria-label="My claims" data-testid="my-claims-cards">
        {list.isPending
          ? [0, 1, 2].map((i) => (
              <li key={i}>
                <Skeleton className="h-16 w-full" />
              </li>
            ))
          : rows.map((r) => (
              <li key={r.id}>
                <Link
                  to="/claims/$claimId"
                  params={{ claimId: r.id }}
                  className="focus-ring flex items-center gap-3 rounded-md border border-border bg-surface-50 p-3"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="truncate font-medium">{what(r)}</span>
                      <span className="num shrink-0 font-semibold">{formatMoney(r.totalCents)}</span>
                    </div>
                    <div className="mt-1 flex items-center justify-between gap-2">
                      <ClaimStatusPill status={r.status} />
                      <span className="num truncate text-2xs text-primary-200">
                        {r.claimNumber ? `${r.claimNumber} · ` : ""}
                        {dates(r)}
                      </span>
                    </div>
                  </div>
                  <ChevronRight className="size-4 shrink-0 text-primary-200" aria-hidden />
                </Link>
              </li>
            ))}
      </ul>
      {/* Desktop: a dense table. */}
      <div className="hidden md:block">
        <DataTable
          label="My claims"
          columns={columns}
          data={rows}
          getRowId={(r) => r.id}
          loading={list.isPending}
          onRowActivate={(row) => void navigate({ to: "/claims/$claimId", params: { claimId: row.original.id } })}
          empty={<span className="sr-only">No claims to show</span>}
        />
      </div>
      {!list.isPending && rows.length === 0 ? (
        <EmptyState
          className="mt-4"
          icon={<ReceiptText />}
          title={search.status ? "No claims here" : "No claims yet"}
          description={
            search.status
              ? "Nothing matches this filter."
              : "Snap a photo of the receipt, enter the amount and send it for approval. Approved claims are paid with your next payslip or by transfer."
          }
          actions={
            <Button variant="primary" onClick={() => setSheet(true)}>
              <Plus aria-hidden /> New claim
            </Button>
          }
        />
      ) : null}
      <ClaimSheet {...sheetProps} />
    </>
  );
}
