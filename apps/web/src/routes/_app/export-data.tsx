import {
  Button,
  Card,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  EmptyState,
  Skeleton,
  textStyle,
} from "@crowhr/ui";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, linkOptions } from "@tanstack/react-router";
import { ChevronDown, ChevronRight, Download } from "lucide-react";
import { can, useMe } from "../../auth/session.ts";
import { PageHeader } from "../../components/page-header.tsx";
import { ErrorNote } from "../../components/section.tsx";
import {
  type CatalogueEntry,
  catalogueQuery,
  DATA_EXPORT_FORMATS,
  exportHref,
  MODULE_LABEL,
  REPORT_EXPORT_FORMATS,
} from "../../reports/api.ts";
import { DownloadFeedback, useExportDownload } from "../../reports/download.tsx";

export const Route = createFileRoute("/_app/export-data")({
  component: ExportDataPage,
});

const fileWorkflows = linkOptions([
  {
    to: "/me/payslips",
    permission: "payslips:read",
    ownEmployee: true,
    title: "My payslips",
    detail: "Itemised payslip PDFs",
  },
  {
    to: "/payroll",
    permission: "payroll:read",
    ownEmployee: false,
    title: "Payroll runs and year-end",
    detail: "Payslip PDFs, CPF files, bank payment XML, IR8A and appendices",
  },
  {
    to: "/settings/leave",
    search: { tab: "claims" },
    permission: "leave_claims:read",
    ownEmployee: false,
    title: "Government-paid leave claims",
    detail: "Claim CSV with filing details",
  },
  {
    to: "/documents",
    permission: "documents:read",
    ownEmployee: false,
    title: "Documents",
    detail: "Generated letters and key employment terms, plus original attachments",
  },
  {
    to: "/documents",
    search: { tab: "acknowledgements" },
    permission: "documents:update",
    ownEmployee: false,
    title: "Document acknowledgements",
    detail: "Outstanding and completed acknowledgements CSV",
  },
  {
    to: "/schedules",
    permission: "rosters:update",
    ownEmployee: false,
    title: "Roster weeks",
    detail: "Shift assignments and conflicts CSV",
  },
  {
    to: "/settings/audit",
    permission: "audit_log:export",
    ownEmployee: false,
    title: "Audit log",
    detail: "Filtered activity CSV",
  },
]);

function ExportDataPage() {
  const me = useMe();
  const query = useQuery(catalogueQuery);
  const download = useExportDownload();
  const groups = new Map<string, CatalogueEntry[]>();
  for (const report of query.data?.items ?? []) {
    if (report.canExport) groups.set(report.module, [...(groups.get(report.module) ?? []), report]);
  }

  const workflows = fileWorkflows.filter(
    (file) => can(me, file.permission) && (!file.ownEmployee || Boolean(me.employeeId)),
  );
  // The employee directory's masked export already enforces the caller's directory scope.
  const canExportDirectory = can(me, "directory:read");
  const hasReports = groups.size > 0;
  const hasFiles = workflows.length > 0 || canExportDirectory;
  return (
    <>
      <PageHeader
        title="Export data"
        description={
          hasReports
            ? "Download a report with its default filters, or open the report to choose a period and columns."
            : undefined
        }
      />
      <DownloadFeedback download={download} />
      {query.isError ? <ErrorNote error={query.error} retry={() => void query.refetch()} /> : null}
      {query.isPending ? (
        <Skeleton className="mb-6 h-24 w-full" aria-label="Loading reports" />
      ) : !query.isError && !hasReports && !hasFiles ? (
        <EmptyState title="No downloads available." description="Reports and files you have access to appear here." />
      ) : null}
      <div className="flex flex-col gap-6">
        {[...groups].map(([module, reports]) => (
          <section key={module} aria-labelledby={`exports-${module}`}>
            <h2 id={`exports-${module}`} className={`mb-2 ${textStyle.section}`}>
              {MODULE_LABEL[module] ?? module}
            </h2>
            <Card className="divide-y divide-ink/10">
              {reports.map((report) => (
                <div key={report.id} className="flex items-center justify-between gap-3 px-4 py-2">
                  <Link
                    to="/reports/$reportId"
                    params={{ reportId: report.id }}
                    search={{}}
                    className="focus-ring rounded-sm font-medium hover:underline"
                  >
                    {report.title}
                  </Link>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        size="sm"
                        disabled={download.isPending}
                        className="shrink-0"
                        aria-label={`Download ${report.title}`}
                      >
                        <Download aria-hidden /> <span className="hidden sm:inline">Download</span>
                        <ChevronDown aria-hidden />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      {REPORT_EXPORT_FORMATS.map(({ id, label }) => (
                        <DropdownMenuItem key={id} onSelect={() => download.mutate(exportHref(report.id, {}, id))}>
                          {label} (.{id})
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              ))}
            </Card>
          </section>
        ))}
        {hasFiles ? (
          <section aria-labelledby="exports-files">
            <h2 id="exports-files" className={`mb-2 ${textStyle.section}`}>
              Other downloads
            </h2>
            <Card className="divide-y divide-ink/10">
              {canExportDirectory ? (
                <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2">
                  <Link to="/people" search={{}} className="focus-ring rounded-sm font-medium hover:underline">
                    Employee directory
                  </Link>
                  <div className="flex gap-2">
                    {DATA_EXPORT_FORMATS.map(({ id, label }) => (
                      <Button
                        key={id}
                        size="sm"
                        disabled={download.isPending}
                        onClick={() => download.mutate(`/api/v1/employees/export?format=${id}`)}
                        aria-label={`Download employee directory as ${label}`}
                      >
                        {label}
                      </Button>
                    ))}
                  </div>
                </div>
              ) : null}
              {workflows.map((file) => (
                <Link
                  key={file.title}
                  to={file.to}
                  search={"search" in file ? file.search : undefined}
                  className="focus-ring flex items-center justify-between gap-3 px-4 py-2 hover:bg-ink/[0.03]"
                >
                  <span>
                    <span className="block font-medium">{file.title}</span>
                    <span className="block text-ui text-primary-300">{file.detail}</span>
                  </span>
                  <ChevronRight className="size-4 shrink-0 text-primary-200" aria-hidden />
                </Link>
              ))}
            </Card>
          </section>
        ) : null}
      </div>
    </>
  );
}
