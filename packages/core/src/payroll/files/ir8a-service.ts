import { and, eq, gte, inArray, isNull, lte } from "drizzle-orm";
import { recordAudit } from "../../audit/audit.ts";
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
import type { GeneratedFile } from "./service.ts";

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
  commencedOn: string | null;
  ceasedOn: string | null;
  notes: Ir8aNote[];
}

export interface Ir8aPreview {
  year: number;
  yearOfAssessment: number;
  /** IRAS deadline: 1 March of the year of assessment. */
  dueOn: string;
  templateUrl: string;
  explanatoryNotesUrl: string;
  parts: { part: number; records: number }[];
  records: Ir8aPreviewRecord[];
  excluded: { employeeName: string; reason: string }[];
  /** Year-level notes (unfinished runs, AIS threshold, Appendix 8A). */
  notes: Ir8aNote[];
}

interface Built {
  preview: Ir8aPreview;
  records: Ir8aRecord[];
}

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
  const ids = [...new Set([...bySlip.keys(), ...openings.map((o) => o.employeeId)])];
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
  const built: { record: Ir8aRecord; employeeId: string; idMasked: string; notes: Ir8aNote[] }[] = [];
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
    const nothing =
      amounts.grossSalaryCents <= 0 &&
      amounts.bonusCents === 0 &&
      amounts.allowancesCents === 0 &&
      amounts.commissionCents === 0 &&
      amounts.employeeCpfCents === 0;
    if (nothing) continue;
    if (p.idType !== "nric" && p.idType !== "fin") {
      excluded.push({
        employeeName: p.legalName,
        reason:
          "ID type is not NRIC or FIN: add this employee in myTax by hand with the right ID type (work permit, Malaysian IC or passport).",
      });
      continue;
    }
    if (p.gender !== "male" && p.gender !== "female") {
      excluded.push({
        employeeName: p.legalName,
        reason:
          "IRAS requires sex (male or female) and none is recorded: add it in People, or enter the record in myTax.",
      });
      continue;
    }
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
  const parts = buildIr8aCsv(records).map((p) => ({ part: p.part, records: p.records }));
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
  yearNotes.push({
    code: "IR8A_APPENDIX_8A",
    message:
      "Appendix 8A (benefits-in-kind such as housing or a car) is not produced: Crow HR does not record benefits-in-kind. Fill the template's Appendix 8A sheets for employees who received any.",
  });
  return {
    records,
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
        commencedOn: b.record.commencedOn,
        ceasedOn: b.record.ceasedOn,
        notes: b.notes,
      })),
    },
  };
}

function assertYear(year: number) {
  if (!Number.isInteger(year) || year < 2000 || year > 2100)
    throw new AppError("validation_failed", "Choose a valid year.");
}

/** IR8A figures for an income year (whole dollars, masked IDs), with the parts to download. */
export async function ir8aPreview(deps: AppDeps, actor: PayrollActor, year: number): Promise<Ir8aPreview> {
  assertYear(year);
  return (await build(deps, actor.orgId, year)).preview;
}

/** One part (≤ 200 records) of the IR8A rows as CSV, to paste into IRAS's IR8A import template at row 6. */
export async function ir8aFile(deps: AppDeps, actor: PayrollActor, year: number, part: number): Promise<GeneratedFile> {
  assertYear(year);
  const { records, preview } = await build(deps, actor.orgId, year);
  if (records.length === 0) throw new AppError("conflict", `No approved payslips in ${year}.`);
  const parts = buildIr8aCsv(records);
  const chosen = parts.find((p) => p.part === part);
  if (!chosen)
    throw new AppError("not_found", `There ${parts.length === 1 ? "is 1 part" : `are ${parts.length} parts`}.`);
  await recordAudit(deps.db, deps, actor.audit, {
    action: "payroll.ir8a_file_generated",
    targetType: "payroll_year",
    targetId: String(year),
    meta: { part, records: chosen.records, parts: parts.length, excluded: preview.excluded.length },
  });
  return {
    fileName: `ir8a-${year}-part${part}-of-${parts.length}.csv`,
    contentType: "text/csv; charset=utf-8",
    body: chosen.csv,
    excluded: part === 1 ? preview.excluded : [],
  };
}
