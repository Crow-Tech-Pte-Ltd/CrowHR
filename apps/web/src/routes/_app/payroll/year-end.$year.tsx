import { Button, Card, type ColumnDef, DataTable, EmptyState, formatMoney } from "@crowhr/ui";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, Navigate } from "@tanstack/react-router";
import { ChevronLeft, ChevronRight, ExternalLink, Gift, LineChart, Plus } from "lucide-react";
import * as React from "react";
import { can, useMe } from "../../../auth/session.ts";
import { PageHeader } from "../../../components/page-header.tsx";
import { ErrorNote } from "../../../components/section.tsx";
import {
  type AppendixEntry,
  AppendixEntryDialog,
  type AppendixKind,
  appendixQuery,
  entryPeriod,
  entrySummary,
  KIND_LABEL,
} from "./-lib/appendix.tsx";

export const Route = createFileRoute("/_app/payroll/year-end/$year")({ component: YearEndPage });

function YearEndPage() {
  const me = useMe();
  const { year: raw } = Route.useParams();
  if (!can(me, "payroll:read")) return <Navigate to="/me/payslips" />;
  const year = Number(raw);
  if (!Number.isInteger(year) || year < 2000 || year > 2100) return <Navigate to="/payroll" />;
  return <YearEnd year={year} canEdit={can(me, "payroll:update")} />;
}

const num = (n: number) => <span className="num">{n.toLocaleString("en-SG")}</span>;

function YearEnd({ year, canEdit }: { year: number; canEdit: boolean }) {
  const q = useQuery(appendixQuery(year));
  const [dialog, setDialog] = React.useState<{ entry: AppendixEntry | null; kind: AppendixKind } | null>(null);
  const entries = q.data?.entries ?? [];
  const benefits = entries.filter((e) => e.kind !== "share_gain");
  const gains = entries.filter((e) => e.kind === "share_gain");
  const open = (entry: AppendixEntry | null, kind: AppendixKind = "residence") =>
    canEdit ? setDialog({ entry, kind: entry?.kind ?? kind }) : undefined;
  const addBenefit = canEdit ? (
    <Button size="sm" onClick={() => open(null, "residence")}>
      <Plus aria-hidden /> Add benefit
    </Button>
  ) : null;
  const addGain = canEdit ? (
    <Button size="sm" onClick={() => open(null, "share_gain")}>
      <Plus aria-hidden /> Add share gain
    </Button>
  ) : null;

  const benefitColumns: ColumnDef<AppendixEntry, unknown>[] = [
    { id: "employee", header: "Employee", accessorFn: (e) => e.employeeName },
    {
      id: "item",
      header: "Item",
      accessorFn: (e) => e.computed?.item ?? "",
      cell: ({ row }) => (
        <span className="whitespace-nowrap">
          <span className="font-azeret text-2xs text-primary-200">{row.original.computed?.item ?? "–"}</span>{" "}
          {KIND_LABEL[row.original.kind]}
        </span>
      ),
    },
    {
      id: "detail",
      header: "Details",
      accessorFn: (e) => entrySummary(e),
      cell: ({ row }) => (
        <span className="block max-w-[22rem] truncate text-primary-300">{entrySummary(row.original)}</span>
      ),
      meta: { headerClassName: "hidden md:table-cell", cellClassName: "hidden md:table-cell" },
    },
    {
      id: "period",
      header: "Period",
      accessorFn: (e) => entryPeriod(e) ?? "",
      cell: ({ row }) => <span className="num whitespace-nowrap">{entryPeriod(row.original) ?? "–"}</span>,
      meta: { headerClassName: "hidden lg:table-cell", cellClassName: "hidden lg:table-cell" },
    },
    {
      id: "value",
      header: "Taxable value",
      accessorFn: (e) => e.computed?.valueCents ?? -1,
      cell: ({ row }) =>
        row.original.computed ? (
          <span className="num">{formatMoney(row.original.computed.valueCents)}</span>
        ) : (
          <span className="text-danger-300">Fix this record</span>
        ),
      meta: { numeric: true },
    },
  ];

  const gainColumns: ColumnDef<AppendixEntry, unknown>[] = [
    { id: "employee", header: "Employee", accessorFn: (e) => e.employeeName },
    {
      id: "plan",
      header: "Plan",
      accessorFn: (e) => entrySummary(e),
      cell: ({ row }) => <span className="whitespace-nowrap">{entrySummary(row.original)}</span>,
    },
    {
      id: "accrued",
      header: "Accrued",
      accessorFn: (e) => (e.details.kind === "share_gain" ? e.details.eventDate : ""),
      cell: ({ row }) => <span className="num whitespace-nowrap">{entryPeriod(row.original)}</span>,
      meta: { numeric: true, headerClassName: "hidden sm:table-cell", cellClassName: "hidden sm:table-cell" },
    },
    {
      id: "shares",
      header: "Shares",
      accessorFn: (e) => (e.details.kind === "share_gain" ? Number(e.details.shares) : 0),
      cell: ({ row }) => (
        <span className="num">{row.original.details.kind === "share_gain" ? row.original.details.shares : ""}</span>
      ),
      meta: { numeric: true, headerClassName: "hidden md:table-cell", cellClassName: "hidden md:table-cell" },
    },
    {
      id: "section",
      header: "IR8A",
      accessorFn: (e) => e.computed?.section ?? "",
      cell: ({ row }) => (
        <span className="font-azeret text-2xs">
          {row.original.computed?.section === "S10_1_G" ? "d7(b)" : row.original.computed ? "d7(a)" : "–"}
        </span>
      ),
    },
    {
      id: "gain",
      header: "Gross gain",
      accessorFn: (e) => e.computed?.valueCents ?? -1,
      cell: ({ row }) =>
        row.original.computed ? (
          <span className="num">{formatMoney(row.original.computed.valueCents)}</span>
        ) : (
          <span className="text-danger-300">Fix this record</span>
        ),
      meta: { numeric: true },
    },
  ];

  type Totals = NonNullable<typeof q.data>["employees"][number];
  const totalColumns: ColumnDef<Totals, unknown>[] = [
    { id: "employee", header: "Employee", accessorFn: (t) => t.employeeName },
    {
      id: "d8",
      header: "d8 Benefits-in-kind",
      accessorFn: (t) => t.benefitsInKind,
      cell: ({ getValue }) => num(getValue() as number),
      meta: { numeric: true },
    },
    {
      id: "d7a",
      header: "d7(a) S10(1)(b)",
      accessorFn: (t) => t.shareGainsS101b,
      cell: ({ getValue }) => num(getValue() as number),
      meta: { numeric: true },
    },
    {
      id: "d7b",
      header: "d7(b) S10(1)(g)",
      accessorFn: (t) => t.shareGainsS101g,
      cell: ({ getValue }) => num(getValue() as number),
      meta: { numeric: true },
    },
  ];

  return (
    <>
      <PageHeader
        crumbs={[{ label: "Payroll", to: "/payroll" }]}
        title={`Year end ${year}`}
        description={`Benefits-in-kind (Appendix 8A) and share-plan gains (Appendix 8B) for the IR8A of income year ${year}, Year of Assessment ${year + 1}. Crow HR works out the values IRAS gives a formula for; you enter the rest.`}
        actions={
          <nav aria-label="Income year" className="flex gap-1">
            <Button asChild size="sm" variant="ghost">
              <Link
                to="/payroll/year-end/$year"
                params={{ year: String(year - 1) }}
                aria-label={`Year end ${year - 1}`}
              >
                <ChevronLeft aria-hidden /> {year - 1}
              </Link>
            </Button>
            <Button asChild size="sm" variant="ghost">
              <Link
                to="/payroll/year-end/$year"
                params={{ year: String(year + 1) }}
                aria-label={`Year end ${year + 1}`}
              >
                {year + 1} <ChevronRight aria-hidden />
              </Link>
            </Button>
          </nav>
        }
      />
      {q.isError ? (
        <Card>
          <ErrorNote error={q.error} retry={() => void q.refetch()} />
        </Card>
      ) : (
        <>
          <section aria-labelledby="totals-title" className="mb-8">
            <h2 id="totals-title" className="mb-1 font-azeret text-xs font-semibold uppercase tracking-wider">
              IR8A totals
            </h2>
            <p className="mb-3 max-w-2xl text-ui text-primary-300">
              Whole dollars, decimals dropped. myTax computes d7 and d8 from the appendix sheets after import: check
              them against these. Download the sheets from the IR8A panel on the{" "}
              <Link to="/payroll" className="focus-ring rounded-sm font-medium underline">
                Payroll
              </Link>{" "}
              page.
            </p>
            <DataTable
              label="IR8A totals per employee"
              columns={totalColumns}
              data={q.data?.employees ?? []}
              loading={q.isPending}
              getRowId={(t) => t.employeeId}
              empty={<p className="px-4 py-3 text-ui text-primary-300">No appendix records in {year} yet.</p>}
            />
          </section>
          <section aria-labelledby="a8a-title" className="mb-8">
            <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
              <div>
                <h2 id="a8a-title" className="font-azeret text-xs font-semibold uppercase tracking-wider">
                  Appendix 8A: benefits-in-kind
                </h2>
                <p className="mt-1 max-w-2xl text-ui text-primary-300">
                  Housing, hotel stays, cars, home leave passages and other non-cash benefits. Leave out benefits IRAS
                  exempts.
                </p>
              </div>
              {addBenefit}
            </div>
            <DataTable
              label="Appendix 8A benefits-in-kind"
              columns={benefitColumns}
              data={benefits}
              loading={q.isPending}
              getRowId={(e) => e.id}
              onRowActivate={(row) => open(row.original)}
              empty={
                <EmptyState
                  variant="plain"
                  icon={<Gift />}
                  title={`No benefits-in-kind recorded for ${year}`}
                  description="Record each place of residence, hotel stay, car or other benefit the employer provided. Crow HR values housing and cars with IRAS's formulas."
                  actions={addBenefit}
                />
              }
            />
          </section>
          <section aria-labelledby="a8b-title" className="mb-8">
            <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
              <div>
                <h2 id="a8b-title" className="font-azeret text-xs font-semibold uppercase tracking-wider">
                  Appendix 8B: share-plan gains
                </h2>
                <p className="mt-1 max-w-2xl text-ui text-primary-300">
                  ESOP and ESOW gains in the year they accrue: (market value − price paid) × shares. Gains of leaving
                  foreigners under the deemed exercise rule go in their IR21, not here.
                </p>
              </div>
              {addGain}
            </div>
            <DataTable
              label="Appendix 8B share-plan gains"
              columns={gainColumns}
              data={gains}
              loading={q.isPending}
              getRowId={(e) => e.id}
              onRowActivate={(row) => open(row.original)}
              empty={
                <EmptyState
                  variant="plain"
                  icon={<LineChart />}
                  title={`No share-plan gains recorded for ${year}`}
                  description="Record each exercise of an option, or each vesting or grant of shares, with the prices in S$."
                  actions={addGain}
                />
              }
            />
          </section>
          {q.data ? (
            <p className="flex flex-wrap gap-x-4 gap-y-1 text-2xs text-primary-300">
              {(
                [
                  [q.data.sources.explanatoryNotes8a, "IRAS: notes on IR8A and Appendix 8A"],
                  [q.data.sources.explanatoryNotes8b, "IRAS: notes on Appendix 8B"],
                  [q.data.sources.exemptBenefits, "IRAS: exempt benefits"],
                ] as const
              ).map(([href, label]) => (
                <a
                  key={href}
                  href={href}
                  target="_blank"
                  rel="noreferrer"
                  className="focus-ring inline-flex items-center gap-1 rounded-sm font-medium underline"
                >
                  {label} <ExternalLink aria-hidden className="size-3" />
                </a>
              ))}
            </p>
          ) : null}
        </>
      )}
      {dialog ? (
        <AppendixEntryDialog
          year={year}
          open
          onOpenChange={(o) => (o ? undefined : setDialog(null))}
          entry={dialog.entry}
          initialKind={dialog.kind}
        />
      ) : null}
    </>
  );
}
