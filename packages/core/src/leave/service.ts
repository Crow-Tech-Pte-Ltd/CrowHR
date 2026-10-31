import { asc, sql } from "drizzle-orm";
import { z } from "zod";
import type { AssignedRole } from "../access/matrix.ts";
import { orgScope } from "../access/org-scope.ts";
import type { AuditContext } from "../audit/audit.ts";
import { type LeaveType, leaveTypes } from "../db/schema/leave.ts";
import type { Db } from "../db/types.ts";
import type { AppDeps } from "../deps.ts";
import { isIsoDate } from "../employees/dates.ts";
import { AppError } from "../errors.ts";
import type { CountedDay } from "./calendar.ts";
import { ensureLeaveSetup } from "./defaults.ts";

/** Shared leave service types, inputs and helpers. */

/** Who is acting on leave (from the request's auth, or a job). */
export interface LeaveActor {
  orgId: string;
  membershipId: string;
  employeeId: string | null;
  roles: readonly AssignedRole[];
  audit: AuditContext;
}

export const isoDate = z.string().refine(isIsoDate, { message: "Use the date format YYYY-MM-DD, like 2026-11-04." });
export const sessionSchema = z.enum(["full", "am", "pm"]);

export const ATTACHMENT_TYPES = ["application/pdf", "image/jpeg", "image/png", "image/webp", "image/heic"] as const;
export const ATTACHMENT_MAX_BYTES = 5 * 1024 * 1024;

export const attachmentInput = z.object({
  filename: z.string().trim().min(1, "Give the file a name.").max(120, "Shorten the file name to 120 characters."),
  contentType: z.enum(ATTACHMENT_TYPES, { message: "Attach a PDF, JPEG, PNG, WebP or HEIC file." }),
  dataBase64: z
    .string()
    .min(1, "Attach the file.")
    .max(Math.ceil((ATTACHMENT_MAX_BYTES * 4) / 3) + 64, "Attach a file of 5 MB or less."),
});

export const quoteInput = z.object({
  employeeId: z.uuid().optional(),
  leaveTypeId: z.uuid({ message: "Choose a leave type." }),
  startDate: isoDate,
  endDate: isoDate,
  startSession: sessionSchema.default("full"),
  endSession: sessionSchema.default("full"),
  childId: z.uuid().nullish(),
});

export const applyInput = quoteInput.extend({
  reason: z.string().trim().max(500, "Keep the reason to 500 characters.").nullish(),
  attachments: z.array(attachmentInput).max(5, "Attach at most 5 files.").optional(),
});

export type QuoteInput = z.output<typeof quoteInput>;
export type ApplyInput = z.output<typeof applyInput>;

export interface QuoteIssue {
  code: "validation_failed" | "not_eligible" | "insufficient_balance" | "leave_overlap";
  path: string;
  message: string;
}

export interface QuoteYear {
  year: number;
  hundredths: number;
  tracked: boolean;
  available: number | null;
  after: number | null;
}

export interface Quote {
  employeeId: string;
  type: LeaveType;
  unit: "days" | "hours";
  days: CountedDay[];
  totalHundredths: number;
  years: QuoteYear[];
  issues: QuoteIssue[];
  warnings: string[];
  attachment: LeaveType["attachment"];
  needsChild: boolean;
}

export async function listTypes(deps: AppDeps, orgId: string): Promise<LeaveType[]> {
  await ensureLeaveSetup(deps, orgId);
  const org = orgScope(deps.db, orgId);
  return deps.db
    .select()
    .from(leaveTypes)
    .where(org.where(leaveTypes))
    .orderBy(asc(leaveTypes.sortOrder), asc(leaveTypes.name));
}

export async function getType(db: Db, orgId: string, typeId: string): Promise<LeaveType> {
  const row = await orgScope(db, orgId).findById(leaveTypes, typeId);
  if (!row) throw new AppError("not_found", "That leave type doesn't exist.");
  return row;
}

/** Serialises balance checks for one employee (all types: outpatient days count against hospitalisation). */
export async function lockEmployeeLeave(db: Db, orgId: string, employeeId: string) {
  await db.execute(sql`select pg_advisory_xact_lock(hashtext(${`crowhr:leave:${orgId}:${employeeId}`}))`);
}
