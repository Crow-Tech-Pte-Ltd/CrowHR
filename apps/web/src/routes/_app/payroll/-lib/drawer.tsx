import type { PayrollEmployeeDetailDto, PayrollItemDto, PayrollOverviewDto, PayrollRowDto } from "@crowhr/core";
import {
  Button,
  cn,
  FormField,
  formatDate,
  formatMoney,
  Input,
  MoneyInput,
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
  toast,
} from "@crowhr/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ChevronLeft, ChevronRight, ExternalLink, FileText, Pencil, Plus, Trash2 } from "lucide-react";
import * as React from "react";
import {
  addItem,
  deleteItem,
  employeeDetailQuery,
  errorMessage,
  fieldErrors,
  invalidateRun,
  updateItem,
} from "./api.ts";
import { type DrawerTask, fixesFor } from "./fixes.ts";
import { IssueList, sourceHost } from "./ui.tsx";

const SECTION_TITLE: Record<string, string> = {
  basic: "Basic pay",
  allowances: "Allowances",
  overtime: "Overtime",
  pay: "Pay",
  cpf: "CPF",
  shg: "Self-help group",
  sdl: "Skills Development Levy",
  fwl: "Foreign worker levy (estimate)",
  deductions: "Deduction limits",
};
const SECTION_ORDER = ["basic", "allowances", "overtime", "pay", "cpf", "shg", "sdl", "fwl", "deductions"];

const RESIDENCY_STATUS_LABEL: Record<string, string> = {
  SC: "Singapore Citizen",
  SPR: "Singapore Permanent Resident",
  FOREIGNER: "Foreigner",
};
const SPR_OPTION_LABEL: Record<string, string> = {
  GG: "graduated employer and employee rates, G/G",
  FG: "full employer, graduated employee rates, F/G",
  FF: "full rates, F/F",
};

/** CPF residency category in words: "SPR1_GG" → "SPR year 1, graduated employer and employee rates, G/G". */
export function cpfCategoryLabel(code: string): string {
  if (RESIDENCY_STATUS_LABEL[code]) return RESIDENCY_STATUS_LABEL[code];
  const m = /^SPR(\d)(?:_(GG|FG|FF))?$/.exec(code);
  if (!m) return code;
  if (m[1] === "3") return "SPR year 3 onwards, full rates";
  return `SPR year ${m[1]}${m[2] ? `, ${SPR_OPTION_LABEL[m[2]]}` : ""}`;
}

const ITEM_KIND: Record<PayrollItemDto["kind"], string> = {
  bonus: "Bonus",
  commission: "Commission",
  backpay: "Back pay",
  other_earning: "Other earning",
  overtime: "Overtime",
  unpaid_leave: "No-pay leave",
  hours: "Hours worked",
  deduction: "Deduction",
  scheduled_days: "Scheduled days",
  days_worked: "Days worked",
  cpf_aw_recovery: "Recover AW top-up CPF",
};

export function EmployeeDrawer({
  runId,
  run,
  rows,
  employeeId,
  onNavigate,
  task,
  onTask,
}: {
  runId: string;
  run: PayrollOverviewDto["run"];
  rows: PayrollRowDto[];
  employeeId: string | null;
  onNavigate: (id: string | undefined) => void;
  /** An item form to open with (from an issue's fix), or null. */
  task: DrawerTask | null;
  onTask: (task: DrawerTask | null) => void;
}) {
  const index = rows.findIndex((r) => r.employeeId === employeeId);
  const prev = index > 0 ? rows[index - 1] : undefined;
  const next = index >= 0 && index < rows.length - 1 ? rows[index + 1] : undefined;
  const detail = useQuery({ ...employeeDetailQuery(runId, employeeId ?? ""), enabled: !!employeeId });
  const onKeyDown = (e: React.KeyboardEvent) => {
    const t = e.target as HTMLElement;
    if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t.getAttribute("role") === "combobox")
      return;
    if (e.key === "]" && next) onNavigate(next.employeeId);
    if (e.key === "[" && prev) onNavigate(prev.employeeId);
  };
  const row = rows.find((r) => r.employeeId === employeeId);
  return (
    <Sheet open={!!employeeId} onOpenChange={(o) => !o && onNavigate(undefined)}>
      <SheetContent
        className="w-[min(46rem,calc(100vw-1rem))] overflow-y-auto p-0 sm:w-[min(46rem,calc(100vw-3rem))]"
        onKeyDown={onKeyDown}
        aria-describedby={undefined}
      >
        <div className="sticky top-0 z-10 flex items-center justify-between gap-2 border-b border-border bg-background px-4 py-3 pr-12">
          <div className="min-w-0">
            <SheetTitle className="truncate text-base font-semibold">
              {row?.name ?? detail.data?.employeeName ?? "Employee"}
            </SheetTitle>
            <SheetDescription className="font-azeret text-[10px] uppercase tracking-wide text-primary-200">
              {row?.employeeNumber} {row?.department ? `· ${row.department}` : ""}
            </SheetDescription>
          </div>
          <div className="flex shrink-0 gap-1">
            <Button
              variant="ghost"
              size="icon-sm"
              disabled={!prev}
              onClick={() => prev && onNavigate(prev.employeeId)}
              aria-label="Previous employee ([)"
            >
              <ChevronLeft />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              disabled={!next}
              onClick={() => next && onNavigate(next.employeeId)}
              aria-label="Next employee (])"
            >
              <ChevronRight />
            </Button>
          </div>
        </div>
        <div className="px-4 py-4">
          {detail.isPending ? (
            <div className="flex flex-col gap-3" role="status" aria-label="Loading">
              <Skeleton className="h-20 w-full" />
              <Skeleton className="h-40 w-full" />
            </div>
          ) : detail.isError ? (
            <p role="alert" className="text-ui text-danger-300">
              {errorMessage(detail.error)}
            </p>
          ) : (
            <DrawerBody d={detail.data} runId={runId} editable={run.status === "draft"} task={task} onTask={onTask} />
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function H({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="mb-1.5 mt-5 font-azeret text-[10px] font-semibold uppercase tracking-wider text-primary-300 first:mt-0">
      {children}
    </h3>
  );
}

function DrawerBody({
  d,
  runId,
  editable,
  task,
  onTask,
}: {
  d: PayrollEmployeeDetailDto;
  runId: string;
  editable: boolean;
  task: DrawerTask | null;
  onTask: (task: DrawerTask | null) => void;
}) {
  const r = d.result;
  const input = d.input as Record<string, unknown> | null;
  const fed = (input?.items as InputItem[] | undefined) ?? [];
  const form = task && editable ? formFor(task, d.items, fed) : null;
  const emp = input?.employee as
    | { dob: string; residency: { status: string; sprDate?: string; option?: string }; idMasked: string }
    | undefined;
  const employment = input?.employment as
    | { hireDate: string; lastWorkingDay: string | null; jobTitle: string | null }
    | undefined;
  const comp =
    (input?.compensation as { from: string; to: string | null; payBasis: string; amountCents: number }[] | undefined) ??
    [];
  return (
    <div>
      {r?.issues.length ? (
        <>
          <H>Issues</H>
          <div className="rounded-md border border-border">
            <IssueList
              issues={r.issues.filter((i) => i.severity !== "info")}
              limit={10}
              // In the drawer a fix either opens another page or the item form below.
              fixes={(i) => fixesFor(i, d.employeeId).filter((f) => f.kind !== "drawer" || (editable && f.task))}
              onFix={(f) => (f.kind === "drawer" && f.task ? onTask(f.task) : undefined)}
            />
          </div>
        </>
      ) : null}
      {r ? (
        <>
          <H>Pay</H>
          <table className="w-full text-ui">
            <tbody>
              {r.lines.map((l) => (
                <tr key={l.code} className="border-b border-border last:border-b-0">
                  <td className="py-1.5 pr-2">
                    {l.label}
                    {l.detail ? <span className="block text-2xs text-primary-300">{l.detail}</span> : null}
                  </td>
                  <td className="py-1.5 pr-2 font-azeret text-[10px] uppercase text-primary-200">
                    {l.kind === "employer"
                      ? "Employer"
                      : l.wageClass
                        ? `${l.wageClass}${l.cpfLiable ? "" : " · no CPF"}`
                        : l.kind === "reimbursement"
                          ? "Not wages"
                          : ""}
                  </td>
                  <td className={cn("num py-1.5 text-right", l.kind === "employer" && "text-primary-300")}>
                    {l.kind === "deduction" ? "-" : ""}
                    {formatMoney(l.amountCents, { symbol: false })}
                  </td>
                </tr>
              ))}
              <tr className="border-t-2 border-ink">
                <td className="py-2 font-medium" colSpan={2}>
                  Net pay{d.run.kind === "adjustment" ? " (revised)" : ""}
                </td>
                <td className="num py-2 text-right font-semibold">{formatMoney(r.totals.netCents as number)}</td>
              </tr>
              {d.run.kind === "adjustment" ? (
                <tr>
                  <td className="py-1 text-primary-300" colSpan={2}>
                    To pay now (after what was already paid)
                  </td>
                  <td className="num py-1 text-right">{formatMoney(r.totals.netPayableCents as number)}</td>
                </tr>
              ) : null}
            </tbody>
          </table>
          {d.payslipId ? (
            <Button asChild variant="link" size="sm" className="mt-2">
              <Link to="/payroll/runs/$runId/payslips/$payslipId" params={{ runId, payslipId: d.payslipId }}>
                <FileText aria-hidden /> View payslip
              </Link>
            </Button>
          ) : null}

          {r.cpf ? (
            <>
              <H>CPF at a glance</H>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-ui sm:grid-cols-3">
                <Fact k="Category" v={cpfCategoryLabel(r.cpf.residencyCategory)} />
                <Fact k="Age band" v={r.cpf.ageBandLabel ?? "–"} />
                <Fact k="Wage band" v={r.cpf.wageBand ?? "–"} />
                <Fact k="OW subject" v={formatMoney(r.cpf.owSubjectCents)} mono />
                <Fact k="AW subject" v={formatMoney(r.cpf.awSubjectCents)} mono />
                <Fact k="AW above ceiling" v={formatMoney(r.cpf.awNotSubjectCents)} mono />
                {r.cpf.awCeiling ? (
                  <>
                    <Fact
                      k={`AW ceiling (${r.cpf.awCeiling.basis.toLowerCase()})`}
                      v={formatMoney(r.cpf.awCeiling.annualAwCeilingCents)}
                      mono
                    />
                    <Fact k="Headroom left" v={formatMoney(r.cpf.awCeiling.headroomAfterCents)} mono />
                  </>
                ) : null}
                <Fact k="Exact total" v={exactMoney(r.cpf.exactTotal)} mono />
              </dl>
            </>
          ) : null}

          <H>Working</H>
          <div className="flex flex-col gap-3">
            {SECTION_ORDER.filter((s) => r.working.some((w) => w.section === s)).map((s) => (
              <div key={s} className="rounded-md border border-border">
                <p className="border-b border-border bg-surface-100 px-3 py-1 font-azeret text-[10px] font-semibold uppercase tracking-wider">
                  {SECTION_TITLE[s]}
                </p>
                <ol className="flex flex-col divide-y divide-border">
                  {r.working
                    .filter((w) => w.section === s)
                    .map((w) => (
                      <li key={`${w.code}-${w.text}`} className="px-3 py-1.5 text-ui leading-5">
                        {w.text}
                        <span className="ml-2 font-azeret text-[9px] uppercase text-primary-200">{w.code}</span>
                      </li>
                    ))}
                </ol>
              </div>
            ))}
          </div>

          <H>Rules used</H>
          <table className="w-full text-ui">
            <thead>
              <tr className="border-b border-border text-left font-azeret text-[10px] uppercase tracking-wider text-primary-200">
                <th className="py-1 pr-2 font-medium">Rule</th>
                <th className="py-1 pr-2 font-medium">In force</th>
                <th className="py-1 font-medium">Source</th>
              </tr>
            </thead>
            <tbody>
              {r.rules.map((rule) => (
                <tr key={`${rule.family}-${rule.id}`} className="border-b border-border last:border-b-0">
                  <td className="py-1.5 pr-2">
                    {rule.family}
                    <span className="block font-azeret text-[10px] text-primary-300">{rule.id}</span>
                  </td>
                  <td className="num whitespace-nowrap py-1.5 pr-2 text-2xs">
                    from {formatDate(rule.effectiveFrom)}
                    {rule.effectiveTo ? ` to ${formatDate(rule.effectiveTo)}` : ""}
                  </td>
                  <td className="py-1.5">
                    <a
                      href={rule.source}
                      target="_blank"
                      rel="noreferrer"
                      className="focus-ring inline-flex items-center gap-1 rounded-sm text-2xs text-biru-400 hover:underline"
                    >
                      {sourceHost(rule.source)} <ExternalLink className="size-3" aria-hidden />
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      ) : (
        <p className="text-ui text-primary-300">Not computed yet. Compute the run to see the pay and its working.</p>
      )}

      <H>Inputs</H>
      {emp && employment ? (
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-ui sm:grid-cols-3">
          <Fact k="NRIC/FIN" v={emp.idMasked} mono />
          <Fact k="Date of birth" v={formatDate(emp.dob)} />
          <Fact
            k="CPF residency"
            v={
              emp.residency.status === "SPR"
                ? `Singapore Permanent Resident from ${formatDate(emp.residency.sprDate as string)} (${SPR_OPTION_LABEL[emp.residency.option ?? "GG"] ?? emp.residency.option})`
                : (RESIDENCY_STATUS_LABEL[emp.residency.status] ?? emp.residency.status)
            }
          />
          <Fact k="Joined" v={formatDate(employment.hireDate)} />
          <Fact k="Last day" v={employment.lastWorkingDay ? formatDate(employment.lastWorkingDay) : "–"} />
          {comp.map((c) => (
            <Fact
              key={c.from}
              k={`Basic from ${formatDate(c.from)}`}
              v={`${formatMoney(c.amountCents)}${c.payBasis === "hourly" ? "/h" : "/month"}`}
              mono
            />
          ))}
        </dl>
      ) : null}
      {d.inputHash ? (
        <p className="mt-2 break-all font-azeret text-[10px] text-primary-200">
          input sha256 {d.inputHash.slice(0, 16)}… · result sha256 {d.resultHash?.slice(0, 16)}…
        </p>
      ) : null}

      <H>Items in this run</H>
      <ItemList
        items={d.items}
        runId={runId}
        editable={editable}
        onEdit={(itemId) => onTask({ kind: "edit", itemId })}
      />
      <FedItems items={fed} manual={d.items} editable={editable} onTask={onTask} />
      {form ? (
        <ItemForm
          key={JSON.stringify(task)}
          runId={runId}
          employeeId={d.employeeId}
          initial={form}
          onClose={() => onTask(null)}
        />
      ) : editable ? (
        <Button size="sm" className="mt-2" onClick={() => onTask({ kind: "add", itemKind: "bonus" })}>
          <Plus aria-hidden /> Add item
        </Button>
      ) : null}
    </div>
  );
}

function Fact({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="font-azeret text-[10px] uppercase tracking-wide text-primary-200">{k}</dt>
      <dd className={cn("truncate", mono && "num")}>{v}</dd>
    </div>
  );
}

/** A run item as it went into the last computation (manual or fed from another module). */
interface InputItem {
  id: string;
  kind: PayrollItemDto["kind"];
  label: string;
  amountCents: number | null;
  minutes: number | null;
  days: number | null;
  periodStart: string | null;
  periodEnd: string | null;
}

const FED_SOURCE: [string, string][] = [
  ["attendance:", "Attendance"],
  ["leave:", "Leave"],
  ["scheduling:", "Roster"],
  ["encashment:", "Leave encashment"],
  ["holiday:", "Holiday pay"],
];

function quantity(i: { amountCents: number | null; minutes: number | null; days: number | null }): string {
  if (i.amountCents !== null) return formatMoney(i.amountCents);
  if (i.minutes) return `${i.minutes / 60} h`;
  if (i.days) return `${i.days} d`;
  return "";
}

function ItemList({
  items,
  runId,
  editable,
  onEdit,
}: {
  items: PayrollItemDto[];
  runId: string;
  editable: boolean;
  onEdit: (itemId: string) => void;
}) {
  const qc = useQueryClient();
  const del = useMutation({
    mutationFn: (id: string) => deleteItem(runId, id),
    onSuccess: () => invalidateRun(qc, runId),
    onError: (e) => toast.error(errorMessage(e)),
  });
  if (!items.length)
    return <p className="text-ui text-primary-300">No items. Basic pay and allowances come from People.</p>;
  return (
    <ul className="divide-y divide-border rounded-md border border-border">
      {items.map((i) => (
        <li key={i.id} className="flex items-center gap-2 px-3 py-1.5 text-ui">
          <span className="w-24 shrink-0 font-azeret text-[10px] uppercase text-primary-200">{ITEM_KIND[i.kind]}</span>
          <span className="min-w-0 flex-1 truncate">
            {i.label}
            {i.wageClass ? (
              <span className="ml-1.5 font-azeret text-[10px] text-primary-300">{i.wageClass}</span>
            ) : null}
            {i.awPayableDate ? (
              <span className="ml-1.5 text-2xs text-primary-300">payable {formatDate(i.awPayableDate)}</span>
            ) : null}
            {i.kind === "hours" && i.date ? (
              <span className="ml-1.5 text-2xs text-primary-300">worked {formatDate(i.date)}</span>
            ) : null}
            {i.holidayDate ? (
              <span className="ml-1.5 text-2xs text-primary-300">holiday {formatDate(i.holidayDate)}</span>
            ) : null}
            {i.overtimeSourceId ? (
              <span className="ml-1.5 text-2xs text-primary-300">prices overtime approved in attendance</span>
            ) : null}
          </span>
          <span className="num shrink-0">{quantity(i)}</span>
          {editable ? (
            <>
              <Button variant="ghost" size="icon-sm" aria-label={`Edit ${i.label}`} onClick={() => onEdit(i.id)}>
                <Pencil />
              </Button>
              <Button variant="ghost" size="icon-sm" aria-label={`Remove ${i.label}`} onClick={() => del.mutate(i.id)}>
                <Trash2 />
              </Button>
            </>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

/**
 * Items fed in from Attendance, Leave and rosters, and automatic holiday pay, as computed. Approved
 * overtime with no statutory rate needs an amount: entered as an overtime item for that claim, which
 * replaces the fed amount (so it is never paid twice).
 */
function FedItems({
  items,
  manual,
  editable,
  onTask,
}: {
  items: InputItem[];
  manual: PayrollItemDto[];
  editable: boolean;
  onTask: (t: DrawerTask) => void;
}) {
  const fed = items.filter(
    (i) =>
      i.id.includes(":") &&
      !(i.id.startsWith("holiday:") && manual.some((m) => m.holidayDate && i.id.endsWith(`:${m.holidayDate}`))),
  );
  if (!fed.length) return null;
  return (
    <>
      <H>From other modules</H>
      <ul className="divide-y divide-border rounded-md border border-border">
        {fed.map((i) => {
          const source = FED_SOURCE.find(([p]) => i.id.startsWith(p))?.[1] ?? "";
          const claimId = i.kind === "overtime" && i.id.startsWith("attendance:") ? i.id.slice(11) : null;
          const priced = claimId ? manual.find((m) => m.overtimeSourceId === claimId) : undefined;
          return (
            <li key={i.id} className="flex flex-wrap items-center gap-x-2 gap-y-1 px-3 py-1.5 text-ui">
              <span className="w-24 shrink-0 font-azeret text-[10px] uppercase text-primary-200">{source}</span>
              <span className="min-w-0 flex-1">
                {i.label}
                {i.periodStart && i.periodEnd ? (
                  <span className="ml-1.5 text-2xs text-primary-300">
                    {formatDate(i.periodStart)}
                    {i.periodEnd !== i.periodStart ? ` – ${formatDate(i.periodEnd)}` : ""}
                  </span>
                ) : null}
              </span>
              <span className="num shrink-0">
                {i.kind === "overtime" && i.minutes ? `${i.minutes / 60} h` : quantity(i)}
                {i.kind === "overtime" && i.amountCents !== null ? ` · ${formatMoney(i.amountCents)}` : ""}
              </span>
              {claimId && editable ? (
                <Button
                  variant="link"
                  size="sm"
                  className="shrink-0"
                  onClick={() =>
                    onTask(
                      priced ? { kind: "edit", itemId: priced.id } : { kind: "overtime", overtimeSourceId: claimId },
                    )
                  }
                >
                  {priced ? "Change amount" : i.amountCents === null ? "Enter amount" : "Use a contract amount"}
                </Button>
              ) : null}
            </li>
          );
        })}
      </ul>
    </>
  );
}

const DEDUCTION_OPTIONS: [string, string][] = [
  ["consented", "Other (written consent)"],
  ["damage_loss", "Damage or loss (25% limit)"],
  ["accommodation", "Accommodation (25% with amenities)"],
  ["amenities", "Amenities and services (25% with accommodation)"],
  ["unearned_benefit", "Unearned employment benefit"],
  ["advance", "Advance recovery (25% per instalment)"],
  ["loan", "Loan instalment (25%)"],
  ["overpayment", "Overpaid salary recovery"],
  ["absence", "Unauthorised absence"],
  ["cooperative", "Co-operative society"],
  ["court_order", "Court order or tax"],
];

const EARNINGS: PayrollItemDto["kind"][] = ["bonus", "commission", "backpay", "other_earning"];

interface FormState {
  editId: string | null;
  kind: PayrollItemDto["kind"];
  label: string;
  amount: number | null;
  wageClass: "OW" | "AW";
  cpfLiable: boolean;
  payable: string;
  hours: string;
  workedOn: string;
  days: string;
  category: string;
  holidayDate: string | null;
  holidayName: string | null;
  overtimeSourceId: string | null;
  periodStart: string | null;
  periodEnd: string | null;
}

function fromItem(i: PayrollItemDto): FormState {
  return {
    editId: i.id,
    kind: i.kind,
    label: i.label,
    amount: i.amountCents,
    wageClass: i.wageClass ?? (i.kind === "bonus" ? "AW" : "OW"),
    cpfLiable: i.cpfLiable,
    payable: i.awPayableDate ?? "",
    hours: i.minutes ? String(i.minutes / 60) : "",
    workedOn: i.date ?? "",
    days: i.days !== null ? String(i.days) : "",
    category: i.deductionCategory ?? "consented",
    holidayDate: i.holidayDate,
    holidayName: null,
    overtimeSourceId: i.overtimeSourceId,
    periodStart: i.periodStart,
    periodEnd: i.periodEnd,
  };
}

const blank = (kind: PayrollItemDto["kind"]): FormState => ({
  editId: null,
  kind,
  label: "",
  amount: null,
  wageClass: kind === "bonus" ? "AW" : "OW",
  cpfLiable: true,
  payable: "",
  hours: "",
  workedOn: "",
  days: "",
  category: "consented",
  holidayDate: null,
  holidayName: null,
  overtimeSourceId: null,
  periodStart: null,
  periodEnd: null,
});

/** The form a task opens with. An item that already covers the holiday or overtime claim is edited instead. */
function formFor(task: DrawerTask, items: PayrollItemDto[], fed: InputItem[]): FormState | null {
  switch (task.kind) {
    case "add":
      return blank(task.itemKind);
    case "edit": {
      const item = items.find((i) => i.id === task.itemId);
      return item ? fromItem(item) : null;
    }
    case "holiday": {
      const existing = items.find((i) => i.holidayDate === task.holidayDate);
      if (existing) return { ...fromItem(existing), holidayName: task.holidayName };
      return {
        ...blank("other_earning"),
        label: `Public holiday: ${task.holidayName} (off day)`,
        holidayDate: task.holidayDate,
        holidayName: task.holidayName,
      };
    }
    case "overtime": {
      const existing = items.find((i) => i.overtimeSourceId === task.overtimeSourceId);
      if (existing) return fromItem(existing);
      const source = fed.find((i) => i.id === `attendance:${task.overtimeSourceId}`);
      return {
        ...blank("overtime"),
        label: "Overtime (contract rate)",
        hours: source?.minutes ? String(source.minutes / 60) : "",
        overtimeSourceId: task.overtimeSourceId,
        periodStart: source?.periodStart ?? null,
        periodEnd: source?.periodEnd ?? null,
      };
    }
  }
}

function ItemForm({
  runId,
  employeeId,
  initial,
  onClose,
}: {
  runId: string;
  employeeId: string;
  initial: FormState;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [f, setF] = React.useState(initial);
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setF((s) => ({ ...s, [k]: v }));
  const first = React.useRef<HTMLFormElement>(null);
  const fixed = !!(initial.editId || initial.holidayDate || initial.overtimeSourceId);
  React.useEffect(() => {
    first.current?.scrollIntoView({ block: "nearest" });
    first.current?.querySelector<HTMLElement>("[data-first]")?.focus();
  }, []);
  const earning = EARNINGS.includes(f.kind);
  const save = useMutation({
    mutationFn: () => {
      const body = {
        employeeId,
        kind: f.kind,
        label: f.label || ITEM_KIND[f.kind],
        amountCents: f.amount,
        wageClass: earning ? f.wageClass : null,
        cpfLiable: f.cpfLiable,
        awPayableDate: earning && f.wageClass === "AW" && f.payable ? f.payable : null,
        minutes: f.hours ? Math.round(Number(f.hours) * 60) : null,
        date: f.kind === "hours" && f.workedOn ? f.workedOn : null,
        days: f.days ? Number(f.days) : null,
        deductionCategory: f.kind === "deduction" ? (f.category as never) : null,
        holidayDate: f.kind === "other_earning" ? f.holidayDate : null,
        overtimeSourceId: f.kind === "overtime" ? f.overtimeSourceId : null,
        periodStart: f.kind === "overtime" ? f.periodStart : null,
        periodEnd: f.kind === "overtime" ? f.periodEnd : null,
      };
      return f.editId ? updateItem(runId, f.editId, body) : addItem(runId, body).then(() => undefined);
    },
    onSuccess: async () => {
      await invalidateRun(qc, runId);
      toast.success(f.editId ? "Item saved. Recompute to apply it." : "Item added. Recompute to apply it.");
      if (fixed) onClose();
      else setF((s) => ({ ...blank(s.kind), wageClass: s.wageClass, category: s.category }));
    },
  });
  const errors = fieldErrors(save.error);
  const title = f.holidayDate
    ? `Holiday pay: ${f.holidayName ?? "public holiday"}, ${formatDate(f.holidayDate)}`
    : f.overtimeSourceId
      ? "Overtime approved in attendance"
      : f.editId
        ? `Edit ${ITEM_KIND[f.kind].toLowerCase()}`
        : "Add an item";
  return (
    <form
      ref={first}
      aria-label={title}
      className="mt-3 grid grid-cols-1 gap-3 rounded-md border border-border p-3 sm:grid-cols-2"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      <p className="font-azeret text-[10px] font-semibold uppercase tracking-wider sm:col-span-2">{title}</p>
      {f.holidayDate ? (
        <p className="text-2xs text-primary-300 sm:col-span-2">
          The holiday falls on this employee's off day, so they get one extra day's pay at the gross rate of pay (basic
          pay and fixed allowances; not overtime, bonuses or travelling, food and housing allowances). Crow HR works it
          out itself only for monthly-rated staff on a fixed week.
        </p>
      ) : null}
      {f.overtimeSourceId ? (
        <p className="text-2xs text-primary-300 sm:col-span-2">
          {f.hours ? `${f.hours} h approved` : "Approved"}
          {f.periodStart && f.periodEnd
            ? ` for ${formatDate(f.periodStart)}${f.periodEnd !== f.periodStart ? ` – ${formatDate(f.periodEnd)}` : ""}`
            : ""}
          . Enter the overtime pay your contract gives for these hours; it replaces the statutory rate for this claim
          and is paid once.
        </p>
      ) : null}
      {fixed ? null : (
        <FormField label="Item">
          <Select
            value={f.kind}
            onValueChange={(v) => {
              const kind = v as PayrollItemDto["kind"];
              setF((s) => ({ ...s, kind, wageClass: kind === "bonus" ? "AW" : "OW" }));
            }}
          >
            <SelectTrigger aria-label="Item" data-first>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(ITEM_KIND).map(([k, v]) => (
                <SelectItem key={k} value={k}>
                  {v}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FormField>
      )}
      <FormField label="Label on payslip" error={errors.label}>
        <Input value={f.label} onChange={(e) => set("label", e.target.value)} placeholder={ITEM_KIND[f.kind]} />
      </FormField>
      {earning || f.kind === "deduction" || f.kind === "overtime" || f.kind === "cpf_aw_recovery" ? (
        <FormField
          label={f.holidayDate ? "Day's gross pay" : "Amount"}
          error={errors.amountCents}
          required={!!(f.holidayDate || f.overtimeSourceId)}
          hint={
            f.overtimeSourceId
              ? undefined
              : f.kind === "overtime"
                ? "Leave empty to use the statutory 1.5× rate."
                : f.kind === "cpf_aw_recovery"
                  ? "Leave empty to recover all that CPF Act s 7(9) allows."
                  : undefined
          }
        >
          <MoneyInput value={f.amount} onChange={(c) => set("amount", c)} data-first={fixed ? true : undefined} />
        </FormField>
      ) : null}
      {earning && !f.holidayDate ? (
        <FormField
          label="CPF class"
          hint="AW: bonus, AWS, non-monthly commission. OW: earned for this month, payable by the 14th."
        >
          <Select value={f.wageClass} onValueChange={(v) => set("wageClass", v as "OW" | "AW")}>
            <SelectTrigger aria-label="CPF class">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="OW">Ordinary wages (OW)</SelectItem>
              <SelectItem value="AW">Additional wages (AW)</SelectItem>
            </SelectContent>
          </Select>
        </FormField>
      ) : null}
      {earning && f.wageClass === "AW" && !f.holidayDate ? (
        <FormField
          label="AW payable on"
          error={errors.awPayableDate}
          hint="The date it became due and payable (CPF keys the AW ceiling to it)."
        >
          <Input type="date" value={f.payable} onChange={(e) => set("payable", e.target.value)} required />
        </FormField>
      ) : null}
      {(f.kind === "overtime" && !f.overtimeSourceId) || f.kind === "hours" ? (
        <FormField label="Hours" error={errors.minutes}>
          <Input
            inputMode="decimal"
            value={f.hours}
            onChange={(e) => set("hours", e.target.value)}
            placeholder="e.g. 4.5"
          />
        </FormField>
      ) : null}
      {f.kind === "hours" ? (
        <FormField
          label="Date worked (optional)"
          error={errors.date}
          hint="Needed when the hourly rate changes this month: add one item per rate, dated on or after the change."
        >
          <Input type="date" value={f.workedOn} onChange={(e) => set("workedOn", e.target.value)} />
        </FormField>
      ) : null}
      {f.kind === "scheduled_days" || f.kind === "days_worked" ? (
        <FormField
          label="Days"
          error={errors.days}
          hint={
            f.kind === "scheduled_days"
              ? "Working days the roster required this month, including public holidays."
              : "Days worked, including public holidays and paid leave, excluding no-pay leave."
          }
        >
          <Input inputMode="decimal" value={f.days} onChange={(e) => set("days", e.target.value)} />
        </FormField>
      ) : null}
      {f.kind === "unpaid_leave" ? (
        <FormField label="Days" error={errors.days} hint="Half days allowed, e.g. 1.5.">
          <Input inputMode="decimal" value={f.days} onChange={(e) => set("days", e.target.value)} />
        </FormField>
      ) : null}
      {f.kind === "deduction" ? (
        <FormField label="Category" error={errors.deductionCategory} hint="Employment Act limits apply per category.">
          <Select value={f.category} onValueChange={(v) => set("category", v)}>
            <SelectTrigger aria-label="Category">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {DEDUCTION_OPTIONS.map(([k, v]) => (
                <SelectItem key={k} value={k}>
                  {v}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FormField>
      ) : null}
      {save.isError && !Object.keys(errors).length ? (
        <p role="alert" className="text-ui text-danger-300 sm:col-span-2">
          {errorMessage(save.error)}
        </p>
      ) : null}
      <div className="flex gap-2 sm:col-span-2">
        <Button type="submit" size="sm" variant="primary" disabled={save.isPending}>
          {f.editId ? "Save item" : "Add item"}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onClose}>
          {fixed ? "Cancel" : "Done"}
        </Button>
      </div>
    </form>
  );
}

/** An exact rational number of cents ("n" or "n/d") as dollars with every significant decimal. */
function exactMoney(exact: string): string {
  const [n, d = "1"] = exact.split("/");
  const num = BigInt(n as string);
  const den = BigInt(d) * 100n;
  const neg = num < 0n;
  const abs = neg ? -num : num;
  const whole = abs / den;
  let rem = abs % den;
  let frac = "";
  for (let i = 0; i < 8 && (rem !== 0n || frac.length < 2); i++) {
    rem *= 10n;
    frac += String(rem / den);
    rem %= den;
  }
  const dollars = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${neg ? "-" : ""}S$${dollars}.${frac}${rem !== 0n ? "…" : ""}`;
}
