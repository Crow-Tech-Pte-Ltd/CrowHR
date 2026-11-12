import {
  Button,
  Card,
  Checkbox,
  cn,
  DatePicker,
  EmptyState,
  FormField,
  Input,
  Pagination,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
  textStyle,
} from "@crowhr/ui";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { ArrowDown, ArrowUp, Download, Info } from "lucide-react";
import { PageHeader } from "../../../components/page-header.tsx";
import { ErrorNote } from "../../../components/section.tsx";
import { ApiError } from "../../../lib/api.ts";
import {
  type Cell,
  type ColumnType,
  exportHref,
  formatCell,
  isNumeric,
  type ReportResult,
  reportQuery,
} from "../../../reports/api.ts";

type Search = Record<string, string>;

export const Route = createFileRoute("/_app/reports/$reportId")({
  validateSearch: (s: Record<string, unknown>): Search =>
    Object.fromEntries(Object.entries(s).flatMap(([k, v]) => (v === undefined || v === null ? [] : [[k, String(v)]]))),
  component: ReportPage,
});

function ReportPage() {
  const { reportId } = Route.useParams();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const q = useQuery(reportQuery(reportId, search));
  const set = (patch: Search) => {
    const next: Search = { ...search, ...patch };
    for (const k of Object.keys(next)) if (next[k] === "") delete next[k];
    if (!("page" in patch)) delete next.page;
    void navigate({ search: next, replace: true });
  };
  const data = q.data;
  const err = q.error instanceof ApiError ? q.error : null;
  const title = data?.report.title ?? (q.isPending ? "Loading…" : "Report");
  // Echo the resolved parameters (defaults filled by the server) into the export links.
  const params: Search = {};
  for (const [k, v] of Object.entries(data?.params ?? {})) if (v !== undefined && v !== null) params[k] = String(v);
  if (search.columns) params.columns = search.columns;
  if (search.sort) params.sort = search.sort;
  if (search.dir) params.dir = search.dir;

  return (
    <>
      <PageHeader
        crumbs={[{ label: "Reports", to: "/reports" }]}
        title={title}
        description={data?.report.description}
        actions={
          data?.canExport ? (
            <>
              <Button asChild size="sm">
                <a href={exportHref(reportId, params, "csv")} download data-testid="export-csv">
                  <Download aria-hidden /> CSV
                </a>
              </Button>
              <Button asChild size="sm">
                <a href={exportHref(reportId, params, "xlsx")} download data-testid="export-xlsx">
                  <Download aria-hidden /> Excel
                </a>
              </Button>
            </>
          ) : null
        }
      />
      {data ? <Parameters data={data} onChange={set} search={search} /> : null}
      {err && err.status === 403 ? (
        <EmptyState
          title="You can't run this report."
          description="Your role doesn't include this report. Ask an owner if you need access."
        />
      ) : err && err.status === 404 ? (
        <EmptyState title="Report not found." description="This report isn't available on this server." />
      ) : q.isError && !data ? (
        <Card>
          <ErrorNote error={q.error} retry={() => void q.refetch()} />
        </Card>
      ) : !data ? (
        <Card className="p-4">
          <Skeleton className="h-40 w-full" />
        </Card>
      ) : (
        <ReportBody
          data={data}
          search={search}
          onChange={set}
          stale={q.isFetching}
          error={q.isError ? q.error : null}
        />
      )}
    </>
  );
}

function Parameters({ data, search, onChange }: { data: ReportResult; search: Search; onChange: (p: Search) => void }) {
  const requested = new Set((search.columns ?? "").split(",").filter(Boolean));
  return (
    <div className="mb-4 flex flex-wrap items-end gap-3" data-testid="report-params">
      {data.fields.map((f) => {
        const value = String(data.params[f.key] ?? "");
        const id = `param-${f.key}`;
        return (
          <FormField key={f.key} label={f.label} id={id} hint={f.hint}>
            {f.kind === "date" ? (
              <DatePicker
                id={id}
                value={value || null}
                onChange={(v) => onChange({ [f.key]: v ?? "" })}
                className="w-40"
              />
            ) : f.kind === "month" ? (
              <Input
                id={id}
                type="month"
                value={value}
                onChange={(e) => onChange({ [f.key]: e.target.value })}
                className="num w-48"
              />
            ) : (
              <Select value={value} onValueChange={(v) => onChange({ [f.key]: v })}>
                <SelectTrigger id={id} aria-label={f.label} className="w-56">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(f.options ?? []).map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </FormField>
        );
      })}
      {data.optionalColumns.map((c) => (
        <div key={c.key} className="flex h-9 items-center gap-2 text-ui">
          <Checkbox
            id={`col-${c.key}`}
            checked={requested.has(c.key)}
            onCheckedChange={(on) => {
              const next = new Set(requested);
              if (on) next.add(c.key);
              else next.delete(c.key);
              onChange({ columns: [...next].join(",") });
            }}
          />
          <label htmlFor={`col-${c.key}`}>Show {c.title.charAt(0).toLowerCase() + c.title.slice(1)}</label>
        </div>
      ))}
    </div>
  );
}

function ReportBody({
  data,
  search,
  onChange,
  stale,
  error,
}: {
  data: ReportResult;
  search: Search;
  onChange: (p: Search) => void;
  stale: boolean;
  error: unknown;
}) {
  const sortBy = (key: string) =>
    onChange({
      sort: key,
      dir: data.sort.key === key && data.sort.dir === "asc" ? "desc" : "asc",
      page: search.page ?? "",
    });
  return (
    <div className={cn("flex flex-col gap-4 transition-opacity", stale && "opacity-70")} aria-busy={stale}>
      {error ? (
        <Card>
          <ErrorNote error={error} />
        </Card>
      ) : null}
      {data.redactedColumns.length ? (
        <p className="flex items-center gap-2 text-ui text-primary-300" data-testid="redacted-note">
          <Info className="size-4" aria-hidden />
          Pay columns are left out because your role doesn't include salary access.
        </p>
      ) : null}
      {data.summary.length ? (
        <dl className="grid grid-cols-2 gap-x-6 gap-y-3 lg:grid-cols-4" data-testid="report-summary">
          {data.summary.map((s) => (
            <div key={s.label} className="border-l-2 border-ink/10 pl-3">
              <dt className="text-2xs text-primary-300">{s.label}</dt>
              <dd className={cn("font-medium", isNumeric(s.type) && "num")} title={s.hint}>
                {s.value === null ? "n/a" : formatCell(s.value, s.type)}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
      <Card className="overflow-hidden">
        {data.totalRows === 0 ? (
          <EmptyState
            variant="plain"
            title="Nothing to show."
            description={data.emptyMessage ?? "No rows for these parameters. Widen them and try again."}
            data-testid="report-empty"
          />
        ) : (
          <div className="max-h-[70vh] overflow-auto">
            <Table aria-label={data.report.title}>
              <TableHeader className="sticky top-0 z-10 bg-surface-50 shadow-[0_1px_0_0_hsl(var(--ink)/0.1)]">
                <TableRow>
                  {data.columns.map((c) => {
                    const active = data.sort.key === c.key;
                    return (
                      <TableHead
                        key={c.key}
                        numeric={isNumeric(c.type)}
                        aria-sort={active ? (data.sort.dir === "asc" ? "ascending" : "descending") : "none"}
                      >
                        <button
                          type="button"
                          onClick={() => sortBy(c.key)}
                          className={cn(
                            "focus-ring inline-flex items-center gap-1 rounded-sm uppercase",
                            active && "text-ink",
                          )}
                        >
                          {c.title}
                          {active ? (
                            data.sort.dir === "asc" ? (
                              <ArrowUp className="size-3" aria-hidden />
                            ) : (
                              <ArrowDown className="size-3" aria-hidden />
                            )
                          ) : null}
                        </button>
                      </TableHead>
                    );
                  })}
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.rows.map((r, i) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: report rows have no ID; the page is the identity.
                  <TableRow key={`${data.page}-${i}`} data-testid="report-row">
                    {data.columns.map((c) => (
                      <TableCell key={c.key} numeric={isNumeric(c.type)} className="h-9 py-1.5">
                        {formatCell(r[c.key], c.type, c.key)}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
              {data.totals ? (
                <TableFooter className="sticky bottom-0 bg-surface-100">
                  <TableRow data-testid="report-totals" className="font-semibold">
                    {data.columns.map((c) => (
                      <TableCell key={c.key} numeric={isNumeric(c.type)} className="h-9 py-1.5">
                        {data.totals?.[c.key] === undefined ? "" : formatCell(data.totals[c.key] as Cell, c.type)}
                      </TableCell>
                    ))}
                  </TableRow>
                </TableFooter>
              ) : null}
            </Table>
          </div>
        )}
        {data.totalRows > data.pageSize ? (
          <div className="border-t border-ink/10 px-3 py-2">
            <Pagination
              page={data.page}
              pageSize={data.pageSize}
              total={data.totalRows}
              onPageChange={(p) => onChange({ page: String(p) })}
            />
          </div>
        ) : null}
      </Card>
      {data.chart && data.totalRows > 1 ? <BarChart data={data} /> : null}
      {data.notes.length ? (
        <ul className="flex flex-col gap-1 text-2xs text-primary-300" data-testid="report-notes">
          {data.notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/**
 * One series, one hue (ink): horizontal bars from a zero baseline with 4px rounded data ends and a
 * 2px gap, values in text tokens beside the bars, a native tooltip per bar. The table above is the
 * accessible view; this chart only shows the rows on this page.
 */
function BarChart({ data }: { data: ReportResult }) {
  const chart = data.chart as { label: string; value: string };
  const label = data.columns.find((c) => c.key === chart.label);
  const value = data.columns.find((c) => c.key === chart.value);
  if (!label || !value) return null;
  // A label repeated across rows (e.g. a month split by department) makes the bars ambiguous.
  const labels = data.rows.map((r) => String(r[label.key]));
  if (new Set(labels).size !== labels.length) return null;
  const rows = data.rows
    .map((r) => ({ name: formatCell(r[label.key], label.type, label.key), v: Number(r[value.key] ?? 0) }))
    .filter((r) => Number.isFinite(r.v))
    .slice(0, 24);
  const max = Math.max(...rows.map((r) => Math.abs(r.v)), 1);
  const type: ColumnType = value.type;
  return (
    <figure
      className="rounded-lg border border-ink/10 bg-surface-50 p-4"
      aria-label={`${value.title} by ${label.title}`}
    >
      <figcaption className={cn("mb-3", textStyle.group)}>
        {value.title} by {label.title.toLowerCase()}
        {data.totalRows > rows.length ? (
          <span className="font-normal text-primary-300"> · rows on this page</span>
        ) : null}
      </figcaption>
      <ul className="flex flex-col gap-0.5">
        {rows.map((r, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: labels may repeat; position is the identity.
          <li key={`${r.name}-${i}`} className="group grid grid-cols-[minmax(6rem,12rem)_1fr] items-center gap-3">
            <span className="truncate text-2xs text-primary-300" title={r.name}>
              {r.name}
            </span>
            <span className="flex items-center gap-2" title={`${r.name}: ${formatCell(r.v, type)}`}>
              <span
                className="h-3.5 rounded-r-[4px] bg-ink/80 transition-colors group-hover:bg-ink"
                style={{ width: `${Math.max(0.5, (Math.abs(r.v) / max) * 100) * 0.8}%` }}
              />
              <span className="num text-2xs text-primary-300">{formatCell(r.v, type)}</span>
            </span>
          </li>
        ))}
      </ul>
    </figure>
  );
}
