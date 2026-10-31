import { and, eq, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { orgScope } from "../../access/org-scope.ts";
import { employees, employmentRecords, tenures, workPasses } from "../../db/schema/employees.ts";
import { departments, locations } from "../../db/schema/organisation.ts";
import type { Db } from "../../db/types.ts";
import { inForceOn } from "../effective.ts";
import { displayName } from "../records.ts";

/**
 * People facts for reports, as at a date. Headcount counts employees with a tenure where
 * hire date ≤ date and (no last working day, or last working day ≥ date) (add-reporting spec
 * "Headcount report"); department, location and employment type come from the employment record in
 * force on that date.
 */
export interface HeadcountMember {
  employeeId: string;
  employeeNumber: string;
  name: string;
  department: string;
  location: string | null;
  employmentType: string;
  residency: string;
  passType: string | null;
}

export async function membersOn(
  db: Db,
  orgId: string,
  date: string,
  scope: ReadonlySet<string> | null,
): Promise<HeadcountMember[]> {
  if (scope && scope.size === 0) return [];
  const org = orgScope(db, orgId);
  const rows = await db
    .select({
      employeeId: employees.id,
      employeeNumber: employees.employeeNumber,
      legalName: employees.legalName,
      preferredName: employees.preferredName,
      residency: employees.residencyStatus,
      department: departments.name,
      location: locations.name,
      employmentType: employmentRecords.employmentType,
    })
    .from(tenures)
    .innerJoin(employees, and(eq(employees.orgId, tenures.orgId), eq(employees.id, tenures.employeeId)))
    .leftJoin(
      employmentRecords,
      and(
        eq(employmentRecords.orgId, tenures.orgId),
        eq(employmentRecords.employeeId, tenures.employeeId),
        inForceOn(employmentRecords, date),
      ),
    )
    .leftJoin(
      departments,
      and(eq(departments.orgId, employmentRecords.orgId), eq(departments.id, employmentRecords.departmentId)),
    )
    .leftJoin(
      locations,
      and(eq(locations.orgId, employmentRecords.orgId), eq(locations.id, employmentRecords.locationId)),
    )
    .where(
      org.where(
        tenures,
        lte(tenures.hireDate, date),
        or(isNull(tenures.lastWorkingDay), sql`${tenures.lastWorkingDay} >= ${date}`),
        scope ? inArray(tenures.employeeId, [...scope]) : undefined,
      ),
    );
  const ids = [...new Set(rows.map((r) => r.employeeId))];
  const passes = ids.length
    ? await db
        .select({ employeeId: workPasses.employeeId, passType: workPasses.passType, expiresOn: workPasses.expiresOn })
        .from(workPasses)
        .where(
          org.where(
            workPasses,
            inArray(workPasses.employeeId, ids),
            or(isNull(workPasses.cancelledOn), sql`${workPasses.cancelledOn} > ${date}`),
            sql`coalesce(${workPasses.issuedOn}, '0001-01-01') <= ${date}`,
          ),
        )
    : [];
  const passOf = new Map<string, { passType: string; expiresOn: string }>();
  for (const p of passes) {
    const cur = passOf.get(p.employeeId);
    if (!cur || p.expiresOn > cur.expiresOn) passOf.set(p.employeeId, p);
  }
  const seen = new Set<string>();
  const out: HeadcountMember[] = [];
  for (const r of rows) {
    if (seen.has(r.employeeId)) continue;
    seen.add(r.employeeId);
    out.push({
      employeeId: r.employeeId,
      employeeNumber: r.employeeNumber,
      name: displayName({ legalName: r.legalName, preferredName: r.preferredName }),
      department: r.department ?? "No department",
      location: r.location ?? null,
      employmentType: r.employmentType ?? "full_time",
      residency: r.residency,
      passType: passOf.get(r.employeeId)?.passType ?? null,
    });
  }
  return out;
}

export interface TenureEvent {
  employeeId: string;
  employeeNumber: string;
  name: string;
  department: string;
  date: string;
  kind: "joiner" | "leaver";
  cessationReason: string | null;
}

/** Joiners (hire date in range) and leavers (last working day in range), both inclusive. */
export async function tenureEventsBetween(
  db: Db,
  orgId: string,
  from: string,
  to: string,
  scope: ReadonlySet<string> | null,
): Promise<TenureEvent[]> {
  if (scope && scope.size === 0) return [];
  const org = orgScope(db, orgId);
  const rows = await db
    .select({
      employeeId: tenures.employeeId,
      hireDate: tenures.hireDate,
      lastWorkingDay: tenures.lastWorkingDay,
      cessationReason: tenures.cessationReason,
      employeeNumber: employees.employeeNumber,
      legalName: employees.legalName,
      preferredName: employees.preferredName,
    })
    .from(tenures)
    .innerJoin(employees, and(eq(employees.orgId, tenures.orgId), eq(employees.id, tenures.employeeId)))
    .where(
      org.where(
        tenures,
        or(
          and(sql`${tenures.hireDate} >= ${from}`, sql`${tenures.hireDate} <= ${to}`),
          and(sql`${tenures.lastWorkingDay} >= ${from}`, sql`${tenures.lastWorkingDay} <= ${to}`),
        ),
        scope ? inArray(tenures.employeeId, [...scope]) : undefined,
      ),
    );
  const out: TenureEvent[] = [];
  const deptCache = new Map<string, string>();
  const deptOn = async (employeeId: string, date: string) => {
    const key = `${employeeId}:${date}`;
    const hit = deptCache.get(key);
    if (hit) return hit;
    const [row] = await db
      .select({ name: departments.name })
      .from(employmentRecords)
      .innerJoin(
        departments,
        and(eq(departments.orgId, employmentRecords.orgId), eq(departments.id, employmentRecords.departmentId)),
      )
      .where(
        org.where(
          employmentRecords,
          eq(employmentRecords.employeeId, employeeId),
          lte(employmentRecords.effectiveFrom, date),
        ),
      )
      .orderBy(sql`${employmentRecords.effectiveFrom} desc`)
      .limit(1);
    const name = row?.name ?? "No department";
    deptCache.set(key, name);
    return name;
  };
  for (const r of rows) {
    const name = displayName({ legalName: r.legalName, preferredName: r.preferredName });
    if (r.hireDate >= from && r.hireDate <= to) {
      out.push({
        employeeId: r.employeeId,
        employeeNumber: r.employeeNumber,
        name,
        department: await deptOn(r.employeeId, r.hireDate),
        date: r.hireDate,
        kind: "joiner",
        cessationReason: null,
      });
    }
    if (r.lastWorkingDay && r.lastWorkingDay >= from && r.lastWorkingDay <= to) {
      out.push({
        employeeId: r.employeeId,
        employeeNumber: r.employeeNumber,
        name,
        department: await deptOn(r.employeeId, r.lastWorkingDay),
        date: r.lastWorkingDay,
        kind: "leaver",
        cessationReason: r.cessationReason ?? null,
      });
    }
  }
  return out;
}

export interface PassRow {
  employeeId: string;
  employeeNumber: string;
  name: string;
  passType: string;
  passNumberMasked: string | null;
  expiresOn: string;
}

/** Current (not cancelled) passes of employees still employed on `today`, expiring on or before `until`. */
export async function passesExpiring(
  db: Db,
  orgId: string,
  today: string,
  until: string,
  scope: ReadonlySet<string> | null,
): Promise<PassRow[]> {
  if (scope && scope.size === 0) return [];
  const current = await membersOn(db, orgId, today, scope);
  const ids = current.map((m) => m.employeeId);
  if (!ids.length) return [];
  const org = orgScope(db, orgId);
  const rows = await db
    .select()
    .from(workPasses)
    .where(
      org.where(
        workPasses,
        inArray(workPasses.employeeId, ids),
        or(isNull(workPasses.cancelledOn), sql`${workPasses.cancelledOn} > ${today}`),
        lte(workPasses.expiresOn, until),
      ),
    );
  // Only each employee's latest pass: a renewed pass replaces the old one.
  const latest = await db
    .select({ employeeId: workPasses.employeeId, max: sql<string>`max(${workPasses.expiresOn})::text` })
    .from(workPasses)
    .where(
      org.where(
        workPasses,
        inArray(workPasses.employeeId, ids),
        or(isNull(workPasses.cancelledOn), sql`${workPasses.cancelledOn} > ${today}`),
      ),
    )
    .groupBy(workPasses.employeeId);
  const maxOf = new Map(latest.map((l) => [l.employeeId, l.max]));
  const byId = new Map(current.map((m) => [m.employeeId, m]));
  return rows
    .filter((p) => maxOf.get(p.employeeId) === p.expiresOn)
    .map((p) => {
      const m = byId.get(p.employeeId) as HeadcountMember;
      return {
        employeeId: p.employeeId,
        employeeNumber: m.employeeNumber,
        name: m.name,
        passType: p.passType,
        passNumberMasked: p.passNumberMasked,
        expiresOn: p.expiresOn,
      };
    });
}
