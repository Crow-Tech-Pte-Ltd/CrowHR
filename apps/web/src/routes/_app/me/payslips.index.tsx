import type { PayslipSummaryDto } from "@crowhr/core";
import { Button, Card, type ColumnDef, DataTable, EmptyState, formatDate, StatusPill } from "@crowhr/ui";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Download } from "lucide-react";
import { useMe } from "../../../auth/session.ts";
import { PageHeader } from "../../../components/page-header.tsx";
import { ErrorNote } from "../../../components/section.tsx";
import { myPayslipsQuery } from "../payroll/-lib/api.ts";
import { Money } from "../payroll/-lib/ui.tsx";

export const Route = createFileRoute("/_app/me/payslips/")({
  component: MyPayslips,
});

const columns: ColumnDef<PayslipSummaryDto, unknown>[] = [
  {
    id: "title",
    header: "Payslip",
    accessorFn: (r) => r.month,
    cell: ({ row }) => (
      <span className="flex flex-wrap items-center gap-2">
        <Link
          to="/me/payslips/$payslipId"
          params={{ payslipId: row.original.id }}
          tabIndex={-1}
          className="focus-ring rounded-sm font-medium hover:underline"
        >
          {row.original.title}
        </Link>
        {row.original.revised ? <StatusPill tone="neutral">Revised later</StatusPill> : null}
        <span className="num block w-full text-2xs text-primary-300 sm:hidden">
          Paid {formatDate(row.original.payDate)}
        </span>
      </span>
    ),
  },
  {
    id: "payDate",
    header: "Paid on",
    accessorFn: (r) => r.payDate,
    cell: ({ getValue }) => formatDate(getValue() as string),
    meta: { numeric: true, headerClassName: "hidden sm:table-cell", cellClassName: "hidden sm:table-cell" },
  },
  {
    id: "net",
    header: "Net pay",
    accessorFn: (r) => r.netCents,
    cell: ({ getValue }) => <Money cents={getValue() as number} />,
    meta: { numeric: true },
  },
  {
    id: "pdf",
    header: () => <span className="sr-only">Download</span>,
    cell: ({ row }) => (
      <Button asChild size="sm" variant="ghost" aria-label={`Download ${row.original.title} as PDF`}>
        <a href={`/api/v1/payslips/${row.original.id}/pdf`} download onClick={(e) => e.stopPropagation()}>
          <Download aria-hidden /> <span className="hidden sm:inline">PDF</span>
        </a>
      </Button>
    ),
    meta: { numeric: true },
  },
];

function MyPayslips() {
  const me = useMe();
  const q = useQuery(myPayslipsQuery);
  const navigate = useNavigate();
  return (
    <>
      <PageHeader
        title="Payslips"
        description={
          me.membershipStatus === "former"
            ? "You have left the company; your payslips stay available here to view and download."
            : "Your payslips appear here once payroll releases them."
        }
      />
      {q.isError ? (
        <Card>
          <ErrorNote error={q.error} retry={() => void q.refetch()} />
        </Card>
      ) : (
        <DataTable
          label="My payslips"
          columns={columns}
          data={q.data?.items ?? []}
          loading={q.isPending}
          getRowId={(r) => r.id}
          onRowActivate={(row) =>
            void navigate({ to: "/me/payslips/$payslipId", params: { payslipId: row.original.id } })
          }
          empty={
            <EmptyState
              variant="plain"
              title={me.membershipStatus === "former" ? "No payslips were released to you." : "No payslips yet."}
              description={
                me.membershipStatus === "former"
                  ? undefined
                  : "Your first one shows here on payday, once payroll approves and releases the run."
              }
            />
          }
        />
      )}
    </>
  );
}
