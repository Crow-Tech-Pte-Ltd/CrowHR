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
import { ChevronLeft, ChevronRight, ExternalLink, FileText, Plus, Trash2 } from "lucide-react";
import * as React from "react";
import { addItem, deleteItem, employeeDetailQuery, errorMessage, fieldErrors, invalidateRun } from "./api.ts";
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

const ITEM_KIND: Record<PayrollItemDto["kind"], string> = {
  bonus: "Bonus",
  commission: "Commission",
  backpay: "Back pay",
  other_earning: "Other earning",
  overtime: "Overtime",
  unpaid_leave: "No-pay leave",
  hours: "Hours worked",
  deduction: "Deduction",
};

export function EmployeeDrawer({
  runId,
  run,
  rows,
  employeeId,
  onNavigate,
}: {
  runId: string;
  run: PayrollOverviewDto["run"];
  rows: PayrollRowDto[];
  employeeId: string | null;
  onNavigate: (id: string | undefined) => void;
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
              {row?.employeeNumber} {row?.department ? `· ${row.department}` : ""} · shows its working
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
            <DrawerBody d={detail.data} runId={runId} editable={run.status === "draft"} />
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

function DrawerBody({ d, runId, editable }: { d: PayrollEmployeeDetailDto; runId: string; editable: boolean }) {
  const r = d.result;
  const input = d.input as Record<string, unknown> | null;
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
            <IssueList issues={r.issues.filter((i) => i.severity !== "info")} limit={10} />
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
                <Fact k="Category" v={r.cpf.residencyCategory} />
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
                <Fact k="Exact total (cents)" v={r.cpf.exactTotal} mono />
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
                ? `SPR from ${formatDate(emp.residency.sprDate as string)} (${emp.residency.option ?? "GG"})`
                : emp.residency.status
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
      <ItemList items={d.items} runId={runId} editable={editable} />
      {editable ? <AddItem runId={runId} employeeId={d.employeeId} /> : null}
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

function ItemList({ items, runId, editable }: { items: PayrollItemDto[]; runId: string; editable: boolean }) {
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
          </span>
          <span className="num shrink-0">
            {i.amountCents !== null
              ? formatMoney(i.amountCents)
              : i.minutes
                ? `${i.minutes / 60} h`
                : i.days
                  ? `${i.days} d`
                  : ""}
          </span>
          {editable ? (
            <Button variant="ghost" size="icon-sm" aria-label={`Remove ${i.label}`} onClick={() => del.mutate(i.id)}>
              <Trash2 />
            </Button>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

const DEDUCTION_OPTIONS: [string, string][] = [
  ["consented", "Other (written consent)"],
  ["damage_loss", "Damage or loss (25% limit)"],
  ["accommodation", "Accommodation (25% limit)"],
  ["amenities", "Amenities and services (25% limit)"],
  ["advance", "Advance recovery (25% per instalment)"],
  ["loan", "Loan instalment (25%)"],
  ["overpayment", "Overpaid salary recovery"],
  ["absence", "Unauthorised absence"],
  ["cooperative", "Co-operative society"],
  ["court_order", "Court order or tax"],
];

function AddItem({ runId, employeeId }: { runId: string; employeeId: string }) {
  const qc = useQueryClient();
  const [open, setOpen] = React.useState(false);
  const [kind, setKind] = React.useState<PayrollItemDto["kind"]>("bonus");
  const [label, setLabel] = React.useState("");
  const [amount, setAmount] = React.useState<number | null>(null);
  const [wageClass, setWageClass] = React.useState<"OW" | "AW">("AW");
  const [payable, setPayable] = React.useState("");
  const [hours, setHours] = React.useState("");
  const [days, setDays] = React.useState("");
  const [category, setCategory] = React.useState("consented");
  const add = useMutation({
    mutationFn: () =>
      addItem(runId, {
        employeeId,
        kind,
        label: label || ITEM_KIND[kind],
        amountCents: amount,
        wageClass: ["bonus", "commission", "backpay", "other_earning"].includes(kind) ? wageClass : null,
        awPayableDate: wageClass === "AW" && payable ? payable : null,
        minutes: hours ? Math.round(Number(hours) * 60) : null,
        days: days ? Number(days) : null,
        deductionCategory: kind === "deduction" ? (category as never) : null,
      }),
    onSuccess: async () => {
      await invalidateRun(qc, runId);
      toast.success("Item added. Recompute to apply it.");
      setLabel("");
      setAmount(null);
      setHours("");
      setDays("");
    },
  });
  const errors = fieldErrors(add.error);
  const earning = ["bonus", "commission", "backpay", "other_earning"].includes(kind);
  if (!open) {
    return (
      <Button size="sm" className="mt-2" onClick={() => setOpen(true)}>
        <Plus aria-hidden /> Add item
      </Button>
    );
  }
  return (
    <form
      className="mt-3 grid grid-cols-1 gap-3 rounded-md border border-border p-3 sm:grid-cols-2"
      onSubmit={(e) => {
        e.preventDefault();
        add.mutate();
      }}
    >
      <FormField label="Item">
        <Select
          value={kind}
          onValueChange={(v) => {
            setKind(v as PayrollItemDto["kind"]);
            setWageClass(v === "bonus" ? "AW" : "OW");
          }}
        >
          <SelectTrigger aria-label="Item">
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
      <FormField label="Label on payslip" error={errors.label}>
        <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder={ITEM_KIND[kind]} />
      </FormField>
      {earning || kind === "deduction" || kind === "overtime" ? (
        <FormField
          label="Amount"
          error={errors.amountCents}
          hint={kind === "overtime" ? "Leave empty to use the statutory 1.5× rate." : undefined}
        >
          <MoneyInput value={amount} onChange={(c) => setAmount(c)} />
        </FormField>
      ) : null}
      {earning ? (
        <FormField
          label="CPF class"
          hint="AW: bonus, AWS, non-monthly commission. OW: earned for this month, payable by the 14th."
        >
          <Select value={wageClass} onValueChange={(v) => setWageClass(v as "OW" | "AW")}>
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
      {earning && wageClass === "AW" ? (
        <FormField
          label="AW payable on"
          error={errors.awPayableDate}
          hint="The date it became due and payable (CPF keys the AW ceiling to it)."
        >
          <Input type="date" value={payable} onChange={(e) => setPayable(e.target.value)} required />
        </FormField>
      ) : null}
      {kind === "overtime" || kind === "hours" ? (
        <FormField label="Hours" error={errors.minutes}>
          <Input inputMode="decimal" value={hours} onChange={(e) => setHours(e.target.value)} placeholder="e.g. 4.5" />
        </FormField>
      ) : null}
      {kind === "unpaid_leave" ? (
        <FormField label="Days" error={errors.days} hint="Half days allowed, e.g. 1.5.">
          <Input inputMode="decimal" value={days} onChange={(e) => setDays(e.target.value)} />
        </FormField>
      ) : null}
      {kind === "deduction" ? (
        <FormField label="Category" error={errors.deductionCategory} hint="Employment Act limits apply per category.">
          <Select value={category} onValueChange={setCategory}>
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
      {add.isError && !Object.keys(errors).length ? (
        <p role="alert" className="text-ui text-danger-300 sm:col-span-2">
          {errorMessage(add.error)}
        </p>
      ) : null}
      <div className="flex gap-2 sm:col-span-2">
        <Button type="submit" size="sm" variant="primary" disabled={add.isPending}>
          Add item
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
          Done
        </Button>
      </div>
    </form>
  );
}
