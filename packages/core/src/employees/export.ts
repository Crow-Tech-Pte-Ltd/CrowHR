import { bankAccounts, compensationRecords, employees, workPasses } from "../db/schema/employees.ts";
import type { AppDeps } from "../deps.ts";
import { AppError } from "../errors.ts";
import { type Actor, listScope, type Section } from "./access.ts";
import { recordAudit } from "./audit-helpers.ts";
import { bankName } from "./banks.ts";
import { singaporeToday } from "./dates.ts";
import { findAsAt } from "./effective.ts";
import { toCsv } from "./import/parse.ts";
import type { PeoplePorts } from "./ports.ts";
import { type DirectoryFilters, listDirectory } from "./records.ts";
import { overallPassState } from "./work-pass.ts";
import { writeXlsx } from "./xlsx.ts";

/**
 * Employee list export (spec: Employee export). Columns the reader cannot
 * read for every exported row are not offered; unmasked NRIC/FIN and bank
 * numbers need the sensitive-export route, which requires recent
 * re-authentication. Every export is audited with its columns and row count.
 */

export interface ExportColumn {
  key: string;
  label: string;
  section: Section;
  /** Requires the re-authenticated sensitive export. */
  unmasked?: boolean;
}

export const EXPORT_COLUMNS: ExportColumn[] = [
  { key: "employee_number", label: "Employee number", section: "directory" },
  { key: "name", label: "Name", section: "directory" },
  { key: "legal_name", label: "Legal name", section: "directory" },
  { key: "job_title", label: "Job title", section: "directory" },
  { key: "department", label: "Department", section: "directory" },
  { key: "team", label: "Team", section: "directory" },
  { key: "location", label: "Location", section: "directory" },
  { key: "manager", label: "Manager", section: "directory" },
  { key: "work_email", label: "Work email", section: "directory" },
  { key: "status", label: "Status", section: "employment" },
  { key: "hire_date", label: "Start date", section: "employment" },
  { key: "id_number_masked", label: "NRIC/FIN (masked)", section: "personal" },
  { key: "id_number", label: "NRIC/FIN", section: "personal", unmasked: true },
  { key: "date_of_birth", label: "Date of birth", section: "personal" },
  { key: "residency_status", label: "Residency", section: "personal" },
  { key: "pr_start_date", label: "PR start date", section: "personal" },
  { key: "nationality", label: "Nationality", section: "personal" },
  { key: "race", label: "Race", section: "personal" },
  { key: "religion", label: "Religion", section: "personal" },
  { key: "mobile", label: "Mobile", section: "personal" },
  { key: "personal_email", label: "Personal email", section: "personal" },
  { key: "work_pass_type", label: "Work pass", section: "work_pass" },
  { key: "work_pass_expires_on", label: "Work pass expiry", section: "work_pass" },
  { key: "pay_basis", label: "Pay basis", section: "compensation" },
  { key: "basic_pay", label: "Basic pay (S$)", section: "compensation" },
  { key: "bank", label: "Bank", section: "bank" },
  { key: "bank_account_last4", label: "Account (last 4)", section: "bank" },
  { key: "bank_account_number", label: "Account number", section: "bank", unmasked: true },
];

/** Race and religion are sensitive: only exported when explicitly selected (design risk note). */
export const DEFAULT_EXPORT_COLUMNS = [
  "employee_number",
  "name",
  "job_title",
  "department",
  "team",
  "location",
  "manager",
  "work_email",
  "status",
];

/** Who the export may contain, and which columns are offered for that set. */
async function exportScope(actor: Actor) {
  const rowsScope = await listScope(actor, "employment");
  const sections = new Set<Section>(["directory"]);
  for (const s of ["employment", "personal", "work_pass", "compensation", "bank"] as Section[]) {
    const scope = await listScope(actor, s);
    if (scope === "all") sections.add(s);
    else if (rowsScope !== "all" && [...rowsScope].every((id) => scope.has(id)) && rowsScope.size > 0) sections.add(s);
  }
  return { rowsScope, sections };
}

export async function availableExportColumns(actor: Actor, opts: { unmasked?: boolean } = {}) {
  const { sections } = await exportScope(actor);
  return EXPORT_COLUMNS.filter((c) => sections.has(c.section) && (!c.unmasked || opts.unmasked));
}

const centsToDollars = (c: number) => `${Math.trunc(c / 100)}.${String(c % 100).padStart(2, "0")}`;

export async function exportEmployees(
  deps: AppDeps,
  ports: PeoplePorts,
  actor: Actor,
  input: { columns?: string[]; format: "csv" | "xlsx"; filters: DirectoryFilters; unmasked?: boolean },
): Promise<{ body: Uint8Array | string; contentType: string; fileName: string; rows: number; columns: string[] }> {
  const { rowsScope, sections } = await exportScope(actor);
  const requested = input.columns?.length ? input.columns : DEFAULT_EXPORT_COLUMNS;
  const columns: ExportColumn[] = [];
  for (const key of requested) {
    const col = EXPORT_COLUMNS.find((c) => c.key === key);
    if (!col)
      throw new AppError("validation_failed", `Unknown column "${key}".`, {
        target: "query",
        issues: [{ path: "columns", message: `Unknown column "${key}".` }],
      });
    if (!sections.has(col.section)) {
      throw new AppError("forbidden", `You cannot export "${col.label}". Remove that column.`, { column: key });
    }
    if (col.unmasked && !input.unmasked) {
      throw new AppError(
        "forbidden",
        `"${col.label}" unmasked needs the sensitive export, which asks you to sign in again.`,
        { column: key },
      );
    }
    columns.push(col);
  }
  let rows = await listDirectory(deps, actor, input.filters);
  if (rowsScope !== "all") {
    // Managers export their team (not themselves); anyone else only their own row.
    const team = await actor.team();
    rows = rows.filter((r) => (team.size ? team.has(r.id) : r.id === actor.employeeId));
  }

  const today = singaporeToday(deps.clock.now());
  const ids = new Set(rows.map((r) => r.id));
  const need = new Set(columns.map((c) => c.section));
  const emps = need.has("personal")
    ? new Map((await deps.db.select().from(employees).where(actor.org.where(employees))).map((e) => [e.id, e]))
    : new Map();
  const comps = need.has("compensation")
    ? await deps.db.select().from(compensationRecords).where(actor.org.where(compensationRecords))
    : [];
  const banks = need.has("bank") ? await deps.db.select().from(bankAccounts).where(actor.org.where(bankAccounts)) : [];
  const passes = need.has("work_pass")
    ? await deps.db.select().from(workPasses).where(actor.org.where(workPasses))
    : [];

  const out: (string | number | null)[][] = [];
  for (const r of rows) {
    if (!ids.has(r.id)) continue;
    const e = emps.get(r.id);
    const comp = findAsAt(
      comps.filter((c) => c.employeeId === r.id),
      today,
    );
    const bank = findAsAt(
      banks.filter((b) => b.employeeId === r.id),
      today,
    );
    const myPasses = passes.filter((p) => p.employeeId === r.id);
    const latestPass = [...myPasses].sort((a, b) => (a.expiresOn < b.expiresOn ? 1 : -1))[0];
    const line: (string | number | null)[] = [];
    for (const c of columns) {
      switch (c.key) {
        case "employee_number":
          line.push(r.employeeNumber);
          break;
        case "name":
          line.push(r.name);
          break;
        case "legal_name":
          line.push(r.legalName);
          break;
        case "job_title":
          line.push(r.jobTitle);
          break;
        case "department":
          line.push(r.department?.name ?? null);
          break;
        case "team":
          line.push(r.team?.name ?? null);
          break;
        case "location":
          line.push(r.location?.name ?? null);
          break;
        case "manager":
          line.push(r.manager?.name ?? null);
          break;
        case "work_email":
          line.push(r.workEmail);
          break;
        case "status":
          line.push(r.status.label);
          break;
        case "hire_date":
          line.push(r.hireDate);
          break;
        case "id_number_masked":
          line.push(e?.idNumberMasked ?? null);
          break;
        case "id_number":
          line.push(e ? await ports.secretBox.decrypt("nric", e.idNumberEnc) : null);
          break;
        case "date_of_birth":
          line.push(e?.dob ?? null);
          break;
        case "residency_status":
          line.push(e?.residencyStatus ?? null);
          break;
        case "pr_start_date":
          line.push(e?.prStartDate ?? null);
          break;
        case "nationality":
          line.push(e?.nationality ?? null);
          break;
        case "race":
          line.push(e?.race ?? null);
          break;
        case "religion":
          line.push(e?.religion ?? null);
          break;
        case "mobile":
          line.push(e?.mobileE164 ?? null);
          break;
        case "personal_email":
          line.push(e?.personalEmail ?? null);
          break;
        case "work_pass_type":
          line.push(latestPass?.passType ?? null);
          break;
        case "work_pass_expires_on":
          line.push(
            latestPass
              ? `${latestPass.expiresOn}${overallPassState(myPasses, today) === "expired" ? " (expired)" : ""}`
              : null,
          );
          break;
        case "pay_basis":
          line.push(comp?.payBasis ?? null);
          break;
        case "basic_pay":
          line.push(comp ? centsToDollars(comp.amountCents) : null);
          break;
        case "bank":
          line.push(bank ? bankName(bank.bankCode) : null);
          break;
        case "bank_account_last4":
          line.push(bank?.accountLast4 ?? null);
          break;
        case "bank_account_number":
          line.push(bank ? await ports.secretBox.decrypt("bank-account", bank.accountNumberEnc) : null);
          break;
        default:
          line.push(null);
      }
    }
    out.push(line);
  }
  const headers = columns.map((c) => c.label);
  // A read: nothing to roll back, so the event commits on its own (before the file is returned).
  await recordAudit(deps.db, ports, actor, {
    action: "employees.exported",
    targetType: "employee_list",
    targetId: actor.orgId,
    meta: {
      columns: columns.map((c) => c.key),
      rowCount: out.length,
      format: input.format,
      unmasked: !!input.unmasked,
    },
  });
  const stamp = today.replace(/-/g, "");
  if (input.format === "xlsx") {
    return {
      body: writeXlsx("Employees", headers, out),
      contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      fileName: `employees-${stamp}.xlsx`,
      rows: out.length,
      columns: columns.map((c) => c.key),
    };
  }
  return {
    body: `﻿${toCsv(headers, out)}`,
    contentType: "text/csv; charset=utf-8",
    fileName: `employees-${stamp}.csv`,
    rows: out.length,
    columns: columns.map((c) => c.key),
  };
}
