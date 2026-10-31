import {
  A4,
  createPdf,
  finishPdf,
  HAIRLINE,
  INK,
  KUNING,
  MUTED,
  type PdfCanvas,
  SURFACE,
  WHITE,
} from "../pdf/document.ts";
import { dateLabel, sgd } from "./engine/dates.ts";
import type { PayslipView } from "./payslip.ts";

/**
 * Payslip PDF (A4, one page for normal payslips). Same content and order as the web payslip, laid
 * out to MOM's itemised payslip items. Byte-stable: `createdAt` is the release (or approval) time.
 */

const M = 48; // margin
const RIGHT = A4.width - M;

function money(cents: number) {
  return sgd(cents).replace("−", "-");
}

export async function renderPayslipPdf(view: PayslipView, opts: { createdAt: Date }): Promise<Uint8Array> {
  const c = await createPdf({
    title: `${view.title}: ${view.employee.name}`,
    author: view.employer.legalName,
    subject: `Pay date ${dateLabel(view.payDate)}`,
    createdAt: opts.createdAt,
  });
  let y = A4.height - M;

  // Header: employer, title, brand chip.
  c.rect(M, y - 4, 6, 18, { fill: KUNING });
  c.text(view.employer.legalName, M + 14, y, { font: "bodyStrong", size: 13 });
  c.text(view.title.toUpperCase(), RIGHT, y, { font: "monoStrong", size: 10, align: "right" });
  y -= 18;
  if (view.revision) {
    c.text(
      `Revision: replaces the payslip of the original run. Net already paid ${money(view.revision.previouslyPaidCents)}.`,
      M + 14,
      y,
      { size: 8, color: MUTED },
    );
    y -= 12;
  }
  y -= 8;
  c.line(M, y, RIGHT, y, 1, INK);
  y -= 20;

  // Particulars: two columns of label/value pairs.
  const left: [string, string][] = [
    ["Employee", view.employee.name],
    ["Employee no.", view.employee.employeeNumber],
    ["NRIC/FIN", view.employee.idMasked],
    ["Job title", view.employee.jobTitle ?? "—"],
  ];
  const right: [string, string][] = [
    ["Date of payment", dateLabel(view.payDate)],
    ["Salary period", `${dateLabel(view.periodStart)} – ${dateLabel(view.periodEnd)}`],
    ["Department", view.employee.department ?? "—"],
    [
      "CPF",
      view.cpf?.rateTableLabel
        ? `${view.cpf.rateTableLabel}${view.cpf.ageBand ? `, age ${view.cpf.ageBand}` : ""}`
        : "Not applicable",
    ],
  ];
  for (let i = 0; i < 4; i++) {
    const [ll, lv] = left[i] as [string, string];
    const [rl, rv] = right[i] as [string, string];
    c.text(ll.toUpperCase(), M, y, { font: "mono", size: 6.5, color: MUTED });
    c.text(lv, M + 80, y, { size: 9, maxWidth: 170 });
    c.text(rl.toUpperCase(), 310, y, { font: "mono", size: 6.5, color: MUTED });
    c.text(rv, 400, y, { size: 9, maxWidth: RIGHT - 400 });
    y -= 15;
  }
  y -= 10;

  const section = (title: string) => {
    c.rect(M, y - 5, RIGHT - M, 16, { fill: SURFACE });
    c.text(title.toUpperCase(), M + 6, y, { font: "monoStrong", size: 7.5 });
    c.text("S$", RIGHT - 6, y, { font: "mono", size: 7, color: MUTED, align: "right" });
    y -= 18;
  };
  const row = (label: string, cents: number, detail: string | null = null, negative = false) => {
    c.text(label, M + 6, y, { size: 9, maxWidth: 260 });
    if (detail) c.text(detail, 330, y, { size: 7.5, color: MUTED, maxWidth: 150 });
    c.text(negative ? `-${money(cents).replace("S$", "")}` : money(cents).replace("S$", ""), RIGHT - 6, y, {
      font: "mono",
      size: 9,
      align: "right",
    });
    y -= 6;
    c.line(M, y, RIGHT, y, 0.4, HAIRLINE);
    y -= 11;
  };
  const total = (label: string, cents: number) => {
    c.text(label, M + 6, y, { font: "bodyStrong", size: 9 });
    c.text(money(cents).replace("S$", ""), RIGHT - 6, y, { font: "monoStrong", size: 9, align: "right" });
    y -= 20;
  };

  section("Earnings");
  if (view.basic) {
    const detail = view.basic.hourly
      ? `${view.basic.hourly.hours} h × ${money(view.basic.hourly.rateCents)}`
      : view.basic.detail;
    row("Basic salary", view.basic.amountCents, detail);
  } else {
    row("Basic salary (paid in the monthly payslip)", 0);
  }
  for (const a of view.allowances) row(a.label, a.amountCents, a.detail ?? "Allowance");
  if (view.overtime) {
    const period =
      view.overtime.differsFromSalaryPeriod && view.overtime.periodStart && view.overtime.periodEnd
        ? `, ${dateLabel(view.overtime.periodStart)} – ${dateLabel(view.overtime.periodEnd)}`
        : "";
    row("Overtime pay", view.overtime.payCents, `${view.overtime.hours} h worked${period}`);
  }
  for (const a of view.additional) row(a.label, a.amountCents, a.detail);
  total("Gross pay", view.grossCents);

  section("Deductions");
  if (view.deductions.length === 0) row("No deductions", 0);
  for (const d of view.deductions)
    row(d.label, d.amountCents, d.type === "fixed" ? "Fixed" : (d.detail ?? "Ad hoc"), true);
  total("Total deductions", view.totalDeductionsCents);

  if (view.reimbursements.length > 0) {
    section("Reimbursements (not wages)");
    for (const r of view.reimbursements) row(r.label, r.amountCents);
    y -= 4;
  }

  // Net pay: the one emphasised surface (2px ink border, hard offset shadow).
  const boxH = view.revision ? 52 : 40;
  c.rect(M + 3, y - boxH + 9, RIGHT - M, boxH, { fill: INK });
  c.rect(M, y - boxH + 12, RIGHT - M, boxH, { fill: WHITE, border: INK, borderWidth: 2 });
  c.text("NET PAY", M + 12, y - 12, { font: "monoStrong", size: 9 });
  c.text(money(view.netCents), RIGHT - 12, y - 14, { font: "monoStrong", size: 15, align: "right" });
  if (view.revision) {
    c.text(
      `Already paid ${money(view.revision.previouslyPaidCents)}; ${view.netPayableCents >= 0 ? "to pay now" : "overpaid"} ${money(Math.abs(view.netPayableCents))}`,
      M + 12,
      y - 30,
      { size: 8, color: MUTED },
    );
  }
  y -= boxH + 18;

  // Employer contributions and CPF context (not deducted from pay).
  c.text("EMPLOYER CONTRIBUTIONS (NOT DEDUCTED)", M, y, { font: "mono", size: 6.5, color: MUTED });
  y -= 13;
  c.text("Employer CPF", M, y, { size: 8.5 });
  c.text(money(view.employerCpfCents), 250, y, { font: "mono", size: 8.5, align: "right" });
  c.text(`AW subject to CPF in ${view.ytd.year} to date`, 300, y, { size: 8.5 });
  c.text(money(view.ytd.awSubjectCents), RIGHT, y, { font: "mono", size: 8.5, align: "right" });
  y -= 13;
  if (view.shgFunds.length) {
    c.text(`Self-help group: ${view.shgFunds.join(", ")}`, M, y, { size: 8.5 });
    y -= 13;
  }

  // Footer.
  footer(c, view);
  return finishPdf(c);
}

function footer(c: PdfCanvas, view: PayslipView) {
  c.line(M, 64, RIGHT, 64, 0.4, HAIRLINE);
  c.text(
    `Itemised payslip with the items MOM requires (mom.gov.sg/employment-practices/salary/itemised-payslips). Keep it for your records.`,
    M,
    52,
    {
      size: 6.5,
      color: MUTED,
      maxWidth: RIGHT - M,
    },
  );
  c.text(`Payslip ${view.id} · Generated by Crow HR`, M, 42, { font: "mono", size: 6, color: MUTED });
}
