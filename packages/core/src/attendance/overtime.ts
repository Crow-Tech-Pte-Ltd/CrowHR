import { checkOvertimeLimits, isPart4Covered } from "@crowhr/sg-rules";
import { asc, desc, eq, gte, inArray, lt, lte, ne, type SQL, sql } from "drizzle-orm";
import { z } from "zod";
import type { Grant } from "../access/authorize.ts";
import { orgScope } from "../access/org-scope.ts";
import { singaporeDate } from "../access/scope.ts";
import { type AuditContext, recordAudit } from "../audit/audit.ts";
import { type OvertimeClaim, overtimeClaims } from "../db/schema/attendance.ts";
import { compensationRecords, employees } from "../db/schema/employees.ts";
import type { Db } from "../db/types.ts";
import type { AppDeps } from "../deps.ts";
import { isIsoDate } from "../employees/dates.ts";
import { findAsAt } from "../employees/effective.ts";
import { displayName } from "../employees/records.ts";
import { isUniqueViolation } from "../employees/validation.ts";
import { AppError } from "../errors.ts";
import { employmentNear, loadEmployeeTime, scheduleOn } from "../leave/calendar.ts";
import { submitApproval, withdrawSubject } from "../workflows/engine.ts";
import { timesheets } from "./timesheet.ts";

/**
 * Overtime claims (spec "Overtime and claims"; design decision 5). One open or approved claim per
 * employee and date, never more than the computed OT; approved through workflows as `overtime`.
 */

export const MONTHLY_OT_LIMIT_MINUTES = 72 * 60;

export interface OvertimeActor {
  orgId: string;
  membershipId: string;
  employeeId: string | null;
  audit: AuditContext;
}

const isoDate = z.string().refine(isIsoDate, { message: "Use the date format YYYY-MM-DD, like 2026-11-12." });

export const claimInput = z.object({
  employeeId: z.uuid().optional(),
  date: isoDate,
  minutes: z
    .int()
    .min(1, "Claim at least 1 minute.")
    .max(24 * 60),
  reason: z.string().trim().max(300).nullish(),
});

export const claimView = z.object({
  id: z.uuid(),
  employee: z.object({ id: z.uuid(), name: z.string() }),
  date: z.string(),
  computedMinutes: z.number(),
  claimedMinutes: z.number(),
  approvedMinutes: z.number().nullable(),
  statutory: z.boolean(),
  reason: z.string().nullable(),
  status: z.enum(["pending", "approved", "rejected", "withdrawn"]),
  approvalRequestId: z.uuid().nullable(),
  createdAt: z.string(),
  decidedAt: z.string().nullable(),
});
export type ClaimView = z.input<typeof claimView>;

export async function toClaimViews(db: Db, orgId: string, rows: OvertimeClaim[]): Promise<ClaimView[]> {
  if (!rows.length) return [];
  const people = await db
    .select({ id: employees.id, legalName: employees.legalName, preferredName: employees.preferredName })
    .from(employees)
    .where(orgScope(db, orgId).where(employees, inArray(employees.id, [...new Set(rows.map((r) => r.employeeId))])));
  return rows.map((r) => {
    const p = people.find((x) => x.id === r.employeeId);
    return {
      id: r.id,
      employee: { id: r.employeeId, name: p ? displayName(p) : "Former employee" },
      date: r.workDate,
      computedMinutes: r.computedMinutes,
      claimedMinutes: r.claimedMinutes,
      approvedMinutes: r.approvedMinutes,
      statutory: r.statutory,
      reason: r.reason,
      status: r.status,
      approvalRequestId: r.approvalRequestId,
      createdAt: r.createdAt.toISOString(),
      decidedAt: r.decidedAt?.toISOString() ?? null,
    };
  });
}

/** Covered by Employment Act Part 4 on `date` (statutory OT), from basic pay and the employment record. */
export async function part4On(db: Db, orgId: string, employeeId: string, date: string): Promise<boolean> {
  const t = await loadEmployeeTime(db, orgId, employeeId);
  const emp = employmentNear(t, date);
  if (!emp?.eaCovered) return false;
  const rows = await db
    .select()
    .from(compensationRecords)
    .where(orgScope(db, orgId).where(compensationRecords, eq(compensationRecords.employeeId, employeeId)))
    .orderBy(asc(compensationRecords.effectiveFrom));
  const comp = findAsAt(rows, date) ?? rows.at(-1);
  if (!comp) return false;
  let monthly = comp.amountCents;
  if (comp.payBasis === "hourly") {
    // Monthly equivalent of an hourly rate: rate × weekly hours × 52 / 12.
    const weekly = (scheduleOn(t, date)?.version.weeklyMinutes ?? 44 * 60) / 60;
    monthly = Math.round((comp.amountCents * weekly * 52) / 12);
  }
  // Managers and executives are never Part 4, whatever their pay.
  return isPart4Covered({
    date,
    monthlyBasicCents: monthly,
    isWorkman: emp.isWorkman,
    isManagerOrExecutive: emp.isManagerOrExecutive,
  }).covered;
}

function nextMonthStart(month: string): string {
  const [y, m] = month.split("-").map(Number) as [number, number];
  return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
}

/** Minutes of approved and pending OT in the calendar month of `date`, excluding `exceptId`. */
export async function monthMinutes(db: Db, orgId: string, employeeId: string, date: string, exceptId?: string) {
  const month = date.slice(0, 7);
  const [row] = await db
    .select({
      total: sql<number>`coalesce(sum(coalesce(${overtimeClaims.approvedMinutes}, ${overtimeClaims.claimedMinutes})), 0)::int`,
    })
    .from(overtimeClaims)
    .where(
      orgScope(db, orgId).where(
        overtimeClaims,
        eq(overtimeClaims.employeeId, employeeId),
        inArray(overtimeClaims.status, ["pending", "approved"]),
        gte(overtimeClaims.workDate, `${month}-01`),
        lt(overtimeClaims.workDate, nextMonthStart(month)),
        exceptId ? ne(overtimeClaims.id, exceptId) : undefined,
      ),
    );
  return Number(row?.total ?? 0);
}

export function monthWarnings(date: string, totalMinutes: number): string[] {
  return checkOvertimeLimits({ date, monthOvertimeMinutes: totalMinutes }).map((i) => i.message);
}

const hm = (minutes: number) => {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h && m ? `${h} h ${m} min` : h ? `${h} h` : `${m} min`;
};

export { hm as minutesText };

export async function createClaim(
  deps: AppDeps,
  actor: OvertimeActor,
  grant: Grant,
  input: z.output<typeof claimInput>,
): Promise<{ claim: OvertimeClaim; warnings: string[] }> {
  const employeeId = input.employeeId ?? actor.employeeId;
  if (!employeeId) {
    throw new AppError(
      "validation_failed",
      "Your sign-in isn't linked to an employee record, so choose the employee.",
      {
        issues: [{ path: "employeeId", message: "Choose the employee." }],
      },
    );
  }
  await grant.assertEmployee(employeeId, "employee");
  const today = singaporeDate(deps.clock.now());
  if (input.date > today) {
    throw new AppError("validation_failed", "You can only claim overtime for a day that has passed or is today.", {
      issues: [{ path: "date", message: "Pick today or an earlier date." }],
    });
  }
  const sheet = await timesheets(deps.db, actor.orgId, [employeeId], input.date, input.date, today);
  const day = sheet.days.get(employeeId)?.[0];
  const computed = day?.otMinutes ?? 0;
  if (input.minutes > computed) {
    throw new AppError(
      "validation_failed",
      computed === 0
        ? "Your timesheet shows no overtime on that day. Ask your manager to correct the punches first."
        : `At most ${hm(computed)} (${computed} minutes) of overtime can be claimed for that day, from the timesheet.`,
      { issues: [{ path: "minutes", message: `Claim ${computed} minutes or fewer.` }], computedMinutes: computed },
    );
  }
  const statutory = await part4On(deps.db, actor.orgId, employeeId, input.date);
  try {
    return await deps.db.transaction(async (tx) => {
      const id = deps.ids.newId();
      const before = await monthMinutes(tx, actor.orgId, employeeId, input.date);
      const [row] = await tx
        .insert(overtimeClaims)
        .values({
          id,
          orgId: actor.orgId,
          employeeId,
          workDate: input.date,
          computedMinutes: computed,
          claimedMinutes: input.minutes,
          statutory,
          reason: input.reason ?? null,
          status: "pending",
          createdByMembershipId: actor.membershipId,
        })
        .returning();
      if (!row) throw new Error("overtime claim insert returned nothing");
      await recordAudit(tx, deps, actor.audit, {
        action: "attendance.overtime_claimed",
        targetType: "overtime_claim",
        targetId: id,
        meta: { employeeId, date: input.date, minutes: input.minutes, statutory },
      });
      const requester =
        employeeId === actor.employeeId
          ? actor.membershipId
          : ((await memberOf(tx, actor.orgId, employeeId)) ?? actor.membershipId);
      const approval = await submitApproval(tx, deps, actor.audit, {
        orgId: actor.orgId,
        subjectType: "overtime",
        subjectId: id,
        requesterMembershipId: requester,
        requesterEmployeeId: employeeId,
        attributes: { typeCode: statutory ? "statutory" : "contractual" },
      });
      const [updated] = await tx
        .update(overtimeClaims)
        .set({ approvalRequestId: approval.requestId })
        .where(orgScope(tx, actor.orgId).whereId(overtimeClaims, id))
        .returning();
      const warnings = monthWarnings(input.date, before + input.minutes);
      if (!statutory) {
        warnings.push(
          "Not covered by Part 4 of the Employment Act on this date, so overtime pay is contractual (company policy).",
        );
      }
      return { claim: updated ?? row, warnings };
    });
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new AppError(
        "conflict",
        "There is already an open or approved overtime claim for that day. Withdraw it first to change it.",
      );
    }
    throw err;
  }
}

async function memberOf(db: Db, orgId: string, employeeId: string): Promise<string | null> {
  const r = await db.execute(
    sql`select id from memberships where org_id = ${orgId} and employee_id = ${employeeId} and status in ('active', 'invited') limit 1`,
  );
  const rows = ((r as unknown as { rows?: { id: string }[] }).rows ?? (r as unknown as { id: string }[])) as {
    id: string;
  }[];
  return rows[0]?.id ?? null;
}

export async function loadClaim(db: Db, orgId: string, id: string): Promise<OvertimeClaim> {
  const row = await orgScope(db, orgId).findById(overtimeClaims, id);
  if (!row) throw new AppError("not_found", "That overtime claim doesn't exist or you can't see it.");
  return row;
}

export async function withdrawClaim(deps: AppDeps, actor: OvertimeActor, grant: Grant, id: string) {
  const found = await loadClaim(deps.db, actor.orgId, id);
  await grant.assertEmployee(found.employeeId, "overtime claim");
  return deps.db.transaction(async (tx) => {
    const claim = await loadClaim(tx, actor.orgId, id);
    if (claim.status !== "pending") {
      throw new AppError("conflict", `This claim is ${claim.status}, so it can't be withdrawn.`);
    }
    const done = await withdrawSubject(tx, deps, actor.audit, {
      orgId: actor.orgId,
      subjectType: "overtime",
      subjectId: id,
    });
    if (!done) await setClaimStatus(tx, actor.orgId, id, "withdrawn", deps.clock.now());
    await recordAudit(tx, deps, actor.audit, {
      action: "attendance.overtime_withdrawn",
      targetType: "overtime_claim",
      targetId: id,
    });
    return loadClaim(tx, actor.orgId, id);
  });
}

export async function setClaimStatus(
  db: Db,
  orgId: string,
  id: string,
  status: OvertimeClaim["status"],
  at: Date,
  approvedMinutes?: number,
) {
  await db
    .update(overtimeClaims)
    .set({ status, decidedAt: at, updatedAt: at, ...(approvedMinutes !== undefined ? { approvedMinutes } : {}) })
    .where(orgScope(db, orgId).where(overtimeClaims, eq(overtimeClaims.id, id), eq(overtimeClaims.status, "pending")));
}

export const claimListQuery = z.object({
  employeeId: z.uuid().optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
  status: z.enum(["pending", "approved", "rejected", "withdrawn"]).optional(),
});

export async function listClaims(db: Db, orgId: string, grant: Grant, q: z.output<typeof claimListQuery>) {
  const filters: (SQL | undefined)[] = [await grant.employeeFilter(overtimeClaims.employeeId)];
  if (q.employeeId) filters.push(eq(overtimeClaims.employeeId, q.employeeId));
  if (q.from) filters.push(gte(overtimeClaims.workDate, q.from));
  if (q.to) filters.push(lte(overtimeClaims.workDate, q.to));
  if (q.status) filters.push(eq(overtimeClaims.status, q.status));
  const rows = await db
    .select()
    .from(overtimeClaims)
    .where(orgScope(db, orgId).where(overtimeClaims, ...filters))
    .orderBy(desc(overtimeClaims.workDate), desc(overtimeClaims.createdAt))
    .limit(500);
  return toClaimViews(db, orgId, rows);
}
