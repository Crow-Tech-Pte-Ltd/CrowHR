import {
  Button,
  EmptyState,
  FormField,
  Input,
  Pagination,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@crowhr/ui";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Download, ScrollText } from "lucide-react";
import * as React from "react";
import { formatDateTime } from "../../../auth/format.ts";
import { can, useMe } from "../../../auth/session.ts";
import type { AuditEvent, Page } from "../../../auth/types.ts";
import { PageHeader } from "../../../components/page-header.tsx";
import { ErrorNote } from "../../../components/section.tsx";
import { apiGet } from "../../../lib/api.ts";
import { ACTION_OPTIONS, actionFilterValue, actionLabel, targetTypeLabel } from "../../../settings/audit-labels.ts";

export const Route = createFileRoute("/_app/settings/audit")({
  component: AuditLogPage,
});

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function AuditLogPage() {
  const me = useMe();
  const [draft, setDraft] = React.useState({ action: "", targetType: "", from: "", to: "" });
  const [filters, setFilters] = React.useState(draft);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [page, setPage] = React.useState(1);
  const [open, setOpen] = React.useState<string | null>(null);

  const params = new URLSearchParams({ page: String(page), pageSize: "50" });
  for (const [k, v] of Object.entries(filters)) if (v.trim()) params.set(k, v.trim());
  const list = useQuery({
    queryKey: ["audit", params.toString()],
    queryFn: () => apiGet<Page<AuditEvent>>(`/api/v1/audit-events?${params}`),
    placeholderData: keepPreviousData,
    enabled: can(me, "audit_log:read"),
  });

  if (!can(me, "audit_log:read")) {
    return (
      <>
        <PageHeader crumbs={[{ label: "Settings", to: "/settings" }]} title="Audit log" />
        <EmptyState
          icon={<ScrollText />}
          title="You can't see the audit log"
          description="Owners, HR admins and payroll admins can read the parts of the log that concern them."
        />
      </>
    );
  }

  const apply = (e: React.FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (draft.from && !DATE_RE.test(draft.from)) errs.from = "Use YYYY-MM-DD, like 2026-10-01.";
    if (draft.to && !DATE_RE.test(draft.to)) errs.to = "Use YYYY-MM-DD, like 2026-10-31.";
    if (draft.from && draft.to && draft.from > draft.to) errs.to = "The end date must be on or after the start date.";
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setPage(1);
    // The API filters by key; a label picked or typed ("Signed in") is sent as its key.
    setFilters({ ...draft, action: actionFilterValue(draft.action) });
  };
  const exportParams = new URLSearchParams(params);
  exportParams.delete("page");
  exportParams.delete("pageSize");
  const scopeNote = me.roles.includes("owner")
    ? "You see every event."
    : me.roles.includes("hr_admin") && me.roles.includes("payroll_admin")
      ? "You see everything except security-settings and single sign-on changes."
      : me.roles.includes("hr_admin")
        ? "You see everything except security-settings, single sign-on and payroll events."
        : "You see payroll, compensation and bank events.";

  return (
    <>
      <PageHeader
        crumbs={[{ label: "Settings", to: "/settings" }]}
        title="Audit log"
        description={`Every sign-in, permission change and sensitive action, in order. Entries can't be edited or deleted. ${scopeNote}`}
        actions={
          can(me, "audit_log:export") ? (
            <Button asChild variant="secondary">
              <a href={`/api/v1/audit-events/export.csv?${exportParams}`} download>
                <Download />
                Export CSV
              </a>
            </Button>
          ) : null
        }
      />
      <form
        onSubmit={apply}
        noValidate
        className="mb-4 grid gap-3 sm:grid-cols-5 sm:items-end"
        aria-label="Filter audit log"
      >
        <FormField label="Action or prefix">
          <Input
            value={draft.action}
            onChange={(e) => setDraft({ ...draft, action: e.target.value })}
            placeholder="Signed in, or auth."
            list="audit-action-options"
          />
        </FormField>
        <datalist id="audit-action-options">
          {ACTION_OPTIONS.map((o) => (
            <option key={o.key} value={o.key}>
              {o.label}
            </option>
          ))}
        </datalist>
        <FormField label="Target type">
          <Input
            value={draft.targetType}
            onChange={(e) => setDraft({ ...draft, targetType: e.target.value })}
            placeholder="membership"
          />
        </FormField>
        <FormField label="From" error={errors.from}>
          <Input
            value={draft.from}
            onChange={(e) => setDraft({ ...draft, from: e.target.value })}
            placeholder="2026-10-01"
            inputMode="numeric"
          />
        </FormField>
        <FormField label="To" error={errors.to}>
          <Input
            value={draft.to}
            onChange={(e) => setDraft({ ...draft, to: e.target.value })}
            placeholder="2026-10-31"
            inputMode="numeric"
          />
        </FormField>
        <Button type="submit">Apply filters</Button>
      </form>
      <div className="rounded-lg border border-border">
        {list.isPending ? (
          <div className="flex flex-col gap-2 p-4" role="status" aria-busy="true" aria-label="Loading audit log">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-9 w-full" />
            ))}
          </div>
        ) : list.isError ? (
          <ErrorNote error={list.error} retry={() => void list.refetch()} />
        ) : list.data.items.length === 0 ? (
          <EmptyState
            variant="plain"
            icon={<ScrollText />}
            title="No events match"
            description="Widen the dates or clear the filters."
          />
        ) : (
          <Table data-testid="audit-table">
            <TableHeader>
              <TableRow>
                <TableHead className="w-44">Time (SGT)</TableHead>
                <TableHead>Action</TableHead>
                <TableHead className="hidden md:table-cell">By</TableHead>
                <TableHead className="hidden lg:table-cell">Target</TableHead>
                <TableHead className="hidden lg:table-cell">IP</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.data.items.map((e) => (
                <React.Fragment key={e.id}>
                  <TableRow className="cursor-pointer" onClick={() => setOpen(open === e.id ? null : e.id)}>
                    <TableCell className="num">
                      {/* The row opens on click too; this button is the keyboard and screen reader control. */}
                      <button
                        type="button"
                        className="focus-ring rounded-sm text-left"
                        aria-expanded={open === e.id}
                        aria-label={`${formatDateTime(e.at)}, ${actionLabel(e.action)}: ${open === e.id ? "hide" : "show"} details`}
                        onClick={(ev) => {
                          ev.stopPropagation();
                          setOpen(open === e.id ? null : e.id);
                        }}
                      >
                        {formatDateTime(e.at)}
                      </button>
                    </TableCell>
                    <TableCell>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span>{actionLabel(e.action)}</span>
                        </TooltipTrigger>
                        <TooltipContent>{e.action}</TooltipContent>
                      </Tooltip>
                    </TableCell>
                    <TableCell className="hidden md:table-cell">
                      {e.actorLabel ?? (e.actorType === "anonymous" ? "Not signed in" : e.actorType)}
                    </TableCell>
                    <TableCell className="hidden lg:table-cell">
                      <AuditTarget event={e} />
                    </TableCell>
                    <TableCell className="num hidden lg:table-cell">{e.ip ?? "—"}</TableCell>
                  </TableRow>
                  {open === e.id ? (
                    <TableRow>
                      <TableCell colSpan={5} className="bg-surface-100">
                        <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all font-azeret text-2xs">
                          {JSON.stringify(
                            {
                              seq: e.seq,
                              action: e.action,
                              target: `${e.targetType}:${e.targetId ?? ""}`,
                              diff: e.diff,
                              meta: e.meta,
                            },
                            null,
                            2,
                          )}
                        </pre>
                      </TableCell>
                    </TableRow>
                  ) : null}
                </React.Fragment>
              ))}
            </TableBody>
          </Table>
        )}
        {list.data && list.data.total > list.data.pageSize ? (
          <Pagination
            page={page}
            pageSize={list.data.pageSize}
            total={list.data.total}
            onPageChange={setPage}
            className="border-t border-border px-3"
          />
        ) : null}
      </div>
    </>
  );
}

/** "Tan Mei Ling · Member", or just the type when the target has no name; full id in the tooltip. */
function AuditTarget({ event: e }: { event: AuditEvent }) {
  const type = targetTypeLabel(e.targetType);
  const text = e.targetLabel ? (
    <span>
      {e.targetLabel}
      <span className="text-2xs text-primary-300"> · {type}</span>
    </span>
  ) : (
    <span className="text-primary-300">{type}</span>
  );
  if (!e.targetId) return text;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{text}</TooltipTrigger>
      <TooltipContent className="max-w-none">
        {e.targetType}:{e.targetId}
      </TooltipContent>
    </Tooltip>
  );
}
