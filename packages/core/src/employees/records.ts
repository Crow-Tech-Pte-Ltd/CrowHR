import { and, asc, desc, eq, inArray } from "drizzle-orm";
import {
  allowanceTypes,
  bankAccounts,
  compensationRecords,
  type Employee,
  type EmploymentRecord,
  emergencyContacts,
  employees,
  employmentRecords,
  profileChangeRequests,
  recurringAllowances,
  type Tenure,
  tenures,
  workPasses,
} from "../db/schema/employees.ts";
import { costCentres, departments, locations, teams, workSchedules } from "../db/schema/organisation.ts";
import type { Db } from "../db/types.ts";
import type { AppDeps } from "../deps.ts";
import { AppError } from "../errors.ts";
import { type Actor, assertCanRead, listScope, readableSections, type Section } from "./access.ts";
import { bankName } from "./banks.ts";
import { ageOn, singaporeToday } from "./dates.ts";
import { findAsAt, inForceOn } from "./effective.ts";
import { type EmploymentStatus, employmentStatus, listEvents } from "./lifecycle.ts";
import { overallPassState, type PassState, toPassView, type WorkPassView } from "./work-pass.ts";

/** Lookup maps for structure names (archived entries included: history must still render). */
export async function structureNames(db: Db, orgId: string) {
  const [d, t, l, c, s] = await Promise.all([
    db.select({ id: departments.id, name: departments.name }).from(departments).where(eq(departments.orgId, orgId)),
    db.select({ id: teams.id, name: teams.name }).from(teams).where(eq(teams.orgId, orgId)),
    db.select({ id: locations.id, name: locations.name }).from(locations).where(eq(locations.orgId, orgId)),
    db.select({ id: costCentres.id, name: costCentres.name }).from(costCentres).where(eq(costCentres.orgId, orgId)),
    db
      .select({ id: workSchedules.id, name: workSchedules.name })
      .from(workSchedules)
      .where(eq(workSchedules.orgId, orgId)),
  ]);
  const map = (rows: { id: string; name: string }[]) => new Map(rows.map((r) => [r.id, r.name]));
  return { departments: map(d), teams: map(t), locations: map(l), costCentres: map(c), schedules: map(s) };
}

type Names = Awaited<ReturnType<typeof structureNames>>;
const ref = (map: Map<string, string>, id: string | null) => (id ? { id, name: map.get(id) ?? "Unknown" } : null);

export function displayName(e: Pick<Employee, "legalName" | "preferredName">): string {
  return e.preferredName || e.legalName;
}

// ---------------------------------------------------------------------------
// Directory list

export const EMPLOYEE_STATUSES = ["active", "not_started", "leaving", "former", "no_tenure"] as const;
export type EmployeeStatusCode = (typeof EMPLOYEE_STATUSES)[number];

export interface DirectoryFilters {
  q?: string;
  departmentId?: string;
  teamId?: string;
  locationId?: string;
  costCentreId?: string;
  managerId?: string;
  status?: EmployeeStatusCode[];
  /** Restrict to the actor's team (managers). */
  teamOnly?: boolean;
}

export interface DirectoryRow {
  id: string;
  employeeNumber: string;
  name: string;
  legalName: string;
  preferredName: string | null;
  jobTitle: string | null;
  department: { id: string; name: string } | null;
  team: { id: string; name: string } | null;
  location: { id: string; name: string } | null;
  manager: { id: string; name: string } | null;
  workEmail: string | null;
  status: EmploymentStatus;
  /** Only for readers with work-pass access to everyone; null otherwise or for non-foreigners. */
  workPassState: PassState | null;
  hireDate: string | null;
}

interface Loaded {
  employees: Employee[];
  records: Map<string, EmploymentRecord>;
  tenures: Map<string, Tenure[]>;
  names: Names;
  passes: Map<string, PassState | null>;
}

/** Everything the directory needs, as at today, in a handful of queries (fine for SME headcounts). */
async function loadDirectory(db: Db, orgId: string, today: string, withPasses: boolean): Promise<Loaded> {
  const [emps, recs, tens, names, passes] = await Promise.all([
    db.select().from(employees).where(eq(employees.orgId, orgId)),
    db.select().from(employmentRecords).where(eq(employmentRecords.orgId, orgId)),
    db.select().from(tenures).where(eq(tenures.orgId, orgId)),
    structureNames(db, orgId),
    withPasses ? db.select().from(workPasses).where(eq(workPasses.orgId, orgId)) : Promise.resolve([]),
  ]);
  const byEmp = <T extends { employeeId: string }>(rows: T[]) => {
    const m = new Map<string, T[]>();
    for (const r of rows) m.set(r.employeeId, [...(m.get(r.employeeId) ?? []), r]);
    return m;
  };
  const recsBy = byEmp(recs);
  const records = new Map<string, EmploymentRecord>();
  for (const [id, rows] of recsBy) {
    // In force today, else the latest (for leavers and future starters).
    const sorted = [...rows].sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? 1 : -1));
    const current = findAsAt(rows, today) ?? sorted.find((r) => r.effectiveFrom > today) ?? sorted[0];
    if (current) records.set(id, current);
  }
  const passesBy = byEmp(passes);
  const passStates = new Map<string, PassState | null>();
  for (const e of emps) passStates.set(e.id, overallPassState(passesBy.get(e.id) ?? [], today));
  return { employees: emps, records, tenures: byEmp(tens), names, passes: passStates };
}

function toRow(
  e: Employee,
  l: Loaded,
  today: string,
  empNames: Map<string, string>,
  withPasses: boolean,
): DirectoryRow {
  const r = l.records.get(e.id);
  const ten = l.tenures.get(e.id) ?? [];
  return {
    id: e.id,
    employeeNumber: e.employeeNumber,
    name: displayName(e),
    legalName: e.legalName,
    preferredName: e.preferredName,
    jobTitle: r?.jobTitle ?? null,
    department: r ? ref(l.names.departments, r.departmentId) : null,
    team: r ? ref(l.names.teams, r.teamId) : null,
    location: r ? ref(l.names.locations, r.locationId) : null,
    manager: r?.managerEmployeeId
      ? { id: r.managerEmployeeId, name: empNames.get(r.managerEmployeeId) ?? "Unknown" }
      : null,
    workEmail: e.workEmail,
    status: employmentStatus(ten, today),
    workPassState: withPasses && e.residencyStatus === "foreigner" ? (l.passes.get(e.id) ?? null) : null,
    hireDate: [...ten].sort((a, b) => (a.hireDate < b.hireDate ? 1 : -1))[0]?.hireDate ?? null,
  };
}

export async function listDirectory(deps: AppDeps, actor: Actor, filters: DirectoryFilters): Promise<DirectoryRow[]> {
  const today = singaporeToday(deps.clock.now());
  const passScope = await listScope(actor, "work_pass");
  const l = await loadDirectory(deps.db, actor.orgId, today, passScope === "all");
  const empNames = new Map(l.employees.map((e) => [e.id, displayName(e)]));
  let rows = l.employees.map((e) => toRow(e, l, today, empNames, passScope === "all"));
  if (filters.teamOnly) {
    const team = await actor.team();
    rows = rows.filter((r) => team.has(r.id));
  }
  const q = filters.q?.trim().toLowerCase();
  if (q) {
    rows = rows.filter((r) =>
      [r.name, r.legalName, r.employeeNumber, r.workEmail ?? "", r.jobTitle ?? ""].some((v) =>
        v.toLowerCase().includes(q),
      ),
    );
  }
  if (filters.departmentId) rows = rows.filter((r) => r.department?.id === filters.departmentId);
  if (filters.teamId) rows = rows.filter((r) => r.team?.id === filters.teamId);
  if (filters.locationId) rows = rows.filter((r) => r.location?.id === filters.locationId);
  if (filters.costCentreId) rows = rows.filter((r) => l.records.get(r.id)?.costCentreId === filters.costCentreId);
  if (filters.managerId) rows = rows.filter((r) => r.manager?.id === filters.managerId);
  if (filters.status?.length) rows = rows.filter((r) => filters.status?.includes(r.status.code));
  return rows;
}

// ---------------------------------------------------------------------------
// One employee

export interface EmployeeDetail {
  id: string;
  employeeNumber: string;
  name: string;
  legalName: string;
  preferredName: string | null;
  workEmail: string | null;
  status: EmploymentStatus;
  job: {
    effectiveFrom: string;
    jobTitle: string;
    department: { id: string; name: string } | null;
    team: { id: string; name: string } | null;
    location: { id: string; name: string } | null;
    manager: { id: string; name: string } | null;
  } | null;
  employment?: {
    costCentre: { id: string; name: string } | null;
    employmentType: string;
    workSchedule: { id: string; name: string } | null;
    probationEnd: string | null;
    eaCovered: boolean;
    isWorkman: boolean;
    tenures: {
      id: string;
      hireDate: string;
      lastWorkingDay: string | null;
      cessationReason: string | null;
      noticeDays: number | null;
    }[];
    history: {
      id: string;
      effectiveFrom: string;
      effectiveTo: string | null;
      jobTitle: string;
      department: string | null;
      team: string | null;
      location: string | null;
      manager: string | null;
      employmentType: string;
      eventId: string;
    }[];
    events: Awaited<ReturnType<typeof listEvents>>;
    directReports: { id: string; name: string }[];
  };
  personal?: {
    idType: string;
    idNumberMasked: string;
    dob: string;
    age: number;
    gender: string | null;
    nationality: string | null;
    residencyStatus: string;
    prStartDate: string | null;
    sprCpfOption: string | null;
    sprCpfOptionApprovedOn: string | null;
    race: string | null;
    raceSecondary: string | null;
    religion: string | null;
    shgOptOutOn: string | null;
    personalEmail: string | null;
    mobile: string | null;
    address: Employee["address"];
  };
  emergencyContacts?: { id: string; name: string; relationship: string; phone: string }[];
  workPasses?: WorkPassView[];
  compensation?: {
    current: CompensationView | null;
    history: CompensationView[];
    allowances: {
      id: string;
      allowanceTypeId: string;
      name: string;
      amountCents: number;
      effectiveFrom: string;
      effectiveTo: string | null;
    }[];
  };
  bank?: { current: BankView | null; history: BankView[] };
  /** Fields this reader may not see (sensitivity classes and sections). */
  redactedFields: string[];
}

export interface CompensationView {
  id: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  payBasis: "monthly" | "hourly";
  amountCents: number;
  reason: string | null;
  retroactive: boolean;
  eventId: string;
}

export interface BankView {
  id: string;
  bankCode: string;
  bankName: string;
  accountLast4: string;
  holderName: string;
  effectiveFrom: string;
  effectiveTo: string | null;
}

const SECTION_FIELDS: Partial<Record<Section, string>> = {
  employment: "employment",
  personal: "personal",
  emergency: "emergencyContacts",
  work_pass: "workPasses",
  compensation: "compensation",
  bank: "bank",
};

export async function getEmployee(deps: AppDeps, actor: Actor, employeeId: string): Promise<EmployeeDetail> {
  const { db } = deps;
  const orgId = actor.orgId;
  const [e] = await db
    .select()
    .from(employees)
    .where(and(eq(employees.orgId, orgId), eq(employees.id, employeeId)));
  if (!e) throw new AppError("not_found", "That employee record doesn't exist or you can't see it.");
  await assertCanRead(actor, "directory", employeeId);
  const today = singaporeToday(deps.clock.now());
  const sections = await readableSections(actor, employeeId);
  const names = await structureNames(db, orgId);
  const recs = await db
    .select()
    .from(employmentRecords)
    .where(and(eq(employmentRecords.orgId, orgId), eq(employmentRecords.employeeId, employeeId)))
    .orderBy(desc(employmentRecords.effectiveFrom));
  const ten = await db
    .select()
    .from(tenures)
    .where(and(eq(tenures.orgId, orgId), eq(tenures.employeeId, employeeId)))
    .orderBy(asc(tenures.hireDate));
  const current = findAsAt(recs, today) ?? recs.find((r) => r.effectiveFrom > today) ?? recs[0];
  const managerIds = [...new Set(recs.map((r) => r.managerEmployeeId).filter((x): x is string => !!x))];
  const managers = managerIds.length
    ? await db
        .select({ id: employees.id, legalName: employees.legalName, preferredName: employees.preferredName })
        .from(employees)
        .where(and(eq(employees.orgId, orgId), inArray(employees.id, managerIds)))
    : [];
  const mgrName = new Map(managers.map((m) => [m.id, displayName(m)]));

  const out: EmployeeDetail = {
    id: e.id,
    employeeNumber: e.employeeNumber,
    name: displayName(e),
    legalName: e.legalName,
    preferredName: e.preferredName,
    workEmail: e.workEmail,
    status: employmentStatus(ten, today),
    job: current
      ? {
          effectiveFrom: current.effectiveFrom,
          jobTitle: current.jobTitle,
          department: ref(names.departments, current.departmentId),
          team: ref(names.teams, current.teamId),
          location: ref(names.locations, current.locationId),
          manager: current.managerEmployeeId
            ? { id: current.managerEmployeeId, name: mgrName.get(current.managerEmployeeId) ?? "Unknown" }
            : null,
        }
      : null,
    redactedFields: [],
  };

  if (sections.has("employment")) {
    const reports = await db
      .select({ id: employees.id, legalName: employees.legalName, preferredName: employees.preferredName })
      .from(employmentRecords)
      .innerJoin(
        employees,
        and(eq(employees.orgId, employmentRecords.orgId), eq(employees.id, employmentRecords.employeeId)),
      )
      .where(
        and(
          eq(employmentRecords.orgId, orgId),
          eq(employmentRecords.managerEmployeeId, employeeId),
          inForceOn(employmentRecords, today),
        ),
      );
    out.employment = {
      costCentre: current ? ref(names.costCentres, current.costCentreId) : null,
      employmentType: current?.employmentType ?? "full_time",
      workSchedule: current ? ref(names.schedules, current.workScheduleId) : null,
      probationEnd: current?.probationEnd ?? null,
      eaCovered: current?.eaCovered ?? true,
      isWorkman: current?.isWorkman ?? false,
      tenures: ten.map((t) => ({
        id: t.id,
        hireDate: t.hireDate,
        lastWorkingDay: t.lastWorkingDay,
        cessationReason: t.cessationReason,
        noticeDays: t.noticeDays,
      })),
      history: recs.map((r) => ({
        id: r.id,
        effectiveFrom: r.effectiveFrom,
        effectiveTo: r.effectiveTo,
        jobTitle: r.jobTitle,
        department: names.departments.get(r.departmentId) ?? null,
        team: r.teamId ? (names.teams.get(r.teamId) ?? null) : null,
        location: r.locationId ? (names.locations.get(r.locationId) ?? null) : null,
        manager: r.managerEmployeeId ? (mgrName.get(r.managerEmployeeId) ?? null) : null,
        employmentType: r.employmentType,
        eventId: r.eventId,
      })),
      events: await listEvents(db, orgId, employeeId, today),
      directReports: reports.map((r) => ({ id: r.id, name: displayName(r) })),
    };
  }
  if (sections.has("personal")) {
    out.personal = {
      idType: e.idType,
      idNumberMasked: e.idNumberMasked,
      dob: e.dob,
      age: ageOn(e.dob, today),
      gender: e.gender,
      nationality: e.nationality,
      residencyStatus: e.residencyStatus,
      prStartDate: e.prStartDate,
      sprCpfOption: e.sprCpfOption,
      sprCpfOptionApprovedOn: e.sprCpfOptionApprovedOn,
      race: e.race,
      raceSecondary: e.raceSecondary,
      religion: e.religion,
      shgOptOutOn: e.shgOptOutOn,
      personalEmail: e.personalEmail,
      mobile: e.mobileE164,
      address: e.address,
    };
  }
  if (sections.has("emergency")) {
    const rows = await db
      .select()
      .from(emergencyContacts)
      .where(and(eq(emergencyContacts.orgId, orgId), eq(emergencyContacts.employeeId, employeeId)))
      .orderBy(asc(emergencyContacts.position));
    out.emergencyContacts = rows.map((c) => ({
      id: c.id,
      name: c.name,
      relationship: c.relationship,
      phone: c.phoneE164,
    }));
  }
  if (sections.has("work_pass")) {
    const rows = await db
      .select()
      .from(workPasses)
      .where(and(eq(workPasses.orgId, orgId), eq(workPasses.employeeId, employeeId)))
      .orderBy(desc(workPasses.expiresOn));
    out.workPasses = rows.map((p) => toPassView(p, today));
  }
  if (sections.has("compensation")) out.compensation = await compensationOf(db, orgId, employeeId, today);
  if (sections.has("bank")) out.bank = await bankOf(db, orgId, employeeId, today);
  for (const [section, field] of Object.entries(SECTION_FIELDS)) {
    if (!sections.has(section as Section)) out.redactedFields.push(field as string);
  }
  return out;
}

export async function compensationOf(db: Db, orgId: string, employeeId: string, today: string) {
  const rows = await db
    .select()
    .from(compensationRecords)
    .where(and(eq(compensationRecords.orgId, orgId), eq(compensationRecords.employeeId, employeeId)))
    .orderBy(desc(compensationRecords.effectiveFrom));
  const history: CompensationView[] = rows.map((r) => ({
    id: r.id,
    effectiveFrom: r.effectiveFrom,
    effectiveTo: r.effectiveTo,
    payBasis: r.payBasis,
    amountCents: r.amountCents,
    reason: r.reason,
    retroactive: r.retroactive,
    eventId: r.eventId,
  }));
  const allowances = await db
    .select({ a: recurringAllowances, name: allowanceTypes.name })
    .from(recurringAllowances)
    .innerJoin(
      allowanceTypes,
      and(
        eq(allowanceTypes.orgId, recurringAllowances.orgId),
        eq(allowanceTypes.id, recurringAllowances.allowanceTypeId),
      ),
    )
    .where(and(eq(recurringAllowances.orgId, orgId), eq(recurringAllowances.employeeId, employeeId)))
    .orderBy(desc(recurringAllowances.effectiveFrom));
  return {
    current: findAsAt(history, today) ?? null,
    history,
    allowances: allowances.map(({ a, name }) => ({
      id: a.id,
      allowanceTypeId: a.allowanceTypeId,
      name,
      amountCents: a.amountCents,
      effectiveFrom: a.effectiveFrom,
      effectiveTo: a.effectiveTo,
    })),
  };
}

export async function bankOf(db: Db, orgId: string, employeeId: string, today: string) {
  const rows = await db
    .select()
    .from(bankAccounts)
    .where(and(eq(bankAccounts.orgId, orgId), eq(bankAccounts.employeeId, employeeId)))
    .orderBy(desc(bankAccounts.effectiveFrom));
  const history: BankView[] = rows.map((b) => ({
    id: b.id,
    bankCode: b.bankCode,
    bankName: bankName(b.bankCode),
    accountLast4: b.accountLast4,
    holderName: b.holderName,
    effectiveFrom: b.effectiveFrom,
    effectiveTo: b.effectiveTo,
  }));
  return { current: findAsAt(history, today) ?? null, history };
}

/** 404 unless the employee exists in the actor's organisation. */
export async function assertEmployeeInOrg(db: Db, orgId: string, employeeId: string): Promise<void> {
  const [e] = await db
    .select({ id: employees.id })
    .from(employees)
    .where(and(eq(employees.orgId, orgId), eq(employees.id, employeeId)));
  if (!e) throw new AppError("not_found", "That employee record doesn't exist or you can't see it.");
}

/** Pending change requests for the employee themself (never shown to others). */
export async function pendingRequestsFor(db: Db, orgId: string, employeeId: string) {
  return db
    .select()
    .from(profileChangeRequests)
    .where(
      and(
        eq(profileChangeRequests.orgId, orgId),
        eq(profileChangeRequests.employeeId, employeeId),
        eq(profileChangeRequests.status, "pending"),
      ),
    )
    .orderBy(desc(profileChangeRequests.createdAt));
}
