import { and, eq, inArray, sql } from "drizzle-orm";
import type { z } from "zod";
import type { Grant } from "../access/authorize.ts";
import { orgScope } from "../access/org-scope.ts";
import { singaporeDate } from "../access/scope.ts";
import { recordAudit, systemAuditContext } from "../audit/audit.ts";
import { memberships } from "../db/schema/access.ts";
import { leaveAttachments, leaveRequestDays, leaveRequests, leaveTypes } from "../db/schema/leave.ts";
import type { Db } from "../db/types.ts";
import type { AppDeps } from "../deps.ts";
import { displayDate } from "../employees/dates.ts";
import { AppError } from "../errors.ts";
import { sniffType } from "../files/sniff.ts";
import { storeFileInTx } from "../files/uploads.ts";
import { attachRosters } from "../scheduling/feeds.ts";
import { submitApproval } from "../workflows/engine.ts";
import { type Balance, childrenOf, computeBalance, needsChild } from "./balances.ts";
import { type CountedDay, countLeave, loadEmployeeTime } from "./calendar.ts";
import { ensureLeaveSetup } from "./defaults.ts";
import { unitFor } from "./entitlement.ts";
import {
  type ApplyInput,
  ATTACHMENT_MAX_BYTES,
  type ATTACHMENT_TYPES,
  type attachmentInput,
  type LeaveActor,
  lockEmployeeLeave,
  type Quote,
  type QuoteInput,
  type QuoteIssue,
  type QuoteYear,
} from "./service.ts";

const conflicts = (a: string, b: string) => a === "full" || b === "full" || a === b;

async function overlaps(db: Db, orgId: string, employeeId: string, days: CountedDay[], exceptRequestId?: string) {
  const counted = days.filter((d) => d.hundredths > 0);
  if (!counted.length) return [];
  const org = orgScope(db, orgId);
  const existing = await db
    .select({ date: leaveRequestDays.date, session: leaveRequestDays.session, requestId: leaveRequestDays.requestId })
    .from(leaveRequestDays)
    .innerJoin(
      leaveRequests,
      and(eq(leaveRequests.orgId, leaveRequestDays.orgId), eq(leaveRequests.id, leaveRequestDays.requestId)),
    )
    .where(
      org.where(
        leaveRequestDays,
        eq(leaveRequestDays.employeeId, employeeId),
        inArray(leaveRequests.status, ["pending", "approved", "cancellation_pending"]),
        inArray(
          leaveRequestDays.date,
          counted.map((d) => d.date),
        ),
      ),
    );
  return existing.filter(
    (e) => e.requestId !== exceptRequestId && counted.some((d) => d.date === e.date && conflicts(d.session, e.session)),
  );
}

/** The year's balance date: today, or the last counted date of the year when later (accrual by then). */
export function asOfFor(
  today: string,
  year: number,
  days: readonly { date: string; hundredths: number; leaveYear: number }[],
): string {
  const last = days.filter((d) => d.leaveYear === year && d.hundredths > 0).at(-1)?.date;
  const candidate = last && last > today ? last : today;
  if (candidate < `${year}-01-01`) return `${year}-01-01`;
  // biome-ignore lint/complexity/useMathMinMax: ISO date strings compare as text, not numbers.
  return candidate > `${year}-12-31` ? `${year}-12-31` : candidate;
}

const fmtQty = (h: number, unit: "days" | "hours") =>
  `${h / 100} ${unit === "hours" ? (h === 100 ? "hour" : "hours") : h === 100 ? "day" : "days"}`;

/**
 * Works out a prospective application (the apply sheet's live count) without writing anything.
 * Every reason it would fail is in `issues`; `applyLeave` throws the first one.
 */
export async function quoteLeave(
  db: Db,
  orgId: string,
  input: QuoteInput & { employeeId: string },
  opts: { today: string; excludeRequestId?: string },
): Promise<Quote> {
  const org = orgScope(db, orgId);
  const types = await db.select().from(leaveTypes).where(org.where(leaveTypes));
  const type = types.find((x) => x.id === input.leaveTypeId);
  if (!type || type.archivedAt)
    throw new AppError("not_found", "That leave type doesn't exist or is no longer offered.");
  const t = await loadEmployeeTime(db, orgId, input.employeeId);
  // Shift-schedule staff: count only the dates their published roster requires (scheduling feed).
  await attachRosters(db, orgId, new Map([[t.employeeId, t]]), input.startDate, input.endDate);
  const unit = unitFor(t, type, input.startDate);
  const issues: QuoteIssue[] = [];
  if (!type.halfDays && (input.startSession !== "full" || input.endSession !== "full")) {
    issues.push({
      code: "validation_failed",
      path: "startSession",
      message: `${type.name} is taken in whole days. Choose Full day.`,
    });
  }
  const counted = countLeave(t, {
    startDate: input.startDate,
    endDate: input.endDate,
    startSession: input.startSession,
    endSession: input.endSession,
    dayCounting: type.dayCounting,
    unit,
  });
  for (const e of counted.errors) {
    issues.push({
      code: e.path === "startDate" ? "not_eligible" : "validation_failed",
      path: e.path,
      message: e.message,
    });
  }
  if (!counted.errors.length && counted.totalHundredths === 0) {
    issues.push({
      code: "validation_failed",
      path: "endDate",
      message:
        "These dates are all rest days, off days or public holidays, so there is nothing to take. Change the dates.",
    });
  }
  const children = await childrenOf(db, orgId, input.employeeId);
  const child = input.childId ? (children.find((c) => c.id === input.childId) ?? null) : null;
  if (input.childId && !child) {
    issues.push({
      code: "validation_failed",
      path: "childId",
      message: "That child isn't on this employee's record. Pick one from the list.",
    });
  }
  if (needsChild(type) && !input.childId) {
    issues.push({
      code: "validation_failed",
      path: "childId",
      message: `${type.name} is per child. Choose the child (add them under Children first).`,
    });
  }
  const years: QuoteYear[] = [];
  const balances: Balance[] = [];
  if (!counted.errors.length) {
    // Per-child entitlements span leave years: earlier years of this request use them up first.
    let usedByEarlierYears = 0;
    for (const [year, hundredths] of [...counted.byYear].sort((a, b) => a[0] - b[0])) {
      const asOf = asOfFor(opts.today, year, counted.days);
      const b = await computeBalance(db, t, type, {
        year,
        asOf,
        childId: child?.id ?? null,
        children,
        excludeRequestId: opts.excludeRequestId,
        types,
      });
      if (b.childId && b.available !== null) {
        b.available -= usedByEarlierYears;
        usedByEarlierYears += hundredths;
      }
      balances.push(b);
      years.push({
        year,
        hundredths,
        tracked: b.tracked,
        available: b.available,
        after: b.available === null ? null : b.available - hundredths,
      });
      const firstDate = counted.days.find((d) => d.leaveYear === year && d.hundredths > 0)?.date ?? asOf;
      if (b.tracked && (!b.eligible || (b.eligibleFrom && firstDate < b.eligibleFrom))) {
        issues.push({
          code: "not_eligible",
          path: "leaveTypeId",
          message:
            b.eligibleFrom && firstDate < b.eligibleFrom
              ? `${type.name} can be taken from ${displayDate(b.eligibleFrom)} (after ${type.policy.minServiceMonths} months of service).`
              : (b.explanation.find(Boolean) ?? `Not eligible for ${type.name.toLowerCase()}.`),
        });
      } else if (b.available !== null && b.available < hundredths) {
        issues.push({
          code: "insufficient_balance",
          path: "endDate",
          message: `Not enough ${type.name.toLowerCase()} for ${year}: ${fmtQty(hundredths, unit)} asked, ${fmtQty(Math.max(0, b.available), unit)} available after pending requests. Shorten the dates or choose another type.`,
        });
      }
    }
    if (type.statutoryCode === "infant_care" && child) {
      const used = await childUsage(db, orgId, input.employeeId, type.id, child.id, opts.excludeRequestId);
      if (used + counted.totalHundredths > 24 * 100) {
        issues.push({
          code: "insufficient_balance",
          path: "childId",
          message: `Unpaid infant care leave is at most 24 days per child; ${used / 100} days are already taken or pending for ${child.name}.`,
        });
      }
    }
    const clash = await overlaps(db, orgId, input.employeeId, counted.days, opts.excludeRequestId);
    if (clash.length) {
      issues.push({
        code: "leave_overlap",
        path: "startDate",
        message: `There is already leave on ${clash
          .map((c) => displayDate(c.date))
          .slice(0, 3)
          .join(", ")}. Withdraw or change that request first.`,
      });
    }
  }
  return {
    employeeId: input.employeeId,
    type,
    unit,
    days: counted.days,
    totalHundredths: counted.totalHundredths,
    years,
    issues,
    warnings: counted.warnings,
    attachment: type.attachment,
    needsChild: needsChild(type),
  };
}

async function childUsage(db: Db, orgId: string, employeeId: string, typeId: string, childId: string, except?: string) {
  const org = orgScope(db, orgId);
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
        eq(leaveRequestDays.employeeId, employeeId),
        eq(leaveRequestDays.leaveTypeId, typeId),
        eq(leaveRequests.childId, childId),
        inArray(leaveRequests.status, ["pending", "approved", "cancellation_pending"]),
        except ? sql`${leaveRequests.id} <> ${except}` : undefined,
      ),
    );
  return Number(row?.total ?? 0);
}

export function throwFirst(issues: QuoteIssue[]) {
  const first = issues[0];
  if (!first) return;
  throw new AppError(first.code, first.message, {
    issues: issues.map((i) => ({ path: i.path, message: i.message, code: i.code })),
  });
}

// ---------------------------------------------------------------------------------------------
// Attachments
// ---------------------------------------------------------------------------------------------

function decodeBase64(data: string): Uint8Array {
  const clean = data.replace(/^data:[^;]+;base64,/, "").replace(/\s+/g, "");
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(clean)) {
    throw new AppError("validation_failed", "The attachment isn't valid base64. Attach the file again.", {
      issues: [{ path: "attachments", message: "Attach the file again." }],
    });
  }
  const bin = atob(clean);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Content sniffing: the declared type must match the file's magic bytes. */
export function sniffContentType(bytes: Uint8Array): (typeof ATTACHMENT_TYPES)[number] | null {
  const type = sniffType(bytes);
  return type && ["application/pdf", "image/jpeg", "image/png", "image/webp", "image/heic"].includes(type)
    ? (type as (typeof ATTACHMENT_TYPES)[number])
    : null;
}

export async function storeAttachments(
  tx: Db,
  deps: AppDeps,
  input: { orgId: string; requestId: string; membershipId: string },
  files: z.output<typeof attachmentInput>[],
) {
  const request = await orgScope(tx, input.orgId).getById(leaveRequests, input.requestId, "leave request");
  const stored: { id: string; filename: string }[] = [];
  for (const [i, f] of files.entries()) {
    const bytes = decodeBase64(f.dataBase64);
    if (bytes.length > ATTACHMENT_MAX_BYTES) {
      throw new AppError("validation_failed", "Attach a file of 5 MB or less.", {
        issues: [{ path: `attachments.${i}`, message: `${f.filename} is larger than 5 MB.` }],
      });
    }
    if (sniffContentType(bytes) !== f.contentType) {
      throw new AppError(
        "validation_failed",
        `${f.filename} doesn't look like a PDF or photo. Attach a PDF, JPEG, PNG, WebP or HEIC file.`,
        {
          issues: [{ path: `attachments.${i}`, message: "The file's content doesn't match its type." }],
        },
      );
    }
    const file = await storeFileInTx(tx, deps, {
      orgId: input.orgId,
      purpose: "leave_attachment",
      data: bytes,
      fileName: f.filename,
      ownerEmployeeId: request.employeeId,
      uploadedByMembershipId: input.membershipId,
      accept: ["application/pdf", "image/jpeg", "image/png", "image/webp", "image/heic"],
      rejectMessage: "Attach a PDF, JPEG, PNG, WebP or HEIC file without active content.",
      maxBytes: ATTACHMENT_MAX_BYTES,
      audit: {
        ...systemAuditContext(input.orgId, "system", "leave-attachment"),
        actorType: "member",
        actorMembershipId: input.membershipId,
      },
    });
    const id = file.id;
    await tx.insert(leaveAttachments).values({
      id,
      orgId: input.orgId,
      requestId: input.requestId,
      fileKey: file.storageKey,
      filename: file.originalName,
      contentType: file.mime,
      sizeBytes: file.sizeBytes,
      uploadedByMembershipId: input.membershipId,
    });
    stored.push({ id, filename: f.filename });
  }
  return stored;
}

// ---------------------------------------------------------------------------------------------
// Apply
// ---------------------------------------------------------------------------------------------

/** Resolves whose leave this is: the caller's own, or (owner / hr_admin) on behalf of anyone in scope. */
export async function resolveTargetEmployee(
  actor: LeaveActor,
  grant: Grant,
  employeeId: string | undefined,
): Promise<string> {
  const target = employeeId ?? actor.employeeId;
  if (!target) {
    throw new AppError(
      "validation_failed",
      "Your sign-in isn't linked to an employee record, so choose the employee.",
      {
        issues: [{ path: "employeeId", message: "Choose the employee." }],
      },
    );
  }
  await grant.assertEmployee(target, "employee");
  return target;
}

/** The active membership linked to an employee (on-behalf requests are routed as the employee's own). */
export async function memberForEmployee(db: Db, orgId: string, employeeId: string): Promise<string | null> {
  const [m] = await db
    .select({ id: memberships.id })
    .from(memberships)
    .where(
      and(
        eq(memberships.orgId, orgId),
        eq(memberships.employeeId, employeeId),
        inArray(memberships.status, ["active", "invited"]),
      ),
    )
    .limit(1);
  return m?.id ?? null;
}

export async function applyLeave(deps: AppDeps, actor: LeaveActor, employeeId: string, input: ApplyInput) {
  await ensureLeaveSetup(deps, actor.orgId);
  const today = singaporeDate(deps.clock.now());
  return deps.db.transaction(async (tx) => {
    await lockEmployeeLeave(tx, actor.orgId, employeeId);
    const quote = await quoteLeave(tx, actor.orgId, { ...input, employeeId }, { today });
    const files = input.attachments ?? [];
    if (quote.attachment === "required" && files.length === 0) {
      quote.issues.push({
        code: "validation_failed",
        path: "attachments",
        message: `Attach the ${quote.type.attachmentLabel ?? "supporting document"} to apply for ${quote.type.name.toLowerCase()}.`,
      });
    }
    throwFirst(quote.issues);
    const id = deps.ids.newId();
    const onBehalf = actor.employeeId !== employeeId;
    const single = input.startDate === input.endDate;
    await tx.insert(leaveRequests).values({
      id,
      orgId: actor.orgId,
      employeeId,
      leaveTypeId: quote.type.id,
      childId: input.childId ?? null,
      startDate: input.startDate,
      endDate: input.endDate,
      startSession: single ? input.startSession : input.startSession === "pm" ? "pm" : "full",
      endSession: single ? input.startSession : input.endSession === "am" ? "am" : "full",
      unit: quote.unit,
      hundredths: quote.totalHundredths,
      reason: input.reason ?? null,
      status: "pending",
      requestedByMembershipId: actor.membershipId,
      onBehalf,
    });
    const counted = quote.days.filter((d) => d.hundredths > 0);
    await tx.insert(leaveRequestDays).values(
      counted.map((d) => ({
        id: deps.ids.newId(),
        orgId: actor.orgId,
        requestId: id,
        employeeId,
        leaveTypeId: quote.type.id,
        date: d.date,
        session: d.session,
        hundredths: d.hundredths,
        leaveYear: d.leaveYear,
      })),
    );
    if (files.length) {
      await storeAttachments(tx, deps, { orgId: actor.orgId, requestId: id, membershipId: actor.membershipId }, files);
    }
    await recordAudit(tx, deps, actor.audit, {
      action: "leave.applied",
      targetType: "leave_request",
      targetId: id,
      meta: {
        employeeId,
        type: quote.type.code,
        startDate: input.startDate,
        endDate: input.endDate,
        quantity: quote.totalHundredths / 100,
        unit: quote.unit,
        onBehalf,
      },
    });
    const requester = onBehalf ? await memberForEmployee(tx, actor.orgId, employeeId) : null;
    const approval = await submitApproval(tx, deps, actor.audit, {
      orgId: actor.orgId,
      subjectType: "leave",
      subjectId: id,
      requesterMembershipId: requester ?? actor.membershipId,
      requesterEmployeeId: employeeId,
      attributes: { typeCode: quote.type.code },
    });
    await tx
      .update(leaveRequests)
      .set({ approvalRequestId: approval.requestId })
      .where(orgScope(tx, actor.orgId).whereId(leaveRequests, id));
    return { id, quote };
  });
}
