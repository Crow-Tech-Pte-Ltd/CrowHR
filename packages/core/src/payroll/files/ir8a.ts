import { formatCsvCell } from "../../export/csv.ts";
import type { PayInput, PayResult } from "../engine/types.ts";

/**
 * IR8A records in the column layout of IRAS's **IR8A Import Template** (sheet "IR8A", version 1.0,
 * https://go.gov.sg/ir8a-import-template), for the employer to paste into that workbook and import in
 * myTax Portal → Employment Income Records. Crow HR does not redistribute or fill IRAS's workbook
 * (its licence is unconfirmed: research/sg-regulatory.md §8.4); it produces the rows.
 *
 * Template rules (its "Instructions (Read Me)" sheet): at most 200 records per import; amounts are
 * whole dollars, income with the cents dropped and deductions rounded up after summing; dates
 * YYYY-MM-DD; mandatory fields record no., ID type, ID no., full name, sex and date of birth.
 *
 * Direct submission through IRAS's AIS-API 2.0 is NOT available: it needs IRAS's approval of the
 * software, Corppass and APEX credentials and whitelisted servers (research/sg-regulatory.md §8.2).
 */

export const IR8A_TEMPLATE_URL = "https://go.gov.sg/ir8a-import-template";
export const IR8A_EXPLANATORY_NOTES =
  "https://www.iras.gov.sg/docs/default-source/individual-income-tax/employers/explanatory-notes-on-form-ir8a-and-appendix-8a-for-ya2027.pdf";
export const IR8A_REPORTING_GUIDE =
  "https://www.iras.gov.sg/taxes/individual-income-tax/employers/auto-inclusion-scheme-(ais)-for-employment-income/reporting-employee-earnings-(ir8a-appendix-8a-appendix-8b)";
export const IR8A_MAX_RECORDS = 200;

/** Row 5 of the template's IR8A sheet, columns A–AR, verbatim (including IRAS's stray spaces). */
export const IR8A_HEADERS = [
  /* A */ "*Record No.",
  /* B */ "*ID Type [Choose option]",
  /* C */ "*ID No.",
  /* D */ "*Full Name of Employee as per NRIC/FIN",
  /* E */ "*Sex [Choose option]",
  /* F */ "*Date of Birth (YYYY-MM-DD)",
  /* G */ "Designation",
  /* H */ "Residential Address [Choose option]",
  /* I */ "Address Details",
  /* J */ "Postal Code",
  /* K */ "Country/ Region [Choose option]",
  /* L */ "Date of Commencement (YYYY-MM-DD)",
  /* M */ "Date of Cessation/posted overseas (YYYY-MM-DD)",
  /* N */ "Bank salary is credited to [Choose option]",
  /* O */ "a) Gross Salary",
  /* P */ "b) Bonus",
  /* Q */ "Date of bonus paid (YYYY-MM-DD)",
  /* R */ "c) Director's fee",
  /* S */ "Date of director's fee approved (YYYY-MM-DD)",
  /* T */ "Total of items d1 to d8 (excluding 3b & 7b) <Amount is automatically computed after record import to digital service>",
  /* U */ "d1) Allowances",
  /* V */ "d2) Gross Commission",
  /* W */ "d4.1(i) Gratuity/ Notice Pay/ Ex-gratia payment/ Others indicator <Indicator is automatically prefilled when applicable after record import to digital service>",
  /* X */ "d3(a) Gratuity/ Notice Pay/ Ex-gratia payment/ Others",
  /* Y */ " Compensation for loss of office indicator <Indicator is automatically prefilled when applicable after record import to digital service>",
  /* Z */ "d3(b) Compensation for loss of office",
  /* AA */ "d4(a) Retirement benefits including gratuities/ pension/ commutation of pension/ lump sum payments, etc from pension/ provident fund <Name of fund>",
  /* AB */ "d4(b) Amount accrued from 01/01/1993",
  /* AC */ "d5) Contributions made by employer to any Pension/Provident Fund constituted outside Singapore without tax concession",
  /* AD */ "d6) Excess / voluntary contribution to CPF by employer ",
  /* AE */ "d7(a) Gains & profits via share options for Sec.10(1)(b) [This item is computed automatically after record import into digital service]",
  /* AF */ "d7(b) Gains & profits via share options for Sec.10(1)(g) [This item is computed automatically after record import into digital service]",
  /* AG */ "d8) Value of benefits-in-kind <This item is computed automatically after record import into digital service>",
  /* AH */ "d9(ii) Appendix 8A indicator <This item to be entered after record import into digital service>",
  /* AI */ "e(i) Remission/ Overseas Posting/ Exempt Indicator [choose option]",
  /* AJ */ "e(ii) Amount of income for the Remission/ Overseas Posting/ Exempt Indicator selected",
  /* AK */ "f) Employee's income tax borne by employer? [Choose option]",
  /* AL */ "f(i) Amount of income for which tax is borne by employer",
  /* AM */ "f(ii) Fixed amount of tax for which tax is borne by employee",
  /* AN */ "g) Section 45 (applicable to non-resident director) [Choose option]",
  /* AO */ "Employee's compulsory CPF contribution",
  /* AP */ "DONATIONS deducted from salaries for Yayasan Mendaki Fund/Community Chest of Singapore/SINDA/CDAC/ECF/Other tax exempt donations",
  /* AQ */ "CONTRIBUTIONS deducted from salaries to Mosque Building Fund",
  /* AR */ "LIFE INSURANCE PREMIUMS deducted from salaries  ",
] as const;

/** Values of the template's dropdown lists (sheet "DropDownList"). */
export type Ir8aIdType = "NRIC" | "FIN";
export type Ir8aSex = "Male" | "Female";

/** Crow HR's bank list (SWIFT BIC) → the template's "Bank" dropdown values. */
export const IR8A_BANK_BY_BIC: Readonly<Record<string, string>> = {
  DBSSSGSG: "DBS/POSB",
  POSBSGSG: "DBS/POSB",
  OCBCSGSG: "OCBC",
  UOVBSGSG: "UOB",
  SCBLSGSG: "STANDARD CHARTERED BANK (SG)",
  HSBCSGS2: "HSBC BANK (SINGAPORE) LIMITED",
  CITISGSL: "CITIBANK SINGAPORE LTD",
  MBBESGS2: "MAYBANK SINGAPORE LIMITED",
  BKCHSGSG: "BANK OF CHINA",
  ICBKSGSG: "INDUSTRIAL AND COMMERCIAL BANK",
  RHBBSGSG: "RHB BANK BERHAD",
  CIBBSGSG: "CIMB BANK BERHAD",
  HLBBSGSG: "HL BANK",
  SIVBSGSG: "SING INVESTMENTS & FINANCE LTD",
  TRWISGSG: "TRUST BANK SINGAPORE LIMITED",
  GXSPSGSG: "GXS BANK PTE. LTD",
};
/** IRAS: choose "Others" for employees paid by cash or cheque. */
export const IR8A_BANK_OTHERS = "OTHERS";

/** One employee's year, in cents (rounded to whole dollars only when written). */
export interface Ir8aAmounts {
  /** a) Gross salary, fees, leave pay, wages and overtime pay. */
  grossSalaryCents: number;
  /** b) Bonus (contractual and non-contractual). */
  bonusCents: number;
  bonusPaidOn: string | null;
  /** d1) Allowances. */
  allowancesCents: number;
  /** d2) Gross commission. */
  commissionCents: number;
  /** Employee's compulsory CPF (including AW top-up shares recovered from pay). */
  employeeCpfCents: number;
  /** SHG donations: CDAC, ECF, SINDA (and Mendaki, which is not collected separately by CPF here). */
  donationsCents: number;
  /** MBMF (Mosque Building Fund). */
  mbmfCents: number;
}

export interface Ir8aRecord extends Ir8aAmounts {
  idType: Ir8aIdType;
  idNumber: string;
  name: string;
  sex: Ir8aSex;
  dateOfBirth: string;
  designation: string | null;
  /** Only when the employee joined during the year (IRAS reporting guide). */
  commencedOn: string | null;
  /** Only when the employment ended during the year. */
  ceasedOn: string | null;
  bank: string;
}

export interface Ir8aNote {
  code: string;
  message: string;
}

/** Income: drop the cents. */
export const incomeDollars = (cents: number): number => Math.floor(Math.max(0, cents) / 100);
/** Deductions: round up to the dollar after summing. */
export const deductionDollars = (cents: number): number => Math.ceil(Math.max(0, cents) / 100);

export interface Ir8aSlip {
  payDate: string;
  input: Pick<PayInput, "items"> & Partial<Pick<PayInput, "reimbursements">>;
  result: Pick<PayResult, "lines">;
}

export interface Ir8aOpening {
  throughMonth: number;
  owCents: number;
  awCents: number;
  cpfEeCents: number;
  shgCents: number;
}

/**
 * Sums a year of effective payslips (approved or paid, not replaced by an adjustment) into the IR8A
 * items. Basic pay after no-pay leave, overtime, back pay and other earnings go to (a); bonuses to
 * (b); commissions to (d2); allowances to (d1); taxable cash reimbursements go to (d1); exempt business reimbursements are left out.
 */
export function aggregateIr8a(
  slips: readonly Ir8aSlip[],
  opening: Ir8aOpening | null,
  shgFundsSeen: ReadonlySet<string>,
): { amounts: Ir8aAmounts; notes: Ir8aNote[] } {
  const a: Ir8aAmounts = {
    grossSalaryCents: 0,
    bonusCents: 0,
    bonusPaidOn: null,
    allowancesCents: 0,
    commissionCents: 0,
    employeeCpfCents: 0,
    donationsCents: 0,
    mbmfCents: 0,
  };
  const notes: Ir8aNote[] = [];
  const note = (code: string, message: string) => {
    if (!notes.some((n) => n.code === code)) notes.push({ code, message });
  };
  for (const s of slips) {
    // IRAS requires taxable flexible benefits to be declared; genuine business expenses remain
    // exempt. Cash reimbursement is d1; non-cash benefits are Appendix 8A entries (ir8a-appendix.ts).
    // https://www.iras.gov.sg/taxes/individual-income-tax/employers/understanding-the-tax-treatment/tax-principles-and-flexible-benefits
    a.allowancesCents += (s.input.reimbursements ?? []).filter((r) => r.taxable).reduce((n, r) => n + r.amountCents, 0);
    const kinds = new Map(s.input.items.map((i) => [i.id, i.kind]));
    for (const l of s.result.lines) {
      switch (l.category) {
        case "basic":
        case "overtime":
          a.grossSalaryCents += l.amountCents;
          break;
        case "npl":
          a.grossSalaryCents -= l.amountCents;
          break;
        case "allowance":
          a.allowancesCents += l.amountCents;
          break;
        case "additional": {
          const kind = l.itemId ? kinds.get(l.itemId) : undefined;
          if (kind === "bonus") {
            a.bonusCents += l.amountCents;
            if (!a.bonusPaidOn || s.payDate > a.bonusPaidOn) a.bonusPaidOn = s.payDate;
          } else if (kind === "commission") {
            a.commissionCents += l.amountCents;
          } else {
            a.grossSalaryCents += l.amountCents;
            if (kind === "backpay")
              note(
                "IR8A_BACKPAY",
                "Back pay is reported in (a) for the year it was paid. If it is salary for an earlier year, amend that year's record instead.",
              );
            else
              note(
                "IR8A_OTHER_EARNINGS",
                `"Other earnings" are reported in (a) Gross Salary. Move notice pay, gratuity or ex-gratia payments to d3(a) in myTax.`,
              );
          }
          break;
        }
        case "cpf_employee":
          a.employeeCpfCents += l.amountCents;
          break;
        case "deduction":
          if (l.code === "CPF_AW_RECOVERY") a.employeeCpfCents += l.amountCents;
          break;
        case "shg":
          if (l.code === "SHG_MBMF") a.mbmfCents += l.amountCents;
          else a.donationsCents += l.amountCents;
          break;
        default:
          // claim (reimbursement), employer CPF, SDL and FWL are not employee income or deductions.
          break;
      }
    }
  }
  if (opening) {
    a.grossSalaryCents += opening.owCents;
    a.bonusCents += opening.awCents;
    a.employeeCpfCents += opening.cpfEeCents;
    if (shgFundsSeen.size === 1 && shgFundsSeen.has("MBMF")) a.mbmfCents += opening.shgCents;
    else a.donationsCents += opening.shgCents;
    note(
      "IR8A_OPENING_BALANCE",
      `Includes the year-to-date opening balance from the previous payroll system (January to month ${opening.throughMonth}): its ordinary wages are in (a) and additional wages in (b). Split out allowances, commission and bonus dates in myTax if they differ.`,
    );
  }
  return { amounts: a, notes };
}

const dollarsOrBlank = (n: number) => (n === 0 ? "" : String(n));

/** One template row (columns A–AR). */
export function ir8aRow(r: Ir8aRecord, recordNo: number): string[] {
  const row: string[] = new Array(IR8A_HEADERS.length).fill("");
  const set = (col: string, v: string | null) => {
    row[columnIndex(col)] = v ?? "";
  };
  set("A", String(recordNo));
  set("B", r.idType);
  set("C", r.idNumber);
  set("D", r.name);
  set("E", r.sex);
  set("F", r.dateOfBirth);
  set("G", r.designation);
  set("L", r.commencedOn);
  set("M", r.ceasedOn);
  set("N", r.bank);
  set("O", String(incomeDollars(r.grossSalaryCents)));
  set("P", dollarsOrBlank(incomeDollars(r.bonusCents)));
  set("Q", r.bonusCents > 0 ? r.bonusPaidOn : null);
  set("U", dollarsOrBlank(incomeDollars(r.allowancesCents)));
  set("V", dollarsOrBlank(incomeDollars(r.commissionCents)));
  set("AO", dollarsOrBlank(deductionDollars(r.employeeCpfCents)));
  set("AP", dollarsOrBlank(deductionDollars(r.donationsCents)));
  set("AQ", dollarsOrBlank(deductionDollars(r.mbmfCents)));
  return row;
}

/** Spreadsheet column letters → zero-based index ("A" → 0, "AR" → 43). */
export function columnIndex(col: string): number {
  let n = 0;
  for (const ch of col) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/** One cell of a template row (IR8A and appendix sheets). */
export function ir8aCsvCell(v: string): string {
  // The shared writer (formula neutralising, quoting); IRAS's template also keeps edge spaces quoted.
  const out = formatCsvCell(v, "text");
  return out.startsWith('"') || !/^\s|\s$/.test(out) ? out : `"${out}"`;
}

export interface Ir8aPart {
  part: number;
  records: number;
  csv: string;
}

/**
 * CSV parts of at most 200 records: the template's header row, then one row per employee, record
 * numbers restarting at 1 in each part. UTF-8 with BOM and CRLF line ends (opens cleanly in Excel).
 */
export function buildIr8aCsv(records: readonly Ir8aRecord[]): Ir8aPart[] {
  const parts: Ir8aPart[] = [];
  for (let i = 0; i < Math.max(1, records.length); i += IR8A_MAX_RECORDS) {
    const chunk = records.slice(i, i + IR8A_MAX_RECORDS);
    const lines = [IR8A_HEADERS.map(ir8aCsvCell).join(",")];
    chunk.forEach((r, k) => {
      lines.push(
        ir8aRow(r, k + 1)
          .map(ir8aCsvCell)
          .join(","),
      );
    });
    parts.push({ part: parts.length + 1, records: chunk.length, csv: `﻿${lines.join("\r\n")}\r\n` });
  }
  return parts;
}
