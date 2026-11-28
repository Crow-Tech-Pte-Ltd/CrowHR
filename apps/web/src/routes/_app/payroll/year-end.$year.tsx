import { Button, Card, type ColumnDef, DataTable, EmptyState, formatMoney, textStyle } from "@crowhr/ui";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, Navigate } from "@tanstack/react-router";
import { ChevronLeft, ChevronRight, ExternalLink, Plus } from "lucide-react";
import * as React from "react";
import { can, useMe } from "../../../auth/session.ts";
import { PageHeader } from "../../../components/page-header.tsx";
import { ErrorNote } from "../../../components/section.tsx";
import { useT } from "../../../i18n/index.ts";
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
  const translate = useT("people-payroll");
  const q = useQuery(appendixQuery(year));
  const [dialog, setDialog] = React.useState<{ entry: AppendixEntry | null; kind: AppendixKind } | null>(null);
  const entries = q.data?.entries ?? [];
  const benefits = entries.filter((e) => e.kind !== "share_gain");
  const gains = entries.filter((e) => e.kind === "share_gain");
  const open = (entry: AppendixEntry | null, kind: AppendixKind = "residence") =>
    canEdit ? setDialog({ entry, kind: entry?.kind ?? kind }) : undefined;
  const addBenefit = canEdit ? (
    <Button size="sm" onClick={() => open(null, "residence")}>
      <Plus aria-hidden /> {translate("Add benefit")}
    </Button>
  ) : null;
  const addGain = canEdit ? (
    <Button size="sm" onClick={() => open(null, "share_gain")}>
      <Plus aria-hidden /> {translate("Add share gain")}
    </Button>
  ) : null;

  const benefitColumns: ColumnDef<AppendixEntry, unknown>[] = [
    { id: "employee", header: translate("Employee"), accessorFn: (e) => e.employeeName },
    {
      id: "item",
      header: "Item",
      accessorFn: (e) => e.computed?.item ?? "",
      cell: ({ row }) => (
        <span className="whitespace-nowrap">
          <span className="font-azeret text-2xs text-primary-200">{row.original.computed?.item ?? "–"}</span>{" "}
          {translate(KIND_LABEL[row.original.kind])}
        </span>
      ),
    },
    {
      id: "detail",
      header: translate("Details"),
      accessorFn: (e) => entrySummary(e),
      cell: ({ row }) => (
        <span className="block max-w-[22rem] truncate text-primary-300">{entrySummary(row.original)}</span>
      ),
      meta: { headerClassName: "hidden md:table-cell", cellClassName: "hidden md:table-cell" },
    },
    {
      id: "period",
      header: translate("Period"),
      accessorFn: (e) => entryPeriod(e) ?? "",
      cell: ({ row }) => <span className="num whitespace-nowrap">{entryPeriod(row.original) ?? "–"}</span>,
      meta: { headerClassName: "hidden lg:table-cell", cellClassName: "hidden lg:table-cell" },
    },
    {
      id: "value",
      header: translate("Taxable value"),
      accessorFn: (e) => e.computed?.valueCents ?? -1,
      cell: ({ row }) =>
        row.original.computed ? (
          <span className="num">{formatMoney(row.original.computed.valueCents)}</span>
        ) : (
          <span className="text-danger-300">{translate("Fix this record")}</span>
        ),
      meta: { numeric: true },
    },
  ];

  const gainColumns: ColumnDef<AppendixEntry, unknown>[] = [
    { id: "employee", header: translate("Employee"), accessorFn: (e) => e.employeeName },
    {
      id: "plan",
      header: translate("Plan"),
      accessorFn: (e) => entrySummary(e),
      cell: ({ row }) => <span className="whitespace-nowrap">{entrySummary(row.original)}</span>,
    },
    {
      id: "accrued",
      header: translate("Accrued"),
      accessorFn: (e) => (e.details.kind === "share_gain" ? e.details.eventDate : ""),
      cell: ({ row }) => <span className="num whitespace-nowrap">{entryPeriod(row.original)}</span>,
      meta: { numeric: true, headerClassName: "hidden sm:table-cell", cellClassName: "hidden sm:table-cell" },
    },
    {
      id: "shares",
      header: translate("Shares"),
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
      header: translate("Gross gain"),
      accessorFn: (e) => e.computed?.valueCents ?? -1,
      cell: ({ row }) =>
        row.original.computed ? (
          <span className="num">{formatMoney(row.original.computed.valueCents)}</span>
        ) : (
          <span className="text-danger-300">{translate("Fix this record")}</span>
        ),
      meta: { numeric: true },
    },
  ];

  type Totals = NonNullable<typeof q.data>["employees"][number];
  const totalColumns: ColumnDef<Totals, unknown>[] = [
    { id: "employee", header: translate("Employee"), accessorFn: (t) => t.employeeName },
    {
      id: "d8",
      header: translate("d8 Benefits-in-kind"),
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
        crumbs={[{ label: translate("Payroll"), to: "/payroll" }]}
        title={translate("Year end {year}", { year })}
        description={translate(
          "Benefits-in-kind (Appendix 8A) and share-plan gains (Appendix 8B) for the IR8A of income year {year}, Year of Assessment {assessment}. Crow HR works out the values IRAS gives a formula for; you enter the rest.",
          { year, assessment: year + 1 },
        )}
        actions={
          <nav aria-label={translate("Income year")} className="flex gap-1">
            <Button asChild size="sm" variant="ghost">
              <Link
                to="/payroll/year-end/$year"
                params={{ year: String(year - 1) }}
                aria-label={translate("Year end {year}", { year: year - 1 })}
              >
                <ChevronLeft aria-hidden /> {year - 1}
              </Link>
            </Button>
            <Button asChild size="sm" variant="ghost">
              <Link
                to="/payroll/year-end/$year"
                params={{ year: String(year + 1) }}
                aria-label={translate("Year end {year}", { year: year + 1 })}
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
            <h2 id="totals-title" className={`mb-1 ${textStyle.section}`}>
              {translate("IR8A totals")}
            </h2>
            <p className="mb-3 max-w-2xl text-ui text-primary-300">
              {translate(
                "Whole dollars, decimals dropped. myTax computes d7 and d8 from the appendix sheets after import: check them against these.",
              )}{" "}
              <Link to="/payroll" className="focus-ring rounded-sm font-medium underline">
                {translate("Download the sheets from the IR8A panel on the Payroll page.")}
              </Link>
            </p>
            <DataTable
              label={translate("IR8A totals per employee")}
              columns={totalColumns}
              data={q.data?.employees ?? []}
              loading={q.isPending}
              getRowId={(t) => t.employeeId}
              empty={
                <EmptyState
                  variant="plain"
                  title={translate("No appendix records in {year} yet.", { year })}
                  description={translate("Each employee with a benefit or share gain below gets a row here.")}
                />
              }
            />
          </section>
          <section aria-labelledby="a8a-title" className="mb-8">
            <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
              <div>
                <h2 id="a8a-title" className={textStyle.section}>
                  {translate("Appendix 8A: benefits-in-kind")}
                </h2>
                <p className="mt-1 max-w-2xl text-ui text-primary-300">
                  {translate(
                    "Housing, hotel stays, cars, home leave passages and other non-cash benefits. Leave out benefits IRAS exempts.",
                  )}
                </p>
              </div>
              {addBenefit}
            </div>
            <DataTable
              label={translate("Appendix 8A benefits-in-kind")}
              columns={benefitColumns}
              data={benefits}
              loading={q.isPending}
              getRowId={(e) => e.id}
              onRowActivate={(row) => open(row.original)}
              empty={
                <EmptyState
                  variant="plain"
                  title={translate("No benefits-in-kind recorded for {year}.", { year })}
                  description={
                    canEdit
                      ? translate(
                          "Add each place of residence, hotel stay, car or other benefit the employer provided with Add benefit. Crow HR values housing and cars with IRAS's formulas.",
                        )
                      : translate(
                          "A payroll admin records each place of residence, hotel stay, car or other benefit here.",
                        )
                  }
                />
              }
            />
          </section>
          <section aria-labelledby="a8b-title" className="mb-8">
            <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
              <div>
                <h2 id="a8b-title" className={textStyle.section}>
                  {translate("Appendix 8B: share-plan gains")}
                </h2>
                <p className="mt-1 max-w-2xl text-ui text-primary-300">
                  {translate(
                    "ESOP and ESOW gains in the year they accrue: (market value − price paid) × shares. Gains of leaving foreigners under the deemed exercise rule go in their IR21, not here.",
                  )}
                </p>
              </div>
              {addGain}
            </div>
            <DataTable
              label={translate("Appendix 8B share-plan gains")}
              columns={gainColumns}
              data={gains}
              loading={q.isPending}
              getRowId={(e) => e.id}
              onRowActivate={(row) => open(row.original)}
              empty={
                <EmptyState
                  variant="plain"
                  title={translate("No share-plan gains recorded for {year}.", { year })}
                  description={
                    canEdit
                      ? translate(
                          "Add each exercise of an option, or each vesting or grant of shares, with Add share gain and the prices in S$.",
                        )
                      : translate(
                          "A payroll admin records each exercise of an option, or each vesting or grant of shares, here.",
                        )
                  }
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
