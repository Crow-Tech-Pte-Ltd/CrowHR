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
  facts?: BalanceFacts,
): Promise<{ sums: Sums; expires: string | null }> {
  if (facts?.covers(t.employeeId, scope.year)) return facts.ledgerSums(t.employeeId, typeIds, scope);
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
  facts?: BalanceFacts,
): Promise<number> {
  if (!excludeRequestId && facts?.covers(t.employeeId, scope.year))
    return facts.pendingSum(t.employeeId, typeIds, scope);
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
export async function excludedServiceMonths(
  db: Db,
  t: EmployeeTime,
  asOf: string,
  facts?: BalanceFacts,
): Promise<number> {
  const rule = t.settings.unpaidServiceRule;
  if (rule === "none") return 0;
  const org = orgScope(db, t.orgId);
  const hire = latestTenureBy(t, asOf)?.hireDate;
  if (!hire) return 0;
  const days = facts?.coversNoPay(t.employeeId, asOf)
    ? facts.noPayDays(t.employeeId, hire)
    : await noPayDaysOf(db, org, t.employeeId, hire, asOf);
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
  /** Preloaded rows for many employees (`loadBalanceFacts`): the same result with fewer queries. */
  facts?: BalanceFacts;
}

export async function computeBalance(db: Db, t: EmployeeTime, type: LeaveType, opts: BalanceOptions): Promise<Balance> {
  const facts = opts.facts;
  const children =
    opts.children ??
    (facts?.covers(t.employeeId, opts.year)
      ? facts.childrenOf(t.employeeId)
      : await childrenOf(db, t.orgId, t.employeeId));
  const child = opts.childId ? (children.find((c) => c.id === opts.childId) ?? null) : null;
  const perChild = !!type.statutoryCode && PER_CHILD_CODES.has(type.statutoryCode);
  const excludedMonths = type.statutoryCode === "annual" ? await excludedServiceMonths(db, t, opts.asOf, facts) : 0;
  const ent = entitlementFor(t, type, { year: opts.year, asOf: opts.asOf, child, children, excludedMonths });
  const scope: Scope = perChild
    ? { year: opts.year, childId: child?.id ?? "00000000-0000-0000-0000-000000000000" }
    : { year: opts.year };
  const own = await ledgerSums(db, t, [type.id], scope, facts);
  const encashment =
    !opts.excludeEncashmentId && facts?.covers(t.employeeId, opts.year)
      ? facts.pendingEncashment(t.employeeId, type.id)
      : await pendingEncashmentOf(db, t, type.id, opts.year, opts.excludeEncashmentId);
  const pending = (await pendingSum(db, t, [type.id], scope, opts.excludeRequestId, facts)) + encashment;
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
        const op = await ledgerSums(db, t, [other.id], scope, facts);
        const opTaken = -(op.sums.taken + op.sums.restored);
        const opPending = await pendingSum(db, t, [other.id], scope, opts.excludeRequestId, facts);
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
  facts?: BalanceFacts,
): Promise<Balance[]> {
  const children = facts?.covers(t.employeeId, year)
    ? facts.childrenOf(t.employeeId)
    : await childrenOf(db, t.orgId, t.employeeId);
  const out: Balance[] = [];
  for (const type of types) {
    if (type.archivedAt) continue;
    if (type.statutoryCode && PER_CHILD_CODES.has(type.statutoryCode)) {
      for (const c of children)
        out.push(await computeBalance(db, t, type, { year, asOf, childId: c.id, children, types, facts }));
      if (!children.length) out.push(await computeBalance(db, t, type, { year, asOf, children, types, facts }));
    } else {
      out.push(await computeBalance(db, t, type, { year, asOf, children, types, facts }));
    }
  }
  return out;
}

async function pendingEncashmentOf(
  db: Db,
  t: EmployeeTime,
  typeId: string,
  year: number,
  excludeEncashmentId?: string,
): Promise<number> {
  const [row] = await db
    .select({ total: sql<number>`coalesce(sum(${leaveEncashments.hundredths}), 0)::int` })
    .from(leaveEncashments)
    .where(
      orgScope(db, t.orgId).where(
        leaveEncashments,
        eq(leaveEncashments.employeeId, t.employeeId),
        eq(leaveEncashments.leaveTypeId, typeId),
        eq(leaveEncashments.leaveYear, year),
        eq(leaveEncashments.status, "pending"),
        sql`${leaveEncashments.ledgerEntryId} is null`,
        excludeEncashmentId ? ne(leaveEncashments.id, excludeEncashmentId) : undefined,
      ),
    );
  return Number(row?.total ?? 0);
}

interface NoPayDay {
  date: string;
  hundredths: number;
}

function noPayDaysOf(
  db: Db,
  org: ReturnType<typeof orgScope>,
  employeeId: string,
  hire: string,
  asOf: string,
): Promise<NoPayDay[]> {
  return db
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
        eq(leaveRequestDays.employeeId, employeeId),
        eq(leaveTypes.statutoryCode, "no_pay"),
        inArray(leaveRequests.status, ["approved", "cancellation_pending"]),
        sql`${leaveRequestDays.date} >= ${hire} and ${leaveRequestDays.date} < ${asOf}`,
      ),
    )
    .orderBy(asc(leaveRequestDays.date));
}

/**
 * Everything `computeBalance` reads for a set of employees, one leave year and one as-of date,
 * loaded in five queries instead of four or five per employee and leave type (the balances
 * report, the balances screen). `covers` says whether a call can be answered from it; anything
 * else (another employee, year or date, or an approval re-check that excludes a request) still
 * queries, so the result never differs.
 */
export interface BalanceFacts {
  covers(employeeId: string, year: number): boolean;
  coversNoPay(employeeId: string, asOf: string): boolean;
  childrenOf(employeeId: string): LeaveChild[];
  ledgerSums(employeeId: string, typeIds: readonly string[], scope: Scope): { sums: Sums; expires: string | null };
  pendingSum(employeeId: string, typeIds: readonly string[], scope: Scope): number;
  pendingEncashment(employeeId: string, typeId: string): number;
  /** Approved no-pay days from `hire` up to (not including) the facts' as-of date, by date. */
  noPayDays(employeeId: string, hire: string): NoPayDay[];
}

interface ScopedSum {
  typeId: string;
  childId: string | null;
  year: number;
  total: number;
}

const inScope = (row: ScopedSum, typeIds: readonly string[], scope: Scope) =>
  typeIds.includes(row.typeId) && (scope.childId ? row.childId === scope.childId : row.year === scope.year);

function byEmployee<T extends { employeeId: string }>(rows: readonly T[]): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const r of rows) {
    const list = out.get(r.employeeId);
    if (list) list.push(r);
    else out.set(r.employeeId, [r]);
  }
  return out;
}

export async function loadBalanceFacts(
  db: Db,
  orgId: string,
  employeeIds: readonly string[],
  year: number,
  asOf: string,
): Promise<BalanceFacts> {
  const ids = [...new Set(employeeIds)];
  const org = orgScope(db, orgId);
  const any = ids.length > 0;
  const children = any
    ? await db
        .select()
        .from(leaveChildren)
        .where(org.where(leaveChildren, inArray(leaveChildren.employeeId, ids)))
        .orderBy(asc(leaveChildren.birthOrder))
    : [];
  // Per-child types count every year of the child; everything else this leave year only.
  const ledger = any
    ? await db
        .select({
          employeeId: leaveLedger.employeeId,
          typeId: leaveLedger.leaveTypeId,
          childId: leaveLedger.childId,
          year: leaveLedger.leaveYear,
          kind: leaveLedger.kind,
          total: sql<number>`coalesce(sum(${leaveLedger.hundredths}), 0)::int`,
          expires: sql<string | null>`max(${leaveLedger.expiresOn})::text`,
        })
        .from(leaveLedger)
        .where(
          org.where(
            leaveLedger,
            inArray(leaveLedger.employeeId, ids),
            sql`(${leaveLedger.leaveYear} = ${year} or ${leaveLedger.childId} is not null)`,
          ),
        )
        .groupBy(
          leaveLedger.employeeId,
          leaveLedger.leaveTypeId,
          leaveLedger.childId,
          leaveLedger.leaveYear,
          leaveLedger.kind,
        )
    : [];
  const pending = any
    ? await db
        .select({
          employeeId: leaveRequestDays.employeeId,
          typeId: leaveRequestDays.leaveTypeId,
          childId: leaveRequests.childId,
          year: leaveRequestDays.leaveYear,
          total: sql<number>`coalesce(sum(${leaveRequestDays.hundredths}), 0)::int`,
        })
        .from(leaveRequestDays)
        .innerJoin(
          leaveRequests,
          and(eq(leaveRequests.orgId, leaveRequestDays.orgId), eq(leaveRequests.id, leaveRequestDays.requestId)),
        )
        .where(
          org.where(
            leaveRequestDays,
            inArray(leaveRequestDays.employeeId, ids),
            eq(leaveRequests.status, "pending"),
            sql`(${leaveRequestDays.leaveYear} = ${year} or ${leaveRequests.childId} is not null)`,
          ),
        )
        .groupBy(
          leaveRequestDays.employeeId,
          leaveRequestDays.leaveTypeId,
          leaveRequests.childId,
          leaveRequestDays.leaveYear,
        )
    : [];
  const encashments = any
    ? await db
        .select({
          employeeId: leaveEncashments.employeeId,
          typeId: leaveEncashments.leaveTypeId,
          total: sql<number>`coalesce(sum(${leaveEncashments.hundredths}), 0)::int`,
        })
        .from(leaveEncashments)
        .where(
          org.where(
            leaveEncashments,
            inArray(leaveEncashments.employeeId, ids),
            eq(leaveEncashments.leaveYear, year),
            eq(leaveEncashments.status, "pending"),
            sql`${leaveEncashments.ledgerEntryId} is null`,
          ),
        )
        .groupBy(leaveEncashments.employeeId, leaveEncashments.leaveTypeId)
    : [];
  const noPay = any
    ? await db
        .select({
          employeeId: leaveRequestDays.employeeId,
          date: leaveRequestDays.date,
          hundredths: leaveRequestDays.hundredths,
        })
        .from(leaveRequestDays)
        .innerJoin(
          leaveRequests,
          and(eq(leaveRequests.orgId, leaveRequestDays.orgId), eq(leaveRequests.id, leaveRequestDays.requestId)),
        )
        .innerJoin(
          leaveTypes,
          and(eq(leaveTypes.orgId, leaveRequests.orgId), eq(leaveTypes.id, leaveRequests.leaveTypeId)),
        )
        .where(
          org.where(
            leaveRequestDays,
            inArray(leaveRequestDays.employeeId, ids),
            eq(leaveTypes.statutoryCode, "no_pay"),
            inArray(leaveRequests.status, ["approved", "cancellation_pending"]),
            sql`${leaveRequestDays.date} < ${asOf}`,
          ),
        )
        .orderBy(asc(leaveRequestDays.date))
    : [];
  const covered = new Set(ids);
  const childrenBy = byEmployee(children);
  const ledgerBy = byEmployee(ledger.map((r) => ({ ...r, total: Number(r.total) })));
  const pendingBy = byEmployee(pending.map((r) => ({ ...r, total: Number(r.total) })));
  const encashmentBy = new Map(encashments.map((r) => [`${r.employeeId}:${r.typeId}`, Number(r.total)]));
  const noPayBy = byEmployee(noPay);
  return {
    covers: (employeeId, y) => y === year && covered.has(employeeId),
    coversNoPay: (employeeId, at) => at === asOf && covered.has(employeeId),
    childrenOf: (employeeId) => childrenBy.get(employeeId) ?? [],
    ledgerSums(employeeId, typeIds, scope) {
      const sums = emptySums();
      let expires: string | null = null;
      for (const r of ledgerBy.get(employeeId) ?? []) {
        if (!inScope(r, typeIds, scope)) continue;
        sums[r.kind] += r.total;
        if (r.kind === "carry_forward" && r.expires !== null && (expires === null || r.expires > expires)) {
          expires = r.expires;
        }
      }
      return { sums, expires };
    },
    pendingSum(employeeId, typeIds, scope) {
      let total = 0;
      for (const r of pendingBy.get(employeeId) ?? []) if (inScope(r, typeIds, scope)) total += r.total;
      return total;
    },
    pendingEncashment: (employeeId, typeId) => encashmentBy.get(`${employeeId}:${typeId}`) ?? 0,
    noPayDays: (employeeId, hire) =>
      (noPayBy.get(employeeId) ?? [])
        .filter((d) => d.date >= hire)
        .map(({ date, hundredths }) => ({ date, hundredths })),
  };
}

export function needsChild(type: Pick<LeaveType, "statutoryCode">): boolean {
  return !!type.statutoryCode && NEEDS_CHILD_CODES.has(type.statutoryCode);
}
