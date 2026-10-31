import {
  Badge,
  Button,
  Card,
  cn,
  DatePicker,
  EmptyState,
  FormField,
  Input,
  RadioGroup,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Tabs,
  TabsList,
  TabsTrigger,
  toast,
} from "@crowhr/ui";
import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Download, Landmark, Plus, Trash2 } from "lucide-react";
import * as React from "react";
import { can, useMe } from "../../../auth/session.ts";
import { PageHeader } from "../../../components/page-header.tsx";
import { ErrorNote } from "../../../components/section.tsx";
import {
  type Entitlement,
  governmentPaidCsvHref,
  governmentPaidQuery,
  holidaysQuery,
  type LeaveSettings,
  type Policy,
  type PolicyView,
  policiesQuery,
  saveSettings,
  settingsQuery,
  useLeaveInvalidate,
} from "../../../leave/api.ts";
import { RadioRow, SwitchRow } from "../../../leave/choice.tsx";
import { carryText, dateRange, entitlementText, fmt, todaySg, weekdayOf } from "../../../leave/format.ts";
import { ApiError, apiDelete, apiPatch, apiPost } from "../../../lib/api.ts";
import { schedulesQuery } from "../people/-lib/api.ts";

type Tab = "policies" | "holidays" | "rules" | "claims";

export const Route = createFileRoute("/_app/settings/leave")({
  validateSearch: (s: Record<string, unknown>): { tab?: Tab } =>
    s.tab === "policies" || s.tab === "holidays" || s.tab === "rules" || s.tab === "claims" ? { tab: s.tab } : {},
  component: LeaveSettingsPage,
});

function LeaveSettingsPage() {
  const me = useMe();
  const navigate = useNavigate({ from: "/settings/leave" });
  const canPolicies = can(me, "policies:read");
  const canClaims = can(me, "leave_claims:read");
  const search = Route.useSearch();
  const tab: Tab = search.tab ?? (canPolicies ? "policies" : "claims");
  return (
    <>
      <PageHeader
        crumbs={[{ label: "Settings", to: "/settings" }]}
        title="Leave"
        description="Statutory leave is set up for you from the Employment Act and the Government-paid leave schemes. Make it more generous, add company leave, and keep holidays up to date."
      />
      <Tabs value={tab} onValueChange={(v) => void navigate({ search: { tab: v as Tab } })} className="mb-5">
        <TabsList className="max-w-full overflow-x-auto">
          {canPolicies ? <TabsTrigger value="policies">Policies</TabsTrigger> : null}
          {canPolicies ? <TabsTrigger value="holidays">Holidays</TabsTrigger> : null}
          {canPolicies ? <TabsTrigger value="rules">Rules</TabsTrigger> : null}
          {canClaims ? <TabsTrigger value="claims">Government-paid</TabsTrigger> : null}
        </TabsList>
      </Tabs>
      {tab === "policies" && canPolicies ? <Policies editable={can(me, "policies:update")} /> : null}
      {tab === "holidays" && canPolicies ? <Holidays editable={can(me, "policies:update")} /> : null}
      {tab === "rules" && canPolicies ? <Rules editable={can(me, "policies:update")} /> : null}
      {tab === "claims" && canClaims ? <GovernmentPaid /> : null}
    </>
  );
}

// ---------------------------------------------------------------------------------------------
// Policies
// ---------------------------------------------------------------------------------------------

function Policies({ editable }: { editable: boolean }) {
  const q = useQuery(policiesQuery);
  const [editing, setEditing] = React.useState<PolicyView | "new" | null>(null);
  const items = q.data?.items ?? [];
  return (
    <section aria-labelledby="policies-title">
      <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 id="policies-title" className="font-azeret text-xs font-semibold uppercase tracking-wider">
            Leave types
          </h2>
          <p className="mt-1 max-w-2xl text-ui text-primary-300">
            Nothing here needs setting up. Statutory minimums can't be lowered; you'll be told if a change goes below
            the law.
          </p>
        </div>
        {editable ? (
          <Button onClick={() => setEditing("new")}>
            <Plus /> Company leave type
          </Button>
        ) : null}
      </div>
      <Card>
        {q.isError ? (
          <ErrorNote error={q.error} retry={() => void q.refetch()} />
        ) : q.isPending ? (
          <div className="flex flex-col gap-2 p-4">
            <Skeleton className="h-6 w-full" />
            <Skeleton className="h-6 w-full" />
          </div>
        ) : (
          <Table aria-label="Leave types">
            <TableHeader>
              <TableRow>
                <TableHead>Type</TableHead>
                <TableHead>Entitlement</TableHead>
                <TableHead className="hidden lg:table-cell">Carry forward</TableHead>
                <TableHead className="hidden md:table-cell">Rules</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((p) => (
                <TableRow
                  key={p.id}
                  data-testid="policy-row"
                  className={cn(editable && "cursor-pointer", p.archived && "text-primary-200")}
                  tabIndex={editable ? 0 : undefined}
                  onClick={() => editable && setEditing(p)}
                  onKeyDown={(e) => {
                    if (editable && e.key === "Enter") setEditing(p);
                  }}
                >
                  <TableCell>
                    <span className="flex flex-wrap items-center gap-1.5">
                      <span className="font-medium">{p.name}</span>
                      {p.kind === "statutory" ? <Badge variant="muted">Statutory</Badge> : <Badge>Company</Badge>}
                      {p.archived ? <Badge variant="muted">Archived</Badge> : null}
                    </span>
                  </TableCell>
                  <TableCell className="text-primary-300">{entitlementText(p)}</TableCell>
                  <TableCell className="hidden text-primary-300 lg:table-cell">{carryText(p.policy)}</TableCell>
                  <TableCell className="hidden md:table-cell">
                    <span className="flex flex-wrap gap-1">
                      {!p.paid ? <Badge variant="muted">Unpaid</Badge> : null}
                      {p.halfDays ? <Badge variant="muted">Half days</Badge> : null}
                      {p.attachment === "required" ? (
                        <Badge variant="muted">Needs {p.attachmentLabel ?? "file"}</Badge>
                      ) : null}
                      {p.sensitive ? <Badge variant="muted">Private</Badge> : null}
                    </span>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
      {editing ? <PolicySheet policy={editing === "new" ? null : editing} onClose={() => setEditing(null)} /> : null}
    </section>
  );
}

const blankPolicy: Policy = {
  entitlement: { basis: "fixed", days: 1 },
  minServiceMonths: 0,
  prorate: false,
  accrual: "upfront",
  carryForward: null,
  encashable: false,
};

function PolicySheet({ policy, onClose }: { policy: PolicyView | null; onClose: () => void }) {
  const invalidate = useLeaveInvalidate();
  const isNew = policy === null;
  const statutory = policy?.kind === "statutory";
  const lockedBasis =
    statutory && !["annual", "sick_outpatient", "hospitalisation"].includes(policy?.statutoryCode ?? "");
  const [name, setName] = React.useState(policy?.name ?? "");
  const [code, setCode] = React.useState("");
  const [p, setP] = React.useState<Policy>(policy?.policy ?? blankPolicy);
  const [halfDays, setHalfDays] = React.useState(policy?.halfDays ?? true);
  const [paid, setPaid] = React.useState(policy?.paid ?? true);
  const [attachment, setAttachment] = React.useState(policy?.attachment ?? "none");
  const [sensitive, setSensitive] = React.useState(policy?.sensitive ?? false);
  const [error, setError] = React.useState<{ message: string; fields: Record<string, string> } | null>(null);
  const save = useMutation({
    mutationFn: () =>
      isNew
        ? apiPost<PolicyView>("/api/v1/leave/policies", {
            code: code.trim(),
            name: name.trim(),
            paid,
            halfDays,
            attachment,
            sensitive,
            policy: p,
          })
        : apiPatch<PolicyView>(`/api/v1/leave/policies/${policy.id}`, {
            name: name.trim(),
            halfDays,
            attachment,
            sensitive,
            ...(statutory ? {} : { paid }),
            policy: p,
          }),
    onSuccess: (r) => {
      invalidate();
      toast.success(`${r.name} saved.`);
      onClose();
    },
    onError: (err) =>
      setError({
        message: err instanceof Error ? err.message : "That didn't save.",
        fields: err instanceof ApiError ? err.fieldErrors : {},
      }),
  });
  const archive = useMutation({
    mutationFn: (archived: boolean) =>
      apiPost<PolicyView>(`/api/v1/leave/policies/${policy?.id}/archive`, { archived }),
    onSuccess: () => {
      invalidate();
      onClose();
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "That didn't work."),
  });
  const e = p.entitlement;
  const setEnt = (ent: Entitlement) => setP({ ...p, entitlement: ent });
  const num = (v: string) => (v === "" ? 0 : Number(v));
  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-[min(34rem,100vw)] overflow-y-auto">
        <form
          className="flex min-h-full flex-col"
          onSubmit={(ev) => {
            ev.preventDefault();
            setError(null);
            save.mutate();
          }}
        >
          <div className="border-b border-border px-5 pb-4 pt-5">
            <SheetTitle className="font-azeret text-sm font-semibold">
              {isNew ? "New company leave type" : policy.name}
            </SheetTitle>
            <SheetDescription className="mt-1 text-ui text-primary-300">
              {statutory
                ? "Statutory leave: you can make it more generous, never less than the law."
                : "Company leave is up to you, such as birthday, marriage or volunteering leave."}
            </SheetDescription>
          </div>
          <div className="flex flex-col gap-4 px-5 py-4">
            {error ? (
              <p
                role="alert"
                className="rounded-md border border-danger-200/40 bg-danger-50 p-3 text-ui text-danger-300"
                data-testid="policy-error"
              >
                {error.message}
              </p>
            ) : null}
            <div className="grid gap-3 sm:grid-cols-2">
              <FormField label="Name" required error={error?.fields.name}>
                <Input value={name} onChange={(ev) => setName(ev.target.value)} maxLength={60} />
              </FormField>
              {isNew ? (
                <FormField label="Code" required hint="Lower case, like birthday." error={error?.fields.code}>
                  <Input value={code} onChange={(ev) => setCode(ev.target.value.toLowerCase())} maxLength={31} />
                </FormField>
              ) : null}
            </div>
            <FormField label="Entitlement">
              <Select
                value={e.basis}
                disabled={lockedBasis}
                onValueChange={(v) =>
                  setEnt(
                    v === "fixed"
                      ? { basis: "fixed", days: e.basis === "fixed" ? e.days : 14 }
                      : v === "by_service"
                        ? { basis: "by_service", steps: [{ fromServiceYear: 1, days: 14 }] }
                        : ({ basis: v } as Entitlement),
                  )
                }
              >
                <SelectTrigger aria-label="Entitlement">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {statutory ? <SelectItem value="statutory">Statutory minimum</SelectItem> : null}
                  <SelectItem value="fixed">Same days every year</SelectItem>
                  <SelectItem value="by_service">By years of service</SelectItem>
                  {!statutory ? <SelectItem value="unlimited">No fixed allowance</SelectItem> : null}
                </SelectContent>
              </Select>
            </FormField>
            {lockedBasis ? (
              <p className="text-ui text-primary-300">
                Government-paid and statutory family leave follows the law: {entitlementText(policy as PolicyView)}.
              </p>
            ) : null}
            {e.basis === "fixed" ? (
              <FormField label="Days a year" error={error?.fields["policy.entitlement.days"]}>
                <Input
                  className="num w-28"
                  inputMode="decimal"
                  value={String(e.days)}
                  onChange={(ev) => setEnt({ basis: "fixed", days: num(ev.target.value) })}
                />
              </FormField>
            ) : null}
            {e.basis === "by_service" ? (
              <fieldset className="flex flex-col gap-2">
                <legend className="mb-1 font-azeret text-2xs font-semibold uppercase tracking-wider">
                  Days by service year
                </legend>
                {e.steps.map((s, i) => (
                  <div
                    key={`step-${s.fromServiceYear}-${s.days}-${e.steps.length}`}
                    className="flex items-center gap-2 text-ui"
                  >
                    <span className="w-16 text-primary-300">From year</span>
                    <Input
                      aria-label={`Step ${i + 1} service year`}
                      className="num w-16"
                      value={String(s.fromServiceYear)}
                      onChange={(ev) =>
                        setEnt({
                          basis: "by_service",
                          steps: e.steps.map((x, j) => (j === i ? { ...x, fromServiceYear: num(ev.target.value) } : x)),
                        })
                      }
                    />
                    <Input
                      aria-label={`Step ${i + 1} days`}
                      className="num w-20"
                      value={String(s.days)}
                      onChange={(ev) =>
                        setEnt({
                          basis: "by_service",
                          steps: e.steps.map((x, j) => (j === i ? { ...x, days: num(ev.target.value) } : x)),
                        })
                      }
                    />
                    <span className="text-primary-300">days</span>
                    {e.steps.length > 1 ? (
                      <Button
                        type="button"
                        size="icon-sm"
                        variant="ghost"
                        aria-label="Remove step"
                        onClick={() => setEnt({ basis: "by_service", steps: e.steps.filter((_, j) => j !== i) })}
                      >
                        <Trash2 />
                      </Button>
                    ) : null}
                  </div>
                ))}
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="self-start"
                  onClick={() => {
                    const last = e.steps.at(-1);
                    setEnt({
                      basis: "by_service",
                      steps: [...e.steps, { fromServiceYear: (last?.fromServiceYear ?? 0) + 1, days: last?.days ?? 0 }],
                    });
                  }}
                >
                  <Plus /> Add a step
                </Button>
              </fieldset>
            ) : null}
            {!lockedBasis && e.basis !== "unlimited" ? (
              <>
                <FormField label="Months of service before it can be used" hint="The Employment Act needs at most 3.">
                  <Input
                    className="num w-20"
                    inputMode="numeric"
                    value={String(p.minServiceMonths)}
                    onChange={(ev) => setP({ ...p, minServiceMonths: num(ev.target.value) })}
                  />
                </FormField>
                {policy?.statutoryCode !== "sick_outpatient" && policy?.statutoryCode !== "hospitalisation" ? (
                  <>
                    <ToggleRow
                      label="Pro-rate in the first year and the year of leaving"
                      checked={p.prorate}
                      onChange={(v) => setP({ ...p, prorate: v })}
                    />
                    <FormField label="Earned">
                      <RadioGroup
                        value={p.accrual}
                        onValueChange={(v) => setP({ ...p, accrual: v as Policy["accrual"] })}
                        className="flex gap-4"
                      >
                        <RadioRow value="upfront">All on 1 January</RadioRow>
                        <RadioRow value="monthly">Month by month</RadioRow>
                      </RadioGroup>
                    </FormField>
                    <ToggleRow
                      label="Carry unused days into next year"
                      checked={p.carryForward !== null}
                      onChange={(v) =>
                        setP({ ...p, carryForward: v ? { maxDays: null, expiresAfterMonths: 12 } : null })
                      }
                    />
                    {p.carryForward ? (
                      <div className="grid grid-cols-2 gap-3 pl-11">
                        <FormField label="Up to (days)" hint="Blank: all unused days.">
                          <Input
                            className="num"
                            inputMode="decimal"
                            value={p.carryForward.maxDays === null ? "" : String(p.carryForward.maxDays)}
                            onChange={(ev) =>
                              setP({
                                ...p,
                                carryForward: {
                                  expiresAfterMonths: p.carryForward?.expiresAfterMonths ?? null,
                                  maxDays: ev.target.value === "" ? null : num(ev.target.value),
                                },
                              })
                            }
                          />
                        </FormField>
                        <FormField label="Use within (months)" hint="Blank: never expires.">
                          <Input
                            className="num"
                            inputMode="numeric"
                            value={
                              p.carryForward.expiresAfterMonths === null
                                ? ""
                                : String(p.carryForward.expiresAfterMonths)
                            }
                            onChange={(ev) =>
                              setP({
                                ...p,
                                carryForward: {
                                  maxDays: p.carryForward?.maxDays ?? null,
                                  expiresAfterMonths: ev.target.value === "" ? null : num(ev.target.value),
                                },
                              })
                            }
                          />
                        </FormField>
                      </div>
                    ) : null}
                    <ToggleRow
                      label="Encash days that can't be carried forward"
                      checked={p.encashable}
                      onChange={(v) => setP({ ...p, encashable: v })}
                    />
                  </>
                ) : null}
              </>
            ) : null}
            <div className="flex flex-col gap-3 border-t border-border pt-4">
              {!statutory ? <ToggleRow label="Paid leave" checked={paid} onChange={setPaid} /> : null}
              <ToggleRow label="Allow half days" checked={halfDays} onChange={setHalfDays} />
              <ToggleRow label="Private: colleagues see only 'On leave'" checked={sensitive} onChange={setSensitive} />
              <FormField label="Supporting document">
                <Select value={attachment} onValueChange={(v) => setAttachment(v as typeof attachment)}>
                  <SelectTrigger aria-label="Supporting document">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Not asked for</SelectItem>
                    <SelectItem value="optional">Optional</SelectItem>
                    <SelectItem value="required">Required</SelectItem>
                  </SelectContent>
                </Select>
              </FormField>
            </div>
          </div>
          <div className="sticky bottom-0 mt-auto flex items-center justify-between gap-2 border-t border-border bg-background px-5 py-3">
            {!isNew && !statutory ? (
              <Button type="button" variant="ghost" size="sm" onClick={() => archive.mutate(!policy.archived)}>
                {policy.archived ? "Restore" : "Archive"}
              </Button>
            ) : (
              <span />
            )}
            <div className="flex gap-2">
              <Button type="button" variant="ghost" onClick={onClose}>
                Cancel
              </Button>
              <Button
                type="submit"
                variant="primary"
                disabled={save.isPending || !name.trim() || (isNew && !code.trim())}
              >
                Save
              </Button>
            </div>
          </div>
        </form>
      </SheetContent>
    </Sheet>
  );
}

function ToggleRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <SwitchRow checked={checked} onChange={onChange}>
      {label}
    </SwitchRow>
  );
}

// ---------------------------------------------------------------------------------------------
// Holidays
// ---------------------------------------------------------------------------------------------

function Holidays({ editable }: { editable: boolean }) {
  const thisYear = Number(todaySg().slice(0, 4));
  const [year, setYear] = React.useState(thisYear);
  const q = useQuery(holidaysQuery(year));
  const invalidate = useLeaveInvalidate();
  const [date, setDate] = React.useState<string | null>(null);
  const [name, setName] = React.useState("");
  const [err, setErr] = React.useState<string | null>(null);
  const add = useMutation({
    mutationFn: () => apiPost("/api/v1/leave/holidays", { date, name: name.trim() }),
    onSuccess: () => {
      invalidate();
      setDate(null);
      setName("");
      setErr(null);
      toast.success("Holiday added. Leave on that day is no longer counted.");
    },
    onError: (e) => setErr(e instanceof Error ? e.message : "That didn't save."),
  });
  const remove = useMutation({
    mutationFn: (id: string) => apiDelete(`/api/v1/leave/holidays/${id}`),
    onSuccess: () => invalidate(),
    onError: (e) => toast.error(e instanceof Error ? e.message : "That didn't work."),
  });
  const items = q.data?.items ?? [];
  return (
    <section aria-labelledby="holidays-title" className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      <div>
        <div className="mb-3 flex items-end justify-between gap-2">
          <div>
            <h2 id="holidays-title" className="font-azeret text-xs font-semibold uppercase tracking-wider">
              Public holidays
            </h2>
            <p className="mt-1 text-ui text-primary-300">
              Gazetted by MOM. A Sunday holiday moves to Monday for Sunday rest days; other rest days get the next
              working day.
            </p>
          </div>
          <Select value={String(year)} onValueChange={(v) => setYear(Number(v))}>
            <SelectTrigger aria-label="Year" className="num w-24">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {[thisYear - 1, thisYear, thisYear + 1].map((y) => (
                <SelectItem key={y} value={String(y)}>
                  {y}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Card>
          {q.isError ? (
            <ErrorNote error={q.error} retry={() => void q.refetch()} />
          ) : q.isPending ? (
            <div className="p-4">
              <Skeleton className="h-24 w-full" />
            </div>
          ) : items.length === 0 ? (
            <EmptyState
              variant="plain"
              title={`No holidays for ${year} yet`}
              description="MOM usually publishes next year's public holidays in June."
            />
          ) : (
            <Table aria-label={`Public holidays ${year}`}>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-36">Date</TableHead>
                  <TableHead>Holiday</TableHead>
                  <TableHead className="w-16 text-right">
                    <span className="sr-only">Actions</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((h) => (
                  <TableRow key={`${h.date}-${h.name}`} data-testid="holiday-row">
                    <TableCell className="num whitespace-nowrap">
                      <span className="inline-block w-9 text-primary-200">{weekdayOf(h.date)}</span>
                      {dateRange(h.date, h.date)}
                    </TableCell>
                    <TableCell>
                      {h.name}
                      {h.source === "organisation" ? (
                        <Badge variant="muted" className="ml-2">
                          Added by you
                        </Badge>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-right">
                      {editable && h.id ? (
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          aria-label={`Remove ${h.name}`}
                          onClick={() => remove.mutate(h.id as string)}
                        >
                          <Trash2 />
                        </Button>
                      ) : null}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Card>
      </div>
      {editable ? (
        <Card className="self-start p-4">
          <h3 className="font-azeret text-xs font-semibold">Add an extra holiday</h3>
          <p className="mt-1 text-ui text-primary-300">
            For Polling Day or a holiday announced at short notice. Leave on that day stops counting.
          </p>
          <form
            className="mt-3 flex flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              add.mutate();
            }}
          >
            <FormField label="Date" required>
              <DatePicker value={date} onChange={setDate} />
            </FormField>
            <FormField label="Name" required error={err ?? undefined}>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Polling Day" maxLength={80} />
            </FormField>
            <Button type="submit" className="self-start" disabled={!date || !name.trim() || add.isPending}>
              <Plus /> Add holiday
            </Button>
          </form>
        </Card>
      ) : null}
    </section>
  );
}

// ---------------------------------------------------------------------------------------------
// Rules (leave settings)
// ---------------------------------------------------------------------------------------------

function Rules({ editable }: { editable: boolean }) {
  const q = useQuery(settingsQuery);
  const schedules = useQuery(schedulesQuery);
  const invalidate = useLeaveInvalidate();
  const [draft, setDraft] = React.useState<LeaveSettings | null>(null);
  React.useEffect(() => {
    if (q.data && !draft) setDraft(q.data);
  }, [q.data, draft]);
  const save = useMutation({
    mutationFn: (s: LeaveSettings) => saveSettings(s),
    onSuccess: () => {
      invalidate();
      toast.success("Leave rules saved.");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "That didn't save."),
  });
  if (q.isError) return <ErrorNote error={q.error} retry={() => void q.refetch()} />;
  if (!draft) return <Skeleton className="h-48 w-full max-w-2xl" />;
  const fixed = (schedules.data?.items ?? []).filter((s) => s.kind === "fixed" && !s.archived);
  return (
    <form
      className="flex max-w-2xl flex-col gap-6"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate(draft);
      }}
    >
      <Card className="p-4">
        <h2 className="font-azeret text-xs font-semibold">A public holiday on an off day</h2>
        <p className="mt-1 text-ui text-primary-300">
          For example a Saturday holiday for a Monday–Friday week. MOM: give another day off or one extra day's pay.
        </p>
        <RadioGroup
          className="mt-3 flex flex-col gap-2"
          disabled={!editable}
          value={draft.offDayHoliday}
          onValueChange={(v) => setDraft({ ...draft, offDayHoliday: v as LeaveSettings["offDayHoliday"] })}
        >
          <RadioRow value="extra_pay">Pay an extra day (payroll); no day off</RadioRow>
          <RadioRow value="next_working_day">Give the next working day off</RadioRow>
        </RadioGroup>
      </Card>
      <Card className="p-4">
        <h2 className="font-azeret text-xs font-semibold">No-pay leave and service</h2>
        <p className="mt-1 text-ui text-primary-300">
          MOM doesn't count unpaid leave as service for annual leave. Choose which months stop counting.
        </p>
        <RadioGroup
          className="mt-3 flex flex-col gap-2"
          disabled={!editable}
          value={draft.unpaidServiceRule}
          onValueChange={(v) => setDraft({ ...draft, unpaidServiceRule: v as LeaveSettings["unpaidServiceRule"] })}
        >
          <RadioRow value="whole_month">Only months that are entirely no-pay leave</RadioRow>
          <RadioRow value="any_day">Any month with a day of no-pay leave</RadioRow>
          <RadioRow value="none">Keep counting service</RadioRow>
        </RadioGroup>
      </Card>
      <Card className="p-4">
        <h2 className="font-azeret text-xs font-semibold">Comparable full-timer</h2>
        <p className="mt-1 text-ui text-primary-300">
          Part-timers get annual, sick and hospitalisation leave in hours, pro-rated against this schedule.
        </p>
        <div className="mt-3 max-w-xs">
          <Select
            disabled={!editable}
            value={draft.fullTimeScheduleId ?? "default"}
            onValueChange={(v) => setDraft({ ...draft, fullTimeScheduleId: v === "default" ? null : v })}
          >
            <SelectTrigger aria-label="Full-time schedule">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="default">The default work schedule</SelectItem>
              {fixed.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.name} ({fmt((s.current?.weeklyMinutes ?? 0) / 60)} h a week)
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </Card>
      {editable ? (
        <Button type="submit" variant="primary" className="self-start" disabled={save.isPending}>
          Save rules
        </Button>
      ) : null}
    </form>
  );
}

// ---------------------------------------------------------------------------------------------
// Government-paid leave report
// ---------------------------------------------------------------------------------------------

function GovernmentPaid() {
  const year = todaySg().slice(0, 4);
  const [from, setFrom] = React.useState<string | null>(`${year}-01-01`);
  const [to, setTo] = React.useState<string | null>(`${year}-12-31`);
  const ok = !!from && !!to && from <= to;
  const q = useQuery({ ...governmentPaidQuery(from ?? "", to ?? ""), enabled: ok });
  const items = q.data?.items ?? [];
  const totals = items.reduce(
    (a, r) => ({ employer: a.employer + r.employerDays, government: a.government + r.governmentDays }),
    { employer: 0, government: 0 },
  );
  return (
    <section aria-labelledby="gov-title">
      <div className="mb-3 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h2 id="gov-title" className="font-azeret text-xs font-semibold uppercase tracking-wider">
            Government-paid leave to claim
          </h2>
          <p className="mt-1 max-w-2xl text-ui text-primary-300">
            You pay these days and claim them back on the MSF Government-Paid Leave portal with Corppass, within 3
            months of the last day of leave. There's no API, so use this list to fill in the claims.
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <FormField label="From">
            <DatePicker value={from} onChange={setFrom} className="w-36" />
          </FormField>
          <FormField label="To">
            <DatePicker value={to} onChange={setTo} className="w-36" />
          </FormField>
          <Button asChild disabled={!ok}>
            <a href={ok ? governmentPaidCsvHref(from, to) : undefined} download>
              <Download /> CSV
            </a>
          </Button>
        </div>
      </div>
      <Card>
        {!ok ? (
          <p className="p-4 text-ui text-danger-300">Pick a start date on or before the end date.</p>
        ) : q.isError ? (
          <ErrorNote error={q.error} retry={() => void q.refetch()} />
        ) : q.isPending ? (
          <div className="p-4">
            <Skeleton className="h-24 w-full" />
          </div>
        ) : items.length === 0 ? (
          <EmptyState
            variant="plain"
            icon={<Landmark />}
            title="Nothing to claim in this period"
            description="Approved maternity, paternity, shared parental, adoption, childcare and NS leave appears here."
          />
        ) : (
          <div className="overflow-x-auto">
            <Table aria-label="Government-paid leave">
              <TableHeader>
                <TableRow>
                  <TableHead>Employee</TableHead>
                  <TableHead>Scheme</TableHead>
                  <TableHead className="hidden lg:table-cell">Dates</TableHead>
                  <TableHead className="text-right">Employer</TableHead>
                  <TableHead className="text-right">Government</TableHead>
                  <TableHead className="hidden md:table-cell">Claim by</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((r) => (
                  <TableRow key={r.requestId} data-testid="gov-row">
                    <TableCell>
                      <span className="block font-medium">{r.employeeName}</span>
                      {r.child ? <span className="text-2xs text-primary-200">{r.child}</span> : null}
                    </TableCell>
                    <TableCell>
                      <span className="block">{r.scheme}</span>
                      <span className="text-2xs text-primary-200">{r.claimVia}</span>
                    </TableCell>
                    <TableCell className="num hidden whitespace-nowrap lg:table-cell">
                      {dateRange(r.startDate, r.endDate)}
                    </TableCell>
                    <TableCell className="num text-right">{fmt(r.employerDays)}</TableCell>
                    <TableCell className="num text-right font-semibold">{fmt(r.governmentDays)}</TableCell>
                    <TableCell className="num hidden whitespace-nowrap md:table-cell">
                      {r.claimBy ? dateRange(r.claimBy, r.claimBy) : "Automatic"}
                    </TableCell>
                  </TableRow>
                ))}
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={2} className="font-azeret text-2xs font-semibold uppercase tracking-wider">
                    Total days
                  </TableCell>
                  <TableCell className="hidden lg:table-cell" />
                  <TableCell className="num text-right font-semibold">{fmt(totals.employer)}</TableCell>
                  <TableCell className="num text-right font-semibold">{fmt(totals.government)}</TableCell>
                  <TableCell className="hidden md:table-cell" />
                </TableRow>
              </TableBody>
            </Table>
          </div>
        )}
      </Card>
    </section>
  );
}
