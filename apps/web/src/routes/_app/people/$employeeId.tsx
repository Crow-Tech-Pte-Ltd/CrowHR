import type { EmployeeDetailDto } from "@crowhr/core";
import {
  Avatar,
  Button,
  cn,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  FormField,
  formatDate,
  formatMoney,
  MoneyInput,
  StatusPill,
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
  Textarea,
  textStyle,
  toast,
} from "@crowhr/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRightLeft, Lock, Pencil, UserMinus, Wallet } from "lucide-react";
import * as React from "react";
import { canForEmployee, useMe } from "../../../auth/session.ts";
import { isNotFound, NotFoundPage } from "../../../components/not-found.tsx";
import { PageHeader } from "../../../components/page-header.tsx";
import { EmployeeDocuments } from "../../../documents/employee-tab.tsx";
import { Encashments } from "../../../leave/encashments.tsx";
import {
  api,
  checklistsQuery,
  directoryQuery,
  employeeQuery,
  errorMessage,
  fieldErrors,
  invalidatePeople,
  referenceQuery,
  structureQuery,
} from "./-lib/api.ts";
import { daysBetween, formatPhone, passExpiry } from "./-lib/format.ts";
import { RevealValue } from "./-lib/reveal.tsx";
import {
  DateInput,
  EmployeeStatus,
  ErrorPanel,
  Field,
  label,
  MomCoverageLink,
  PanelSkeleton,
  Part4Fields,
  Section,
  SelectInput,
  TextInput,
  today,
} from "./-lib/ui.tsx";

const TABS = ["overview", "job", "pay", "leave", "documents", "history"] as const;
type Tab = (typeof TABS)[number];

export const Route = createFileRoute("/_app/people/$employeeId")({
  validateSearch: (s: Record<string, unknown>): { tab?: Tab } => ({
    tab: TABS.includes(s.tab as Tab) ? (s.tab as Tab) : undefined,
  }),
  component: EmployeePage,
});

function EmployeePage() {
  const { employeeId } = Route.useParams();
  const { tab = "overview" } = Route.useSearch();
  const navigate = Route.useNavigate();
  const q = useQuery(employeeQuery(employeeId));
  const [dialog, setDialog] = React.useState<null | "change" | "pay" | "leave">(null);

  if (q.isPending) {
    return (
      <>
        <PageHeader crumbs={[{ label: "People", to: "/people" }]} title="Loading…" />
        <PanelSkeleton rows={6} />
      </>
    );
  }
  if (q.isError) {
    return isNotFound(q.error) ? (
      <NotFoundPage
        title="Employee not found"
        crumbs={[{ label: "People", to: "/people" }]}
        back={{ to: "/people", label: "Back to People" }}
      />
    ) : (
      <ErrorPanel error={q.error} onRetry={() => void q.refetch()} />
    );
  }
  const e = q.data;
  const canEditJob = !!e.employment;
  return (
    <>
      <PageHeader
        crumbs={[{ label: "People", to: "/people" }]}
        leading={
          <span aria-hidden="true" className="contents">
            <Avatar name={e.name} />
          </span>
        }
        title={e.name}
        trailing={
          <>
            <span className="num text-ui text-primary-200">{e.employeeNumber}</span>
            {/* Active is the normal state: a chip only when they are leaving, starting or gone. */}
            {e.status.code !== "active" ? <EmployeeStatus status={e.status} /> : null}
          </>
        }
        description={
          e.job ? (
            <>
              {e.job.jobTitle} · {e.job.department?.name ?? "No department"}
              {e.job.location ? ` · ${e.job.location.name}` : ""}
              {e.preferredName && e.preferredName !== e.legalName ? (
                <span className="text-primary-200"> · goes by {e.preferredName}</span>
              ) : null}
            </>
          ) : null
        }
        actions={
          canEditJob ? (
            <>
              <Button size="sm" onClick={() => setDialog("change")}>
                <ArrowRightLeft aria-hidden /> Record change
              </Button>
              {e.compensation ? (
                <Button size="sm" onClick={() => setDialog("pay")}>
                  <Wallet aria-hidden /> Change pay
                </Button>
              ) : null}
              {e.status.code === "active" || e.status.code === "not_started" ? (
                <Button size="sm" variant="ghost" onClick={() => setDialog("leave")}>
                  <UserMinus aria-hidden /> Record leaving
                </Button>
              ) : null}
            </>
          ) : null
        }
      />
      <Tabs
        value={tab}
        onValueChange={(v) =>
          void navigate({ search: { tab: v === "overview" ? undefined : (v as Tab) }, replace: true })
        }
      >
        <TabsList className="mb-4 max-w-full overflow-x-auto">
          {TABS.map((t) => (
            <TabsTrigger key={t} value={t}>
              {t === "pay" ? "Pay" : t.charAt(0).toUpperCase() + t.slice(1)}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value="overview">
          <Overview e={e} />
        </TabsContent>
        <TabsContent value="job">
          <JobTab e={e} />
        </TabsContent>
        <TabsContent value="pay">
          <PayTab e={e} onChangePay={() => setDialog("pay")} />
        </TabsContent>
        <TabsContent value="leave">
          <Encashments employeeId={e.id} showBalances />
        </TabsContent>
        <TabsContent value="documents">
          <EmployeeDocuments employeeId={e.id} employeeName={e.name} />
        </TabsContent>
        <TabsContent value="history">
          <HistoryTab e={e} />
        </TabsContent>
      </Tabs>
      {dialog === "change" ? <ChangeDialog e={e} onClose={() => setDialog(null)} /> : null}
      {dialog === "pay" ? <PayDialog e={e} onClose={() => setDialog(null)} /> : null}
      {dialog === "leave" ? <LeaveDialog e={e} onClose={() => setDialog(null)} /> : null}
    </>
  );
}

function Restricted({ what }: { what: string }) {
  return (
    <p className="flex items-center gap-2 py-3 text-ui text-primary-300">
      <Lock className="size-4" aria-hidden /> Your role can't see {what}.
    </p>
  );
}

function address(a: NonNullable<EmployeeDetailDto["personal"]>["address"]) {
  if (!a) return null;
  return [a.block, a.street, a.unit, a.building, a.postalCode ? `Singapore ${a.postalCode}` : null]
    .filter(Boolean)
    .join(", ");
}

function Overview({ e }: { e: EmployeeDetailDto }) {
  const p = e.personal;
  const me = useMe();
  const [editingNames, setEditingNames] = React.useState(false);
  return (
    <div className="grid items-start gap-4 lg:grid-cols-2">
      <Section
        title="Names"
        actions={
          canForEmployee(me, "personal_details:update", e.id) ? (
            <Button size="sm" variant="ghost" onClick={() => setEditingNames(true)}>
              <Pencil aria-hidden /> Edit
            </Button>
          ) : null
        }
      >
        <dl>
          <Field term="Legal name">{e.legalName}</Field>
          <Field term="Preferred name">{e.preferredName}</Field>
        </dl>
        {editingNames ? <NamesDialog e={e} onClose={() => setEditingNames(false)} /> : null}
      </Section>
      <Section title="Work">
        <dl>
          <Field term="Job title">{e.job?.jobTitle}</Field>
          <Field term="Department">{e.job?.department?.name}</Field>
          <Field term="Team">{e.job?.team?.name}</Field>
          <Field term="Location">{e.job?.location?.name}</Field>
          <Field term="Manager">
            {e.job?.manager ? (
              <Link
                className="text-biru-400 hover:underline"
                to="/people/$employeeId"
                params={{ employeeId: e.job.manager.id }}
              >
                {e.job.manager.name}
              </Link>
            ) : null}
          </Field>
          <Field term="Work email">{e.workEmail}</Field>
        </dl>
      </Section>
      <Section title="Personal">
        {p ? (
          <dl>
            <Field term={p.idType === "other" ? "ID" : p.idType.toUpperCase()} mono>
              <RevealValue masked={p.idNumberMasked} employeeId={e.id} kind="nric" />
            </Field>
            <Field term="Date of birth">
              {formatDate(p.dob)} <span className="num text-primary-200">· {p.age} years</span>
            </Field>
            <Field term="Residency">
              {label(p.residencyStatus)}
              {p.prStartDate ? <span className="text-primary-200"> · since {formatDate(p.prStartDate)}</span> : null}
            </Field>
            {p.residencyStatus === "pr" ? <Field term="CPF rate option">{label(p.sprCpfOption)}</Field> : null}
            <Field term="Nationality">{p.nationality}</Field>
            <Field term="Race / religion">
              {[p.race, p.raceSecondary]
                .filter(Boolean)
                .map((r) => label(r))
                .join("-") || "—"}{" "}
              · {label(p.religion)}
              {p.shgOptOutOn ? (
                <span className="text-primary-200"> · SHG opt-out {formatDate(p.shgOptOutOn)}</span>
              ) : null}
            </Field>
            <Field term="Mobile" mono>
              {formatPhone(p.mobile)}
            </Field>
            <Field term="Personal email">{p.personalEmail}</Field>
            <Field term="Address">{address(p.address)}</Field>
          </dl>
        ) : (
          <Restricted what="personal details" />
        )}
      </Section>
      <Section title="Emergency contacts">
        {e.emergencyContacts ? (
          e.emergencyContacts.length ? (
            <dl>
              {e.emergencyContacts.map((c) => (
                <Field key={c.id} term={c.relationship.charAt(0).toUpperCase() + c.relationship.slice(1)}>
                  {c.name} · <span className="num">{formatPhone(c.phone)}</span>
                </Field>
              ))}
            </dl>
          ) : (
            <p className="py-3 text-ui text-primary-300">None recorded.</p>
          )
        ) : (
          <Restricted what="emergency contacts" />
        )}
      </Section>
      <Section title="Work passes">
        {e.workPasses ? (
          e.workPasses.length ? (
            <dl>
              {e.workPasses.map((w) => (
                <Field key={w.id} term={w.passTypeLabel}>
                  <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="num">{w.passNumberMasked ?? "—"}</span>
                    {/* A chip only when the pass needs someone; otherwise the date says it all. */}
                    {w.state === "expired" || w.state === "expiring" ? (
                      <StatusPill
                        tone={w.state === "expired" ? "danger" : "warning"}
                        className="h-auto min-h-5 whitespace-normal py-0.5"
                      >
                        <span className="num">{passExpiry(w, today())}</span>
                      </StatusPill>
                    ) : (
                      <span className="num text-primary-300">{passExpiry(w, today())}</span>
                    )}
                  </span>
                </Field>
              ))}
            </dl>
          ) : (
            <p className="py-3 text-ui text-primary-300">No work pass: not needed for citizens and PRs.</p>
          )
        ) : (
          <Restricted what="work passes" />
        )}
      </Section>
    </div>
  );
}

function JobTab({ e }: { e: EmployeeDetailDto }) {
  const emp = e.employment;
  const checklists = useQuery({ ...checklistsQuery(e.id), enabled: !!emp });
  if (!emp) return <Restricted what="employment records" />;
  return (
    <div className="flex flex-col gap-4">
      <div className="grid items-start gap-4 lg:grid-cols-2">
        <Section title="Current terms">
          <dl>
            <Field term="Employment type">{label(emp.employmentType)}</Field>
            <Field term="Work schedule">{emp.workSchedule?.name}</Field>
            <Field term="Cost centre">{emp.costCentre?.name}</Field>
            <Field term="Probation ends">{emp.probationEnd ? formatDate(emp.probationEnd) : null}</Field>
            <Field term="Employment Act">
              {emp.eaCovered ? "Covered" : "Not covered"}
              {emp.isWorkman ? " · workman" : ""}
            </Field>
            <Field term="Manager or executive">
              {emp.isManagerOrExecutive ? "Yes" : "No"}
              <span className="mt-0.5 block text-2xs text-primary-300">
                {emp.isManagerOrExecutive
                  ? "Not covered by Part 4 of the Employment Act: no statutory overtime rate, so OT follows the contract."
                  : "Part 4 (statutory overtime, rest days and hours) applies when basic pay is within MOM's limits."}{" "}
                <MomCoverageLink />
              </span>
            </Field>
            <Field term="Reports">
              {emp.directReports.length ? emp.directReports.map((r) => r.name).join(", ") : "None"}
            </Field>
          </dl>
        </Section>
        <Section title="Employment periods">
          <dl>
            {emp.tenures.map((t) => (
              <Field key={t.id} term={`From ${formatDate(t.hireDate)}`}>
                {t.lastWorkingDay ? (
                  <>
                    Last day <span className="num">{formatDate(t.lastWorkingDay)}</span> · {label(t.cessationReason)}
                    {t.noticeDays ? <span className="num text-primary-200"> · {t.noticeDays} days' notice</span> : null}
                  </>
                ) : (
                  "Current"
                )}
              </Field>
            ))}
          </dl>
        </Section>
      </div>
      <Section title="Job history">
        <div className="-mx-4 -my-2">
          <Table aria-label="Job history">
            <TableHeader>
              <TableRow>
                <TableHead numeric>From</TableHead>
                <TableHead numeric>Until</TableHead>
                <TableHead>Job title</TableHead>
                <TableHead>Department</TableHead>
                <TableHead className="hidden md:table-cell">Manager</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {emp.history.map((h) => (
                <TableRow key={h.id}>
                  <TableCell numeric>{formatDate(h.effectiveFrom)}</TableCell>
                  <TableCell numeric>{h.effectiveTo ? formatDate(h.effectiveTo) : "—"}</TableCell>
                  <TableCell>{h.jobTitle}</TableCell>
                  <TableCell>
                    {h.department}
                    {h.team ? <span className="text-primary-200"> · {h.team}</span> : null}
                  </TableCell>
                  <TableCell className="hidden md:table-cell">{h.manager ?? "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </Section>
      <Section title="Checklists">
        {checklists.isPending ? (
          <PanelSkeleton rows={2} />
        ) : checklists.data?.items.length ? (
          checklists.data.items.map((c) => (
            <div key={c.id} className="py-2">
              <h3 className={cn(textStyle.group, "mb-1")}>
                {c.kind === "onboarding" ? "Onboarding" : "Offboarding"}{" "}
                <span className="font-sans font-normal text-primary-300">
                  from <span className="num">{formatDate(c.anchorDate)}</span>
                  {c.status === "cancelled" ? " · cancelled" : ""}
                </span>
              </h3>
              <ul className="divide-y divide-border">
                {c.items.map((i) => (
                  <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 py-1.5 text-ui">
                    <span>
                      {i.title} <span className="text-primary-200">· {label(i.assigneeRole)}</span>
                    </span>
                    <ChecklistItemState status={i.status} dueOn={i.dueOn} />
                  </li>
                ))}
              </ul>
            </div>
          ))
        ) : (
          <p className="py-3 text-ui text-primary-300">No checklists.</p>
        )}
      </Section>
    </div>
  );
}

function PayTab({ e, onChangePay }: { e: EmployeeDetailDto; onChangePay: () => void }) {
  const c = e.compensation;
  return (
    <div className="flex flex-col gap-4">
      <div className="grid items-start gap-4 lg:grid-cols-2">
        <Section
          title="Basic pay"
          actions={
            c ? (
              <Button size="sm" variant="ghost" onClick={onChangePay}>
                <Pencil aria-hidden /> Change
              </Button>
            ) : null
          }
        >
          {c ? (
            c.current ? (
              <dl>
                <Field term={c.current.payBasis === "hourly" ? "Hourly rate" : "Monthly"} mono>
                  <span className="text-lg font-semibold">{formatMoney(c.current.amountCents)}</span>
                </Field>
                <Field term="Since">{formatDate(c.current.effectiveFrom)}</Field>
                {c.history
                  .filter((h) => h.effectiveFrom > today())
                  .map((h) => (
                    <Field key={h.id} term="Scheduled">
                      <span className="num">{formatMoney(h.amountCents)}</span> from{" "}
                      <span className="num">{formatDate(h.effectiveFrom)}</span>
                    </Field>
                  ))}
              </dl>
            ) : (
              <p className="py-3 text-ui text-primary-300">No pay recorded yet.</p>
            )
          ) : (
            <Restricted what="pay (owner and payroll admins only)" />
          )}
        </Section>
        <Section title="Bank account">
          {e.bank ? (
            e.bank.current ? (
              <dl>
                <Field term="Bank">{e.bank.current.bankName}</Field>
                <Field term="Account" mono>
                  <RevealValue masked={`••••${e.bank.current.accountLast4}`} employeeId={e.id} kind="bank" />
                </Field>
                <Field term="Holder">{e.bank.current.holderName}</Field>
                <Field term="Since">{formatDate(e.bank.current.effectiveFrom)}</Field>
              </dl>
            ) : (
              <p className="py-3 text-ui text-primary-300">
                No bank account. Salary can't be paid by GIRO until one is added.
              </p>
            )
          ) : (
            <Restricted what="bank details" />
          )}
        </Section>
      </div>
      {c ? (
        <Section title="Pay history">
          <div className="-mx-4 -my-2">
            <Table aria-label="Pay history">
              <TableHeader>
                <TableRow>
                  <TableHead numeric>From</TableHead>
                  <TableHead numeric>Until</TableHead>
                  <TableHead>Basis</TableHead>
                  <TableHead numeric>Amount</TableHead>
                  <TableHead className="hidden sm:table-cell">Reason</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {c.history.map((h) => (
                  <TableRow key={h.id}>
                    <TableCell numeric>{formatDate(h.effectiveFrom)}</TableCell>
                    <TableCell numeric>{h.effectiveTo ? formatDate(h.effectiveTo) : "—"}</TableCell>
                    <TableCell>
                      {label(h.payBasis)}
                      {h.retroactive ? " · retro" : ""}
                    </TableCell>
                    <TableCell numeric>{formatMoney(h.amountCents)}</TableCell>
                    <TableCell className="hidden sm:table-cell">{h.reason ?? "—"}</TableCell>
                  </TableRow>
                ))}
                {c.allowances.map((a) => (
                  <TableRow key={a.id}>
                    <TableCell numeric>{formatDate(a.effectiveFrom)}</TableCell>
                    <TableCell numeric>{a.effectiveTo ? formatDate(a.effectiveTo) : "—"}</TableCell>
                    <TableCell>{a.name}</TableCell>
                    <TableCell numeric>{formatMoney(a.amountCents)}</TableCell>
                    <TableCell className="hidden sm:table-cell">Recurring allowance</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </Section>
      ) : null}
    </div>
  );
}

function HistoryTab({ e }: { e: EmployeeDetailDto }) {
  const qc = useQueryClient();
  const cancel = useMutation({
    mutationFn: (eventId: string) => api("POST", `/employees/${e.id}/events/${eventId}/cancel`),
    onSuccess: async () => {
      await invalidatePeople(qc);
      toast("Change cancelled", { description: "The previous record is back in force." });
    },
    onError: (err) => toast("Couldn't cancel", { description: errorMessage(err) }),
  });
  if (!e.employment) return <Restricted what="lifecycle events" />;
  return (
    <Section title="Lifecycle events">
      <ol className="divide-y divide-border">
        {e.employment.events.map((ev) => (
          <li key={ev.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
            <div className="min-w-0">
              <p className="font-medium">{label(ev.type)}</p>
              <p className="text-2xs text-primary-200">
                <span className="num">{formatDate(ev.effectiveDate)}</span>
                {describeEvent(ev.payload)}
              </p>
            </div>
            <div className="flex items-center gap-2">
              {/* Effective is the normal state; only a scheduled or cancelled event is marked. */}
              {ev.status === "scheduled" ? (
                <StatusPill tone="info">Scheduled</StatusPill>
              ) : ev.status === "cancelled" ? (
                <span className="text-2xs text-primary-300">Cancelled</span>
              ) : null}
              {ev.status === "scheduled" && ev.type !== "hire" && ev.type !== "rehire" ? (
                <Button size="sm" variant="ghost" disabled={cancel.isPending} onClick={() => cancel.mutate(ev.id)}>
                  Cancel
                </Button>
              ) : null}
            </div>
          </li>
        ))}
      </ol>
    </Section>
  );
}

/** A checklist item's due date, and a mark only when it needs someone (overdue) or is finished. */
function ChecklistItemState({ status, dueOn }: { status: string; dueOn: string }) {
  if (status === "done") return <span className="text-2xs text-primary-300">Done</span>;
  if (status !== "open") return <span className="text-2xs text-primary-300">{label(status)}</span>;
  const overdue = daysBetween(today(), dueOn) < 0;
  return overdue ? (
    <StatusPill tone="warning">
      <span className="num">Overdue · due {formatDate(dueOn)}</span>
    </StatusPill>
  ) : (
    <span className="num text-2xs text-primary-300">Due {formatDate(dueOn)}</span>
  );
}

function describeEvent(p: Record<string, unknown>): string {
  const bits: string[] = [];
  const ch = (p.changes ?? {}) as Record<string, unknown>;
  if (typeof ch.jobTitle === "string") bits.push(`job title ${ch.jobTitle}`);
  if (ch.departmentId) bits.push("department");
  if (ch.managerEmployeeId !== undefined) bits.push("manager");
  if (ch.locationId) bits.push("location");
  if (typeof p.reason === "string" && p.reason !== "resignation") bits.push(label(p.reason));
  if (typeof p.noticeDays === "number")
    bits.push(`${p.noticeDays} days' notice${p.noticeBasis === "statutory" ? " (Employment Act minimum)" : ""}`);
  if (typeof p.jobTitle === "string") bits.push(p.jobTitle);
  return bits.length ? ` · ${bits.join(", ")}` : "";
}

function ChangeDialog({ e, onClose }: { e: EmployeeDetailDto; onClose: () => void }) {
  const qc = useQueryClient();
  const departments = useQuery(structureQuery("departments"));
  const locations = useQuery(structureQuery("locations"));
  const people = useQuery(directoryQuery({ status: "active,leaving,not_started" }));
  const [type, setType] = React.useState("transfer");
  const [date, setDate] = React.useState(today());
  const [jobTitle, setJobTitle] = React.useState(e.job?.jobTitle ?? "");
  const [departmentId, setDepartmentId] = React.useState(e.job?.department?.id ?? "");
  const [locationId, setLocationId] = React.useState(e.job?.location?.id ?? "");
  const [managerId, setManagerId] = React.useState(e.job?.manager?.id ?? "");
  const [part4, setPart4] = React.useState({
    isWorkman: e.employment?.isWorkman ?? false,
    isManagerOrExecutive: e.employment?.isManagerOrExecutive ?? false,
  });
  const save = useMutation({
    mutationFn: () => {
      const changes: Record<string, unknown> = {};
      if (jobTitle && jobTitle !== e.job?.jobTitle) changes.jobTitle = jobTitle;
      if (departmentId && departmentId !== e.job?.department?.id) changes.departmentId = departmentId;
      if (locationId && locationId !== e.job?.location?.id) changes.locationId = locationId;
      if (managerId !== (e.job?.manager?.id ?? "")) changes.managerEmployeeId = managerId || null;
      if (part4.isWorkman !== (e.employment?.isWorkman ?? false)) changes.isWorkman = part4.isWorkman;
      if (part4.isManagerOrExecutive !== (e.employment?.isManagerOrExecutive ?? false))
        changes.isManagerOrExecutive = part4.isManagerOrExecutive;
      return api<{ status: string }>("POST", `/employees/${e.id}/events`, { type, effectiveDate: date, changes });
    },
    onSuccess: async (r) => {
      await invalidatePeople(qc);
      toast(r.status === "scheduled" ? "Change scheduled" : "Change saved", {
        description: `${label(type)} effective ${formatDate(date)}.`,
      });
      onClose();
    },
  });
  const errs = fieldErrors(save.error);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Record a change</DialogTitle>
          <DialogDescription>Future dates are scheduled and apply automatically on the day.</DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-3"
          onSubmit={(ev) => {
            ev.preventDefault();
            save.mutate();
          }}
        >
          <SelectInput
            label="Type"
            value={type}
            onChange={setType}
            options={[
              { value: "transfer", label: "Transfer" },
              { value: "promotion", label: "Promotion" },
            ]}
          />
          <DateInput label="Effective from" required value={date} onChange={setDate} error={errs.effectiveDate} />
          <TextInput label="Job title" value={jobTitle} onChange={setJobTitle} error={errs["changes.jobTitle"]} />
          <SelectInput
            label="Department"
            value={departmentId}
            onChange={setDepartmentId}
            options={(departments.data?.items ?? [])
              .filter((d) => !d.archived)
              .map((d) => ({ value: d.id, label: d.name }))}
          />
          <SelectInput
            label="Location"
            value={locationId}
            onChange={setLocationId}
            options={(locations.data?.items ?? [])
              .filter((d) => !d.archived)
              .map((d) => ({ value: d.id, label: d.name }))}
          />
          <SelectInput
            label="Manager"
            value={managerId}
            onChange={setManagerId}
            options={(people.data?.items ?? [])
              .filter((p) => p.id !== e.id)
              .map((p) => ({ value: p.id, label: p.name }))}
          />
          <Part4Fields {...part4} onChange={setPart4} />
          {save.isError ? (
            <p role="alert" className="text-ui text-danger-300">
              {errorMessage(save.error)}
            </p>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={save.isPending}>
              Save change
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function PayDialog({ e, onClose }: { e: EmployeeDetailDto; onClose: () => void }) {
  const qc = useQueryClient();
  const current = e.compensation?.current;
  const [amount, setAmount] = React.useState<number | null>(current?.amountCents ?? null);
  const [basis, setBasis] = React.useState<string>(current?.payBasis ?? "monthly");
  const [date, setDate] = React.useState(today());
  const [reason, setReason] = React.useState("");
  const [retro, setRetro] = React.useState(false);
  const save = useMutation({
    mutationFn: () =>
      api<{ status: string }>("POST", `/employees/${e.id}/events`, {
        type: "salary_change",
        effectiveDate: date,
        compensation: { payBasis: basis, amountCents: amount, reason: reason || null, retroactive: retro || undefined },
      }),
    onSuccess: async (r) => {
      await invalidatePeople(qc);
      toast(r.status === "scheduled" ? "Pay change scheduled" : "Pay changed", {
        description: `${formatMoney(amount ?? 0)} from ${formatDate(date)}.`,
      });
      onClose();
    },
  });
  const errs = fieldErrors(save.error);
  const finalised = errs["compensation.retroactive"];
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Change pay</DialogTitle>
          <DialogDescription>
            Currently {current ? <span className="num">{formatMoney(current.amountCents)}</span> : "not set"}. The old
            amount stays in history.
          </DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-3"
          onSubmit={(ev) => {
            ev.preventDefault();
            save.mutate();
          }}
        >
          <SelectInput
            label="Pay basis"
            value={basis}
            onChange={setBasis}
            options={["monthly", "hourly"].map((v) => ({ value: v, label: label(v) }))}
          />
          <FormField
            label={basis === "hourly" ? "New hourly rate" : "New basic monthly pay"}
            required
            error={errs["compensation.amountCents"]}
          >
            <MoneyInput value={amount} onChange={(c) => setAmount(c)} aria-label="New amount" />
          </FormField>
          <DateInput label="Effective from" required value={date} onChange={setDate} error={errs.effectiveDate} />
          <FormField label="Reason">
            <Textarea
              value={reason}
              onChange={(ev) => setReason(ev.target.value)}
              rows={2}
              placeholder="Annual increment"
            />
          </FormField>
          {finalised ? (
            <label className="flex items-start gap-2 rounded-md border border-warning-300/50 bg-warning-50 p-3 text-ui">
              <input type="checkbox" checked={retro} onChange={(ev) => setRetro(ev.target.checked)} className="mt-1" />
              <span>{finalised} Tick to record it as retroactive.</span>
            </label>
          ) : null}
          {save.isError && !finalised ? (
            <p role="alert" className="text-ui text-danger-300">
              {errorMessage(save.error)}
            </p>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={save.isPending || amount === null}>
              Save pay
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function NamesDialog({ e, onClose }: { e: EmployeeDetailDto; onClose: () => void }) {
  const qc = useQueryClient();
  const [legalName, setLegalName] = React.useState(e.legalName);
  const [preferredName, setPreferredName] = React.useState(e.preferredName ?? "");
  const save = useMutation({
    mutationFn: () => api("PATCH", `/employees/${e.id}`, { legalName: legalName.trim(), preferredName }),
    onSuccess: async () => {
      await invalidatePeople(qc);
      toast("Names saved");
      onClose();
    },
  });
  const errs = fieldErrors(save.error);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit names</DialogTitle>
          <DialogDescription>
            The legal name goes on payslips, letters and statutory forms. The preferred name is what they go by.
          </DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-3"
          onSubmit={(ev) => {
            ev.preventDefault();
            save.mutate();
          }}
        >
          <TextInput
            label="Legal name"
            required
            value={legalName}
            onChange={setLegalName}
            error={errs.legalName}
            hint="As on the NRIC, FIN card or passport."
          />
          <TextInput
            label="Preferred name"
            value={preferredName}
            onChange={setPreferredName}
            error={errs.preferredName}
            hint="Optional, e.g. Hafiz for Muhammad Hafiz bin Ismail. Leave empty to use the legal name."
          />
          {save.isError ? (
            <p role="alert" className="text-ui text-danger-300">
              {errorMessage(save.error)}
            </p>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={save.isPending}>
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function LeaveDialog({ e, onClose }: { e: EmployeeDetailDto; onClose: () => void }) {
  const qc = useQueryClient();
  const ref = useQuery(referenceQuery);
  const [type, setType] = React.useState("resignation");
  const [noticeOn, setNoticeOn] = React.useState(today());
  const [noticeDays, setNoticeDays] = React.useState("");
  const [lastDay, setLastDay] = React.useState("");
  const [reason, setReason] = React.useState("retrenchment");
  const save = useMutation({
    mutationFn: () =>
      api(
        "POST",
        `/employees/${e.id}/events`,
        type === "resignation"
          ? {
              type,
              noticeGivenOn: noticeOn,
              // Empty: the contract states no notice period, so the Employment Act minimum applies.
              noticeDays: noticeDays.trim() === "" ? null : Number(noticeDays),
              agreedLastWorkingDay: lastDay || null,
            }
          : { type, reason, lastWorkingDay: lastDay },
      ),
    onSuccess: async () => {
      await invalidatePeople(qc);
      toast("Leaving recorded", { description: "An offboarding checklist was created." });
      onClose();
    },
  });
  const errs = fieldErrors(save.error);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Record leaving</DialogTitle>
          <DialogDescription>The notice date counts as day 1. A shorter last day can be agreed.</DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-3"
          onSubmit={(ev) => {
            ev.preventDefault();
            save.mutate();
          }}
        >
          <SelectInput
            label="Type"
            value={type}
            onChange={setType}
            options={[
              { value: "resignation", label: "Resignation" },
              { value: "termination", label: "Termination" },
            ]}
          />
          {type === "resignation" ? (
            <>
              <DateInput
                label="Notice given on"
                required
                value={noticeOn}
                onChange={setNoticeOn}
                error={errs.noticeGivenOn}
              />
              <TextInput
                label="Notice period (days)"
                mono
                inputMode="numeric"
                value={noticeDays}
                onChange={setNoticeDays}
                error={errs.noticeDays}
                hint="From the employment contract. Leave empty if the contract states none: the Employment Act minimum applies (1 day under 26 weeks of service, 1 week under 2 years, 2 weeks under 5 years, then 4 weeks)."
              />
              <DateInput
                label="Agreed last day (optional)"
                min={noticeOn || undefined}
                value={lastDay}
                onChange={setLastDay}
                error={errs.agreedLastWorkingDay}
              />
            </>
          ) : (
            <>
              <SelectInput
                label="Reason"
                value={reason}
                onChange={setReason}
                options={(ref.data?.terminationReasons ?? []).map((r) => ({ value: r, label: label(r) }))}
              />
              <DateInput
                label="Last working day"
                required
                value={lastDay}
                onChange={setLastDay}
                error={errs.lastWorkingDay}
              />
            </>
          )}
          {save.isError ? (
            <p role="alert" className="text-ui text-danger-300">
              {errorMessage(save.error)}
            </p>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={save.isPending}>
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
