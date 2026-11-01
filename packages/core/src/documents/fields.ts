import { and, asc, eq, isNull, or, sql } from "drizzle-orm";
import type { SensitivityClass } from "../access/sensitivity.ts";
import {
  allowanceTypes,
  compensationRecords,
  employees,
  employmentRecords,
  recurringAllowances,
  tenures,
} from "../db/schema/employees.ts";
import { leaveTypes } from "../db/schema/leave.ts";
import { companyProfiles, departments, locations, workScheduleVersions } from "../db/schema/organisation.ts";
import { organisations } from "../db/schema/organisations.ts";
import type { Db } from "../db/types.ts";
import { displayDate } from "../employees/dates.ts";
import { inForceOn } from "../employees/effective.ts";
import { displayName } from "../employees/records.ts";

/**
 * The merge-field whitelist (add-documents design decision 2). Every field has a label, a
 * sensitivity class (`salary` fields need salary read to generate), a hint saying where to fill it
 * when it has no value, and a resolver over the employee record as at a date. `terms.*` fields are
 * contract terms Crow HR doesn't hold: HR enters them for each document (recorded on it), or the
 * template states them in its own wording. Full NRIC/FIN is deliberately not a field.
 */

export interface FieldDef {
  id: string;
  label: string;
  group: string;
  sensitivity?: SensitivityClass;
  /** Where to fill it when it has no value, e.g. "set it on the employment record". */
  where: string;
  /** Entered by HR for each document (no stored value). */
  perDocument?: boolean;
}

export const FIELDS: readonly FieldDef[] = [
  { id: "org.legal_name", label: "Company legal name", group: "Company", where: "Settings → Company" },
  { id: "org.uen", label: "Company UEN", group: "Company", where: "Settings → Company" },
  { id: "org.address", label: "Company address", group: "Company", where: "Settings → Company" },
  {
    id: "employee.full_name",
    label: "Employee full name",
    group: "Employee",
    where: "the employee's personal details",
  },
  {
    id: "employee.preferred_name",
    label: "Preferred name",
    group: "Employee",
    where: "the employee's personal details",
  },
  { id: "employee.number", label: "Employee number", group: "Employee", where: "the employee record" },
  {
    id: "employee.nric_masked",
    label: "NRIC/FIN (masked)",
    group: "Employee",
    where: "the employee's personal details",
  },
  { id: "employee.address", label: "Home address", group: "Employee", where: "the employee's personal details" },
  { id: "employment.job_title", label: "Job title", group: "Employment", where: "the employment record" },
  { id: "employment.department", label: "Department", group: "Employment", where: "the employment record" },
  { id: "employment.location", label: "Location", group: "Employment", where: "the employment record" },
  {
    id: "employment.place_of_work",
    label: "Place of work",
    group: "Employment",
    where: "the employment record (location)",
  },
  { id: "employment.manager_name", label: "Manager", group: "Employment", where: "set it on the employment record" },
  { id: "employment.start_date", label: "Start date", group: "Employment", where: "the employment record" },
  { id: "employment.employment_type", label: "Employment type", group: "Employment", where: "the employment record" },
  {
    id: "employment.probation_end",
    label: "Probation end date",
    group: "Employment",
    where: "set it on the employment record",
  },
  {
    id: "employment.probation_period",
    label: "Probation period",
    group: "Employment",
    where: "set the probation end date on the employment record",
  },
  { id: "employment.working_days", label: "Working days a week", group: "Employment", where: "the work schedule" },
  { id: "employment.working_hours", label: "Daily working hours", group: "Employment", where: "the work schedule" },
  { id: "employment.rest_day", label: "Rest day", group: "Employment", where: "the work schedule" },
  {
    id: "employment.last_working_day",
    label: "Last working day",
    group: "Employment",
    where: "record the leaving on the employee",
  },
  {
    id: "employment.notice_period",
    label: "Notice period",
    group: "Employment",
    where: "enter it for this document, or record notice on the tenure",
    perDocument: true,
  },
  {
    id: "compensation.basic_pay",
    label: "Basic pay",
    group: "Pay",
    sensitivity: "salary",
    where: "the compensation record",
  },
  {
    id: "compensation.pay_basis",
    label: "Pay basis",
    group: "Pay",
    sensitivity: "salary",
    where: "the compensation record",
  },
  {
    id: "compensation.fixed_allowances",
    label: "Fixed allowances",
    group: "Pay",
    sensitivity: "salary",
    where: "the employee's recurring allowances",
  },
  {
    id: "terms.main_duties",
    label: "Main duties and responsibilities",
    group: "Contract terms",
    where: "enter it for this document",
    perDocument: true,
  },
  {
    id: "terms.duration",
    label: "Duration of employment",
    group: "Contract terms",
    where: "enter it for this document (fixed-term contracts)",
    perDocument: true,
  },
  {
    id: "terms.salary_period",
    label: "Salary period",
    group: "Contract terms",
    where: "enter it for this document",
    perDocument: true,
  },
  {
    id: "terms.fixed_deductions",
    label: "Fixed deductions",
    group: "Contract terms",
    where: "enter it for this document (write None if there are none)",
    perDocument: true,
  },
  {
    id: "terms.overtime_period",
    label: "Overtime payment period",
    group: "Contract terms",
    where: "enter it for this document",
    perDocument: true,
  },
  {
    id: "terms.overtime_rate",
    label: "Overtime rate",
    group: "Contract terms",
    where: "enter it for this document",
    perDocument: true,
  },
  {
    id: "terms.other_salary",
    label: "Other salary components (bonus, incentives)",
    group: "Contract terms",
    where: "enter it for this document (write None if there are none)",
    perDocument: true,
  },
  {
    id: "terms.leave_types",
    label: "Types of leave",
    group: "Contract terms",
    where: "Settings → Leave (leave types), or enter it for this document",
    perDocument: true,
  },
  {
    id: "terms.medical_benefits",
    label: "Medical benefits",
    group: "Contract terms",
    where: "enter it for this document",
    perDocument: true,
  },
  {
    id: "terms.effective_date",
    label: "Effective date of the change",
    group: "Contract terms",
    where: "enter it for this document",
    perDocument: true,
  },
  {
    id: "terms.purpose",
    label: "Purpose of the letter",
    group: "Contract terms",
    where: "enter it for this document",
    perDocument: true,
  },
  { id: "today", label: "Today's date", group: "General", where: "" },
  { id: "signatory.name", label: "Signatory name", group: "Signatory", where: "pick who signs" },
  {
    id: "signatory.title",
    label: "Signatory job title",
    group: "Signatory",
    where: "enter the signatory's job title",
    perDocument: true,
  },
];

const BY_ID = new Map(FIELDS.map((f) => [f.id, f]));

export function fieldDef(id: string): FieldDef | undefined {
  return BY_ID.get(id);
}

/** Common wrong guesses and what to use instead. */
const ALIASES: Record<string, string> = {
  "employee.salary": "compensation.basic_pay",
  "employee.basic_pay": "compensation.basic_pay",
  "employee.name": "employee.full_name",
  "employee.nric": "employee.nric_masked",
  "employee.fin": "employee.nric_masked",
  "employee.job_title": "employment.job_title",
  "employee.start_date": "employment.start_date",
  "employee.department": "employment.department",
  "org.name": "org.legal_name",
  "company.name": "org.legal_name",
  date: "today",
};

function distance(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)] as number[]);
  for (let j = 1; j <= b.length; j++) (d[0] as number[])[j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      (d[i] as number[])[j] = Math.min(
        ((d[i - 1] as number[])[j] as number) + 1,
        ((d[i] as number[])[j - 1] as number) + 1,
        ((d[i - 1] as number[])[j - 1] as number) + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
  return (d[a.length] as number[])[b.length] as number;
}

/** "Did you mean …?" for an unknown field. */
export function suggestField(id: string): string | null {
  if (ALIASES[id]) return ALIASES[id] as string;
  let best: { id: string; d: number } | null = null;
  for (const f of FIELDS) {
    const d = distance(id, f.id);
    if (!best || d < best.d) best = { id: f.id, d };
  }
  return best && best.d <= Math.max(3, Math.floor(id.length / 3)) ? best.id : null;
}

export interface ResolveInput {
  orgId: string;
  employeeId: string;
  asAt: string;
  today: string;
  signatoryName: string | null;
}

const EMPLOYMENT_TYPE: Record<string, string> = {
  full_time: "Full-time",
  part_time: "Part-time",
  contract: "Fixed-term contract",
  intern: "Internship",
};
const DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

/** `S$4,200.00` from integer cents. */
export function sgMoney(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  const dollars = Math.trunc(abs / 100)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${sign}S$${dollars}.${String(abs % 100).padStart(2, "0")}`;
}

function hoursText(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h} hours ${m} minutes` : `${h} hour${h === 1 ? "" : "s"}`;
}

function monthsBetween(from: string, to: string): number {
  const [fy, fm, fd] = from.split("-").map(Number) as [number, number, number];
  const [ty, tm, td] = to.split("-").map(Number) as [number, number, number];
  let months = (ty - fy) * 12 + (tm - fm);
  if (td + 1 < fd) months--;
  return months;
}

/** Resolves every field for one employee as at a date. Missing values are null. */
export async function resolveAllFields(db: Db, input: ResolveInput): Promise<Record<string, string | null>> {
  const { orgId, employeeId, asAt } = input;
  const [org] = await db.select().from(organisations).where(eq(organisations.id, orgId));
  const [profile] = await db.select().from(companyProfiles).where(eq(companyProfiles.orgId, orgId));
  const [emp] = await db
    .select()
    .from(employees)
    .where(and(eq(employees.orgId, orgId), eq(employees.id, employeeId)));
  const [tenure] = await db
    .select()
    .from(tenures)
    .where(and(eq(tenures.orgId, orgId), eq(tenures.employeeId, employeeId)))
    // The tenure in force on the date, else the next one (a future starter), else the latest.
    .orderBy(
      sql`case when ${tenures.hireDate} <= ${asAt} and (${tenures.lastWorkingDay} is null or ${tenures.lastWorkingDay} >= ${asAt}) then 0 when ${tenures.hireDate} > ${asAt} then 1 else 2 end`,
      sql`${tenures.hireDate} desc`,
    )
    .limit(1);
  // The employment record in force on the date, or the first one for a future starter.
  const [job] = await db
    .select()
    .from(employmentRecords)
    .where(
      and(
        eq(employmentRecords.orgId, orgId),
        eq(employmentRecords.employeeId, employeeId),
        or(inForceOn(employmentRecords, asAt), sql`${employmentRecords.effectiveFrom} > ${asAt}`),
      ),
    )
    .orderBy(
      sql`case when ${employmentRecords.effectiveFrom} <= ${asAt} then 0 else 1 end`,
      sql`${employmentRecords.effectiveFrom} desc`,
    )
    .limit(1);
  const on = job && job.effectiveFrom > asAt ? job.effectiveFrom : asAt;
  const [dept] = job
    ? await db
        .select()
        .from(departments)
        .where(and(eq(departments.orgId, orgId), eq(departments.id, job.departmentId)))
    : [];
  const [loc] = job?.locationId
    ? await db
        .select()
        .from(locations)
        .where(and(eq(locations.orgId, orgId), eq(locations.id, job.locationId)))
    : [];
  const [manager] = job?.managerEmployeeId
    ? await db
        .select()
        .from(employees)
        .where(and(eq(employees.orgId, orgId), eq(employees.id, job.managerEmployeeId)))
    : [];
  const [schedule] = job
    ? await db
        .select()
        .from(workScheduleVersions)
        .where(
          and(
            eq(workScheduleVersions.orgId, orgId),
            eq(workScheduleVersions.scheduleId, job.workScheduleId),
            inForceOn(workScheduleVersions, on),
          ),
        )
    : [];
  const [comp] = await db
    .select()
    .from(compensationRecords)
    .where(
      and(
        eq(compensationRecords.orgId, orgId),
        eq(compensationRecords.employeeId, employeeId),
        or(inForceOn(compensationRecords, on), sql`${compensationRecords.effectiveFrom} > ${on}`),
      ),
    )
    .orderBy(asc(compensationRecords.effectiveFrom))
    .limit(1);
  const allowances = await db
    .select({ name: allowanceTypes.name, amountCents: recurringAllowances.amountCents })
    .from(recurringAllowances)
    .innerJoin(
      allowanceTypes,
      and(
        eq(allowanceTypes.orgId, recurringAllowances.orgId),
        eq(allowanceTypes.id, recurringAllowances.allowanceTypeId),
      ),
    )
    .where(
      and(
        eq(recurringAllowances.orgId, orgId),
        eq(recurringAllowances.employeeId, employeeId),
        inForceOn(recurringAllowances, on),
      ),
    );
  const leave = await db
    .select({ name: leaveTypes.name })
    .from(leaveTypes)
    .where(and(eq(leaveTypes.orgId, orgId), isNull(leaveTypes.archivedAt)))
    .orderBy(asc(leaveTypes.sortOrder), asc(leaveTypes.name));

  const addr = (
    a:
      | {
          block?: string | null;
          street?: string | null;
          unit?: string | null;
          building?: string | null;
          postalCode?: string | null;
        }
      | null
      | undefined,
  ) => {
    if (!a) return null;
    const line = [a.block, a.street].filter(Boolean).join(" ");
    const parts = [line, a.unit, a.building, a.postalCode ? `Singapore ${a.postalCode}` : null].filter(Boolean);
    return parts.length ? parts.join(", ") : null;
  };
  const days = schedule?.days ?? null;
  const working = days
    ? days
        .map((d, i) => ({ ...d, name: DAY_NAMES[i] as string }))
        .filter((d) => d.type === "working" || d.type === "half")
    : [];
  const rest = days
    ? days.map((d, i) => ({ ...d, name: DAY_NAMES[i] as string })).filter((d) => d.type === "rest")
    : [];
  const workingDays = working.reduce((a, d) => a + (d.type === "half" ? 0.5 : 1), 0);
  const fullDayMinutes = working.find((d) => d.type === "working")?.minutes ?? null;
  const probationMonths = tenure && job?.probationEnd ? monthsBetween(tenure.hireDate, job.probationEnd) : null;

  return {
    "org.legal_name": profile?.legalName ?? org?.name ?? null,
    "org.uen": profile?.uen ?? null,
    "org.address": profile
      ? addr({
          block: profile.addressBlock,
          street: profile.addressStreet,
          unit: profile.addressUnit,
          building: profile.addressBuilding,
          postalCode: profile.postalCode,
        })
      : null,
    "employee.full_name": emp?.legalName ?? null,
    "employee.preferred_name": emp ? emp.preferredName || emp.legalName : null,
    "employee.number": emp?.employeeNumber ?? null,
    "employee.nric_masked": emp?.idNumberMasked ?? null,
    "employee.address": addr(emp?.address),
    "employment.job_title": job?.jobTitle ?? null,
    "employment.department": dept?.name ?? null,
    "employment.location": loc?.name ?? null,
    "employment.place_of_work": loc?.name ?? null,
    "employment.manager_name": manager ? displayName(manager) : null,
    "employment.start_date": tenure ? displayDate(tenure.hireDate) : null,
    "employment.employment_type": job ? (EMPLOYMENT_TYPE[job.employmentType] ?? job.employmentType) : null,
    "employment.probation_end": job?.probationEnd ? displayDate(job.probationEnd) : null,
    "employment.probation_period":
      probationMonths !== null && probationMonths > 0
        ? `${probationMonths} month${probationMonths === 1 ? "" : "s"}, ending ${displayDate(job?.probationEnd as string)}`
        : null,
    "employment.working_days": working.length
      ? `${workingDays} days a week (${working.map((d) => (d.type === "half" ? `${d.name} half day` : d.name)).join(", ")})`
      : null,
    "employment.working_hours": fullDayMinutes ? `${hoursText(fullDayMinutes)} a day` : null,
    "employment.rest_day": rest.length ? rest.map((d) => d.name).join(" and ") : null,
    "employment.last_working_day": tenure?.lastWorkingDay ? displayDate(tenure.lastWorkingDay) : null,
    "employment.notice_period": tenure?.noticeDays ? `${tenure.noticeDays} days` : null,
    "compensation.basic_pay": comp
      ? `${sgMoney(comp.amountCents)} ${comp.payBasis === "monthly" ? "a month" : comp.payBasis === "hourly" ? "an hour" : "a day"}`
      : null,
    "compensation.pay_basis": comp
      ? (({ monthly: "Monthly", hourly: "Hourly", daily: "Daily" } as Record<string, string>)[comp.payBasis] ??
        comp.payBasis)
      : null,
    "compensation.fixed_allowances": comp
      ? allowances.length
        ? allowances.map((a) => `${a.name} ${sgMoney(a.amountCents)} a month`).join("; ")
        : "None"
      : null,
    "terms.main_duties": null,
    "terms.duration":
      job && job.employmentType !== "contract" ? "Not applicable: this employment has no fixed end date." : null,
    "terms.salary_period":
      comp?.payBasis === "monthly" ? "Monthly, from the first to the last day of each calendar month" : null,
    "terms.fixed_deductions": null,
    "terms.overtime_period": null,
    "terms.overtime_rate": null,
    "terms.other_salary": null,
    "terms.leave_types": leave.length ? leave.map((l) => l.name).join(", ") : null,
    "terms.medical_benefits": null,
    "terms.effective_date": null,
    "terms.purpose": null,
    today: displayDate(input.today),
    "signatory.name": input.signatoryName,
    "signatory.title": null,
  };
}
