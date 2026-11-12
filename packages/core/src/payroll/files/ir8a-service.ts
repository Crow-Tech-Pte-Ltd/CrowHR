import { and, eq, gte, inArray, isNull, lte } from "drizzle-orm";
import { recordAudit } from "../../audit/audit.ts";
import { taxableCashClaims } from "../../claims/taxable.ts";
import { bankAccounts, employees, ytdOpeningBalances } from "../../db/schema/employees.ts";
import { payrollPayslips, payrollRuns } from "../../db/schema/payroll.ts";
import type { AppDeps } from "../../deps.ts";
import { asAtMany } from "../../employees/effective.ts";
import { AppError } from "../../errors.ts";
import { monthLabel } from "../engine/dates.ts";
import type { PayInput, PayResult } from "../engine/types.ts";
import type { PayrollActor } from "../service.ts";
import {
  aggregateIr8a,
  buildIr8aCsv,
  deductionDollars,
  IR8A_BANK_BY_BIC,
  IR8A_BANK_OTHERS,
  IR8A_EXPLANATORY_NOTES,
  IR8A_MAX_RECORDS,
  IR8A_TEMPLATE_URL,
  type Ir8aNote,
  type Ir8aRecord,
  incomeDollars,
} from "./ir8a.ts";
import {
  APPENDIX_8A_ACCOMMODATION_HEADERS,
  APPENDIX_8A_HOTEL_OTHERS_HEADERS,
  APPENDIX_8B_HEADERS,
  APPENDIX_SHEET_NAMES,
  type AppendixPerson,
  type AppendixSheet,
  accommodationRows,
  appendixCsv,
  type EmployeeAppendices,
  hasAppendix8a,
  hasAppendix8b,
  hotelOthersRow,
  shareGainRows,
} from "./ir8a-appendix.ts";
import { appendicesForYear, assertYear } from "./ir8a-appendix-service.ts";
import type { GeneratedFile } from "./service.ts";

/** Sheets of IRAS's import template the download offers; `ir8a` is the default. */
export const IR8A_SHEETS = ["ir8a", "appendix-8a-accommodation", "appendix-8a-hotel-others", "appendix-8b"] as const;
export type Ir8aSheet = (typeof IR8A_SHEETS)[number];

/** Preview row: whole dollars as they will be written, ID masked. */
export interface Ir8aPreviewRecord {
  employeeId: string;
  employeeName: string;
  idMasked: string;
  part: number;
  recordNo: number;
  grossSalary: number;
  bonus: number;
  allowances: number;
  commission: number;
  employeeCpf: number;
  donations: number;
  mbmf: number;
  /** d7(a): Appendix 8B gains under S10(1)(b), whole dollars (decimals dropped). */
  shareGainsS101b: number;
  /** d7(b): Appendix 8B gains under S10(1)(g), whole dollars. */
  shareGainsS101g: number;
  /** d8: Appendix 8A total, whole dollars. */
  benefitsInKind: number;
  commencedOn: string | null;
  ceasedOn: string | null;
  notes: Ir8aNote[];
}

export interface Ir8aPreviewPart {
  part: number;
  records: number;
  /** Rows of each appendix sheet for this part's employees. */
  appendix8aAccommodation: number;
  appendix8aHotelOthers: number;
  appendix8b: number;
}

export interface Ir8aPreview {
  year: number;
  yearOfAssessment: number;
  /** IRAS deadline: 1 March of the year of assessment. */
  dueOn: string;
  templateUrl: string;
  explanatoryNotesUrl: string;
  parts: Ir8aPreviewPart[];
  records: Ir8aPreviewRecord[];
  excluded: { employeeName: string; reason: string }[];
  /** Year-level notes (unfinished runs, AIS threshold, appendices). */
  notes: Ir8aNote[];
}

interface Built {
  preview: Ir8aPreview;
  records: Ir8aRecord[];
  /** Parallel to `records`: the employee's appendices, if any. */
  appendices: (EmployeeAppendices | null)[];
}

/** Owned-premises notes per employee (the template can take at most 10 residences anyway). */
const RESIDENCE_NOTE_LIMIT = 10;

async function build(deps: AppDeps, orgId: string, year: number): Promise<Built> {
  const db = deps.db;
  const from = `${year}-01`;
  const to = `${year}-12`;
  const slipRows = await db
    .select({
      employeeId: payrollPayslips.employeeId,
      input: payrollPayslips.input,
      result: payrollPayslips.result,
      month: payrollRuns.month,
      payDate: payrollRuns.payDate,
    })
    .from(payrollPayslips)
    .innerJoin(
      payrollRuns,
      and(eq(payrollRuns.orgId, payrollPayslips.orgId), eq(payrollRuns.id, payrollPayslips.runId)),
    )
    .where(
      and(
        eq(payrollPayslips.orgId, orgId),
        inArray(payrollRuns.status, ["approved", "paid"]),
        isNull(payrollRuns.supersededByRunId),
        gte(payrollRuns.month, from),
        lte(payrollRuns.month, to),
      ),
    );
  const unfinished = await db
    .select({ month: payrollRuns.month, status: payrollRuns.status })
    .from(payrollRuns)
    .where(
      and(
        eq(payrollRuns.orgId, orgId),
        inArray(payrollRuns.status, ["draft", "in_review"]),
        gte(payrollRuns.month, from),
        lte(payrollRuns.month, to),
      ),
    );
  const openings = await db
    .select()
    .from(ytdOpeningBalances)
    .where(and(eq(ytdOpeningBalances.orgId, orgId), eq(ytdOpeningBalances.year, year)));

  const bySlip = new Map<string, { month: string; payDate: string; input: PayInput; result: PayResult }[]>();
  for (const r of slipRows) {
    const list = bySlip.get(r.employeeId) ?? [];
    list.push({ month: r.month, payDate: r.payDate, input: r.input as PayInput, result: r.result as PayResult });
    bySlip.set(r.employeeId, list);
  }
  const legacyClaimIds = [
    ...new Set(
      slipRows.flatMap((s) => s.input.reimbursements.filter((r) => r.taxable === undefined).map((r) => r.claimId)),
    ),
  ];
  const cashClaims = await taxableCashClaims(db, orgId, year, legacyClaimIds);
  const appendixYear = await appendicesForYear(deps, orgId, year);
  const ids = [
    ...new Set([
      ...bySlip.keys(),
      ...openings.map((o) => o.employeeId),
      ...cashClaims.map((c) => c.employeeId),
      ...appendixYear.byEmployee.keys(),
      ...appendixYear.failed.map((f) => f.employeeId),
    ]),
  ];
  const people = ids.length
    ? await db
        .select({
          id: employees.id,
          legalName: employees.legalName,
          idType: employees.idType,
          idNumberEnc: employees.idNumberEnc,
          idMasked: employees.idNumberMasked,
          dob: employees.dob,
          gender: employees.gender,
        })
        .from(employees)
        .where(and(eq(employees.orgId, orgId), inArray(employees.id, ids)))
    : [];
  const lastPayDate =
    slipRows
      .map((r) => r.payDate)
      .sort()
      .at(-1) ?? `${year}-01-01`;
  const banks = await asAtMany(db, bankAccounts, orgId, ids, lastPayDate);

  const yearStart = `${year}-01-01`;
  const yearEnd = `${year}-12-31`;
  const excluded: Ir8aPreview["excluded"] = [];
  const built: {
    record: Ir8aRecord;
    employeeId: string;
    idMasked: string;
    notes: Ir8aNote[];
    appendices: EmployeeAppendices | null;
  }[] = [];
  for (const p of [...people].sort((a, b) => a.legalName.localeCompare(b.legalName) || a.id.localeCompare(b.id))) {
    const slips = (bySlip.get(p.id) ?? []).sort((a, b) =>
      a.month === b.month ? a.payDate.localeCompare(b.payDate) : a.month.localeCompare(b.month),
    );
    const opening = openings.find((o) => o.employeeId === p.id) ?? null;
    const funds = new Set(
      slips.flatMap((s) => s.result.lines.filter((l) => l.category === "shg").map((l) => l.code.slice(4))),
    );
    const { amounts, notes } = aggregateIr8a(
      slips.map((s) => ({ payDate: s.payDate, input: s.input, result: s.result })),
      opening
        ? {
            throughMonth: opening.throughMonth,
            owCents: opening.owCents,
            awCents: opening.awCents,
            cpfEeCents: opening.cpfEeCents,
            shgCents: opening.shgCents,
          }
        : null,
      funds,
    );
    const cash = cashClaims.filter((c) => c.employeeId === p.id).reduce((n, c) => n + Number(c.cents), 0);
    amounts.allowancesCents += cash;
    if (cash || slips.some((s) => s.input.reimbursements.some((r) => r.taxable)))
      notes.push({
        code: "IR8A_TAXABLE_REIMBURSEMENTS",
        message:
          "Includes taxable cash reimbursements in d1 allowances. Review claim-type tax classifications. Record non-cash benefits under Year end (Appendix 8A); tax borne by the employer has separate IRAS treatment.",
      });
    const appendices = appendixYear.byEmployee.get(p.id) ?? null;
    for (const f of appendixYear.failed.filter((x) => x.employeeId === p.id))
      notes.push({
        code: "IR8A_APPENDIX_RECORD_INVALID",
        message: `An Appendix 8A/8B record is left out because it no longer validates: ${f.message} Edit it under Year end.`,
      });
    const noPay =
      amounts.grossSalaryCents <= 0 &&
      amounts.bonusCents === 0 &&
      amounts.allowancesCents === 0 &&
      amounts.commissionCents === 0 &&
      amounts.employeeCpfCents === 0;
    if (noPay && !appendices) continue;
    const alsoAppendices = appendices ? " Their Appendix 8A/8B records are left out too." : "";
    if (p.idType !== "nric" && p.idType !== "fin") {
      excluded.push({
        employeeName: p.legalName,
        reason: `ID type is not NRIC or FIN: add this employee in myTax by hand with the right ID type (work permit, Malaysian IC or passport).${alsoAppendices}`,
      });
      continue;
    }
    if (p.gender !== "male" && p.gender !== "female") {
      excluded.push({
        employeeName: p.legalName,
        reason: `IRAS requires sex (male or female) and none is recorded: add it in People, or enter the record in myTax.${alsoAppendices}`,
      });
      continue;
    }
    if (appendices) notes.push(...appendixNotes(appendices, noPay, year));
    const first = slips[0];
    const last = slips[slips.length - 1];
    const hireDates = slips.map((s) => s.input.employment.hireDate).sort();
    const earliestHire = hireDates[0] ?? null;
    const commencedOn =
      earliestHire && ((earliestHire >= yearStart && earliestHire <= yearEnd) || earliestHire < "1969-01-01")
        ? earliestHire
        : null;
    const lastDay = last?.input.employment.lastWorkingDay ?? null;
    const ceasedOn = lastDay && lastDay >= yearStart && lastDay <= yearEnd ? lastDay : null;
    if (first && !opening && earliestHire) {
      const startMonth = earliestHire > yearStart ? earliestHire.slice(0, 7) : `${year}-01`;
      if (first.month > startMonth)
        notes.push({
          code: "IR8A_INCOME_BEFORE_CROWHR_MISSING",
          message: `No payslips or opening balance for ${monthLabel(startMonth)} to ${monthLabel(first.month)} (before this employee's first payroll in Crow HR): add that income in myTax.`,
        });
    }
    const residency = last?.input.employee.residency.status ?? null;
    if (ceasedOn && residency && residency !== "SC")
      notes.push({
        code: "IR8A_IR21_CHECK",
        message:
          "Left during the year and is not a Singapore Citizen: if the income was cleared through IR21 tax clearance, remove this record (IRAS excludes IR21-cleared income from IR8A).",
      });
    const designation = last?.input.employment.jobTitle?.trim() || null;
    if (designation && designation.length > 30)
      notes.push({
        code: "IR8A_DESIGNATION_SHORTENED",
        message: `Designation "${designation}" is longer than IRAS's 30 characters and was shortened.`,
      });
    const bank = banks.get(p.id);
    built.push({
      employeeId: p.id,
      idMasked: p.idMasked,
      notes,
      appendices,
      record: {
        idType: p.idType === "nric" ? "NRIC" : "FIN",
        idNumber: (await deps.secretBox.decrypt("nric", p.idNumberEnc)).toUpperCase(),
        name: p.legalName.trim(),
        sex: p.gender === "male" ? "Male" : "Female",
        dateOfBirth: p.dob,
        designation: designation ? designation.slice(0, 30).trim() : null,
        commencedOn,
        ceasedOn,
        bank: (bank && IR8A_BANK_BY_BIC[bank.bankCode]) ?? IR8A_BANK_OTHERS,
        ...amounts,
      },
    });
  }

  const records = built.map((b) => b.record);
  const parts = buildIr8aCsv(records).map((p) => {
    const chunk = built.slice((p.part - 1) * IR8A_MAX_RECORDS, p.part * IR8A_MAX_RECORDS);
    return {
      part: p.part,
      records: p.records,
      ...appendixRowCounts(chunk.map((b) => ({ person: personOf(b.record), appendices: b.appendices }))),
    };
  });
  const yearNotes: Ir8aNote[] = [];
  if (unfinished.length > 0)
    yearNotes.push({
      code: "IR8A_UNFINISHED_RUNS",
      message: `${unfinished.length} run${unfinished.length === 1 ? "" : "s"} of ${year} not approved yet (${[...new Set(unfinished.map((u) => monthLabel(u.month)))].join(", ")}): their pay is not included.`,
    });
  if (ids.length >= 5)
    yearNotes.push({
      code: "IR8A_AIS_REQUIRED",
      message: `${ids.length} employees were paid in ${year}: employers with 5 or more employees must submit through the Auto-Inclusion Scheme (AIS) by 1 Mar ${year + 1}.`,
    });
  const with8a = built.filter((b) => b.appendices && hasAppendix8a(b.appendices)).length;
  const with8b = built.filter((b) => b.appendices && hasAppendix8b(b.appendices)).length;
  const forWhom = [
    with8a ? `Appendix 8A for ${with8a} employee${with8a === 1 ? "" : "s"}` : null,
    with8b ? `Appendix 8B for ${with8b} employee${with8b === 1 ? "" : "s"}` : null,
  ]
    .filter(Boolean)
    .join(" and ");
  yearNotes.push({
    code: "IR8A_APPENDICES",
    message:
      with8a + with8b === 0
        ? `No benefits-in-kind (Appendix 8A) or share-plan gains (Appendix 8B) are recorded for ${year}. If any employee received housing, a car, home leave passages or share gains, record them under Year end before you export.`
        : `${forWhom}, from the benefits and share gains recorded under Year end. Download each part's appendix sheets with its IR8A rows; myTax computes d7 and d8 from them after import: check them against Crow HR's totals under Year end.`,
  });
  const failed = appendixYear.failed.length;
  if (failed)
    yearNotes.push({
      code: "IR8A_APPENDIX_RECORDS_INVALID",
      message:
        failed === 1
          ? "1 appendix record is left out because it no longer validates: edit it under Year end."
          : `${failed} appendix records are left out because they no longer validate: edit them under Year end.`,
    });
  return {
    records,
    appendices: built.map((b) => b.appendices),
    preview: {
      year,
      yearOfAssessment: year + 1,
      dueOn: `${year + 1}-03-01`,
      templateUrl: IR8A_TEMPLATE_URL,
      explanatoryNotesUrl: IR8A_EXPLANATORY_NOTES,
      parts,
      excluded,
      notes: yearNotes,
      records: built.map((b, i) => ({
        employeeId: b.employeeId,
        employeeName: b.record.name,
        idMasked: b.idMasked,
        part: Math.floor(i / IR8A_MAX_RECORDS) + 1,
        recordNo: (i % IR8A_MAX_RECORDS) + 1,
        grossSalary: incomeDollars(b.record.grossSalaryCents),
        bonus: incomeDollars(b.record.bonusCents),
        allowances: incomeDollars(b.record.allowancesCents),
        commission: incomeDollars(b.record.commissionCents),
        employeeCpf: deductionDollars(b.record.employeeCpfCents),
        donations: deductionDollars(b.record.donationsCents),
        mbmf: deductionDollars(b.record.mbmfCents),
        shareGainsS101b: b.appendices?.total8b.ir8aD7aDollars ?? 0,
        shareGainsS101g: b.appendices?.total8b.ir8aD7bDollars ?? 0,
        benefitsInKind: b.appendices?.total8a.ir8aD8Dollars ?? 0,
        commencedOn: b.record.commencedOn,
        ceasedOn: b.record.ceasedOn,
        notes: b.notes,
      })),
    },
  };
}

/** IR8A figures for an income year (whole dollars, masked IDs), with the parts to download. */
export async function ir8aPreview(deps: AppDeps, actor: PayrollActor, year: number): Promise<Ir8aPreview> {
  assertYear(year);
  return (await build(deps, actor.orgId, year)).preview;
}

/**
 * One part (≤ 200 records) as CSV: the IR8A rows (paste at row 6 of the template's IR8A sheet), or one
 * appendix sheet's rows for the same part's employees (paste at row 2 of that sheet).
 */
export async function ir8aFile(
  deps: AppDeps,
  actor: PayrollActor,
  year: number,
  part: number,
  sheet: Ir8aSheet = "ir8a",
): Promise<GeneratedFile> {
  assertYear(year);
  const { records, appendices, preview } = await build(deps, actor.orgId, year);
  if (records.length === 0) throw new AppError("conflict", `No approved payslips or appendix records in ${year}.`);
  const parts = buildIr8aCsv(records);
  const chosen = parts.find((p) => p.part === part);
  if (!chosen)
    throw new AppError("not_found", `There ${parts.length === 1 ? "is 1 part" : `are ${parts.length} parts`}.`);
  let body = chosen.csv;
  let rows = chosen.records;
  if (sheet !== "ir8a") {
    const from = (part - 1) * IR8A_MAX_RECORDS;
    const chunk = records
      .slice(from, from + IR8A_MAX_RECORDS)
      .map((r, i) => ({ person: personOf(r), appendices: appendices[from + i] ?? null }));
    const sheetRows = appendixRows(sheet, chunk);
    if (sheetRows.length === 0)
      throw new AppError(
        "conflict",
        `No ${APPENDIX_SHEET_NAMES[sheet]} records in part ${part} of ${year}: there is nothing to download for that sheet.`,
      );
    body = appendixCsv(APPENDIX_HEADERS[sheet], sheetRows);
    rows = sheetRows.length;
  }
  await recordAudit(deps.db, deps, actor.audit, {
    action: "payroll.ir8a_file_generated",
    targetType: "payroll_year",
    targetId: String(year),
    meta: { part, sheet, records: chosen.records, rows, parts: parts.length, excluded: preview.excluded.length },
  });
  return {
    fileName: `ir8a-${year}-part${part}-of-${parts.length}${sheet === "ir8a" ? "" : `-${sheet}`}.csv`,
    contentType: "text/csv; charset=utf-8",
    body,
    excluded: part === 1 && sheet === "ir8a" ? preview.excluded : [],
  };
}

const APPENDIX_HEADERS: Record<AppendixSheet, readonly string[]> = {
  "appendix-8a-accommodation": APPENDIX_8A_ACCOMMODATION_HEADERS,
  "appendix-8a-hotel-others": APPENDIX_8A_HOTEL_OTHERS_HEADERS,
  "appendix-8b": APPENDIX_8B_HEADERS,
};

const personOf = (r: Ir8aRecord): AppendixPerson => ({ idType: r.idType, idNumber: r.idNumber });

type PartPerson = { person: AppendixPerson; appendices: EmployeeAppendices | null };

function appendixRows(sheet: AppendixSheet, chunk: readonly PartPerson[]): string[][] {
  return chunk.flatMap(({ person, appendices: a }) => {
    if (!a) return [];
    if (sheet === "appendix-8a-accommodation") return accommodationRows(person, a);
    if (sheet === "appendix-8b") return shareGainRows(person, a);
    const row = hotelOthersRow(person, a);
    return row ? [row] : [];
  });
}

function appendixRowCounts(chunk: readonly PartPerson[]) {
  return {
    appendix8aAccommodation: appendixRows("appendix-8a-accommodation", chunk).length,
    appendix8aHotelOthers: appendixRows("appendix-8a-hotel-others", chunk).length,
    appendix8b: appendixRows("appendix-8b", chunk).length,
  };
}

/** "S$4,931.50" for notes. */
const sgd = (cents: number) =>
  `S$${Math.floor(cents / 100).toLocaleString("en-SG")}.${String(cents % 100).padStart(2, "0")}`;

/** Per-employee notes about the appendices: what the template can't import, appendix-only records. */
function appendixNotes(a: EmployeeAppendices, appendixOnly: boolean, year: number): Ir8aNote[] {
  const notes: Ir8aNote[] = [];
  if (appendixOnly)
    notes.push({
      code: "IR8A_APPENDIX_ONLY",
      message: `No pay from Crow HR in ${year}: the IR8A record carries only the Appendix 8A/8B income. Check the commencement and cessation dates in myTax.`,
    });
  a.residences.slice(0, RESIDENCE_NOTE_LIMIT).forEach((r, i) => {
    const res = r.computed.residence;
    if (r.details.kind !== "residence" || r.details.basis !== "owned" || !res) return;
    notes.push({
      code: "IR8A_APPENDIX_8A_ANNUAL_VALUE",
      message: `Accommodation ${i + 1} is valued at its annual value, which IRAS's import template can't take yet: after import, enter 2a ${sgd(res.annualValueForPeriodCents ?? 0)} and 2b ${sgd(res.furnitureFittingsCents ?? 0)} (${r.details.furnishing === "partial" ? "partly" : "fully"} furnished) for it in myTax.`,
    });
  });
  for (const i of a.total8a.issues) notes.push({ code: i.code, message: i.message });
  return notes;
}
