import type { DirectoryRowDto } from "@crowhr/core";
import {
  Avatar,
  Button,
  type ColumnDef,
  DataTable,
  EmptyState,
  formatDate,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@crowhr/ui";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Download, Search, Upload, UserPlus, Users } from "lucide-react";
import * as React from "react";
import { PageHeader } from "../../../components/page-header.tsx";
import { directoryQuery, structureQuery } from "./-lib/api.ts";
import { EmployeeStatus, ErrorPanel, PassPill } from "./-lib/ui.tsx";

interface PeopleSearch {
  q?: string;
  department?: string;
  location?: string;
  status?: string;
}

export const Route = createFileRoute("/_app/people/")({
  validateSearch: (s: Record<string, unknown>): PeopleSearch => ({
    q: typeof s.q === "string" && s.q ? s.q : undefined,
    department: typeof s.department === "string" && s.department ? s.department : undefined,
    location: typeof s.location === "string" && s.location ? s.location : undefined,
    status: typeof s.status === "string" && s.status ? s.status : undefined,
  }),
  component: PeoplePage,
});

const STATUS_OPTIONS = [
  { value: "current", label: "Current staff" },
  { value: "active", label: "Active" },
  { value: "leaving", label: "Leaving" },
  { value: "not_started", label: "Not started" },
  { value: "former", label: "Former" },
  { value: "all", label: "Everyone" },
];

const statusFilter = (s: string | undefined) =>
  s === "all" ? undefined : !s || s === "current" ? "active,leaving,not_started" : s;

const columns: ColumnDef<DirectoryRowDto, unknown>[] = [
  {
    id: "name",
    header: "Name",
    accessorFn: (r) => r.name,
    cell: ({ row }) => (
      <div className="flex min-w-0 items-baseline gap-2 whitespace-nowrap">
        <Link
          to="/people/$employeeId"
          params={{ employeeId: row.original.id }}
          className="focus-ring truncate rounded-sm font-medium hover:underline"
          tabIndex={-1}
        >
          {row.original.name}
        </Link>
        <span className="num shrink-0 text-2xs text-primary-200">{row.original.employeeNumber}</span>
      </div>
    ),
  },
  {
    id: "jobTitle",
    header: "Job title",
    accessorFn: (r) => r.jobTitle ?? "",
    cell: ({ getValue }) => (
      <span className="block max-w-[14rem] truncate whitespace-nowrap">{(getValue() as string) || "—"}</span>
    ),
  },
  {
    id: "department",
    header: "Department",
    accessorFn: (r) => r.department?.name ?? "",
    cell: ({ row }) => (
      <span className="block max-w-[16rem] truncate whitespace-nowrap" title={row.original.team?.name}>
        {row.original.department?.name ?? "—"}
        {row.original.team ? <span className="text-primary-200"> · {row.original.team.name}</span> : null}
      </span>
    ),
  },
  {
    id: "location",
    header: "Location",
    accessorFn: (r) => r.location?.name ?? "",
    cell: ({ getValue }) => (
      <span className="block max-w-[11rem] truncate whitespace-nowrap">{(getValue() as string) || "—"}</span>
    ),
    meta: { headerClassName: "hidden 2xl:table-cell", cellClassName: "hidden 2xl:table-cell" },
  },
  {
    id: "manager",
    header: "Manager",
    accessorFn: (r) => r.manager?.name ?? "",
    cell: ({ getValue }) => (
      <span className="block max-w-[9rem] truncate whitespace-nowrap">{(getValue() as string) || "—"}</span>
    ),
    meta: { headerClassName: "hidden xl:table-cell", cellClassName: "hidden xl:table-cell" },
  },
  {
    id: "status",
    header: "Status",
    accessorFn: (r) => r.status.code,
    cell: ({ row }) => (
      <div className="flex gap-1 whitespace-nowrap">
        {row.original.status.code === "active" ? (
          <span className="text-primary-300">Active</span>
        ) : (
          <EmployeeStatus status={row.original.status} />
        )}
        <PassPill state={row.original.workPassState} />
      </div>
    ),
  },
  {
    id: "hireDate",
    header: "Started",
    accessorFn: (r) => r.hireDate ?? "",
    cell: ({ getValue }) => (getValue() ? formatDate(getValue() as string) : "—"),
    meta: { numeric: true, headerClassName: "hidden md:table-cell", cellClassName: "hidden md:table-cell" },
  },
];

function PeoplePage() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const [q, setQ] = React.useState(search.q ?? "");
  React.useEffect(() => {
    const id = setTimeout(() => {
      if ((search.q ?? "") !== q)
        void navigate({ search: (s: PeopleSearch) => ({ ...s, q: q || undefined }), replace: true });
    }, 200);
    return () => clearTimeout(id);
  }, [q, search.q, navigate]);

  const departments = useQuery(structureQuery("departments"));
  const locations = useQuery(structureQuery("locations"));
  const query = useQuery(
    directoryQuery({
      q: search.q,
      departmentId: search.department,
      locationId: search.location,
      status: statusFilter(search.status),
    }),
  );
  const setFilter = (key: keyof PeopleSearch, value: string | undefined) =>
    void navigate({ search: (s: PeopleSearch) => ({ ...s, [key]: value && value !== "any" ? value : undefined }) });
  const filtered = !!(
    search.q ||
    search.department ||
    search.location ||
    (search.status && search.status !== "current")
  );

  const exportHref = `/api/v1/employees/export?format=csv${search.department ? `&departmentId=${search.department}` : ""}${statusFilter(search.status) ? `&status=${statusFilter(search.status)}` : ""}${search.q ? `&q=${encodeURIComponent(search.q)}` : ""}`;

  return (
    <>
      <PageHeader
        title="People"
        description={
          query.data ? (
            <>
              <span className="num">{query.data.total}</span> {query.data.total === 1 ? "person" : "people"}
              {filtered ? " match these filters" : ""}
            </>
          ) : (
            "Employee records, work passes and job history."
          )
        }
        actions={
          <>
            <Button asChild variant="ghost" size="sm">
              <a href={exportHref} download>
                <Download aria-hidden /> Export
              </a>
            </Button>
            <Button asChild size="sm">
              <Link to="/people/import">
                <Upload aria-hidden /> Import
              </Link>
            </Button>
            <Button asChild variant="primary" size="sm">
              <Link to="/people/new">
                <UserPlus aria-hidden /> Add employee
              </Link>
            </Button>
          </>
        }
      />
      <div className="mb-3 grid grid-cols-2 gap-2 sm:flex sm:flex-row sm:flex-wrap sm:items-center">
        <div className="relative col-span-2 sm:w-72">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-primary-200"
            aria-hidden
          />
          <Input
            aria-label="Search people"
            placeholder="Search name, number, email…"
            className="pl-9"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <FilterSelect
          label="Department"
          value={search.department}
          onChange={(v) => setFilter("department", v)}
          options={(departments.data?.items ?? []).map((d) => ({ value: d.id, label: d.name }))}
        />
        <FilterSelect
          label="Location"
          value={search.location}
          onChange={(v) => setFilter("location", v)}
          options={(locations.data?.items ?? []).map((d) => ({ value: d.id, label: d.name }))}
        />
        <Select
          value={search.status ?? "current"}
          onValueChange={(v) => setFilter("status", v === "current" ? undefined : v)}
        >
          <SelectTrigger aria-label="Status" className="sm:w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {STATUS_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {filtered ? (
          <Button
            variant="link"
            size="sm"
            onClick={() => {
              setQ("");
              void navigate({ search: {} });
            }}
          >
            Clear filters
          </Button>
        ) : null}
      </div>
      {query.isError ? (
        <ErrorPanel error={query.error} onRetry={() => void query.refetch()} />
      ) : (
        <>
          <MobileList rows={query.data?.items} loading={query.isPending} />
          <DataTable
            className={query.data?.items.length ? "hidden sm:block" : undefined}
            label="People"
            columns={columns}
            data={query.data?.items ?? []}
            getRowId={(r) => r.id}
            loading={query.isPending}
            onRowActivate={(row) =>
              void navigate({ to: "/people/$employeeId", params: { employeeId: row.original.id } })
            }
            empty={
              filtered ? (
                <EmptyState
                  variant="plain"
                  icon={<Search />}
                  title="No one matches"
                  description="Try a different name or clear the filters."
                />
              ) : (
                <EmptyState
                  variant="plain"
                  icon={<Users />}
                  title="No employees yet"
                  description="Add your first employee, or import everyone from a spreadsheet."
                  actions={
                    <>
                      <Button asChild variant="primary" size="sm">
                        <Link to="/people/new">Add employee</Link>
                      </Button>
                      <Button asChild size="sm">
                        <Link to="/people/import">Import CSV</Link>
                      </Button>
                    </>
                  }
                />
              )
            }
          />
        </>
      )}
    </>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string | undefined;
  onChange: (v: string | undefined) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <Select value={value ?? "any"} onValueChange={(v) => onChange(v === "any" ? undefined : v)}>
      <SelectTrigger aria-label={label} className="sm:w-48">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="any">All {label.toLowerCase()}s</SelectItem>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** Phones: a compact list instead of a wide table. */
function MobileList({ rows, loading }: { rows: DirectoryRowDto[] | undefined; loading: boolean }) {
  if (loading || !rows?.length) return null;
  return (
    <ul className="divide-y divide-border rounded-lg border border-border sm:hidden" aria-label="People">
      {rows.map((r) => (
        <li key={r.id}>
          <Link
            to="/people/$employeeId"
            params={{ employeeId: r.id }}
            className="focus-ring flex items-center gap-3 px-3 py-2.5 hover:bg-ink/[0.03]"
          >
            <Avatar name={r.name} size="sm" />
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium">{r.name}</span>
              <span className="block truncate text-2xs text-primary-200">
                {r.jobTitle ?? "—"} · {r.department?.name ?? "—"}
              </span>
            </span>
            <span className="flex shrink-0 flex-col items-end gap-1">
              {r.status.code !== "active" ? <EmployeeStatus status={r.status} /> : null}
              <PassPill state={r.workPassState} />
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
