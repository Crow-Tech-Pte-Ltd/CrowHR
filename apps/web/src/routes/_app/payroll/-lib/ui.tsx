import type { PayrollIssueDto, PayslipViewDto } from "@crowhr/core";
import { Button, cn, formatDate, formatMoney, StatusPill } from "@crowhr/ui";
import { AlertOctagon, AlertTriangle, Download, ExternalLink } from "lucide-react";
import * as React from "react";

/** Right-aligned tabular money. Zero shows as an en dash so real amounts stand out in dense tables. */
export function Money({
  cents,
  className,
  dashZero = false,
  strong = false,
}: {
  cents: number;
  className?: string;
  dashZero?: boolean;
  strong?: boolean;
}) {
  return (
    <span className={cn("num whitespace-nowrap", strong && "font-semibold", className)}>
      {dashZero && cents === 0 ? <span className="text-primary-200">–</span> : formatMoney(cents, { symbol: false })}
    </span>
  );
}

export const FLAG_LABEL: Record<string, string> = {
  joiner: "Joiner",
  leaver: "Leaver",
  npl: "No-pay leave",
  aw: "AW",
  aw_ceiling: "AW ceiling",
  ot: "OT",
  foreigner: "No CPF",
  spr_graduated: "SPR graduated",
};

export function Flags({ flags }: { flags: string[] }) {
  if (!flags.length) return null;
  return (
    <span className="flex gap-1">
      {flags.map((f) => (
        <span
          key={f}
          className="whitespace-nowrap rounded-sm border border-ink/15 px-1 font-azeret text-[10px] uppercase leading-4 tracking-wide text-primary-300"
        >
          {FLAG_LABEL[f] ?? f}
        </span>
      ))}
    </span>
  );
}

export function sourceHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export type IssueRow = PayrollIssueDto & { employeeId?: string | null; employeeName?: string | null };

/** Issues, blocking first. Each says what is wrong and how to fix it, with its source. */
export function IssueList({
  issues,
  onEmployee,
  limit = 6,
}: {
  issues: IssueRow[];
  onEmployee?: (id: string) => void;
  limit?: number;
}) {
  const [all, setAll] = React.useState(false);
  const shown = all ? issues : issues.slice(0, limit);
  return (
    <ul className="divide-y divide-border">
      {shown.map((i) => (
        <li key={`${i.code}-${i.employeeId ?? ""}-${i.message}`} className="flex gap-2.5 px-4 py-2.5 text-ui">
          {i.severity === "blocking" ? (
            <AlertOctagon className="mt-0.5 size-4 shrink-0 text-danger-300" aria-label="Blocking" />
          ) : (
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning-400" aria-label="Warning" />
          )}
          <div className="min-w-0 flex-1">
            <p className="leading-5">
              {i.employeeName ? (
                onEmployee && i.employeeId ? (
                  <button
                    type="button"
                    className="focus-ring mr-1.5 rounded-sm font-medium underline-offset-2 hover:underline"
                    onClick={() => onEmployee(i.employeeId as string)}
                  >
                    {i.employeeName}:
                  </button>
                ) : (
                  <span className="mr-1.5 font-medium">{i.employeeName}:</span>
                )
              ) : null}
              {i.message}
            </p>
            <p className="mt-0.5 flex flex-wrap gap-x-3 font-azeret text-[10px] uppercase tracking-wide text-primary-200">
              <span>{i.code}</span>
              {i.source ? (
                <a
                  href={i.source}
                  target="_blank"
                  rel="noreferrer"
                  className="focus-ring inline-flex items-center gap-1 rounded-sm text-biru-400 hover:underline"
                >
                  {sourceHost(i.source)} <ExternalLink className="size-3" aria-hidden />
                </a>
              ) : null}
            </p>
          </div>
        </li>
      ))}
      {issues.length > limit ? (
        <li className="px-4 py-2">
          <Button variant="link" size="sm" onClick={() => setAll(!all)}>
            {all ? "Show fewer" : `Show all ${issues.length}`}
          </Button>
        </li>
      ) : null}
    </ul>
  );
}

function SlipRow({
  label,
  detail,
  cents,
  negative,
}: {
  label: string;
  detail?: string | null;
  cents: number;
  negative?: boolean;
}) {
  return (
    <tr className="border-b border-border last:border-b-0">
      <td className="py-2 pr-3 align-top text-ui">
        {label}
        {detail ? <span className="block text-2xs text-primary-300 sm:hidden">{detail}</span> : null}
      </td>
      <td className="hidden py-2 pr-3 align-top text-2xs text-primary-300 sm:table-cell">{detail}</td>
      <td className="num py-2 text-right align-top text-ui">
        {negative && cents !== 0 ? "-" : ""}
        {formatMoney(cents, { symbol: false })}
      </td>
    </tr>
  );
}

function SlipSection({
  title,
  children,
  total,
}: {
  title: string;
  children: React.ReactNode;
  total?: { label: string; cents: number };
}) {
  return (
    <section className="mt-5">
      <div className="flex items-baseline justify-between rounded-sm bg-surface-100 px-2 py-1.5">
        <h3 className="font-azeret text-2xs font-semibold uppercase tracking-wider">{title}</h3>
        <span className="font-azeret text-[10px] text-primary-200">S$</span>
      </div>
      <table className="w-full">
        <tbody className="[&_td:first-child]:pl-2 [&_td:last-child]:pr-2">{children}</tbody>
        {total ? (
          <tfoot>
            <tr>
              <td className="py-2 pl-2 text-ui font-medium">{total.label}</td>
              <td className="hidden sm:table-cell" />
              <td className="num py-2 pr-2 text-right text-ui font-semibold">
                {formatMoney(total.cents, { symbol: false })}
              </td>
            </tr>
          </tfoot>
        ) : null}
      </table>
    </section>
  );
}

/** The payslip as employees see it; the PDF has the same items in the same order. */
export function PayslipDocument({ slip, pdfHref }: { slip: PayslipViewDto; pdfHref: string }) {
  const particulars: [string, string][] = [
    ["Employee", slip.employee.name],
    ["Employee no.", slip.employee.employeeNumber],
    ["NRIC/FIN", slip.employee.idMasked],
    ["Job title", slip.employee.jobTitle ?? "—"],
    ["Date of payment", formatDate(slip.payDate)],
    ["Salary period", `${formatDate(slip.periodStart)} – ${formatDate(slip.periodEnd)}`],
    ["Department", slip.employee.department ?? "—"],
    [
      "CPF",
      slip.cpf?.rateTableLabel
        ? `${slip.cpf.rateTableLabel}${slip.cpf.ageBand ? `, age ${slip.cpf.ageBand}` : ""}`
        : "Not applicable",
    ],
  ];
  return (
    <article
      aria-label={slip.title}
      className="mx-auto max-w-3xl rounded-lg border border-border bg-card px-4 py-5 sm:px-8 sm:py-7"
    >
      <header className="flex flex-col gap-2 border-b-2 border-ink pb-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-center gap-2.5">
          <span aria-hidden className="h-5 w-1.5 rounded-[1px] bg-kuning-300" />
          <p className="text-lg font-medium">{slip.employer.legalName}</p>
        </div>
        <div className="flex items-center gap-2 sm:flex-col sm:items-end">
          <h2 className="font-azeret text-xs font-semibold uppercase tracking-wider">{slip.title}</h2>
          <Button asChild size="sm" variant="secondary">
            <a href={pdfHref} download>
              <Download aria-hidden /> PDF
            </a>
          </Button>
        </div>
      </header>
      {slip.revision ? (
        <p className="mt-3 rounded-sm border border-warning-300/50 bg-warning-50 px-3 py-2 text-ui">
          This revised payslip replaces an earlier one for the same month. Net already paid{" "}
          <span className="num">{formatMoney(slip.revision.previouslyPaidCents)}</span>.
        </p>
      ) : null}
      <dl className="mt-4 grid grid-cols-1 gap-x-8 gap-y-2 sm:grid-cols-2">
        {particulars.map(([k, v]) => (
          <div key={k} className="flex items-baseline gap-3">
            <dt className="w-28 shrink-0 font-azeret text-[10px] uppercase tracking-wide text-primary-200">{k}</dt>
            <dd className="min-w-0 text-ui">{v}</dd>
          </div>
        ))}
      </dl>
      <SlipSection title="Earnings" total={{ label: "Gross pay", cents: slip.grossCents }}>
        {slip.basic ? (
          <SlipRow
            label="Basic salary"
            detail={
              slip.basic.hourly
                ? `${slip.basic.hourly.hours} h × ${formatMoney(slip.basic.hourly.rateCents)}`
                : slip.basic.detail
            }
            cents={slip.basic.amountCents}
          />
        ) : (
          <SlipRow label="Basic salary (paid in the monthly payslip)" cents={0} />
        )}
        {slip.allowances.map((a) => (
          <SlipRow key={a.label} label={a.label} detail={a.detail ?? "Allowance"} cents={a.amountCents} />
        ))}
        {slip.overtime ? (
          <SlipRow
            label="Overtime pay"
            detail={`${slip.overtime.hours} h worked${slip.overtime.differsFromSalaryPeriod && slip.overtime.periodStart && slip.overtime.periodEnd ? `, ${formatDate(slip.overtime.periodStart)} – ${formatDate(slip.overtime.periodEnd)}` : ""}`}
            cents={slip.overtime.payCents}
          />
        ) : null}
        {slip.additional.map((a) => (
          <SlipRow key={a.label} label={a.label} detail={a.detail} cents={a.amountCents} />
        ))}
      </SlipSection>
      <SlipSection title="Deductions" total={{ label: "Total deductions", cents: slip.totalDeductionsCents }}>
        {slip.deductions.length === 0 ? <SlipRow label="No deductions" cents={0} /> : null}
        {slip.deductions.map((d) => (
          <SlipRow
            key={d.label}
            label={d.label}
            detail={d.type === "fixed" ? "Fixed" : (d.detail ?? "Ad hoc")}
            cents={d.amountCents}
            negative
          />
        ))}
      </SlipSection>
      {slip.reimbursements.length ? (
        <SlipSection title="Reimbursements (not wages)">
          {slip.reimbursements.map((r) => (
            <SlipRow key={r.label} label={r.label} cents={r.amountCents} />
          ))}
        </SlipSection>
      ) : null}
      <div className="mt-6 flex items-baseline justify-between rounded-md border-2 border-ink px-4 py-3 shadow-brutal-sm">
        <span className="font-azeret text-xs font-semibold uppercase tracking-wider">Net pay</span>
        <span className="num text-xl font-semibold">{formatMoney(slip.netCents)}</span>
      </div>
      {slip.revision ? (
        <p className="mt-2 text-right text-2xs text-primary-300">
          {slip.netPayableCents >= 0 ? "To pay now" : "Overpaid"}:{" "}
          <span className="num">{formatMoney(Math.abs(slip.netPayableCents))}</span>
        </p>
      ) : null}
      <dl className="mt-5 grid grid-cols-1 gap-2 border-t border-border pt-4 text-ui sm:grid-cols-2">
        <div className="flex justify-between gap-3">
          <dt className="text-primary-300">Employer CPF (not deducted)</dt>
          <dd className="num">{formatMoney(slip.employerCpfCents)}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-primary-300">AW subject to CPF, {slip.ytd.year} to date</dt>
          <dd className="num">{formatMoney(slip.ytd.awSubjectCents)}</dd>
        </div>
        {slip.shgFunds.length ? (
          <div className="flex justify-between gap-3">
            <dt className="text-primary-300">Self-help group</dt>
            <dd>{slip.shgFunds.join(", ")}</dd>
          </div>
        ) : null}
      </dl>
      <p className="mt-5 text-2xs text-primary-200">
        Itemised payslip with the items MOM requires.{" "}
        <a
          className="text-biru-400 hover:underline"
          href="https://www.mom.gov.sg/employment-practices/salary/itemised-payslips"
          target="_blank"
          rel="noreferrer"
        >
          What must be on a payslip
        </a>
        .
      </p>
    </article>
  );
}

export function RunStatusPill({
  status,
  superseded,
}: {
  status: "draft" | "in_review" | "approved" | "paid";
  superseded?: boolean;
}) {
  if (superseded) return <StatusPill tone="neutral">Superseded</StatusPill>;
  const s = {
    draft: ["Draft", "neutral"],
    in_review: ["In review", "info"],
    approved: ["Approved", "success"],
    paid: ["Paid", "success"],
  } as const;
  return <StatusPill tone={s[status][1]}>{s[status][0]}</StatusPill>;
}
