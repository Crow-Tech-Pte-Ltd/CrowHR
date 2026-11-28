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
import { type Translate, useT } from "../../../i18n/index.ts";
import { ChildRecords } from "../../../leave/child-records.tsx";
import { EmployeeBalances } from "../../../leave/employee-balances.tsx";
import { Encashments } from "../../../leave/encashments.tsx";
import { RecurringAllowances } from "./-lib/allowances.tsx";
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
  const translate = useT("people-payroll");
  const { employeeId } = Route.useParams();
  const { tab = "overview" } = Route.useSearch();
  const navigate = Route.useNavigate();
  const me = useMe();
  const q = useQuery(employeeQuery(employeeId));
  const [dialog, setDialog] = React.useState<null | "change" | "pay" | "leave">(null);

  if (q.isPending) {
    return (
      <>
        <PageHeader crumbs={[{ label: translate("People"), to: "/people" }]} title={translate("Loading…")} />
        <PanelSkeleton rows={6} />
      </>
    );
  }
  if (q.isError) {
    return isNotFound(q.error) ? (
      <NotFoundPage
        title={translate("Employee not found")}
        crumbs={[{ label: translate("People"), to: "/people" }]}
        back={{ to: "/people", label: translate("Back to People") }}
      />
    ) : (
      <ErrorPanel error={q.error} onRetry={() => void q.refetch()} />
    );
  }
  const e = q.data;
  const canEditJob = !!e.employment;
  const canEditPay = me.employeeId !== e.id && canForEmployee(me, "compensation:update", e.id);
  return (
    <>
      <PageHeader
        crumbs={[{ label: translate("People"), to: "/people" }]}
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
              {e.job.jobTitle} · {e.job.department?.name ?? translate("No department")}
              {e.job.location ? ` · ${e.job.location.name}` : ""}
              {e.preferredName && e.preferredName !== e.legalName ? (
                <span className="text-primary-200"> {translate("· goes by {name}", { name: e.preferredName })}</span>
              ) : null}
            </>
          ) : null
        }
        actions={
          canEditJob ? (
            <>
              <Button size="sm" onClick={() => setDialog("change")}>
                <ArrowRightLeft aria-hidden /> {translate("Record change")}
              </Button>
              {canEditPay && e.compensation ? (
                <Button size="sm" onClick={() => setDialog("pay")}>
                  <Wallet aria-hidden /> {translate("Change pay")}
                </Button>
              ) : null}
              {e.status.code === "active" || e.status.code === "not_started" ? (
                <Button size="sm" variant="ghost" onClick={() => setDialog("leave")}>
                  <UserMinus aria-hidden /> {translate("Record leaving")}
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
              {translate(t.charAt(0).toUpperCase() + t.slice(1))}
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
          <PayTab e={e} editable={canEditPay} onChangePay={() => setDialog("pay")} />
        </TabsContent>
        <TabsContent value="leave">
          <div key={e.id} className="grid gap-4">
            <EmployeeBalances employeeId={e.id} />
            <Encashments employeeId={e.id} />
            <ChildRecords employeeId={e.id} />
          </div>
        </TabsContent>
        <TabsContent value="documents">
          <EmployeeDocuments employeeId={e.id} employeeName={e.name} />
        </TabsContent>
        <TabsContent value="history">
          <HistoryTab e={e} editablePay={canEditPay} />
        </TabsContent>
      </Tabs>
      {dialog === "change" ? <ChangeDialog e={e} onClose={() => setDialog(null)} /> : null}
      {dialog === "pay" ? <PayDialog e={e} onClose={() => setDialog(null)} /> : null}
      {dialog === "leave" ? <LeaveDialog e={e} onClose={() => setDialog(null)} /> : null}
    </>
  );
}

function Restricted({ what }: { what: string }) {
  const t = useT("people-payroll");
  return (
    <p className="flex items-center gap-2 py-3 text-ui text-primary-300">
      <Lock className="size-4" aria-hidden /> {t("Your role can't see {what}.", { what: t(what) })}
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
  const t = useT("people-payroll");
  const p = e.personal;
  const me = useMe();
  const [editingNames, setEditingNames] = React.useState(false);
  return (
    <div className="grid items-start gap-4 lg:grid-cols-2">
      <Section
        title={t("Names")}
        actions={
          canForEmployee(me, "personal_details:update", e.id) ? (
            <Button size="sm" variant="ghost" onClick={() => setEditingNames(true)}>
              <Pencil aria-hidden /> {t("Edit")}
            </Button>
          ) : null
        }
      >
        <dl>
          <Field term={t("Legal name")}>{e.legalName}</Field>
          <Field term={t("Preferred name")}>{e.preferredName}</Field>
        </dl>
        {editingNames ? <NamesDialog e={e} onClose={() => setEditingNames(false)} /> : null}
      </Section>
      <Section title={t("Work")}>
        <dl>
          <Field term={t("Job title")}>{e.job?.jobTitle}</Field>
          <Field term={t("Department")}>{e.job?.department?.name}</Field>
          <Field term={t("Team")}>{e.job?.team?.name}</Field>
          <Field term={t("Location")}>{e.job?.location?.name}</Field>
          <Field term={t("Manager")}>
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
          <Field term={t("Work email")}>{e.workEmail}</Field>
        </dl>
      </Section>
      <Section title={t("Personal")}>
        {p ? (
          <dl>
            <Field term={p.idType === "other" ? "ID" : p.idType.toUpperCase()} mono>
              <RevealValue masked={p.idNumberMasked} employeeId={e.id} kind="nric" />
            </Field>
            <Field term={t("Date of birth")}>
              {formatDate(p.dob)} <span className="num text-primary-200">· {p.age} years</span>
            </Field>
            <Field term={t("Residency")}>
              {label(p.residencyStatus, t)}
              {p.prStartDate ? <span className="text-primary-200"> · since {formatDate(p.prStartDate)}</span> : null}
            </Field>
            {p.residencyStatus === "pr" ? <Field term={t("CPF rate option")}>{label(p.sprCpfOption, t)}</Field> : null}
            <Field term={t("Nationality")}>{p.nationality}</Field>
            <Field term={t("Race / religion")}>
              {[p.race, p.raceSecondary]
                .filter(Boolean)
                .map((r) => label(r, t))
                .join("-") || "—"}{" "}
              · {label(p.religion, t)}
              {p.shgOptOutOn ? (
                <span className="text-primary-200"> · SHG opt-out {formatDate(p.shgOptOutOn)}</span>
              ) : null}
            </Field>
            <Field term={t("Mobile")} mono>
              {formatPhone(p.mobile)}
            </Field>
            <Field term={t("Personal email")}>{p.personalEmail}</Field>
            <Field term={t("Address")}>{address(p.address)}</Field>
          </dl>
        ) : (
          <Restricted what="personal details" />
        )}
      </Section>
      <Section title={t("Emergency contacts")}>
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
            <p className="py-3 text-ui text-primary-300">{t("None recorded.")}</p>
          )
        ) : (
          <Restricted what="emergency contacts" />
        )}
      </Section>
      <Section title={t("Work passes")}>
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
            <p className="py-3 text-ui text-primary-300">{t("No work pass: not needed for citizens and PRs.")}</p>
          )
        ) : (
          <Restricted what="work passes" />
        )}
      </Section>
    </div>
  );
}

function JobTab({ e }: { e: EmployeeDetailDto }) {
  const translate = useT("people-payroll");
  const emp = e.employment;
  const checklists = useQuery({ ...checklistsQuery(e.id), enabled: !!emp });
  if (!emp) return <Restricted what="employment records" />;
  return (
    <div className="flex flex-col gap-4">
      <div className="grid items-start gap-4 lg:grid-cols-2">
        <Section title={translate("Current terms")}>
          <dl>
            <Field term={translate("Employment type")}>{label(emp.employmentType, translate)}</Field>
            <Field term={translate("Work schedule")}>{emp.workSchedule?.name}</Field>
            <Field term={translate("Cost centre")}>{emp.costCentre?.name}</Field>
            <Field term={translate("Probation ends")}>{emp.probationEnd ? formatDate(emp.probationEnd) : null}</Field>
            <Field term={translate("Employment Act")}>
              {emp.eaCovered ? translate("Covered") : translate("Not covered")}
              {emp.isWorkman ? " · workman" : ""}
            </Field>
            <Field term={translate("Manager or executive")}>
              {emp.isManagerOrExecutive ? translate("Yes") : translate("No")}
              <span className="mt-0.5 block text-2xs text-primary-300">
                {emp.isManagerOrExecutive
                  ? "Not covered by Part 4 of the Employment Act: no statutory overtime rate, so OT follows the contract."
                  : "Part 4 (statutory overtime, rest days and hours) applies when basic pay is within MOM's limits."}{" "}
                <MomCoverageLink />
              </span>
            </Field>
            <Field term={translate("Reports")}>
              {emp.directReports.length ? emp.directReports.map((r) => r.name).join(", ") : translate("None")}
            </Field>
          </dl>
        </Section>
        <Section title={translate("Employment periods")}>
          <dl>
            {emp.tenures.map((t) => (
              <Field key={t.id} term={`From ${formatDate(t.hireDate)}`}>
                {t.lastWorkingDay ? (
                  <>
                    {translate("Last day")} <span className="num">{formatDate(t.lastWorkingDay)}</span> ·{" "}
                    {label(t.cessationReason, translate)}
                    {t.noticeDays ? <span className="num text-primary-200"> · {t.noticeDays} days' notice</span> : null}
                  </>
                ) : (
                  translate("Current")
                )}
              </Field>
            ))}
          </dl>
        </Section>
      </div>
      <Section title={translate("Job history")}>
        <div className="-mx-4 -my-2">
          <Table aria-label={translate("Job history")}>
            <TableHeader>
              <TableRow>
                <TableHead numeric>{translate("From")}</TableHead>
                <TableHead numeric>{translate("Until")}</TableHead>
                <TableHead>{translate("Job title")}</TableHead>
                <TableHead>{translate("Department")}</TableHead>
                <TableHead className="hidden md:table-cell">{translate("Manager")}</TableHead>
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
      <Section title={translate("Checklists")}>
        {checklists.isPending ? (
          <PanelSkeleton rows={2} />
        ) : checklists.data?.items.length ? (
          checklists.data.items.map((c) => (
            <div key={c.id} className="py-2">
              <h3 className={cn(textStyle.group, "mb-1")}>
                {c.kind === "onboarding" ? translate("Onboarding") : translate("Offboarding")}{" "}
                <span className="font-sans font-normal text-primary-300">
                  from <span className="num">{formatDate(c.anchorDate)}</span>
                  {c.status === "cancelled" ? " · cancelled" : ""}
                </span>
              </h3>
              <ul className="divide-y divide-border">
                {c.items.map((i) => (
                  <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 py-1.5 text-ui">
                    <span>
                      {i.title} <span className="text-primary-200">· {label(i.assigneeRole, translate)}</span>
                    </span>
                    <ChecklistItemState status={i.status} dueOn={i.dueOn} />
                  </li>
                ))}
              </ul>
            </div>
          ))
        ) : (
          <p className="py-3 text-ui text-primary-300">{translate("No checklists.")}</p>
        )}
      </Section>
    </div>
  );
}

function PayTab({ e, editable, onChangePay }: { e: EmployeeDetailDto; editable: boolean; onChangePay: () => void }) {
  const translate = useT("people-payroll");
  const c = e.compensation;
  return (
    <div className="flex flex-col gap-4">
      <div className="grid items-start gap-4 lg:grid-cols-2">
        <Section
          title={translate("Basic pay")}
          actions={
            c && editable ? (
              <Button size="sm" variant="ghost" onClick={onChangePay}>
                <Pencil aria-hidden /> {translate("Change")}
              </Button>
            ) : null
          }
        >
          {c ? (
            c.current ? (
              <dl>
                <Field term={c.current.payBasis === "hourly" ? translate("Hourly rate") : translate("Monthly")} mono>
                  <span className="text-lg font-semibold">{formatMoney(c.current.amountCents)}</span>
                </Field>
                <Field term={translate("Since")}>{formatDate(c.current.effectiveFrom)}</Field>
                {c.history
                  .filter((h) => h.effectiveFrom > today())
                  .map((h) => (
                    <Field key={h.id} term={translate("Scheduled")}>
                      <span className="num">{formatMoney(h.amountCents)}</span> from{" "}
                      <span className="num">{formatDate(h.effectiveFrom)}</span>
                    </Field>
                  ))}
              </dl>
            ) : (
              <p className="py-3 text-ui text-primary-300">{translate("No pay recorded yet.")}</p>
            )
          ) : (
            <Restricted what="pay (owner and payroll admins only)" />
          )}
        </Section>
        <Section title={translate("Bank account")}>
          {e.bank ? (
            e.bank.current ? (
              <dl>
                <Field term={translate("Bank")}>{e.bank.current.bankName}</Field>
                <Field term={translate("Account")} mono>
                  <RevealValue masked={`••••${e.bank.current.accountLast4}`} employeeId={e.id} kind="bank" />
                </Field>
                <Field term={translate("Holder")}>{e.bank.current.holderName}</Field>
                <Field term={translate("Since")}>{formatDate(e.bank.current.effectiveFrom)}</Field>
              </dl>
            ) : (
              <p className="py-3 text-ui text-primary-300">
                {translate("No bank account. Salary can't be paid by GIRO until one is added.")}
              </p>
            )
          ) : (
            <Restricted what="bank details" />
          )}
        </Section>
      </div>
      {c ? <RecurringAllowances employeeId={e.id} rows={c.allowances} editable={editable} /> : null}
      {c ? (
        <Section title={translate("Pay history")}>
          <div className="-mx-4 -my-2">
            <Table aria-label={translate("Pay history")}>
              <TableHeader>
                <TableRow>
                  <TableHead numeric>{translate("From")}</TableHead>
                  <TableHead numeric>{translate("Until")}</TableHead>
                  <TableHead>{translate("Basis")}</TableHead>
                  <TableHead numeric>{translate("Amount")}</TableHead>
                  <TableHead className="hidden sm:table-cell">{translate("Reason")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {c.history.map((h) => (
                  <TableRow key={h.id}>
                    <TableCell numeric>{formatDate(h.effectiveFrom)}</TableCell>
                    <TableCell numeric>{h.effectiveTo ? formatDate(h.effectiveTo) : "—"}</TableCell>
                    <TableCell>
                      {label(h.payBasis, translate)}
                      {h.retroactive ? " · retro" : ""}
                    </TableCell>
                    <TableCell numeric>{formatMoney(h.amountCents)}</TableCell>
                    <TableCell className="hidden sm:table-cell">{h.reason ?? "—"}</TableCell>
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

function HistoryTab({ e, editablePay }: { e: EmployeeDetailDto; editablePay: boolean }) {
  const translate = useT("people-payroll");
  const qc = useQueryClient();
  const cancel = useMutation({
    mutationFn: (eventId: string) => api("POST", `/employees/${e.id}/events/${eventId}/cancel`),
    onSuccess: async () => {
      await invalidatePeople(qc);
      toast(translate("Change cancelled"), { description: translate("The previous record is back in force.") });
    },
    onError: (err) => toast(translate("Couldn't cancel"), { description: errorMessage(err) }),
  });
  if (!e.employment) return <Restricted what="lifecycle events" />;
  return (
    <Section title={translate("Lifecycle events")}>
      <ol className="divide-y divide-border">
        {e.employment.events.map((ev) => (
          <li key={ev.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
            <div className="min-w-0">
              <p className="font-medium">{label(ev.type, translate)}</p>
              <p className="text-2xs text-primary-200">
                <span className="num">{formatDate(ev.effectiveDate)}</span>
                {describeEvent(ev.payload, translate)}
              </p>
            </div>
            <div className="flex items-center gap-2">
              {/* Effective is the normal state; only a scheduled or cancelled event is marked. */}
              {ev.status === "scheduled" ? (
                <StatusPill tone="info">{translate("Scheduled")}</StatusPill>
              ) : ev.status === "cancelled" ? (
                <span className="text-2xs text-primary-300">{translate("Cancelled")}</span>
              ) : null}
              {ev.status === "scheduled" &&
              ev.type !== "hire" &&
              ev.type !== "rehire" &&
              (ev.type !== "salary_change" || editablePay) ? (
                <Button size="sm" variant="ghost" disabled={cancel.isPending} onClick={() => cancel.mutate(ev.id)}>
                  {translate("Cancel")}
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
  const t = useT("people-payroll");
  if (status === "done") return <span className="text-2xs text-primary-300">{t("Done")}</span>;
  if (status !== "open") return <span className="text-2xs text-primary-300">{label(status, t)}</span>;
  const overdue = daysBetween(today(), dueOn) < 0;
  return overdue ? (
    <StatusPill tone="warning">
      <span className="num">{t("Overdue · due {date}", { date: formatDate(dueOn) })}</span>
    </StatusPill>
  ) : (
    <span className="num text-2xs text-primary-300">{t("Due {date}", { date: formatDate(dueOn) })}</span>
  );
}

function describeEvent(p: Record<string, unknown>, t: Translate): string {
  const bits: string[] = [];
  const ch = (p.changes ?? {}) as Record<string, unknown>;
  if (typeof ch.jobTitle === "string") bits.push(`job title ${ch.jobTitle}`);
  if (ch.departmentId) bits.push("department");
  if (ch.managerEmployeeId !== undefined) bits.push("manager");
  if (ch.locationId) bits.push("location");
  if (typeof p.reason === "string" && p.reason !== "resignation") bits.push(label(p.reason, t));
  if (typeof p.noticeDays === "number")
    bits.push(`${p.noticeDays} days' notice${p.noticeBasis === "statutory" ? " (Employment Act minimum)" : ""}`);
  if (typeof p.jobTitle === "string") bits.push(p.jobTitle);
  if (Array.isArray(p.endedAllowances) && p.endedAllowances.length) bits.push("allowance ends");
  return bits.length ? ` · ${bits.join(", ")}` : "";
}

function ChangeDialog({ e, onClose }: { e: EmployeeDetailDto; onClose: () => void }) {
  const t = useT("people-payroll");
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
      toast(r.status === "scheduled" ? t("Change scheduled") : t("Change saved"), {
        description: `${label(type, t)} effective ${formatDate(date)}.`,
      });
      onClose();
    },
  });
  const errs = fieldErrors(save.error);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("Record a change")}</DialogTitle>
          <DialogDescription>{t("Future dates are scheduled and apply automatically on the day.")}</DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-3"
          onSubmit={(ev) => {
            ev.preventDefault();
            save.mutate();
          }}
        >
          <SelectInput
            label={t("Type")}
            value={type}
            onChange={setType}
            options={[
              { value: "transfer", label: t("Transfer") },
              { value: "promotion", label: t("Promotion") },
            ]}
          />
          <DateInput label={t("Effective from")} required value={date} onChange={setDate} error={errs.effectiveDate} />
          <TextInput label={t("Job title")} value={jobTitle} onChange={setJobTitle} error={errs["changes.jobTitle"]} />
          <SelectInput
            label={t("Department")}
            value={departmentId}
            onChange={setDepartmentId}
            options={(departments.data?.items ?? [])
              .filter((d) => !d.archived)
              .map((d) => ({ value: d.id, label: d.name }))}
          />
          <SelectInput
            label={t("Location")}
            value={locationId}
            onChange={setLocationId}
            options={(locations.data?.items ?? [])
              .filter((d) => !d.archived)
              .map((d) => ({ value: d.id, label: d.name }))}
          />
          <SelectInput
            label={t("Manager")}
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
              {t("Cancel")}
            </Button>
            <Button type="submit" variant="primary" disabled={save.isPending}>
              {t("Save change")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function PayDialog({ e, onClose }: { e: EmployeeDetailDto; onClose: () => void }) {
  const t = useT("people-payroll");
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
      toast(r.status === "scheduled" ? t("Pay change scheduled") : t("Pay changed"), {
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
          <DialogTitle>{t("Change pay")}</DialogTitle>
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
            label={t("Pay basis")}
            value={basis}
            onChange={setBasis}
            options={["monthly", "hourly"].map((v) => ({ value: v, label: label(v, t) }))}
          />
          <FormField
            label={basis === "hourly" ? t("New hourly rate") : t("New basic monthly pay")}
            required
            error={errs["compensation.amountCents"]}
          >
            <MoneyInput value={amount} onChange={(c) => setAmount(c)} aria-label={t("New amount")} />
          </FormField>
          <DateInput label={t("Effective from")} required value={date} onChange={setDate} error={errs.effectiveDate} />
          <FormField label={t("Reason")}>
            <Textarea
              value={reason}
              onChange={(ev) => setReason(ev.target.value)}
              rows={2}
              placeholder={t("Annual increment")}
            />
          </FormField>
          {finalised ? (
            <label className="flex items-start gap-2 rounded-md border border-warning-300/50 bg-warning-50 p-3 text-ui">
              <input type="checkbox" checked={retro} onChange={(ev) => setRetro(ev.target.checked)} className="mt-1" />
              <span>
                {finalised} {t("Tick to record it as retroactive.")}
              </span>
            </label>
          ) : null}
          {save.isError && !finalised ? (
            <p role="alert" className="text-ui text-danger-300">
              {errorMessage(save.error)}
            </p>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              {t("Cancel")}
            </Button>
            <Button type="submit" variant="primary" disabled={save.isPending || amount === null}>
              {t("Save pay")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function NamesDialog({ e, onClose }: { e: EmployeeDetailDto; onClose: () => void }) {
  const t = useT("people-payroll");
  const qc = useQueryClient();
  const [legalName, setLegalName] = React.useState(e.legalName);
  const [preferredName, setPreferredName] = React.useState(e.preferredName ?? "");
  const save = useMutation({
    mutationFn: () => api("PATCH", `/employees/${e.id}`, { legalName: legalName.trim(), preferredName }),
    onSuccess: async () => {
      await invalidatePeople(qc);
      toast(t("Names saved"));
      onClose();
    },
  });
  const errs = fieldErrors(save.error);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("Edit names")}</DialogTitle>
          <DialogDescription>
            {t("The legal name goes on payslips, letters and statutory forms. The preferred name is what they go by.")}
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
            label={t("Legal name")}
            required
            value={legalName}
            onChange={setLegalName}
            error={errs.legalName}
            hint={t("As on the NRIC, FIN card or passport.")}
          />
          <TextInput
            label={t("Preferred name")}
            value={preferredName}
            onChange={setPreferredName}
            error={errs.preferredName}
            hint={t("Optional, e.g. Hafiz for Muhammad Hafiz bin Ismail. Leave empty to use the legal name.")}
          />
          {save.isError ? (
            <p role="alert" className="text-ui text-danger-300">
              {errorMessage(save.error)}
            </p>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              {t("Cancel")}
            </Button>
            <Button type="submit" variant="primary" disabled={save.isPending}>
              {t("Save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function LeaveDialog({ e, onClose }: { e: EmployeeDetailDto; onClose: () => void }) {
  const t = useT("people-payroll");
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
      toast(t("Leaving recorded"), { description: t("An offboarding checklist was created.") });
      onClose();
    },
  });
  const errs = fieldErrors(save.error);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("Record leaving")}</DialogTitle>
          <DialogDescription>
            {t("The notice date counts as day 1. A shorter last day can be agreed.")}
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
            label={t("Type")}
            value={type}
            onChange={setType}
            options={[
              { value: "resignation", label: t("Resignation") },
              { value: "termination", label: t("Termination") },
            ]}
          />
          {type === "resignation" ? (
            <>
              <DateInput
                label={t("Notice given on")}
                required
                value={noticeOn}
                onChange={setNoticeOn}
                error={errs.noticeGivenOn}
              />
              <TextInput
                label={t("Notice period (days)")}
                mono
                inputMode="numeric"
                value={noticeDays}
                onChange={setNoticeDays}
                error={errs.noticeDays}
                hint="From the employment contract. Leave empty if the contract states none: the Employment Act minimum applies (1 day under 26 weeks of service, 1 week under 2 years, 2 weeks under 5 years, then 4 weeks)."
              />
              <DateInput
                label={t("Agreed last day (optional)")}
                min={noticeOn || undefined}
                value={lastDay}
                onChange={setLastDay}
                error={errs.agreedLastWorkingDay}
              />
            </>
          ) : (
            <>
              <SelectInput
                label={t("Reason")}
                value={reason}
                onChange={setReason}
                options={(ref.data?.terminationReasons ?? []).map((r) => ({ value: r, label: label(r, t) }))}
              />
              <DateInput
                label={t("Last working day")}
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
              {t("Cancel")}
            </Button>
            <Button type="submit" variant="primary" disabled={save.isPending}>
              {t("Save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
