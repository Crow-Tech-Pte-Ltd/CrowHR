import { appendix8aRuleFor, appendix8bRuleFor, IRAS_APPENDIX_SOURCES } from "@crowhr/sg-rules";
import { and, asc, eq, inArray } from "drizzle-orm";
import type { z } from "zod";
import { orgScope } from "../../access/org-scope.ts";
import { diffFields, recordAudit } from "../../audit/audit.ts";
import { employees } from "../../db/schema/employees.ts";
import { type PayrollIr8aAppendixEntry, payrollIr8aAppendixEntries } from "../../db/schema/ir8a.ts";
import type { Db } from "../../db/types.ts";
import type { AppDeps } from "../../deps.ts";
import { singaporeToday } from "../../employees/dates.ts";
import { AppError } from "../../errors.ts";
import type { PayrollActor } from "../service.ts";
import {
  type AppendixEntryRow,
  computeEntry,
  type EmployeeAppendices,
  type EntryComputation,
  employeeAppendices,
} from "./ir8a-appendix.ts";
import { type AppendixEntryDetails, appendixEntryInput, type createAppendixEntryInput } from "./ir8a-appendix-input.ts";

/**
 * Appendix 8A / 8B entries (add-ir8a-appendix-8a-8b): CRUD with limits and audit, and the year's
 * computed appendices for the IR8A export. Permissions are the route's (`payroll:read` /
 * `payroll:update`); every query is org-scoped.
 */

export function assertYear(year: number) {
  if (!Number.isInteger(year) || year < 2000 || year > 2100)
    throw new AppError("validation_failed", "Choose a valid year.");
}

const todayOf = (deps: AppDeps) => singaporeToday(deps.clock.now());

/** Re-validates stored details through the same schema (defaults applied), for old rows too. */
function parseDetails(row: PayrollIr8aAppendixEntry): AppendixEntryDetails {
  return appendixEntryInput.parse(row.details);
}

export interface AppendixYear {
  byEmployee: Map<string, EmployeeAppendices>;
  /** Entries that no longer compute under the current rules (e.g. a corrected rule): left out, with why. */
  failed: { entryId: string; employeeId: string; message: string }[];
}

/** Every employee's computed appendices for an income year. */
export async function appendicesForYear(deps: AppDeps, orgId: string, year: number): Promise<AppendixYear> {
  const org = orgScope(deps.db, orgId);
  const rows = await deps.db
    .select()
    .from(payrollIr8aAppendixEntries)
    .where(org.where(payrollIr8aAppendixEntries, eq(payrollIr8aAppendixEntries.year, year)))
    .orderBy(asc(payrollIr8aAppendixEntries.createdAt), asc(payrollIr8aAppendixEntries.id));
  const today = todayOf(deps);
  const grouped = new Map<string, AppendixEntryRow[]>();
  const failed: AppendixYear["failed"] = [];
  for (const row of rows) {
    try {
      const details = parseDetails(row);
      const computed = computeEntry(details, year, today);
      const list = grouped.get(row.employeeId) ?? [];
      list.push({ id: row.id, employeeId: row.employeeId, details, computed });
      grouped.set(row.employeeId, list);
    } catch (err) {
      failed.push({
        entryId: row.id,
        employeeId: row.employeeId,
        message: err instanceof Error ? err.message : "This record no longer validates.",
      });
    }
  }
  const byEmployee = new Map<string, EmployeeAppendices>();
  for (const [employeeId, list] of grouped) byEmployee.set(employeeId, employeeAppendices(list, year));
  return { byEmployee, failed };
}

// ---------------------------------------------------------------------------------------------
// DTOs
// ---------------------------------------------------------------------------------------------

export interface AppendixEntryDto {
  id: string;
  year: number;
  employeeId: string;
  employeeName: string;
  kind: AppendixEntryDetails["kind"];
  details: AppendixEntryDetails;
  computed: {
    appendix: "8A" | "8B";
    item: string;
    valueCents: number;
    days: number | null;
    section: "S10_1_B" | "S10_1_G" | null;
    lines: EntryComputation["lines"];
    working: { code: string; text: string }[];
    issues: { code: string; severity: "info" | "warning" | "blocking"; message: string }[];
  } | null;
  /** Why the entry no longer computes (it is left out of the export until fixed). */
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

function toComputedDto(c: EntryComputation): NonNullable<AppendixEntryDto["computed"]> {
  return {
    appendix: c.appendix,
    item: c.item,
    valueCents: c.valueCents,
    days: c.days,
    section: c.section,
    lines: c.lines,
    working: c.working.map((w) => ({ code: w.code, text: w.text })),
    issues: c.issues.map((i) => ({ code: i.code, severity: i.severity, message: i.message })),
  };
}

function toDto(
  row: PayrollIr8aAppendixEntry,
  employeeName: string,
  details: AppendixEntryDetails,
  computed: EntryComputation | null,
  error: string | null,
): AppendixEntryDto {
  return {
    id: row.id,
    year: row.year,
    employeeId: row.employeeId,
    employeeName,
    kind: details.kind,
    details,
    computed: computed ? toComputedDto(computed) : null,
    error,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function namesOf(db: Db, orgId: string, ids: string[]): Promise<Map<string, string>> {
  if (!ids.length) return new Map();
  const rows = await db
    .select({ id: employees.id, legalName: employees.legalName })
    .from(employees)
    .where(and(eq(employees.orgId, orgId), inArray(employees.id, ids)));
  return new Map(rows.map((r) => [r.id, r.legalName]));
}

export interface AppendixListDto {
  year: number;
  yearOfAssessment: number;
  entries: AppendixEntryDto[];
  employees: {
    employeeId: string;
    employeeName: string;
    appendix8aTotalCents: number;
    /** IR8A d8 in whole dollars. */
    benefitsInKind: number;
    shareGainsS101bCents: number;
    shareGainsS101gCents: number;
    /** IR8A d7(a) / d7(b) in whole dollars. */
    shareGainsS101b: number;
    shareGainsS101g: number;
    issues: { code: string; message: string }[];
  }[];
  limits: { residencesPerEmployee: number; shareRecordsPerEmployee: number };
  sources: { explanatoryNotes8a: string; explanatoryNotes8b: string; exemptBenefits: string; importTemplate: string };
}

/** The year's entries with computed values, and each employee's appendix totals. */
export async function listAppendixEntries(deps: AppDeps, actor: PayrollActor, year: number): Promise<AppendixListDto> {
  assertYear(year);
  const org = orgScope(deps.db, actor.orgId);
  const rows = await deps.db
    .select()
    .from(payrollIr8aAppendixEntries)
    .where(org.where(payrollIr8aAppendixEntries, eq(payrollIr8aAppendixEntries.year, year)))
    .orderBy(asc(payrollIr8aAppendixEntries.createdAt), asc(payrollIr8aAppendixEntries.id));
  const names = await namesOf(deps.db, actor.orgId, [...new Set(rows.map((r) => r.employeeId))]);
  const today = todayOf(deps);
  const grouped = new Map<string, AppendixEntryRow[]>();
  const entries = rows.map((row) => {
    const name = names.get(row.employeeId) ?? "";
    const parsed = appendixEntryInput.safeParse(row.details);
    if (!parsed.success) return toDto(row, name, row.details, null, "This record no longer validates: edit it.");
    try {
      const computed = computeEntry(parsed.data, year, today);
      grouped.set(row.employeeId, [
        ...(grouped.get(row.employeeId) ?? []),
        { id: row.id, employeeId: row.employeeId, details: parsed.data, computed },
      ]);
      return toDto(row, name, parsed.data, computed, null);
    } catch (err) {
      return toDto(row, name, parsed.data, null, err instanceof Error ? err.message : "This record doesn't compute.");
    }
  });
  const people = [...grouped.entries()]
    .map(([employeeId, list]) => [employeeId, employeeAppendices(list, year)] as const)
    .map(([employeeId, a]) => ({
      employeeId,
      employeeName: names.get(employeeId) ?? "",
      appendix8aTotalCents: a.total8a.totalCents,
      benefitsInKind: a.total8a.ir8aD8Dollars,
      shareGainsS101bCents: a.total8b.s101bCents,
      shareGainsS101gCents: a.total8b.s101gCents,
      shareGainsS101b: a.total8b.ir8aD7aDollars,
      shareGainsS101g: a.total8b.ir8aD7bDollars,
      issues: a.total8a.issues.map((i) => ({ code: i.code, message: i.message })),
    }))
    .sort((x, y) => x.employeeName.localeCompare(y.employeeName) || x.employeeId.localeCompare(y.employeeId));
  const limits = rulesLimits(year);
  return {
    year,
    yearOfAssessment: year + 1,
    entries,
    employees: people,
    limits,
    sources: {
      explanatoryNotes8a: IRAS_APPENDIX_SOURCES.explanatoryNotes8a,
      explanatoryNotes8b: IRAS_APPENDIX_SOURCES.explanatoryNotes8b,
      exemptBenefits: IRAS_APPENDIX_SOURCES.exemptBenefits,
      importTemplate: IRAS_APPENDIX_SOURCES.importTemplate,
    },
  };
}

function rulesLimits(year: number) {
  try {
    return {
      residencesPerEmployee: appendix8aRuleFor(year).maxResidencesPerEmployee,
      shareRecordsPerEmployee: appendix8bRuleFor(year).maxRecordsPerEmployee,
    };
  } catch {
    // A year before the encoded rules: nothing can be recorded (create refuses with the reason).
    return { residencesPerEmployee: 0, shareRecordsPerEmployee: 0 };
  }
}

// ---------------------------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------------------------

const LIMITED: Partial<Record<AppendixEntryDetails["kind"], (year: number) => { max: number; what: string }>> = {
  residence: (year) => ({ max: appendix8aRuleFor(year).maxResidencesPerEmployee, what: "places of residence" }),
  share_gain: (year) => ({ max: appendix8bRuleFor(year).maxRecordsPerEmployee, what: "share plan records" }),
};

/** Locks the employee row so concurrent writes can't pass the per-employee limits together. */
async function lockEmployee(tx: Db, orgId: string, employeeId: string) {
  const [emp] = await tx
    .select({ id: employees.id, legalName: employees.legalName })
    .from(employees)
    .where(and(eq(employees.orgId, orgId), eq(employees.id, employeeId)))
    .for("update");
  if (!emp) throw new AppError("not_found", "That employee doesn't exist or you can't see it.");
  return emp;
}

async function checkLimit(
  tx: Db,
  orgId: string,
  employeeId: string,
  year: number,
  kind: AppendixEntryDetails["kind"],
  excludingId: string | null,
) {
  const limit = LIMITED[kind]?.(year);
  if (!limit) return;
  const rows = await tx
    .select({ id: payrollIr8aAppendixEntries.id })
    .from(payrollIr8aAppendixEntries)
    .where(
      and(
        eq(payrollIr8aAppendixEntries.orgId, orgId),
        eq(payrollIr8aAppendixEntries.employeeId, employeeId),
        eq(payrollIr8aAppendixEntries.year, year),
        eq(payrollIr8aAppendixEntries.kind, kind),
      ),
    );
  if (rows.filter((r) => r.id !== excludingId).length >= limit.max)
    throw new AppError(
      "conflict",
      `IRAS's form takes at most ${limit.max} ${limit.what} per employee and year. Combine or delete one first.`,
    );
}

export async function createAppendixEntry(
  deps: AppDeps,
  actor: PayrollActor,
  year: number,
  input: z.output<typeof createAppendixEntryInput>,
): Promise<AppendixEntryDto> {
  assertYear(year);
  const details = input.entry;
  const computed = computeEntry(details, year, todayOf(deps));
  const id = deps.ids.newId();
  const now = deps.clock.now();
  return deps.db.transaction(async (tx) => {
    const emp = await lockEmployee(tx, actor.orgId, input.employeeId);
    await checkLimit(tx, actor.orgId, emp.id, year, details.kind, null);
    const [row] = await tx
      .insert(payrollIr8aAppendixEntries)
      .values(
        orgScope(tx, actor.orgId).values({
          id,
          employeeId: emp.id,
          year,
          kind: details.kind,
          details,
          createdBy: actor.membershipId,
          updatedBy: actor.membershipId,
          createdAt: now,
          updatedAt: now,
        }),
      )
      .returning();
    await recordAudit(tx, deps, actor.audit, {
      action: "payroll.ir8a_appendix_created",
      targetType: "ir8a_appendix_entry",
      targetId: id,
      diff: diffFields(null, details as Record<string, unknown>),
      meta: { year, employeeId: emp.id, kind: details.kind },
    });
    return toDto(row as PayrollIr8aAppendixEntry, emp.legalName, details, computed, null);
  });
}

export async function replaceAppendixEntry(
  deps: AppDeps,
  actor: PayrollActor,
  entryId: string,
  details: AppendixEntryDetails,
): Promise<AppendixEntryDto> {
  const org = orgScope(deps.db, actor.orgId);
  const existing = await org.getById(payrollIr8aAppendixEntries, entryId, "appendix record");
  if (existing.kind !== details.kind)
    throw new AppError(
      "validation_failed",
      "A record can't change kind: delete it and record the benefit or share gain again.",
    );
  const computed = computeEntry(details, existing.year, todayOf(deps));
  return deps.db.transaction(async (tx) => {
    const emp = await lockEmployee(tx, actor.orgId, existing.employeeId);
    const [row] = await tx
      .update(payrollIr8aAppendixEntries)
      .set({ details, updatedBy: actor.membershipId, updatedAt: deps.clock.now() })
      .where(orgScope(tx, actor.orgId).whereId(payrollIr8aAppendixEntries, entryId))
      .returning();
    if (!row) throw new AppError("not_found", "That appendix record doesn't exist or you can't see it.");
    await recordAudit(tx, deps, actor.audit, {
      action: "payroll.ir8a_appendix_updated",
      targetType: "ir8a_appendix_entry",
      targetId: entryId,
      diff: diffFields(existing.details as Record<string, unknown>, details as Record<string, unknown>),
      meta: { year: existing.year, employeeId: existing.employeeId, kind: details.kind },
    });
    return toDto(row, emp.legalName, details, computed, null);
  });
}

export async function deleteAppendixEntry(deps: AppDeps, actor: PayrollActor, entryId: string): Promise<void> {
  const org = orgScope(deps.db, actor.orgId);
  const existing = await org.getById(payrollIr8aAppendixEntries, entryId, "appendix record");
  await deps.db.transaction(async (tx) => {
    const deleted = await tx
      .delete(payrollIr8aAppendixEntries)
      .where(orgScope(tx, actor.orgId).whereId(payrollIr8aAppendixEntries, entryId))
      .returning({ id: payrollIr8aAppendixEntries.id });
    if (!deleted.length) throw new AppError("not_found", "That appendix record doesn't exist or you can't see it.");
    await recordAudit(tx, deps, actor.audit, {
      action: "payroll.ir8a_appendix_deleted",
      targetType: "ir8a_appendix_entry",
      targetId: entryId,
      diff: diffFields(existing.details as Record<string, unknown>, null),
      meta: { year: existing.year, employeeId: existing.employeeId, kind: existing.kind },
    });
  });
}
