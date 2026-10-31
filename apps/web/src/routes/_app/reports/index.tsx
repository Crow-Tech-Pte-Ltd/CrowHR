import { Card, EmptyState, Skeleton, StatusPill } from "@crowhr/ui";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { BarChart3, ChevronRight } from "lucide-react";
import { PageHeader } from "../../../components/page-header.tsx";
import { ErrorNote } from "../../../components/section.tsx";
import { type CatalogueEntry, catalogueQuery, MODULE_LABEL } from "../../../reports/api.ts";

export const Route = createFileRoute("/_app/reports/")({
  component: ReportsCatalogue,
});

function ReportsCatalogue() {
  const q = useQuery(catalogueQuery);
  const items = q.data?.items ?? [];
  const groups = new Map<string, CatalogueEntry[]>();
  for (const r of items) groups.set(r.module, [...(groups.get(r.module) ?? []), r]);
  return (
    <>
      <PageHeader
        title="Reports"
        description="Fixed reports from your own data, limited to what your role may see. Every report exports to CSV and Excel."
      />
      {q.isError ? (
        <Card>
          <ErrorNote error={q.error} retry={() => void q.refetch()} />
        </Card>
      ) : q.isPending ? (
        <div className="grid gap-3">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          icon={<BarChart3 />}
          title="No reports for your role"
          description="Reports are for owners, HR and payroll admins, and managers (for their team). Ask an owner if you need access."
        />
      ) : (
        <div className="flex flex-col gap-8">
          {[...groups].map(([module, reports]) => (
            <section key={module} aria-labelledby={`reports-${module}`}>
              <h2
                id={`reports-${module}`}
                className="mb-2 font-azeret text-xs font-semibold uppercase tracking-wider text-primary-300"
              >
                {MODULE_LABEL[module] ?? module}
              </h2>
              <Card className="divide-y divide-ink/10">
                {reports.map((r) => (
                  <Link
                    key={r.id}
                    to="/reports/$reportId"
                    params={{ reportId: r.id }}
                    className="focus-ring flex items-center gap-3 px-4 py-3 hover:bg-ink/[0.03]"
                    data-testid={`report-${r.id}`}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-2 font-medium">
                        {r.title}
                        {r.scope === "team" ? <StatusPill tone="info">Your team</StatusPill> : null}
                      </span>
                      <span className="block text-ui text-primary-300">{r.description}</span>
                    </span>
                    <ChevronRight className="size-4 shrink-0 text-primary-200" aria-hidden />
                  </Link>
                ))}
              </Card>
            </section>
          ))}
        </div>
      )}
    </>
  );
}
