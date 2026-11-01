import { and, asc, eq, inArray, ne, sql } from "drizzle-orm";
import { orgScope } from "../access/org-scope.ts";
import {
  type LeaveChild,
  type LeaveLedgerKind,
  type LeaveType,
  type LeaveUnit,
  leaveChildren,
  leaveEncashments,
  leaveLedger,
  leaveRequestDays,
  leaveRequests,
  leaveTypes,
} from "../db/schema/leave.ts";
import type { Db } from "../db/types.ts";
import { addDays } from "../employees/dates.ts";
import { dayInfo, type EmployeeTime, latestTenureBy } from "./calendar.ts";
import { NEEDS_CHILD_CODES, PER_CHILD_CODES } from "./defaults.ts";
import { entitlementFor } from "./entitlement.ts";

/**
 * Balances = computed entitlement + ledger movements − pending (design decision 2), with
 * outpatient sick days counting against hospitalisation (spec "Entitlements and balances").
 */

export interface Balance {
  typeId: string;
  code: string;
  name: string;
  statutoryCode: string | null;
  unit: LeaveUnit;
  tracked: boolean;
  eligible: boolean;
  eligibleFrom: string | null;
  year: number;
  childId: string | null;
  entitlement: number;
  carriedForward: number;
  /** Carried-forward days expired, forfeited or encashed (positive). */
  expired: number;
  adjustments: number;
  taken: number;
  pending: number;
  /** Null when not tracked. */
  available: number | null;
  carryExpiresOn: string | null;
  explanation: string[];
}

type Sums = Record<LeaveLedgerKind, number>;
const emptySums = (): Sums => ({
  carry_forward: 0,
  expiry: 0,
  forfeit: 0,
  encashment: 0,
  adjustment: 0,
  taken: 0,
  restored: 0,
});

interface Scope {
  year: number;
  childId?: string | null;
}

async function ledgerSums(
  db: Db,
  t: EmployeeTime,
  typeIds: string[],
  scope: Scope,
): Promise<{ sums: Sums; expires: string | null }> {
  const org = orgScope(db, t.orgId);
  const rows = await db
    .select({
      kind: leaveLedger.kind,
      total: sql<number>`coalesce(sum(${leaveLedger.hundredths}), 0)::int`,
      expires: sql<string | null>`max(${leaveLedger.expiresOn})::text`,
    })
    .from(leaveLedger)
    .where(
      org.where(
        leaveLedger,
        eq(leaveLedger.employeeId, t.employeeId),
        inArray(leaveLedger.leaveTypeId, typeIds),
        scope.childId ? eq(leaveLedger.childId, scope.childId) : eq(leaveLedger.leaveYear, scope.year),
      ),
    )
    .groupBy(leaveLedger.kind);
  const sums = emptySums();
  let expires: string | null = null;
  for (const r of rows) {
    sums[r.kind] = Number(r.total);
    if (r.kind === "carry_forward") expires = r.expires;
  }
  return { sums, expires };
}

async function pendingSum(
  db: Db,
  t: EmployeeTime,
  typeIds: string[],
  scope: Scope,
  excludeRequestId?: string,
): Promise<number> {
  const org = orgScope(db, t.orgId);
  const [row] = await db
    .select({ total: sql<number>`coalesce(sum(${leaveRequestDays.hundredths}), 0)::int` })
    .from(leaveRequestDays)
    .innerJoin(
      leaveRequests,
      and(eq(leaveRequests.orgId, leaveRequestDays.orgId), eq(leaveRequests.id, leaveRequestDays.requestId)),
    )
    .where(
      org.where(
        leaveRequestDays,
        eq(leaveRequestDays.employeeId, t.employeeId),
        inArray(leaveRequestDays.leaveTypeId, typeIds),
        eq(leaveRequests.status, "pending"),
        scope.childId ? eq(leaveRequests.childId, scope.childId) : eq(leaveRequestDays.leaveYear, scope.year),
        excludeRequestId ? ne(leaveRequests.id, excludeRequestId) : undefined,
      ),
    );
  return Number(row?.total ?? 0);
}

/** Months of service excluded for no-pay leave, per the org's rule (MOM: unpaid leave is not service). */
export async function excludedServiceMonths(db: Db, t: EmployeeTime, asOf: string): Promise<number> {
  const rule = t.settings.unpaidServiceRule;
  if (rule === "none") return 0;
  const org = orgScope(db, t.orgId);
  const hire = latestTenureBy(t, asOf)?.hireDate;
  if (!hire) return 0;
  const days = await db
    .select({ date: leaveRequestDays.date, hundredths: leaveRequestDays.hundredths })
    .from(leaveRequestDays)
    .innerJoin(
      leaveRequests,
      and(eq(leaveRequests.orgId, leaveRequestDays.orgId), eq(leaveRequests.id, leaveRequestDays.requestId)),
    )
    .innerJoin(leaveTypes, and(eq(leaveTypes.orgId, leaveRequests.orgId), eq(leaveTypes.id, leaveRequests.leaveTypeId)))
    .where(
      org.where(
        leaveRequestDays,
        eq(leaveRequestDays.employeeId, t.employeeId),
        eq(leaveTypes.statutoryCode, "no_pay"),
        inArray(leaveRequests.status, ["approved", "cancellation_pending"]),
        sql`${leaveRequestDays.date} >= ${hire} and ${leaveRequestDays.date} < ${asOf}`,
      ),
    )
    .orderBy(asc(leaveRequestDays.date));
  const byMonth = new Map<string, number>();
  for (const d of days)
    if (d.hundredths > 0) byMonth.set(d.date.slice(0, 7), (byMonth.get(d.date.slice(0, 7)) ?? 0) + d.hundredths);
  if (rule === "any_day") return byMonth.size;
  let whole = 0;
  for (const [month, taken] of byMonth) {
    let working = 0;
    for (let d = `${month}-01`; d.startsWith(month); d = addDays(d, 1)) {
      const info = dayInfo(t, d);
      if (info.dayType === "working" || info.dayType === "shift") working += info.holiday ? 0 : 100;
      if (info.dayType === "half") working += info.holiday ? 0 : 50;
    }
    if (working > 0 && taken >= working) whole++;
  }
  return whole;
}

export async function childrenOf(db: Db, orgId: string, employeeId: string): Promise<LeaveChild[]> {
  const org = orgScope(db, orgId);
  return db
    .select()
    .from(leaveChildren)
    .where(org.where(leaveChildren, eq(leaveChildren.employeeId, employeeId)))
    .orderBy(asc(leaveChildren.birthOrder));
}

export interface BalanceOptions {
  year: number;
  asOf: string;
  childId?: string | null;
  children?: readonly LeaveChild[];
  /** Approval re-check: don't count this request as pending. */
  excludeRequestId?: string;
  excludeEncashmentId?: string;
  /** All org types (to find the hospitalisation pool). */
  types?: readonly LeaveType[];
}

export async function computeBalance(db: Db, t: EmployeeTime, type: LeaveType, opts: BalanceOptions): Promise<Balance> {
  const children = opts.children ?? (await childrenOf(db, t.orgId, t.employeeId));
  const child = opts.childId ? (children.find((c) => c.id === opts.childId) ?? null) : null;
  const perChild = !!type.statutoryCode && PER_CHILD_CODES.has(type.statutoryCode);
  const excludedMonths = type.statutoryCode === "annual" ? await excludedServiceMonths(db, t, opts.asOf) : 0;
  const ent = entitlementFor(t, type, { year: opts.year, asOf: opts.asOf, child, children, excludedMonths });
  const scope: Scope = perChild
    ? { year: opts.year, childId: child?.id ?? "00000000-0000-0000-0000-000000000000" }
    : { year: opts.year };
  const own = await ledgerSums(db, t, [type.id], scope);
  const [encashment] = await db
    .select({ total: sql<number>`coalesce(sum(${leaveEncashments.hundredths}), 0)::int` })
    .from(leaveEncashments)
    .where(
      orgScope(db, t.orgId).where(
        leaveEncashments,
        eq(leaveEncashments.employeeId, t.employeeId),
        eq(leaveEncashments.leaveTypeId, type.id),
        eq(leaveEncashments.leaveYear, opts.year),
        eq(leaveEncashments.status, "pending"),
        sql`${leaveEncashments.ledgerEntryId} is null`,
        opts.excludeEncashmentId ? ne(leaveEncashments.id, opts.excludeEncashmentId) : undefined,
      ),
    );
  const pending = (await pendingSum(db, t, [type.id], scope, opts.excludeRequestId)) + Number(encashment?.total ?? 0);
  const carried = own.sums.carry_forward;
  const expired = -(own.sums.expiry + own.sums.forfeit + own.sums.encashment);
  const taken = -(own.sums.taken + own.sums.restored);
  const base: Balance = {
    typeId: type.id,
    code: type.code,
    name: type.name,
    statutoryCode: type.statutoryCode,
    unit: ent.unit,
    tracked: ent.tracked,
    eligible: ent.eligible,
    eligibleFrom: ent.eligibleFrom,
    year: opts.year,
    childId: perChild ? (child?.id ?? null) : null,
    entitlement: ent.hundredths,
    carriedForward: carried,
    expired,
    adjustments: own.sums.adjustment,
    taken,
    pending,
    available: ent.tracked ? ent.hundredths + carried - expired + own.sums.adjustment - taken - pending : null,
    carryExpiresOn: own.expires,
    explanation: ent.explanation,
  };
  // Outpatient days count against the hospitalisation total (60 including the 14).
  const types = opts.types;
  if (types && (type.statutoryCode === "hospitalisation" || type.statutoryCode === "sick_outpatient")) {
    const other = types.find(
      (x) => x.statutoryCode === (type.statutoryCode === "hospitalisation" ? "sick_outpatient" : "hospitalisation"),
    );
    if (other) {
      if (type.statutoryCode === "hospitalisation") {
        const op = await ledgerSums(db, t, [other.id], scope);
        const opTaken = -(op.sums.taken + op.sums.restored);
        const opPending = await pendingSum(db, t, [other.id], scope, opts.excludeRequestId);
        base.taken += opTaken;
        base.pending += opPending;
        if (base.available !== null) base.available -= opTaken + opPending;
        base.explanation = [
          ...base.explanation,
          opTaken + opPending > 0
            ? `Includes ${(opTaken + opPending) / 100} outpatient sick ${base.unit} taken or pending.`
            : "",
        ].filter(Boolean);
      } else if (base.available !== null) {
        const hosp = await computeBalance(db, t, other, opts);
        if (hosp.available !== null && hosp.available < base.available) {
          base.available = Math.max(0, hosp.available);
          base.explanation = [
            ...base.explanation,
            "Limited by the hospitalisation leave left (outpatient days count towards it).",
          ];
        }
      }
    }
  }
  return base;
}

/** Every balance for an employee and year (per-child types: one row per child). */
export async function balancesFor(
  db: Db,
  t: EmployeeTime,
  types: readonly LeaveType[],
  year: number,
  asOf: string,
): Promise<Balance[]> {
  const children = await childrenOf(db, t.orgId, t.employeeId);
  const out: Balance[] = [];
  for (const type of types) {
    if (type.archivedAt) continue;
    if (type.statutoryCode && PER_CHILD_CODES.has(type.statutoryCode)) {
      for (const c of children)
        out.push(await computeBalance(db, t, type, { year, asOf, childId: c.id, children, types }));
      if (!children.length) out.push(await computeBalance(db, t, type, { year, asOf, children, types }));
    } else {
      out.push(await computeBalance(db, t, type, { year, asOf, children, types }));
    }
  }
  return out;
}

export function needsChild(type: Pick<LeaveType, "statutoryCode">): boolean {
  return !!type.statutoryCode && NEEDS_CHILD_CODES.has(type.statutoryCode);
}
