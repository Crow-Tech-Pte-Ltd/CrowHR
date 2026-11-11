import { isPart4Covered } from "@crowhr/sg-rules";
import { and, asc, eq, gte, inArray, isNotNull, lt, lte, sql } from "drizzle-orm";
import { orgScope } from "../access/org-scope.ts";
import { singaporeDate } from "../access/scope.ts";
import { type AuditContext, recordAudit } from "../audit/audit.ts";
import { compensationRecords, tenures } from "../db/schema/employees.ts";
import {
  type LeaveType,
  leaveLedger,
  leaveRequestDays,
  leaveRequests,
  leaveTypes,
  leaveYearClosings,
} from "../db/schema/leave.ts";
import type { Db } from "../db/types.ts";
import type { AppDeps } from "../deps.ts";
import { findAsAt } from "../employees/effective.ts";
import type { Transition } from "../workflows/types.ts";
import { childrenOf, computeBalance } from "./balances.ts";
import { type EmployeeTime, employmentNear, loadEmployeesTime, scheduleOn } from "./calendar.ts";
import { PER_CHILD_CODES } from "./defaults.ts";
import { entitlementFor } from "./entitlement.ts";

/**
 * Year-end processing (spec "Year-end processing", design decision 9). Runs on every `tick`:
 * - once per organisation and closed year (claimed by inserting `leave_year_closings`): carry the
 *   unused balance into the next year up to the policy cap (Part 4 employees: at least their unused
 *   statutory annual leave), and forfeit or mark for encashment the rest;
 * - expire carried-forward days not taken by the expiry date, using carried days first.
 * Every ledger row has a `source_ref`, so a re-run (or a second replica) changes nothing.
 */

function addMonths(date: string, months: number): string {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const i = y * 12 + (m - 1) + months;
  return `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** Hours in the employee's average working day (for day caps on hour-based balances). */
function hoursPerDay(t: EmployeeTime, date: string): number {
  const s = scheduleOn(t, date);
  const days = s?.version.days;
  if (!days) return 8;
  const working = days.filter((d) => d.type === "working");
  return working.length ? working.reduce((a, d) => a + d.minutes, 0) / working.length / 60 : 8;
}

async function isPart4(db: Db, t: EmployeeTime, date: string): Promise<boolean> {
  const org = orgScope(db, t.orgId);
  const rows = await db
    .select()
    .from(compensationRecords)
    .where(org.where(compensationRecords, eq(compensationRecords.employeeId, t.employeeId)))
    .orderBy(asc(compensationRecords.effectiveFrom));
  const comp = findAsAt(rows, date) ?? rows.at(-1);
  const emp = employmentNear(t, date);
  if (comp?.payBasis !== "monthly" || !emp?.eaCovered) return false;
  return isPart4Covered({
    date,
    monthlyBasicCents: comp.amountCents,
    isWorkman: emp.isWorkman,
    isManagerOrExecutive: emp.isManagerOrExecutive,
  }).covered;
}

const carries = (type: LeaveType) =>
  !type.archivedAt &&
  type.policy.entitlement.basis !== "unlimited" &&
  !(type.statutoryCode && PER_CHILD_CODES.has(type.statutoryCode)) &&
  (type.policy.carryForward !== null || type.policy.encashable || type.statutoryCode === "annual");

export async function closeLeaveYear(
  db: Db,
  deps: AppDeps,
  audit: AuditContext,
  orgId: string,
  year: number,
): Promise<number | null> {
  const [claimed] = await db
    .insert(leaveYearClosings)
    .values({ orgId, year })
    .onConflictDoNothing()
    .returning({ year: leaveYearClosings.year });
  if (!claimed) return null;
  const org = orgScope(db, orgId);
  const types = (await db.select().from(leaveTypes).where(org.where(leaveTypes))).filter(carries);
  const yearEnd = `${year}-12-31`;
  const next = `${year + 1}-01-01`;
  // Employees employed at some point in the year and still employed on 1 Jan of the next.
  const staff = await db
    .select({ employeeId: tenures.employeeId })
    .from(tenures)
    .where(
      org.where(
        tenures,
        lte(tenures.hireDate, yearEnd),
        sql`(${tenures.lastWorkingDay} is null or ${tenures.lastWorkingDay} >= ${next})`,
      ),
    );
  const times = await loadEmployeesTime(
    db,
    orgId,
    staff.map((s) => s.employeeId),
  );
  let processed = 0;
  for (const t of times.values()) {
    const children = await childrenOf(db, orgId, t.employeeId);
    let part4: boolean | null = null;
    for (const type of types) {
      const b = await computeBalance(db, t, type, { year, asOf: next, children, types });
      if (!b.tracked || b.available === null || b.available <= 0) continue;
      const remaining = b.available;
      const policy = type.policy.carryForward;
      const perDay = b.unit === "hours" ? Math.round(hoursPerDay(t, yearEnd) * 100) : 100;
      let carry = policy
        ? policy.maxDays === null
          ? remaining
          : Math.min(remaining, Math.round(policy.maxDays * perDay))
        : 0;
      if (type.statutoryCode === "annual") {
        part4 ??= await isPart4(db, t, yearEnd);
        if (part4) {
          // Part 4: unused statutory leave must be allowed to carry forward for 12 months.
          const statutory = entitlementFor(
            t,
            { ...type, policy: { ...type.policy, entitlement: { basis: "statutory" } } },
            {
              year,
              asOf: next,
              children,
            },
          );
          carry = Math.max(carry, Math.min(remaining, statutory.hundredths));
        }
      }
      const excess = remaining - carry;
      const ref = (what: string) => `ye:${year}:${t.employeeId}:${type.id}:${what}`;
      const row = (
        y: number,
        kind: "carry_forward" | "forfeit" | "encashment",
        hundredths: number,
        what: string,
        expiresOn: string | null = null,
      ) =>
        db
          .insert(leaveLedger)
          .values({
            id: deps.ids.newId(),
            orgId,
            employeeId: t.employeeId,
            leaveTypeId: type.id,
            leaveYear: y,
            kind,
            unit: b.unit,
            hundredths,
            sourceRef: ref(what),
            expiresOn,
            reason: `Year-end ${year}`,
          })
          .onConflictDoNothing();
      if (carry > 0) {
        // MOM: Part IV annual leave remains available for the next 12 months, even if
        // company policy expires discretionary carry earlier.
        // https://www.mom.gov.sg/employment-practices/leave/annual-leave/special-situations
        // A policy without an expiry ("never expires") is more generous still and stays open-ended.
        const months =
          part4 && type.statutoryCode === "annual" && !(policy && policy.expiresAfterMonths === null)
            ? Math.max(12, policy?.expiresAfterMonths ?? 12)
            : (policy?.expiresAfterMonths ?? null);
        await row(year, "carry_forward", -carry, "out");
        await row(year + 1, "carry_forward", carry, "in", months ? addMonths(next, months) : null);
      }
      if (excess > 0) {
        await row(
          year,
          type.policy.encashable ? "encashment" : "forfeit",
          -excess,
          type.policy.encashable ? "encash" : "forfeit",
        );
      }
    }
    processed++;
  }
  await db
    .update(leaveYearClosings)
    .set({ employees: processed })
    .where(and(eq(leaveYearClosings.orgId, orgId), eq(leaveYearClosings.year, year)));
  await recordAudit(db, deps, audit, {
    action: "leave.year_closed",
    targetType: "organisation",
    targetId: orgId,
    meta: { year, employees: processed },
  });
  return processed;
}

/** Expires carried-forward days whose expiry date has passed (carried days are used first). */
export async function expireCarryForward(db: Db, deps: AppDeps, today: string): Promise<number> {
  const due = await db
    .select()
    .from(leaveLedger)
    .where(
      and(
        eq(leaveLedger.kind, "carry_forward"),
        isNotNull(leaveLedger.expiresOn),
        lte(leaveLedger.expiresOn, today),
        sql`${leaveLedger.hundredths} > 0`,
        sql`not exists (select 1 from leave_ledger e where e.org_id = ${leaveLedger.orgId} and e.source_ref = 'exp:' || ${leaveLedger.id}::text)`,
      ),
    );
  let count = 0;
  for (const carry of due) {
    const expiresOn = carry.expiresOn as string;
    const [used] = await db
      .select({ total: sql<number>`coalesce(sum(${leaveRequestDays.hundredths}), 0)::int` })
      .from(leaveRequestDays)
      .innerJoin(
        leaveRequests,
        and(eq(leaveRequests.orgId, leaveRequestDays.orgId), eq(leaveRequests.id, leaveRequestDays.requestId)),
      )
      .where(
        and(
          eq(leaveRequestDays.orgId, carry.orgId),
          eq(leaveRequestDays.employeeId, carry.employeeId),
          eq(leaveRequestDays.leaveTypeId, carry.leaveTypeId),
          eq(leaveRequestDays.leaveYear, carry.leaveYear),
          gte(leaveRequestDays.date, `${carry.leaveYear}-01-01`),
          lt(leaveRequestDays.date, expiresOn),
          inArray(leaveRequests.status, ["approved", "cancellation_pending"]),
        ),
      );
    const expired = Math.max(0, carry.hundredths - Number(used?.total ?? 0));
    await db
      .insert(leaveLedger)
      .values({
        id: deps.ids.newId(),
        orgId: carry.orgId,
        employeeId: carry.employeeId,
        leaveTypeId: carry.leaveTypeId,
        leaveYear: carry.leaveYear,
        kind: "expiry",
        unit: carry.unit,
        hundredths: -expired,
        sourceRef: `exp:${carry.id}`,
        reason: `Carried-forward leave expired on ${expiresOn}`,
      })
      .onConflictDoNothing();
    count++;
  }
  return count;
}

export function leaveYearEndTransition(deps: AppDeps): Transition {
  return {
    id: "leave_year_end",
    async run(_db, input) {
      const today = singaporeDate(input.now);
      const year = Number(today.slice(0, 4)) - 1;
      // Only years the organisation used Crow HR leave in: a first install mid-year must not carry
      // a whole computed year of untaken leave forward.
      const orgs = await deps.db
        .select({
          orgId: leaveTypes.orgId,
          since: sql<number>`extract(year from min(${leaveTypes.createdAt}) at time zone 'Asia/Singapore')::int`,
        })
        .from(leaveTypes)
        .where(
          sql`not exists (select 1 from leave_year_closings c where c.org_id = ${leaveTypes.orgId} and c.year = ${year})`,
        )
        .groupBy(leaveTypes.orgId);
      // Expire old carry before calculating the closed year's remaining balance. Otherwise
      // a delayed January tick carries already-expired days forward a second time.
      let n = await deps.db.transaction((tx) => expireCarryForward(tx, deps, today));
      for (const { orgId, since } of orgs) {
        if (Number(since) > year) continue;
        const done = await deps.db.transaction((tx) => closeLeaveYear(tx, deps, input.audit(orgId), orgId, year));
        if (done !== null) n++;
      }
      n += await deps.db.transaction((tx) => expireCarryForward(tx, deps, today));
      return n;
    },
  };
}
