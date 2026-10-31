import type { StructureItem, StructureKind, WorkScheduleView } from "@crowhr/core";
import {
  Badge,
  Button,
  EmptyState,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  toast,
} from "@crowhr/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Archive, ArchiveRestore, CalendarClock, Network, Plus } from "lucide-react";
import * as React from "react";
import { PageHeader } from "../../../components/page-header.tsx";
import {
  api,
  errorDetails,
  errorMessage,
  fieldErrors,
  invalidatePeople,
  schedulesQuery,
  structureQuery,
} from "../people/-lib/api.ts";
import { ErrorPanel, PanelSkeleton, SelectInput, TextInput } from "../people/-lib/ui.tsx";

const TABS = ["departments", "teams", "locations", "cost-centres", "schedules"] as const;
type Tab = (typeof TABS)[number];

export const Route = createFileRoute("/_app/settings/structure")({
  validateSearch: (s: Record<string, unknown>): { tab?: Tab } => ({
    tab: TABS.includes(s.tab as Tab) ? (s.tab as Tab) : undefined,
  }),
  component: StructurePage,
});

const TITLES: Record<Tab, string> = {
  departments: "Departments",
  teams: "Teams",
  locations: "Locations",
  "cost-centres": "Cost centres",
  schedules: "Work schedules",
};

function StructurePage() {
  const { tab = "departments" } = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <>
      <PageHeader
        crumbs={[{ label: "Settings", to: "/settings" }]}
        title="Structure"
        description="How your company is organised. Entries are archived, never deleted, so history stays readable."
      />
      <Tabs
        value={tab}
        onValueChange={(v) =>
          void navigate({ search: { tab: v === "departments" ? undefined : (v as Tab) }, replace: true })
        }
      >
        <TabsList className="mb-4 max-w-full overflow-x-auto">
          {TABS.map((t) => (
            <TabsTrigger key={t} value={t}>
              {TITLES[t]}
            </TabsTrigger>
          ))}
        </TabsList>
        {(["departments", "teams", "locations", "cost-centres"] as const).map((k) => (
          <TabsContent key={k} value={k}>
            <StructureList kind={k} />
          </TabsContent>
        ))}
        <TabsContent value="schedules">
          <Schedules />
        </TabsContent>
      </Tabs>
    </>
  );
}

function StructureList({ kind }: { kind: StructureKind }) {
  const qc = useQueryClient();
  const q = useQuery(structureQuery(kind));
  const departments = useQuery({ ...structureQuery("departments"), enabled: kind === "teams" });
  const [name, setName] = React.useState("");
  const [code, setCode] = React.useState("");
  const [extra, setExtra] = React.useState("");
  const [showArchived, setShowArchived] = React.useState(false);
  const one = TITLES[kind as Tab]
    .replace(/s$/, "")
    .replace(/centre$/, "centre")
    .toLowerCase();
  const create = useMutation({
    mutationFn: () =>
      api<StructureItem>("POST", `/organisation/structure/${kind}`, {
        name,
        ...(kind === "departments" ? { code: code || null } : {}),
        ...(kind === "cost-centres" ? { code } : {}),
        ...(kind === "teams" ? { departmentId: extra || null } : {}),
        ...(kind === "locations" ? { postalCode: code || null, address: extra || null } : {}),
      }),
    onSuccess: async () => {
      setName("");
      setCode("");
      setExtra("");
      await invalidatePeople(qc);
    },
  });
  const archive = useMutation({
    mutationFn: (v: { id: string; archived: boolean }) =>
      api<StructureItem>("POST", `/organisation/structure/${kind}/${v.id}/archive`, { archived: v.archived }),
    onSuccess: async (_d, v) => {
      await invalidatePeople(qc);
      toast(v.archived ? "Archived" : "Restored");
    },
    onError: (err) => {
      const d = errorDetails<{ reason?: string; count?: number }>(err);
      toast(d?.reason === "in_use" ? `In use by ${d.count} employee${d.count === 1 ? "" : "s"}` : "Couldn't archive", {
        description: errorMessage(err),
      });
    },
  });
  const errs = fieldErrors(create.error);
  const items = (q.data?.items ?? []).filter((i) => showArchived || !i.archived);
  const archivedCount = (q.data?.items ?? []).filter((i) => i.archived).length;
  const deptName = new Map((departments.data?.items ?? []).map((d) => [d.id, d.name]));

  return (
    <div className="flex flex-col gap-4">
      <form
        className="grid items-end gap-3 rounded-lg border border-border bg-surface-50 p-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,12rem)_auto]"
        onSubmit={(e) => {
          e.preventDefault();
          create.mutate();
        }}
      >
        <TextInput
          label={kind === "cost-centres" ? "Name" : `New ${one}`}
          value={name}
          onChange={setName}
          error={errs.name ?? (create.isError && !Object.keys(errs).length ? errorMessage(create.error) : undefined)}
        />
        {kind === "cost-centres" || kind === "departments" ? (
          <TextInput
            label={kind === "cost-centres" ? "Code" : "Code (optional)"}
            mono
            value={code}
            onChange={setCode}
            error={errs.code}
            placeholder={kind === "cost-centres" ? "CC-100" : ""}
          />
        ) : kind === "teams" ? (
          <SelectInput
            label="Department (optional)"
            value={extra}
            onChange={setExtra}
            options={(departments.data?.items ?? [])
              .filter((d) => !d.archived)
              .map((d) => ({ value: d.id, label: d.name }))}
            error={errs.departmentId}
          />
        ) : (
          <TextInput
            label="Postal code"
            mono
            value={code}
            onChange={setCode}
            error={errs.postalCode}
            placeholder="079903"
          />
        )}
        <Button type="submit" variant="primary" disabled={create.isPending || !name.trim()}>
          <Plus aria-hidden /> Add
        </Button>
      </form>
      {q.isPending ? (
        <PanelSkeleton />
      ) : q.isError ? (
        <ErrorPanel error={q.error} onRetry={() => void q.refetch()} />
      ) : items.length === 0 ? (
        <EmptyState
          icon={<Network />}
          title={`No ${TITLES[kind as Tab].toLowerCase()} yet`}
          description={`Add your first ${one} above.`}
        />
      ) : (
        <Table aria-label={TITLES[kind as Tab]}>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              {kind === "cost-centres" || kind === "departments" ? <TableHead>Code</TableHead> : null}
              {kind === "teams" ? <TableHead>Department</TableHead> : null}
              {kind === "locations" ? <TableHead className="hidden sm:table-cell">Address</TableHead> : null}
              <TableHead numeric>Employees</TableHead>
              <TableHead className="w-28">
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((i) => (
              <TableRow key={i.id}>
                <TableCell>
                  {i.name} {i.archived ? <Badge variant="muted">Archived</Badge> : null}
                </TableCell>
                {kind === "cost-centres" || kind === "departments" ? (
                  <TableCell className="num">{i.code ?? "—"}</TableCell>
                ) : null}
                {kind === "teams" ? (
                  <TableCell>{i.departmentId ? (deptName.get(i.departmentId) ?? "—") : "—"}</TableCell>
                ) : null}
                {kind === "locations" ? (
                  <TableCell className="hidden sm:table-cell">
                    {[i.address, i.postalCode].filter(Boolean).join(", ") || "—"}
                  </TableCell>
                ) : null}
                <TableCell numeric>
                  {i.employeeCount && kind !== "cost-centres" ? (
                    <Link
                      className="text-biru-400 hover:underline"
                      to="/people"
                      search={
                        kind === "departments" ? { department: i.id } : kind === "locations" ? { location: i.id } : {}
                      }
                    >
                      {i.employeeCount}
                    </Link>
                  ) : (
                    i.employeeCount
                  )}
                </TableCell>
                <TableCell>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={archive.isPending}
                    onClick={() => archive.mutate({ id: i.id, archived: !i.archived })}
                  >
                    {i.archived ? <ArchiveRestore aria-hidden /> : <Archive aria-hidden />}{" "}
                    {i.archived ? "Restore" : "Archive"}
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      {archivedCount ? (
        <Button variant="link" size="sm" className="self-start" onClick={() => setShowArchived((v) => !v)}>
          {showArchived ? "Hide archived" : `Show ${archivedCount} archived`}
        </Button>
      ) : null}
    </div>
  );
}

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
type Day = { type: "working" | "half" | "off" | "rest"; minutes: number };
const defaultWeek = (): Day[] => [
  ...Array.from({ length: 5 }, () => ({ type: "working" as const, minutes: 480 })),
  { type: "off", minutes: 0 },
  { type: "rest", minutes: 0 },
];
const hours = (m: number) => `${Math.floor(m / 60)} h${m % 60 ? ` ${String(m % 60).padStart(2, "0")} min` : ""}`;

function Schedules() {
  const qc = useQueryClient();
  const q = useQuery(schedulesQuery);
  const [name, setName] = React.useState("");
  const [kind, setKind] = React.useState<"fixed" | "shift">("fixed");
  const [week, setWeek] = React.useState<Day[]>(defaultWeek);
  const [weekly, setWeekly] = React.useState("44");
  const create = useMutation({
    mutationFn: () =>
      api<WorkScheduleView>(
        "POST",
        "/organisation/work-schedules",
        kind === "fixed" ? { name, kind, days: week } : { name, kind, weeklyMinutes: Math.round(Number(weekly) * 60) },
      ),
    onSuccess: async () => {
      setName("");
      setWeek(defaultWeek());
      await invalidatePeople(qc);
      toast("Work schedule saved");
    },
  });
  const makeDefault = useMutation({
    mutationFn: (id: string) => api("POST", `/organisation/work-schedules/${id}/default`),
    onSuccess: () => invalidatePeople(qc),
  });
  const total = week.reduce((s, d) => s + d.minutes, 0);
  const errs = fieldErrors(create.error);
  const setDay = (i: number, patch: Partial<Day>) =>
    setWeek((w) =>
      w.map((d, j) => {
        if (j !== i) return d;
        const next = { ...d, ...patch };
        if (patch.type === "off" || patch.type === "rest") next.minutes = 0;
        if (patch.type === "working" && d.minutes === 0) next.minutes = 480;
        if (patch.type === "half" && (d.minutes === 0 || d.minutes >= 480)) next.minutes = 240;
        return next;
      }),
    );

  return (
    <div className="flex flex-col gap-4">
      {q.isPending ? (
        <PanelSkeleton rows={2} />
      ) : q.isError ? (
        <ErrorPanel error={q.error} />
      ) : q.data.items.length ? (
        <Table aria-label="Work schedules">
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Week</TableHead>
              <TableHead numeric>Contracted</TableHead>
              <TableHead className="w-36">
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {q.data.items.map((s) => (
              <TableRow key={s.id}>
                <TableCell>
                  {s.name} {s.isDefault ? <Badge variant="brand">Default</Badge> : null}
                </TableCell>
                <TableCell className="font-azeret text-2xs">
                  {s.kind === "shift"
                    ? "From rosters"
                    : (s.current?.days ?? []).map((d, i) => (
                        <span
                          key={DAYS[i]}
                          title={`${DAYS[i]}: ${d.type === "rest" ? "rest day" : d.type === "off" ? "off day" : d.type}`}
                          className={
                            d.type === "rest"
                              ? "font-bold text-danger-300 underline"
                              : d.type === "off"
                                ? "text-primary-200"
                                : ""
                          }
                        >
                          {DAYS[i]?.[0]}
                          {d.type === "half" ? "½" : ""}{" "}
                        </span>
                      ))}
                </TableCell>
                <TableCell numeric>{hours(s.current?.weeklyMinutes ?? 0)}</TableCell>
                <TableCell>
                  {!s.isDefault ? (
                    <Button size="sm" variant="ghost" onClick={() => makeDefault.mutate(s.id)}>
                      Make default
                    </Button>
                  ) : null}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : (
        <EmptyState
          icon={<CalendarClock />}
          title="No work schedule yet"
          description="Leave and overtime need each employee's working days and rest day. Create the default below."
        />
      )}
      <form
        className="flex flex-col gap-4 rounded-lg border border-border bg-surface-50 p-4"
        onSubmit={(e) => {
          e.preventDefault();
          create.mutate();
        }}
      >
        <h2 className="font-azeret text-2xs font-semibold uppercase tracking-wider">New work schedule</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <TextInput
            label="Name"
            required
            value={name}
            onChange={setName}
            error={errs.name}
            placeholder="Office 5-day"
          />
          <SelectInput
            label="Kind"
            value={kind}
            onChange={(v) => setKind(v as "fixed" | "shift")}
            options={[
              { value: "fixed", label: "Fixed week" },
              { value: "shift", label: "Shift (days from rosters)" },
            ]}
          />
        </div>
        {kind === "fixed" ? (
          <>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-7">
              {week.map((d, i) => (
                <div key={DAYS[i]} className="flex flex-col gap-1.5 rounded-md border border-border p-2">
                  <span className="font-azeret text-2xs font-semibold uppercase">{DAYS[i]}</span>
                  <Select value={d.type} onValueChange={(v) => setDay(i, { type: v as Day["type"] })}>
                    <SelectTrigger aria-label={`${DAYS[i]} day type`} className="h-8 text-2xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="working">Working</SelectItem>
                      <SelectItem value="half">Half day</SelectItem>
                      <SelectItem value="off">Off day</SelectItem>
                      <SelectItem value="rest">Rest day</SelectItem>
                    </SelectContent>
                  </Select>
                  <Input
                    aria-label={`${DAYS[i]} hours`}
                    className="num h-8 text-right text-2xs"
                    inputMode="decimal"
                    disabled={d.type === "off" || d.type === "rest"}
                    value={String(d.minutes / 60)}
                    onChange={(e) => setDay(i, { minutes: Math.round(Number(e.target.value || 0) * 60) })}
                  />
                </div>
              ))}
            </div>
            <p className="text-ui">
              Weekly contracted hours: <span className="num font-semibold">{hours(total)}</span>
            </p>
          </>
        ) : (
          <TextInput
            label="Contracted hours per week"
            mono
            inputMode="decimal"
            value={weekly}
            onChange={setWeekly}
            error={errs.weeklyMinutes}
            className="sm:max-w-xs"
          />
        )}
        {create.isError ? (
          <p role="alert" className="text-ui text-danger-300">
            {errorMessage(create.error)}
          </p>
        ) : null}
        <div>
          <Button type="submit" variant="primary" disabled={create.isPending || !name.trim()}>
            <Plus aria-hidden /> Save schedule
          </Button>
        </div>
      </form>
    </div>
  );
}
