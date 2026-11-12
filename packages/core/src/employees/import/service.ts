import { eq, isNull, sql } from "drizzle-orm";
import { orgScope } from "../../access/org-scope.ts";
import {
  employees,
  type ImportCellError,
  type ImportJob,
  type ImportKind,
  importJobs,
  ytdOpeningBalances,
} from "../../db/schema/employees.ts";
import { costCentres, departments, locations, teams, workSchedules } from "../../db/schema/organisation.ts";
import type { Db } from "../../db/types.ts";
import type { AppDeps } from "../../deps.ts";
import { AppError } from "../../errors.ts";
import { type Actor, assertCanWrite, canWrite } from "../access.ts";
import { recordAudit } from "../audit-helpers.ts";
import { applyEvent, ctxFor, hire } from "../lifecycle.ts";
import { maskIdNumber } from "../nric.ts";
import type { PeoplePorts } from "../ports.ts";
import { closestName, MAX_IMPORT_ROWS, parseCsv, parseDollarsToCents, parseImportDate } from "./parse.ts";
import { TEMPLATES } from "./templates.ts";

/**
 * Import pipeline (design decision 7): parse → map headers → validate every
 * row through the same services the API uses inside a transaction that is
 * rolled back (preview) → store the preview for 24 h → commit re-runs the
 * whole file in one transaction, all rows or none.
 */

export const PREVIEW_TTL_MS = 24 * 3_600_000;

export interface ImportPreview {
  jobId: string;
  kind: ImportKind;
  fileName: string | null;
  status: ImportJob["status"];
  totalRows: number;
  validRows: number;
  errors: ImportCellError[];
  /** Rows that will be created, without sensitive values. */
  rows: { row: number; summary: string; valid: boolean }[];
  expiresAt: string;
  canCommit: boolean;
}

class Rollback extends Error {}

interface RowOutcome {
  line: number;
  summary: string;
  errors: ImportCellError[];
}

/**
 * Ports that queue side effects (invitations, back-pay) until the outer
 * transaction commits. Audit events are not deferred: they are written inside
 * that transaction, so a preview's roll-back discards them too.
 */
function deferredPorts(ports: PeoplePorts) {
  const queue: (() => Promise<void>)[] = [];
  const deferred: PeoplePorts = {
    secretBox: ports.secretBox,
    approvals: ports.approvals,
    audit: ports.audit,
    memberships: {
      inviteForEmployee: async (i, ctx) => {
        queue.push(async () => void (await ports.memberships.inviteForEmployee(i, ctx)));
        return {
          status: "skipped",
          inviteUrl: null,
          message: "Invitations are sent once the import is confirmed; resend links from Settings → Members.",
        };
      },
      markFormer: async (i) => void queue.push(() => ports.memberships.markFormer(i)),
    },
    payroll: {
      lastFinalisedPeriodEnd: (o, db) => ports.payroll.lastFinalisedPeriodEnd(o, db),
      notifyBackPay: async (n) => void queue.push(() => ports.payroll.notifyBackPay(n)),
    },
  };
  return {
    deferred,
    flush: async () => {
      for (const fn of queue) await fn();
    },
  };
}

/** Field path from a service validation error → template column. */
const PATH_TO_COLUMN: Record<string, string> = {
  "person.employeeNumber": "employee_number",
  "person.legalName": "legal_name",
  "person.preferredName": "preferred_name",
  "person.idType": "id_type",
  "person.idNumber": "id_number",
  "person.dob": "date_of_birth",
  "person.gender": "gender",
  "person.nationality": "nationality",
  "person.residencyStatus": "residency_status",
  "person.prStartDate": "pr_start_date",
  "person.race": "race",
  "person.religion": "religion",
  "person.workEmail": "work_email",
  "person.personalEmail": "personal_email",
  "person.mobile": "mobile",
  "job.hireDate": "hire_date",
  "job.jobTitle": "job_title",
  "job.departmentId": "department",
  "job.teamId": "team",
  "job.locationId": "location",
  "job.costCentreId": "cost_centre",
  "job.managerEmployeeId": "manager_employee_number",
  "job.employmentType": "employment_type",
  "job.workScheduleId": "work_schedule",
  "job.probationEnd": "probation_end",
  "job.isManagerOrExecutive": "manager_or_executive",
  "job.isWorkman": "workman",
  "compensation.payBasis": "pay_basis",
  "compensation.amountCents": "basic_pay",
  "compensation.retroactive": "retroactive",
  "workPass.passType": "pass_type",
  "workPass.passNumber": "pass_number",
  "workPass.issuedOn": "pass_issued_on",
  "workPass.expiresOn": "pass_expires_on",
  workPass: "pass_type",
  effectiveDate: "effective_from",
};

function columnFor(path: string): string {
  if (PATH_TO_COLUMN[path]) return PATH_TO_COLUMN[path];
  const prefix = Object.keys(PATH_TO_COLUMN).find((p) => path.startsWith(`${p}.`));
  return prefix ? (PATH_TO_COLUMN[prefix] as string) : path || "(row)";
}

function displayValue(column: string, values: Record<string, string>): string {
  const v = values[column] ?? "";
  if (column === "id_number" && v) return maskIdNumber(v.toUpperCase());
  if (column === "pass_number" && v) return `••••${v.slice(-4)}`;
  return v;
}

function errorsFrom(err: unknown, line: number, values: Record<string, string>): ImportCellError[] {
  if (!(err instanceof AppError)) throw err;
  const details = err.details as { issues?: { path: string; message: string }[]; reason?: string } | undefined;
  if (details?.issues?.length) {
    return details.issues.map((i) => {
      const column = columnFor(i.path);
      return { row: line, column, value: displayValue(column, values), message: i.message };
    });
  }
  const column =
    err.code === "duplicate_id_number"
      ? "id_number"
      : err.code === "reporting_cycle"
        ? "manager_employee_number"
        : details?.reason === "work_email_taken"
          ? "work_email"
          : "(row)";
  return [{ row: line, column, value: displayValue(column, values), message: err.message }];
}

// ---------------------------------------------------------------------------
// Name resolution

interface Lookups {
  departments: { id: string; name: string }[];
  teams: { id: string; name: string }[];
  locations: { id: string; name: string }[];
  costCentres: { id: string; name: string }[];
  schedules: { id: string; name: string }[];
}

async function lookups(db: Db, orgId: string): Promise<Lookups> {
  const org = orgScope(db, orgId);
  const [d, t, l, c, s] = await Promise.all([
    db
      .select({ id: departments.id, name: departments.name })
      .from(departments)
      .where(org.where(departments, isNull(departments.archivedAt))),
    db
      .select({ id: teams.id, name: teams.name })
      .from(teams)
      .where(org.where(teams, isNull(teams.archivedAt))),
    db
      .select({ id: locations.id, name: locations.name })
      .from(locations)
      .where(org.where(locations, isNull(locations.archivedAt))),
    db
      .select({ id: costCentres.id, name: costCentres.code })
      .from(costCentres)
      .where(org.where(costCentres, isNull(costCentres.archivedAt))),
    db
      .select({ id: workSchedules.id, name: workSchedules.name })
      .from(workSchedules)
      .where(org.where(workSchedules, isNull(workSchedules.archivedAt))),
  ]);
  return { departments: d, teams: t, locations: l, costCentres: c, schedules: s };
}

function resolve(
  list: { id: string; name: string }[],
  raw: string,
  label: string,
  column: string,
  line: number,
  errors: ImportCellError[],
): string | null | undefined {
  if (!raw) return null;
  const found = list.find((x) => x.name.toLowerCase() === raw.trim().toLowerCase());
  if (found) return found.id;
  const near = closestName(
    raw,
    list.map((x) => x.name),
  );
  errors.push({
    row: line,
    column,
    value: raw,
    message: near
      ? `No ${label} called "${raw}". The closest is "${near}". Fix the name, or add the ${label} in Settings → Structure first.`
      : `No ${label} called "${raw}". Add it in Settings → Structure first.`,
  });
  return undefined;
}

async function employeeIdByNumber(db: Db, orgId: string, number: string): Promise<string | null> {
  const org = orgScope(db, orgId);
  const [e] = await db
    .select({ id: employees.id })
    .from(employees)
    .where(org.where(employees, sql`lower(${employees.employeeNumber}) = ${number.trim().toLowerCase()}`));
  return e?.id ?? null;
}

const date = (v: Record<string, string>, column: string, line: number, errors: ImportCellError[]) => {
  const raw = v[column] ?? "";
  if (!raw) return null;
  const r = parseImportDate(raw);
  if (!r.ok) {
    errors.push({ row: line, column, value: raw, message: r.message });
    return undefined;
  }
  return r.value;
};

const money = (v: Record<string, string>, column: string, line: number, errors: ImportCellError[]) => {
  const raw = v[column] ?? "";
  if (!raw) return null;
  const r = parseDollarsToCents(raw);
  if (!r.ok) {
    errors.push({ row: line, column, value: raw, message: r.message });
    return undefined;
  }
  return r.cents;
};

const blank = (s: string | undefined) => (s && s.trim() !== "" ? s.trim() : null);

/** A yes/no cell: yes, no, y, n, true, false (any case); empty is no. */
function yesNo(v: Record<string, string>, column: string, line: number, errors: ImportCellError[]): boolean {
  const raw = blank(v[column]);
  if (raw === null) return false;
  const answer = { yes: true, y: true, true: true, no: false, n: false, false: false }[raw.toLowerCase()];
  if (answer === undefined) errors.push({ row: line, column, value: raw, message: "Use yes or no." });
  return answer ?? false;
}

// ---------------------------------------------------------------------------
// Row processors (run inside the import transaction)

type RowProcessor = (
  tx: Db,
  deps: AppDeps,
  ports: PeoplePorts,
  actor: Actor,
  look: Lookups,
  row: { line: number; values: Record<string, string> },
  seen: Set<string>,
) => Promise<RowOutcome>;

const employeeRow: RowProcessor = async (tx, deps, ports, actor, look, { line, values: v }) => {
  const errors: ImportCellError[] = [];
  const summary = `${v.legal_name || "(no name)"}${v.department ? ` · ${v.department}` : ""}`;
  const departmentId = resolve(look.departments, v.department ?? "", "department", "department", line, errors);
  if (departmentId === null)
    errors.push({ row: line, column: "department", value: "", message: "Enter the department name." });
  const teamId = resolve(look.teams, v.team ?? "", "team", "team", line, errors);
  const locationId = resolve(look.locations, v.location ?? "", "location", "location", line, errors);
  const costCentreId = resolve(look.costCentres, v.cost_centre ?? "", "cost centre", "cost_centre", line, errors);
  const workScheduleId = resolve(look.schedules, v.work_schedule ?? "", "work schedule", "work_schedule", line, errors);
  let managerEmployeeId: string | null = null;
  if (blank(v.manager_employee_number)) {
    managerEmployeeId = await employeeIdByNumber(tx, actor.orgId, v.manager_employee_number as string);
    if (!managerEmployeeId) {
      errors.push({
        row: line,
        column: "manager_employee_number",
        value: v.manager_employee_number as string,
        message: "No employee has this number. Use an existing employee, or put the manager's row earlier in the file.",
      });
    }
  }
  const dob = date(v, "date_of_birth", line, errors);
  const hireDate = date(v, "hire_date", line, errors);
  const prStart = date(v, "pr_start_date", line, errors);
  const probationEnd = date(v, "probation_end", line, errors);
  const passIssued = date(v, "pass_issued_on", line, errors);
  const passExpires = date(v, "pass_expires_on", line, errors);
  const basic = money(v, "basic_pay", line, errors);
  const managerOrExecutive = yesNo(v, "manager_or_executive", line, errors);
  const workman = yesNo(v, "workman", line, errors);
  for (const required of [
    "legal_name",
    "id_type",
    "id_number",
    "date_of_birth",
    "residency_status",
    "hire_date",
    "job_title",
    "employment_type",
  ]) {
    if (!blank(v[required]))
      errors.push({ row: line, column: required, value: "", message: "This column is required." });
  }
  if (basic !== null && basic !== undefined && !canWrite(actor, "compensation")) {
    errors.push({
      row: line,
      column: "basic_pay",
      value: "",
      message: "Your role cannot set pay. Leave basic_pay empty; a payroll admin imports compensation.",
    });
  }
  if (blank(v.pass_type) && !passExpires) {
    errors.push({
      row: line,
      column: "pass_expires_on",
      value: v.pass_expires_on ?? "",
      message: "Enter the pass expiry date.",
    });
  }
  if (errors.length) return { line, summary, errors };
  const payload = {
    person: {
      employeeNumber: blank(v.employee_number),
      legalName: v.legal_name,
      preferredName: blank(v.preferred_name),
      idType: (v.id_type ?? "").toLowerCase(),
      idNumber: v.id_number,
      dob,
      gender: blank(v.gender)?.toLowerCase() ?? null,
      nationality: blank(v.nationality),
      residencyStatus: (v.residency_status ?? "").toLowerCase(),
      prStartDate: prStart,
      race: blank(v.race)?.toLowerCase() ?? null,
      religion: blank(v.religion)?.toLowerCase() ?? null,
      workEmail: blank(v.work_email),
      personalEmail: blank(v.personal_email),
      mobile: blank(v.mobile),
    },
    job: {
      hireDate,
      jobTitle: v.job_title,
      departmentId,
      teamId,
      locationId,
      costCentreId,
      managerEmployeeId,
      employmentType: (v.employment_type ?? "").toLowerCase(),
      workScheduleId,
      probationEnd,
      isManagerOrExecutive: managerOrExecutive,
      isWorkman: workman,
    },
    compensation:
      basic === null || basic === undefined
        ? null
        : { payBasis: (blank(v.pay_basis) ?? "monthly").toLowerCase(), amountCents: basic },
    workPass: blank(v.pass_type)
      ? {
          passType: (v.pass_type as string).toUpperCase(),
          passNumber: blank(v.pass_number),
          issuedOn: passIssued,
          expiresOn: passExpires,
        }
      : null,
  };
  try {
    await hire(ctxFor({ ...deps, db: tx }, ports, actor), payload);
    return { line, summary, errors: [] };
  } catch (err) {
    return { line, summary, errors: errorsFrom(err, line, v) };
  }
};

const compensationRow: RowProcessor = async (tx, deps, ports, actor, _look, { line, values: v }) => {
  const errors: ImportCellError[] = [];
  const summary = `${v.employee_number ?? ""} · ${v.basic_pay ?? ""} from ${v.effective_from ?? ""}`;
  const employeeId = blank(v.employee_number)
    ? await employeeIdByNumber(tx, actor.orgId, v.employee_number as string)
    : null;
  if (!employeeId) {
    errors.push({
      row: line,
      column: "employee_number",
      value: v.employee_number ?? "",
      message: "No employee has this number.",
    });
  }
  const from = date(v, "effective_from", line, errors);
  if (from === null)
    errors.push({ row: line, column: "effective_from", value: "", message: "This column is required." });
  const basic = money(v, "basic_pay", line, errors);
  if (basic === null) errors.push({ row: line, column: "basic_pay", value: "", message: "This column is required." });
  const retro = (v.retroactive ?? "").toLowerCase();
  if (retro && !["yes", "no", "true", "false", "y", "n"].includes(retro)) {
    errors.push({ row: line, column: "retroactive", value: v.retroactive ?? "", message: "Use yes or no." });
  }
  if (errors.length || !employeeId) return { line, summary, errors };
  try {
    await applyEvent(ctxFor({ ...deps, db: tx }, ports, actor), employeeId, {
      type: "salary_change",
      effectiveDate: from,
      compensation: {
        payBasis: (blank(v.pay_basis) ?? "monthly").toLowerCase(),
        amountCents: basic,
        reason: blank(v.reason),
        retroactive: ["yes", "true", "y"].includes(retro),
      },
    });
    return { line, summary, errors: [] };
  } catch (err) {
    return { line, summary, errors: errorsFrom(err, line, v) };
  }
};

const ytdRow: RowProcessor = async (tx, deps, _ports, actor, _look, { line, values: v }, seen) => {
  const errors: ImportCellError[] = [];
  const summary = `${v.employee_number ?? ""} · ${v.year ?? ""} through ${v.through_month ?? ""}`;
  const employeeId = blank(v.employee_number)
    ? await employeeIdByNumber(tx, actor.orgId, v.employee_number as string)
    : null;
  if (!employeeId)
    errors.push({
      row: line,
      column: "employee_number",
      value: v.employee_number ?? "",
      message: "No employee has this number.",
    });
  const year = Number(v.year);
  if (!/^\d{4}$/.test(v.year ?? "") || year < 2000 || year > 2100) {
    errors.push({
      row: line,
      column: "year",
      value: v.year ?? "",
      message: "Enter a 4-digit calendar year, like 2026.",
    });
  }
  let through = Number.NaN;
  const tm = (v.through_month ?? "").trim();
  const ym = /^(\d{4})-(\d{2})$/.exec(tm);
  if (ym) {
    through = Number(ym[2]);
    if (Number(ym[1]) !== year)
      errors.push({
        row: line,
        column: "through_month",
        value: tm,
        message: "The month must be in the same year as the year column.",
      });
  } else if (/^\d{1,2}$/.test(tm)) through = Number(tm);
  if (!(through >= 1 && through <= 12)) {
    errors.push({
      row: line,
      column: "through_month",
      value: tm,
      message: "Enter the last month covered as 1-12 or YYYY-MM, like 6 or 2026-06.",
    });
  }
  const amounts: Record<string, number | null | undefined> = {};
  for (const c of ["ow_ytd", "ow_cpf_ytd", "aw_ytd", "aw_cpf_ytd", "cpf_ee_ytd", "cpf_er_ytd", "shg_ytd", "sdl_ytd"]) {
    amounts[c] = money(v, c, line, errors);
  }
  for (const c of ["ow_ytd", "aw_ytd", "cpf_ee_ytd", "cpf_er_ytd", "shg_ytd"]) {
    if (amounts[c] === null)
      errors.push({ row: line, column: c, value: "", message: "This column is required (use 0.00 if none)." });
  }
  const key = `${employeeId}:${year}`;
  if (employeeId && seen.has(key)) {
    errors.push({
      row: line,
      column: "employee_number",
      value: v.employee_number ?? "",
      message: "This employee already has a row for this year in the file. Keep one row per employee and year.",
    });
  }
  if (errors.length || !employeeId) return { line, summary, errors };
  seen.add(key);
  const values = {
    throughMonth: through,
    owCents: amounts.ow_ytd as number,
    owCpfCents: amounts.ow_cpf_ytd ?? null,
    awCents: amounts.aw_ytd as number,
    awCpfCents: amounts.aw_cpf_ytd ?? null,
    cpfEeCents: amounts.cpf_ee_ytd as number,
    cpfErCents: amounts.cpf_er_ytd as number,
    shgCents: amounts.shg_ytd as number,
    sdlCents: amounts.sdl_ytd ?? null,
    updatedAt: deps.clock.now(),
  };
  await tx
    .insert(ytdOpeningBalances)
    .values({ orgId: actor.orgId, employeeId, year, ...values })
    .onConflictDoUpdate({
      target: [ytdOpeningBalances.orgId, ytdOpeningBalances.employeeId, ytdOpeningBalances.year],
      set: values,
    });
  return { line, summary, errors: [] };
};

const PROCESSORS: Record<ImportKind, RowProcessor> = {
  employees: employeeRow,
  compensation: compensationRow,
  ytd: ytdRow,
};

function assertImportAllowed(actor: Actor, kind: ImportKind) {
  if (kind === "employees") assertCanWrite(actor, "employment");
  else assertCanWrite(actor, "compensation");
}

async function runFile(
  deps: AppDeps,
  ports: PeoplePorts,
  actor: Actor,
  kind: ImportKind,
  rows: { line: number; values: Record<string, string> }[],
  /** Commit (instead of rolling back) when every row passes; runs inside the transaction first. */
  commit: ((tx: Db) => Promise<void>) | null,
): Promise<{ outcomes: RowOutcome[]; flush: () => Promise<void> }> {
  const { deferred, flush } = deferredPorts(ports);
  const outcomes: RowOutcome[] = [];
  try {
    await deps.db.transaction(async (tx) => {
      const look = await lookups(tx, actor.orgId);
      const seen = new Set<string>();
      for (const row of rows) outcomes.push(await PROCESSORS[kind](tx, deps, deferred, actor, look, row, seen));
      if (!commit || outcomes.some((o) => o.errors.length)) throw new Rollback();
      await commit(tx);
    });
  } catch (err) {
    if (!(err instanceof Rollback)) throw err;
  }
  return { outcomes, flush };
}

function checkHeaders(kind: ImportKind, headers: string[]): ImportCellError[] {
  const t = TEMPLATES[kind];
  const missing = t.columns.filter((c) => c.required && !headers.includes(c.name));
  const unknown = headers.filter((h) => h && !t.columns.some((c) => c.name === h));
  return [
    ...missing.map((c) => ({
      row: 1,
      column: c.name,
      value: "",
      message: `The column "${c.name}" is missing. Download the template and keep its header row.`,
    })),
    ...unknown.map((h) => ({
      row: 1,
      column: h,
      value: "",
      message: `Unknown column "${h}". Remove it or rename it to a template column.`,
    })),
  ];
}

async function sealRows(ports: PeoplePorts, rows: { line: number; values: Record<string, string> }[]) {
  return [{ sealed: await ports.secretBox.encrypt("people-import", JSON.stringify(rows)) }];
}

async function unsealRows(ports: PeoplePorts, stored: Record<string, string>[]) {
  const sealed = stored[0]?.sealed;
  if (!sealed) return [];
  return JSON.parse(await ports.secretBox.decrypt("people-import", sealed)) as {
    line: number;
    values: Record<string, string>;
  }[];
}

function toPreview(job: ImportJob, outcomes: RowOutcome[] | null, now: Date): ImportPreview {
  return {
    jobId: job.id,
    kind: job.kind,
    fileName: job.fileName,
    status: job.status,
    totalRows: outcomes?.length ?? job.validRowCount,
    validRows: job.validRowCount,
    errors: job.errors,
    rows: (outcomes ?? []).map((o) => ({ row: o.line, summary: o.summary, valid: o.errors.length === 0 })),
    expiresAt: job.expiresAt.toISOString(),
    canCommit: job.status === "previewed" && job.errors.length === 0 && job.expiresAt > now && job.validRowCount > 0,
  };
}

export async function previewImport(
  deps: AppDeps,
  ports: PeoplePorts,
  actor: Actor,
  kind: ImportKind,
  file: { name?: string | null; content: string | Uint8Array },
): Promise<ImportPreview> {
  assertImportAllowed(actor, kind);
  const parsed = parseCsv(file.content);
  if (!parsed.ok)
    throw new AppError("validation_failed", parsed.message, {
      target: "file",
      issues: [{ path: "file", message: parsed.message }],
    });
  const headerErrors = checkHeaders(kind, parsed.csv.headers);
  if (parsed.csv.rows.length === 0) {
    throw new AppError("validation_failed", "The file has a header row but no data rows.", {
      target: "file",
      issues: [{ path: "file", message: "Add at least one data row under the header." }],
    });
  }
  const { outcomes } = headerErrors.some((e) => e.message.includes("missing"))
    ? { outcomes: [] as RowOutcome[] }
    : await runFile(deps, ports, actor, kind, parsed.csv.rows, null);
  const errors = [...headerErrors, ...outcomes.flatMap((o) => o.errors)];
  const id = deps.ids.newId();
  const now = deps.clock.now();
  const [job] = await deps.db
    .insert(importJobs)
    .values({
      id,
      orgId: actor.orgId,
      kind,
      status: "previewed",
      fileName: file.name ?? null,
      rows: await sealRows(ports, parsed.csv.rows),
      errors,
      validRowCount: outcomes.filter((o) => o.errors.length === 0).length,
      expiresAt: new Date(now.getTime() + PREVIEW_TTL_MS),
      createdBy: actor.userId,
    })
    .returning();
  return toPreview(
    job as ImportJob,
    outcomes.length ? outcomes : parsed.csv.rows.map((r) => ({ line: r.line, summary: "", errors: [] })),
    now,
  );
}

export async function getImport(deps: AppDeps, actor: Actor, jobId: string): Promise<ImportPreview> {
  const [job] = await deps.db.select().from(importJobs).where(actor.org.whereId(importJobs, jobId));
  if (!job) throw new AppError("not_found", "No such import.");
  assertImportAllowed(actor, job.kind);
  return toPreview(job, null, deps.clock.now());
}

/** Re-validates and applies every row in one transaction; nothing is written if any row fails. */
export async function commitImport(
  deps: AppDeps,
  ports: PeoplePorts,
  actor: Actor,
  jobId: string,
): Promise<ImportPreview> {
  const [job] = await deps.db.select().from(importJobs).where(actor.org.whereId(importJobs, jobId));
  if (!job) throw new AppError("not_found", "No such import.");
  assertImportAllowed(actor, job.kind);
  const now = deps.clock.now();
  if (job.status === "committed") throw new AppError("conflict", "This import was already confirmed.");
  if (job.expiresAt <= now)
    throw new AppError("conflict", "This preview has expired (24 hours). Upload the file again.");
  if (job.errors.length)
    throw new AppError("conflict", "Fix the errors in the file and upload it again before confirming.");
  const rows = await unsealRows(ports, job.rows);
  if (rows.length > MAX_IMPORT_ROWS) throw new AppError("validation_failed", "Too many rows.");
  let done: ImportJob | undefined;
  const { outcomes, flush } = await runFile(deps, ports, actor, job.kind, rows, async (tx) => {
    [done] = await tx
      .update(importJobs)
      .set({ status: "committed", committedAt: now, rows: [] })
      .where(eq(importJobs.id, jobId))
      .returning();
    await recordAudit(tx, ports, actor, {
      action: `import.${job.kind}.committed`,
      targetType: "import_job",
      targetId: jobId,
      meta: { rows: rows.length, fileName: job.fileName },
    });
  });
  const errors = outcomes.flatMap((o) => o.errors);
  if (errors.length) {
    const [failed] = await deps.db
      .update(importJobs)
      .set({ errors, validRowCount: outcomes.filter((o) => !o.errors.length).length })
      .where(eq(importJobs.id, jobId))
      .returning();
    throw new AppError(
      "conflict",
      "Some rows no longer pass validation (data changed since the preview). Nothing was imported.",
      {
        reason: "revalidation_failed",
        preview: toPreview(failed as ImportJob, outcomes, now),
      },
    );
  }
  await flush();
  return toPreview(done as ImportJob, outcomes, now);
}

/** YTD opening balances for payroll (one row per employee and year). */
export async function ytdOpeningBalance(db: Db, orgId: string, employeeId: string, year: number) {
  const org = orgScope(db, orgId);
  const [row] = await db
    .select()
    .from(ytdOpeningBalances)
    .where(
      org.where(ytdOpeningBalances, eq(ytdOpeningBalances.employeeId, employeeId), eq(ytdOpeningBalances.year, year)),
    );
  return row ?? null;
}
