import { publicHolidays, RulesNotAvailableError } from "@crowhr/sg-rules";
import { and, asc, desc, eq, gte, inArray, lte, type SQL } from "drizzle-orm";
import { z } from "zod";
import type { Grant } from "../access/authorize.ts";
import { orgScope } from "../access/org-scope.ts";
import { singaporeDate } from "../access/scope.ts";
import { recordAudit } from "../audit/audit.ts";
import type { AuthContext } from "../context.ts";
import { employees } from "../db/schema/employees.ts";
import {
  type LeaveChild,
  type LeaveRequest,
  type LeaveType,
  leaveAttachments,
  leaveChildren,
  leaveHolidays,
  leaveRequestDays,
  leaveRequests,
  leaveTypes,
} from "../db/schema/leave.ts";
import { approvalTasks } from "../db/schema/workflows.ts";
import type { Db } from "../db/types.ts";
import type { AppDeps } from "../deps.ts";
import { displayName } from "../employees/records.ts";
import { AppError } from "../errors.ts";
import { ensureLeaveSetup, NEEDS_CHILD_CODES, PER_CHILD_CODES } from "./defaults.ts";
import { isoDate, type LeaveActor } from "./service.ts";

/** Read models for the leave API (requests, calendar, children, holidays). */

export const typeView = z.object({
  id: z.uuid(),
  code: z.string(),
  name: z.string(),
  statutoryCode: z.string().nullable(),
  paid: z.boolean(),
  halfDays: z.boolean(),
  attachment: z.enum(["none", "optional", "required"]),
  attachmentLabel: z.string().nullable(),
  sensitive: z.boolean(),
  needsChild: z.boolean(),
  perChild: z.boolean(),
  unlimited: z.boolean(),
  archived: z.boolean(),
});

export function toTypeView(t: LeaveType): z.input<typeof typeView> {
  return {
    id: t.id,
    code: t.code,
    name: t.name,
    statutoryCode: t.statutoryCode,
    paid: t.paid,
    halfDays: t.halfDays,
    attachment: t.attachment,
    attachmentLabel: t.attachmentLabel,
    sensitive: t.sensitive,
    needsChild: !!t.statutoryCode && NEEDS_CHILD_CODES.has(t.statutoryCode),
    perChild: !!t.statutoryCode && PER_CHILD_CODES.has(t.statutoryCode),
    unlimited: t.policy.entitlement.basis === "unlimited",
    archived: t.archivedAt !== null,
  };
}

export const requestView = z.object({
  id: z.uuid(),
  employee: z.object({ id: z.uuid(), name: z.string() }),
  type: z.object({ id: z.uuid(), code: z.string(), name: z.string() }),
  startDate: z.string(),
  endDate: z.string(),
  startSession: z.enum(["full", "am", "pm"]),
  endSession: z.enum(["full", "am", "pm"]),
  unit: z.enum(["days", "hours"]),
  quantity: z.number(),
  reason: z.string().nullable(),
  status: z.enum(["pending", "approved", "rejected", "withdrawn", "cancellation_pending", "cancelled"]),
  child: z.object({ id: z.uuid(), name: z.string() }).nullable(),
  attachments: z.array(
    z.object({ id: z.uuid(), filename: z.string(), contentType: z.string(), sizeBytes: z.number() }),
  ),
  approvalRequestId: z.uuid().nullable(),
  cancellationRequestId: z.uuid().nullable(),
  onBehalf: z.boolean(),
  cancelReason: z.string().nullable(),
  createdAt: z.string(),
  decidedAt: z.string().nullable(),
  days: z.array(z.object({ date: z.string(), session: z.enum(["full", "am", "pm"]), quantity: z.number() })).optional(),
});
export type RequestView = z.input<typeof requestView>;

export async function toRequestViews(
  db: Db,
  orgId: string,
  rows: LeaveRequest[],
  withDays = false,
): Promise<RequestView[]> {
  if (!rows.length) return [];
  const org = orgScope(db, orgId);
  const ids = rows.map((r) => r.id);
  const types = await db.select().from(leaveTypes).where(org.where(leaveTypes));
  const people = await db
    .select({ id: employees.id, legalName: employees.legalName, preferredName: employees.preferredName })
    .from(employees)
    .where(org.where(employees, inArray(employees.id, [...new Set(rows.map((r) => r.employeeId))])));
  const childIds = rows.flatMap((r) => (r.childId ? [r.childId] : []));
  const kids = childIds.length
    ? await db
        .select()
        .from(leaveChildren)
        .where(org.where(leaveChildren, inArray(leaveChildren.id, childIds)))
    : [];
  const files = await db
    .select()
    .from(leaveAttachments)
    .where(org.where(leaveAttachments, inArray(leaveAttachments.requestId, ids)));
  const days = withDays
    ? await db
        .select()
        .from(leaveRequestDays)
        .where(org.where(leaveRequestDays, inArray(leaveRequestDays.requestId, ids)))
        .orderBy(asc(leaveRequestDays.date))
    : [];
  return rows.map((r) => {
    const type = types.find((t) => t.id === r.leaveTypeId);
    const person = people.find((p) => p.id === r.employeeId);
    const child = kids.find((k) => k.id === r.childId);
    return {
      id: r.id,
      employee: { id: r.employeeId, name: person ? displayName(person) : "Former employee" },
      type: { id: r.leaveTypeId, code: type?.code ?? "", name: type?.name ?? "Leave" },
      startDate: r.startDate,
      endDate: r.endDate,
      startSession: r.startSession,
      endSession: r.endSession,
      unit: r.unit,
      quantity: r.hundredths / 100,
      reason: r.reason,
      status: r.status,
      child: child ? { id: child.id, name: child.name } : null,
      attachments: files
        .filter((f) => f.requestId === r.id)
        .map((f) => ({ id: f.id, filename: f.filename, contentType: f.contentType, sizeBytes: f.sizeBytes })),
      approvalRequestId: r.approvalRequestId,
      cancellationRequestId: r.cancellationRequestId,
      onBehalf: r.onBehalf,
      cancelReason: r.cancelReason,
      createdAt: r.createdAt.toISOString(),
      decidedAt: r.decidedAt?.toISOString() ?? null,
      ...(withDays
        ? {
            days: days
              .filter((d) => d.requestId === r.id)
              .map((d) => ({ date: d.date, session: d.session, quantity: d.hundredths / 100 })),
          }
        : {}),
    };
  });
}

export const requestListQuery = z.object({
  employeeId: z.uuid().optional(),
  status: z
    .string()
    .optional()
    .transform((s) => (s ? s.split(",").filter(Boolean) : undefined))
    .pipe(
      z.array(z.enum(["pending", "approved", "rejected", "withdrawn", "cancellation_pending", "cancelled"])).optional(),
    ),
  from: isoDate.optional(),
  to: isoDate.optional(),
  limit: z.coerce.number().int().min(1).max(500).default(200),
});

export async function listRequests(db: Db, orgId: string, grant: Grant, q: z.output<typeof requestListQuery>) {
  const org = orgScope(db, orgId);
  const filters: (SQL | undefined)[] = [await grant.employeeFilter(leaveRequests.employeeId)];
  if (q.employeeId) filters.push(eq(leaveRequests.employeeId, q.employeeId));
  if (q.status?.length) filters.push(inArray(leaveRequests.status, q.status));
  if (q.from) filters.push(gte(leaveRequests.endDate, q.from));
  if (q.to) filters.push(lte(leaveRequests.startDate, q.to));
  const rows = await db
    .select()
    .from(leaveRequests)
    .where(org.where(leaveRequests, ...filters))
    .orderBy(desc(leaveRequests.startDate), desc(leaveRequests.createdAt))
    .limit(q.limit);
  return toRequestViews(db, orgId, rows);
}

export async function getRequest(db: Db, orgId: string, grant: Grant, id: string) {
  const row = await orgScope(db, orgId).findById(leaveRequests, id);
  if (!row) throw new AppError("not_found", "That leave request doesn't exist or you can't see it.");
  await grant.assertEmployee(row.employeeId, "leave request");
  const [view] = await toRequestViews(db, orgId, [row], true);
  return view as RequestView;
}

/**
 * Medical attachments (spec "Calendar and visibility"): the requester, owners, hr_admins and the
 * request's approvers. Everyone else gets 404.
 */
export async function readAttachment(deps: AppDeps, auth: AuthContext, requestId: string, attachmentId: string) {
  const org = orgScope(deps.db, auth.orgId);
  const request = await org.findById(leaveRequests, requestId);
  const file = await org.findById(leaveAttachments, attachmentId);
  const notFound = new AppError("not_found", "That attachment doesn't exist or you can't see it.");
  if (!request || !file || file.requestId !== request.id) throw notFound;
  let allowed =
    request.employeeId === auth.employeeId || auth.roles.includes("owner") || auth.roles.includes("hr_admin");
  if (!allowed) {
    const ids = [request.approvalRequestId, request.cancellationRequestId].filter((x): x is string => !!x);
    if (ids.length) {
      const tasks = await deps.db
        .select({ id: approvalTasks.id })
        .from(approvalTasks)
        .where(
          and(
            eq(approvalTasks.orgId, auth.orgId),
            inArray(approvalTasks.requestId, ids),
            eq(approvalTasks.assigneeMembershipId, auth.membershipId),
          ),
        );
      allowed = tasks.length > 0;
    }
  }
  if (!allowed) throw notFound;
  const stored = await deps.fileStore.get(file.fileKey);
  if (!stored) throw notFound;
  return { file, data: stored.data };
}

// ---------------------------------------------------------------------------------------------
// Team calendar
// ---------------------------------------------------------------------------------------------

export const calendarQuery = z.object({
  from: isoDate,
  to: isoDate,
  view: z.enum(["team", "org"]).default("team"),
});

export const calendarView = z.object({
  from: z.string(),
  to: z.string(),
  holidays: z.array(z.object({ date: z.string(), name: z.string() })),
  people: z.array(
    z.object({
      employeeId: z.uuid(),
      name: z.string(),
      self: z.boolean(),
      entries: z.array(
        z.object({
          date: z.string(),
          session: z.enum(["full", "am", "pm"]),
          status: z.enum(["approved", "pending"]),
          /** The leave type, or "On leave" when the viewer may not see it. */
          label: z.string(),
          typeCode: z.string().nullable(),
          requestId: z.uuid().nullable(),
        }),
      ),
    }),
  ),
});

/**
 * Gazetted public holidays plus the organisation's own, between two dates. With `inLieu`, a
 * holiday on a Sunday is shown on its gazetted Monday as "<name> (in lieu)", which is the day off
 * for staff with a Sunday rest day and matches what the apply sheet leaves out (calendar.ts
 * `holidaysFor`). The roster grid and the holiday list keep the gazetted date.
 */
export async function holidaysBetween(
  db: Db,
  orgId: string,
  from: string,
  to: string,
  opts: { inLieu?: boolean } = {},
) {
  const out: { date: string; name: string }[] = [];
  // From the year before: a 31 Dec Sunday holiday moves into January.
  for (let y = Number(from.slice(0, 4)) - (opts.inLieu ? 1 : 0); y <= Number(to.slice(0, 4)); y++) {
    try {
      for (const h of publicHolidays(y)) {
        const shown = opts.inLieu && h.observedOn ? { date: h.observedOn, name: `${h.name} (in lieu)` } : h;
        if (shown.date >= from && shown.date <= to) out.push({ date: shown.date, name: shown.name });
      }
    } catch (err) {
      if (!(err instanceof RulesNotAvailableError)) throw err;
    }
  }
  const org = orgScope(db, orgId);
  const extra = await db
    .select()
    .from(leaveHolidays)
    .where(org.where(leaveHolidays, gte(leaveHolidays.date, from), lte(leaveHolidays.date, to)));
  for (const h of extra) out.push({ date: h.date, name: h.name });
  return out.sort((a, b) => (a.date < b.date ? -1 : 1));
}

/**
 * Who is away. `team`: the viewer and their reports (or, for owners and hr_admins, everyone);
 * `org`: everyone with approved leave in the range. Types are shown only where the viewer's
 * `leave:read` scope covers the employee, or the type is not sensitive.
 */
export async function teamCalendar(
  deps: AppDeps,
  auth: AuthContext,
  grant: Grant,
  input: z.output<typeof calendarQuery>,
) {
  if (input.to < input.from) {
    throw new AppError("validation_failed", "The end date is before the start date.", {
      issues: [{ path: "to", message: "Pick an end date on or after the start date." }],
    });
  }
  const span = (Date.parse(input.to) - Date.parse(input.from)) / 86_400_000;
  if (span > 92) {
    throw new AppError("validation_failed", "Show at most three months at a time.", {
      issues: [{ path: "to", message: "Pick a range of up to 92 days." }],
    });
  }
  await ensureLeaveSetup(deps, auth.orgId);
  const db = deps.db;
  const org = orgScope(db, auth.orgId);
  const inScope = grant.all ? null : await grant.employeeIds();
  let peopleIds: string[];
  if (input.view === "team") {
    peopleIds = grant.all
      ? (await db.select({ id: employees.id }).from(employees).where(org.where(employees))).map((e) => e.id)
      : [...(inScope ?? [])];
  } else {
    peopleIds = [];
  }
  const days = await db
    .select({ day: leaveRequestDays, status: leaveRequests.status, typeId: leaveRequests.leaveTypeId })
    .from(leaveRequestDays)
    .innerJoin(
      leaveRequests,
      and(eq(leaveRequests.orgId, leaveRequestDays.orgId), eq(leaveRequests.id, leaveRequestDays.requestId)),
    )
    .where(
      org.where(
        leaveRequestDays,
        gte(leaveRequestDays.date, input.from),
        lte(leaveRequestDays.date, input.to),
        inArray(leaveRequests.status, ["pending", "approved", "cancellation_pending"]),
        input.view === "team"
          ? inArray(leaveRequestDays.employeeId, peopleIds.length ? peopleIds : [auth.orgId])
          : undefined,
      ),
    )
    .orderBy(asc(leaveRequestDays.date));
  const types = await db.select().from(leaveTypes).where(org.where(leaveTypes));
  const canSee = (employeeId: string) => grant.all || (inScope?.has(employeeId) ?? false);
  const visible = days.filter((d) => d.status !== "pending" || canSee(d.day.employeeId));
  const ids = [...new Set([...peopleIds, ...visible.map((d) => d.day.employeeId)])];
  const people = ids.length
    ? await db
        .select({ id: employees.id, legalName: employees.legalName, preferredName: employees.preferredName })
        .from(employees)
        .where(org.where(employees, inArray(employees.id, ids)))
    : [];
  const rows = people
    .map((p) => {
      const mine = visible.filter((d) => d.day.employeeId === p.id);
      return {
        employeeId: p.id,
        name: displayName(p),
        self: p.id === auth.employeeId,
        entries: mine.map((d) => {
          const type = types.find((t) => t.id === d.typeId);
          const show = canSee(p.id) || (type ? !type.sensitive : false);
          return {
            date: d.day.date,
            session: d.day.session,
            status: d.status === "pending" ? ("pending" as const) : ("approved" as const),
            label: show ? (type?.name ?? "Leave") : "On leave",
            typeCode: show ? (type?.code ?? null) : null,
            requestId: canSee(p.id) ? d.day.requestId : null,
          };
        }),
      };
    })
    .filter((r) => input.view === "team" || r.entries.length > 0)
    .sort((a, b) => (a.self === b.self ? a.name.localeCompare(b.name) : a.self ? -1 : 1));
  return {
    from: input.from,
    to: input.to,
    holidays: await holidaysBetween(db, auth.orgId, input.from, input.to, { inLieu: true }),
    people: rows,
  };
}

// ---------------------------------------------------------------------------------------------
// Children
// ---------------------------------------------------------------------------------------------

export const childInput = z
  .object({
    employeeId: z.uuid().optional(),
    name: z.string().trim().min(1, 'Enter the child\'s name (or "Baby" before birth).').max(80),
    birthDate: isoDate.nullish(),
    expectedDeliveryDate: isoDate.nullish(),
    isCitizen: z.boolean(),
    birthOrder: z.int().min(1, "Birth order starts at 1 (first child).").max(20),
    stillborn: z.boolean().default(false),
    adoptionIntentDate: isoDate.nullish(),
    marriedToMother: z.boolean().nullish(),
  })
  .refine((c) => c.birthDate || c.expectedDeliveryDate || c.adoptionIntentDate, {
    path: ["birthDate"],
    message: "Enter the date of birth, the expected delivery date, or the date of formal intent to adopt.",
  });

export const childView = z.object({
  id: z.uuid(),
  employeeId: z.uuid(),
  name: z.string(),
  birthDate: z.string().nullable(),
  expectedDeliveryDate: z.string().nullable(),
  isCitizen: z.boolean(),
  birthOrder: z.number(),
  stillborn: z.boolean(),
  adoptionIntentDate: z.string().nullable(),
  marriedToMother: z.boolean().nullable(),
});

export const toChildView = (c: LeaveChild): z.input<typeof childView> => ({
  id: c.id,
  employeeId: c.employeeId,
  name: c.name,
  birthDate: c.birthDate,
  expectedDeliveryDate: c.expectedDeliveryDate,
  isCitizen: c.isCitizen,
  birthOrder: c.birthOrder,
  stillborn: c.stillborn,
  adoptionIntentDate: c.adoptionIntentDate,
  marriedToMother: c.marriedToMother,
});

export async function saveChild(
  deps: AppDeps,
  actor: LeaveActor,
  grant: Grant,
  input: z.output<typeof childInput>,
  childId?: string,
) {
  const employeeId = input.employeeId ?? actor.employeeId;
  if (!employeeId) {
    throw new AppError("validation_failed", "Choose the employee this child belongs to.", {
      issues: [{ path: "employeeId", message: "Choose the employee." }],
    });
  }
  await grant.assertEmployee(employeeId, "employee");
  const values = {
    name: input.name,
    birthDate: input.birthDate ?? null,
    expectedDeliveryDate: input.expectedDeliveryDate ?? null,
    isCitizen: input.isCitizen,
    birthOrder: input.birthOrder,
    stillborn: input.stillborn,
    adoptionIntentDate: input.adoptionIntentDate ?? null,
    marriedToMother: input.marriedToMother ?? null,
  };
  return deps.db.transaction(async (tx) => {
    let row: LeaveChild | undefined;
    if (childId) {
      const existing = await orgScope(tx, actor.orgId).findById(leaveChildren, childId);
      if (!existing || existing.employeeId !== employeeId)
        throw new AppError("not_found", "That child record doesn't exist.");
      [row] = await tx
        .update(leaveChildren)
        .set({ ...values, updatedAt: deps.clock.now() })
        .where(orgScope(tx, actor.orgId).whereId(leaveChildren, childId))
        .returning();
    } else {
      [row] = await tx
        .insert(leaveChildren)
        .values({ id: deps.ids.newId(), orgId: actor.orgId, employeeId, ...values })
        .returning();
    }
    if (!row) throw new Error("child write returned nothing");
    await recordAudit(tx, deps, actor.audit, {
      action: childId ? "leave.child_updated" : "leave.child_added",
      targetType: "employee",
      targetId: employeeId,
      meta: { childId: row.id },
    });
    return row;
  });
}

export async function listChildren(db: Db, orgId: string, grant: Grant, employeeId: string) {
  await grant.assertEmployee(employeeId, "employee");
  const org = orgScope(db, orgId);
  return db
    .select()
    .from(leaveChildren)
    .where(org.where(leaveChildren, eq(leaveChildren.employeeId, employeeId)))
    .orderBy(asc(leaveChildren.birthOrder));
}

export const todaySg = (deps: AppDeps) => singaporeDate(deps.clock.now());
