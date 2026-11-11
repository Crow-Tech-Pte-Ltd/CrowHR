import { and, asc, count, desc, eq, ilike, inArray, isNull, ne, notInArray, or, type SQL, sql } from "drizzle-orm";
import { recordAudit } from "../audit/audit.ts";
import { type ClaimStatus, claimLineFiles, claimLines, claims, claimTypes } from "../db/schema/claims.ts";
import { employees } from "../db/schema/employees.ts";
import { files, orgCounters } from "../db/schema/files.ts";
import type { Db } from "../db/types.ts";
import type { AppDeps } from "../deps.ts";
import { addDays } from "../employees/dates.ts";
import { AppError } from "../errors.ts";
import { RECEIPT_TYPES } from "../files/sniff.ts";
import { storeFile } from "../files/uploads.ts";
import { toLimitOffset } from "../http/list.ts";
import { submitApproval, withdrawSubject } from "../workflows/engine.ts";
import { approverRole, type ClaimsActor, canSeeMedical, claimsWithTasks, inScope, scopeFor } from "./access.ts";
import { assertWithinCaps, type CapUsage, claimCapUsage, lockCaps, usageFor } from "./caps.ts";
import {
  currencyExponent,
  formatRateMicros,
  lineSgdCents,
  MoneyOverflowError,
  moneyError,
  parseRateMicros,
  sgd,
  sumCents,
} from "./money.ts";
import { employeeSummaries, membershipOfEmployee } from "./people.ts";
import {
  type ClaimTypeRow,
  employmentFacts,
  getClaimSettings,
  ineligibleReason,
  receiptRequired,
  receiptRuleLabel,
} from "./types.ts";

/**
 * Claims (spec "Multi-line claims", "Submission and approval", "Receipts"). Drafts are saved with
 * structural checks only; submission validates everything, checks caps under the advisory lock,
 * numbers the claim and submits it to the workflows engine in one transaction.
 */

export const MAX_LINES = 30;
export const MAX_RECEIPTS_PER_LINE = 5;
export const RECEIPT_PURPOSE = "claim_receipt";
export const RECEIPT_REJECT_MESSAGE = "This file is not a PDF or image. Upload a photo or PDF of the receipt";

export interface LineInput {
  claimTypeId: string;
  expenseDate: string;
  merchant: string;
  description: string;
  currency: string;
  amountMinor: number;
  /** SGD per 1 unit, as typed (up to 6 decimal places). Required for non-SGD lines. */
  rate?: string | null;
  gstCents?: number | null;
  receiptIds: string[];
}

export interface ClaimInput {
  employeeId?: string | null;
  title?: string | null;
  lines: LineInput[];
}

type ClaimRow = typeof claims.$inferSelect;
type LineRow = typeof claimLines.$inferSelect;
type FileRow = typeof files.$inferSelect;

interface Issue {
  path: string;
  message: string;
}

const lineNo = (i: number) => `Line ${i + 1}`;

// ---------------------------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------------------------

async function typesById(db: Db, orgId: string, ids?: readonly string[]): Promise<Map<string, ClaimTypeRow>> {
  const rows = await db
    .select()
    .from(claimTypes)
    .where(
      and(
        eq(claimTypes.orgId, orgId),
        ids ? inArray(claimTypes.id, ids.length ? [...ids] : ["00000000-0000-0000-0000-000000000000"]) : undefined,
      ),
    );
  return new Map(rows.map((r) => [r.id, r]));
}

interface LoadedClaim {
  claim: ClaimRow;
  lines: (LineRow & { receipts: FileRow[] })[];
}

async function loadLines(db: Db, orgId: string, claimId: string): Promise<LoadedClaim["lines"]> {
  const lines = await db
    .select()
    .from(claimLines)
    .where(and(eq(claimLines.orgId, orgId), eq(claimLines.claimId, claimId)))
    .orderBy(asc(claimLines.position));
  if (!lines.length) return [];
  const links = await db
    .select({ lineId: claimLineFiles.claimLineId, position: claimLineFiles.position, file: files })
    .from(claimLineFiles)
    .innerJoin(files, and(eq(files.orgId, claimLineFiles.orgId), eq(files.id, claimLineFiles.fileId)))
    .where(
      and(
        eq(claimLineFiles.orgId, orgId),
        inArray(
          claimLineFiles.claimLineId,
          lines.map((l) => l.id),
        ),
      ),
    )
    .orderBy(asc(claimLineFiles.position));
  return lines.map((l) => ({ ...l, receipts: links.filter((k) => k.lineId === l.id).map((k) => k.file) }));
}

export async function loadClaim(
  db: Db,
  orgId: string,
  claimId: string,
  opts: { lock?: boolean } = {},
): Promise<LoadedClaim> {
  const q = db
    .select()
    .from(claims)
    .where(and(eq(claims.orgId, orgId), eq(claims.id, claimId)));
  const [claim] = opts.lock ? await q.for("update") : await q;
  if (!claim) throw new AppError("not_found", "That claim doesn't exist or you can't see it.");
  return { claim, lines: await loadLines(db, orgId, claimId) };
}

// ---------------------------------------------------------------------------------------------
// Access
// ---------------------------------------------------------------------------------------------

/** May the actor create/edit/submit claims for this employee (own, or owner/hr_admin on behalf)? */
async function canCreateFor(actor: ClaimsActor, employeeId: string) {
  return inScope(actor, "claims:create", employeeId);
}

/**
 * For an employee ID taken from the request: in scope, and (on someone's behalf) an employee of
 * this organisation, so an unknown ID is a 404 rather than a failed insert. Call before any
 * transaction.
 */
async function assertCanCreateFor(db: Db, actor: ClaimsActor, employeeId: string) {
  const known =
    employeeId === actor.employeeId ||
    (
      await db
        .select({ id: employees.id })
        .from(employees)
        .where(and(eq(employees.orgId, actor.orgId), eq(employees.id, employeeId)))
        .limit(1)
    ).length > 0;
  if (!known || !(await canCreateFor(actor, employeeId)))
    throw new AppError("not_found", "That employee doesn't exist or you can't claim for them.");
}

/**
 * Read access to one claim: claims:read scope (all / team / own) or an approval task on it.
 * Drafts are private to the claimant and whoever created them. 404 otherwise.
 */
async function assertCanRead(db: Db, actor: ClaimsActor, claim: ClaimRow) {
  const own = actor.employeeId === claim.employeeId || actor.membershipId === claim.createdByMembershipId;
  if (claim.status === "draft") {
    if (own) return;
    throw new AppError("not_found", "That claim doesn't exist or you can't see it.");
  }
  if (own || (await inScope(actor, "claims:read", claim.employeeId))) return;
  if ((await approverRole(db, actor.orgId, actor.membershipId, claim.id)).holder) return;
  throw new AppError("not_found", "That claim doesn't exist or you can't see it.");
}

// ---------------------------------------------------------------------------------------------
// DTOs
// ---------------------------------------------------------------------------------------------

export function fileDto(f: FileRow) {
  return {
    id: f.id,
    name: f.originalName,
    mime: f.mime,
    sizeBytes: f.sizeBytes,
    scanStatus: f.scanStatus,
    removed: f.deletedAt !== null,
    previewable: f.mime !== "image/heic" && f.mime !== "application/pdf" && f.deletedAt === null,
    url: `/api/v1/claims/receipts/${f.id}`,
    uploadedAt: f.createdAt.toISOString(),
  };
}

async function duplicatesFor(db: Db, orgId: string, claimId: string, receipts: FileRow[]) {
  const shas = [...new Set(receipts.map((r) => r.sha256))];
  if (!shas.length) return [];
  const rows = await db
    .select({ sha256: files.sha256, claimId: claims.id, claimNumber: claims.claimNumber })
    .from(files)
    .innerJoin(claimLineFiles, and(eq(claimLineFiles.orgId, files.orgId), eq(claimLineFiles.fileId, files.id)))
    .innerJoin(claimLines, and(eq(claimLines.orgId, files.orgId), eq(claimLines.id, claimLineFiles.claimLineId)))
    .innerJoin(claims, and(eq(claims.orgId, files.orgId), eq(claims.id, claimLines.claimId)))
    .where(
      and(
        eq(files.orgId, orgId),
        inArray(files.sha256, shas),
        ne(claims.id, claimId),
        notInArray(claims.status, ["draft", "rejected", "withdrawn"]),
      ),
    );
  const out: { fileId: string; claimId: string; claimNumber: string | null }[] = [];
  for (const r of receipts) {
    for (const d of rows.filter((x) => x.sha256 === r.sha256)) {
      if (!out.some((o) => o.fileId === r.id && o.claimId === d.claimId))
        out.push({ fileId: r.id, claimId: d.claimId, claimNumber: d.claimNumber });
    }
  }
  return out;
}

export type ClaimDto = Awaited<ReturnType<typeof toClaimDto>>;

export async function toClaimDto(deps: AppDeps, actor: ClaimsActor, loaded: LoadedClaim) {
  const { claim, lines } = loaded;
  const db = deps.db;
  const types = await typesById(
    db,
    actor.orgId,
    lines.map((l) => l.claimTypeId),
  );
  const people = await employeeSummaries(db, actor.orgId, [claim.employeeId], actor.today);
  const medicalOk = await canSeeMedical(db, actor, claim);
  const outLines = [];
  for (const l of lines) {
    const t = types.get(l.claimTypeId);
    const medical = t?.category === "medical";
    const hidden = medical && !medicalOk;
    outLines.push({
      id: l.id,
      position: l.position,
      claimTypeId: l.claimTypeId,
      typeCode: t?.code ?? "",
      typeName: t?.name ?? "",
      category: t?.category ?? "other",
      expenseDate: l.expenseDate,
      ...(hidden ? {} : { merchant: l.merchant, description: l.description, receipts: l.receipts.map(fileDto) }),
      receiptCount: l.receipts.length,
      currency: l.currency,
      amountMinor: l.amountMinor,
      rate: l.rateMicros === null ? null : formatRateMicros(l.rateMicros),
      sgdCents: l.sgdCents,
      gstCents: l.gstCents,
      receiptRequired: t ? receiptRequired(t, l.sgdCents) : false,
      duplicates: hidden || claim.status === "draft" ? [] : await duplicatesFor(db, actor.orgId, claim.id, l.receipts),
      ...(hidden ? { redactedFields: ["merchant", "description", "receipts"] } : {}),
    });
  }
  const capUsage: CapUsage[] =
    claim.status === "draft" || claim.status === "submitted"
      ? await claimCapUsage(db, {
          orgId: actor.orgId,
          employeeId: claim.employeeId,
          claimId: claim.id,
          lines: lines.map((l, index) => ({
            index,
            claimTypeId: l.claimTypeId,
            expenseDate: l.expenseDate,
            sgdCents: l.sgdCents,
          })),
          types,
        })
      : [];
  const mayCreate = await canCreateFor(actor, claim.employeeId);
  const isClaimant = actor.employeeId === claim.employeeId || actor.membershipId === claim.submittedByMembershipId;
  const person = people.get(claim.employeeId);
  return {
    id: claim.id,
    claimNumber: claim.claimNumber,
    status: claim.status,
    title: claim.title,
    employee: {
      id: claim.employeeId,
      name: person?.name ?? "",
      employeeNumber: person?.employeeNumber ?? "",
      departmentName: person?.departmentName ?? null,
    },
    totalCents: claim.totalCents,
    gstCents: sumCents(lines.map((l) => l.gstCents ?? 0)),
    payoutMethod: claim.payoutMethod,
    approvalRequestId: claim.approvalRequestId,
    submittedAt: claim.submittedAt?.toISOString() ?? null,
    decidedAt: claim.decidedAt?.toISOString() ?? null,
    approvedOn: claim.approvedOn,
    decisionComment: claim.decisionComment,
    reservedByPayrollRun: claim.payrollRunId !== null && claim.status === "approved",
    paidVia: claim.paidVia,
    paidOn: claim.paidOn,
    paidReference: claim.paidReference,
    copiedFromClaimId: claim.copiedFromClaimId,
    createdAt: claim.createdAt.toISOString(),
    updatedAt: claim.updatedAt.toISOString(),
    lines: outLines,
    capUsage,
    actions: {
      edit: claim.status === "draft" && mayCreate,
      submit: claim.status === "draft" && mayCreate,
      delete: claim.status === "draft" && mayCreate,
      withdraw: claim.status === "submitted" && isClaimant,
      copy: (claim.status === "rejected" || claim.status === "withdrawn") && mayCreate,
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Draft lines (structural validation only)
// ---------------------------------------------------------------------------------------------

interface PreparedLine {
  input: LineInput;
  type: ClaimTypeRow;
  currency: string;
  exponent: number;
  rateMicros: number | null;
  sgdCents: number;
  gstCents: number | null;
}

async function prepareLines(db: Db, orgId: string, employeeId: string, input: readonly LineInput[]) {
  const issues: Issue[] = [];
  if (input.length < 1 || input.length > MAX_LINES) {
    issues.push({ path: "lines", message: `A claim has 1 to ${MAX_LINES} lines. Add a line or split the claim.` });
  }
  const types = await typesById(
    db,
    orgId,
    input.map((l) => l.claimTypeId),
  );
  const fileIds = [...new Set(input.flatMap((l) => l.receiptIds))];
  const fileRows = fileIds.length
    ? await db
        .select()
        .from(files)
        .where(and(eq(files.orgId, orgId), inArray(files.id, fileIds)))
    : [];
  const fileMap = new Map(fileRows.map((f) => [f.id, f]));
  const prepared: PreparedLine[] = [];
  input.forEach((l, i) => {
    const p = `lines.${i}`;
    const type = types.get(l.claimTypeId);
    if (!type) issues.push({ path: `${p}.claimTypeId`, message: `${lineNo(i)}: pick a claim type from the list.` });
    const currency = l.currency.toUpperCase();
    const exponent = currencyExponent(currency);
    if (exponent === null)
      issues.push({ path: `${p}.currency`, message: `${lineNo(i)}: ${l.currency} is not an ISO 4217 currency code.` });
    let rateMicros: number | null = null;
    if (currency !== "SGD") {
      rateMicros = l.rate ? parseRateMicros(l.rate) : null;
      if (rateMicros === null)
        issues.push({
          path: `${p}.rate`,
          message: `${lineNo(i)}: enter the exchange rate as SGD per 1 ${currency}, with up to 6 decimal places (e.g. 0.301234).`,
        });
    } else if (l.rate) {
      issues.push({
        path: `${p}.rate`,
        message: `${lineNo(i)}: SGD expenses don't take an exchange rate. Clear the rate.`,
      });
    }
    let sgdCents = 0;
    if (exponent !== null && (currency === "SGD" || rateMicros !== null)) {
      try {
        sgdCents = lineSgdCents({ currency, amountMinor: l.amountMinor, rateMicros });
      } catch (err) {
        moneyError(err, `${p}.amountMinor`);
      }
    }
    if (sgdCents === 0 && l.amountMinor > 0 && currency !== "SGD" && rateMicros !== null) {
      issues.push({
        path: `${p}.amountMinor`,
        message: `${lineNo(i)}: ${l.currency.toUpperCase()} ${l.amountMinor} at that rate is less than half a cent, so it would be S$0.00. Check the amount and rate, or leave the line out.`,
      });
    }
    const gstCents = l.gstCents ?? null;
    if (gstCents !== null && gstCents > 0 && currency !== "SGD") {
      issues.push({
        path: `${p}.gstCents`,
        message: "GST applies only to SGD expenses. Remove the GST amount for this line",
      });
    } else if (gstCents !== null && gstCents > sgdCents) {
      issues.push({
        path: `${p}.gstCents`,
        message: `${lineNo(i)}: GST is included in the amount, so it can't be more than the amount.`,
      });
    }
    if (l.receiptIds.length > MAX_RECEIPTS_PER_LINE) {
      issues.push({
        path: `${p}.receiptIds`,
        message: `${lineNo(i)}: attach at most ${MAX_RECEIPTS_PER_LINE} receipts.`,
      });
    }
    for (const id of l.receiptIds) {
      const f = fileMap.get(id);
      // Another employee's (or another org's) file is indistinguishable from a missing one.
      if (!f || f.ownerEmployeeId !== employeeId || f.purpose !== RECEIPT_PURPOSE || f.deletedAt) {
        issues.push({ path: `${p}.receiptIds`, message: `${lineNo(i)}: a receipt is missing. Upload it again.` });
      }
    }
    if (type && exponent !== null)
      prepared.push({
        input: l,
        type,
        currency,
        exponent,
        rateMicros,
        sgdCents,
        gstCents: currency === "SGD" ? gstCents : null,
      });
  });
  if (!issues.length) {
    try {
      sumCents(prepared.map((l) => l.sgdCents));
    } catch (err) {
      if (!(err instanceof MoneyOverflowError)) throw err;
      issues.push({
        path: "lines",
        message:
          "The claim's total is too large to store. Check the amounts, or split the expenses into separate claims.",
      });
    }
  }
  if (issues.length) throw new AppError("validation_failed", "Some claim lines need fixing.", { issues });
  return { lines: prepared, files: fileMap };
}

async function writeLines(deps: AppDeps, tx: Db, orgId: string, claimId: string, lines: PreparedLine[]) {
  await tx.delete(claimLines).where(and(eq(claimLines.orgId, orgId), eq(claimLines.claimId, claimId)));
  let position = 0;
  for (const l of lines) {
    const id = deps.ids.newId();
    position++;
    await tx.insert(claimLines).values({
      id,
      orgId,
      claimId,
      position,
      claimTypeId: l.type.id,
      expenseDate: l.input.expenseDate,
      merchant: l.input.merchant.trim(),
      description: l.input.description.trim(),
      currency: l.currency,
      currencyExponent: l.exponent,
      amountMinor: l.input.amountMinor,
      rateMicros: l.rateMicros,
      sgdCents: l.sgdCents,
      gstCents: l.gstCents,
    });
    let fp = 0;
    for (const fileId of [...new Set(l.input.receiptIds)]) {
      await tx.insert(claimLineFiles).values({ orgId, claimLineId: id, fileId, position: ++fp });
    }
  }
  return sumCents(lines.map((l) => l.sgdCents));
}

export async function createDraft(deps: AppDeps, actor: ClaimsActor, input: ClaimInput) {
  const employeeId = input.employeeId ?? actor.employeeId;
  if (!employeeId) {
    throw new AppError(
      "validation_failed",
      "Your account isn't linked to an employee record. Pick the employee this claim is for.",
      {
        issues: [{ path: "employeeId", message: "Choose an employee." }],
      },
    );
  }
  await assertCanCreateFor(deps.db, actor, employeeId);
  const { lines } = await prepareLines(deps.db, actor.orgId, employeeId, input.lines);
  const id = deps.ids.newId();
  await deps.db.transaction(async (tx) => {
    const now = deps.clock.now();
    await tx.insert(claims).values({
      id,
      orgId: actor.orgId,
      employeeId,
      status: "draft",
      title: input.title?.trim() || null,
      createdByMembershipId: actor.membershipId,
      createdAt: now,
      updatedAt: now,
    });
    const total = await writeLines(deps, tx, actor.orgId, id, lines);
    await tx.update(claims).set({ totalCents: total }).where(eq(claims.id, id));
    await recordAudit(tx, deps, actor.auditCtx, {
      action: "claim.draft_created",
      targetType: "claim",
      targetId: id,
      meta: { employeeId, lines: lines.length },
    });
  });
  return id;
}

async function assertEditable(db: Db, actor: ClaimsActor, claim: ClaimRow) {
  await assertCanRead(db, actor, claim);
  if (!(await canCreateFor(actor, claim.employeeId))) {
    throw new AppError("not_found", "That claim doesn't exist or you can't see it.");
  }
  if (claim.status !== "draft") {
    throw new AppError(
      "conflict",
      claim.status === "submitted"
        ? "A submitted claim can't be edited. Withdraw it first, then copy it into a new draft."
        : `This claim is ${claim.status} and can't be edited.${claim.status === "rejected" ? " Copy it into a new draft instead." : ""}`,
    );
  }
}

export async function updateDraft(deps: AppDeps, actor: ClaimsActor, claimId: string, input: ClaimInput) {
  const { claim } = await loadClaim(deps.db, actor.orgId, claimId);
  await assertEditable(deps.db, actor, claim);
  const { lines } = await prepareLines(deps.db, actor.orgId, claim.employeeId, input.lines);
  await deps.db.transaction(async (tx) => {
    const { claim: locked } = await loadClaim(tx, actor.orgId, claimId, { lock: true });
    if (locked.status !== "draft")
      throw new AppError("conflict", "This claim was submitted meanwhile. Reload to see it.");
    const total = await writeLines(deps, tx, actor.orgId, claimId, lines);
    await tx
      .update(claims)
      .set({ title: input.title?.trim() || null, totalCents: total, updatedAt: deps.clock.now() })
      .where(eq(claims.id, claimId));
    await recordAudit(tx, deps, actor.auditCtx, {
      action: "claim.draft_updated",
      targetType: "claim",
      targetId: claimId,
      meta: { lines: lines.length },
    });
  });
}

export async function deleteDraft(deps: AppDeps, actor: ClaimsActor, claimId: string) {
  const { claim } = await loadClaim(deps.db, actor.orgId, claimId);
  await assertEditable(deps.db, actor, claim);
  await deps.db.transaction(async (tx) => {
    await tx
      .delete(claims)
      .where(and(eq(claims.orgId, actor.orgId), eq(claims.id, claimId), eq(claims.status, "draft")));
    await recordAudit(tx, deps, actor.auditCtx, {
      action: "claim.draft_deleted",
      targetType: "claim",
      targetId: claimId,
    });
  });
}

// ---------------------------------------------------------------------------------------------
// Submit
// ---------------------------------------------------------------------------------------------

async function nextClaimNumber(tx: Db, orgId: string): Promise<string> {
  const [row] = await tx
    .insert(orgCounters)
    .values({ orgId, name: "claim_number", nextValue: 2 })
    .onConflictDoUpdate({
      target: [orgCounters.orgId, orgCounters.name],
      set: { nextValue: sql`${orgCounters.nextValue} + 1` },
    })
    .returning({ next: orgCounters.nextValue });
  const n = (row?.next ?? 2) - 1;
  return `C-${String(n).padStart(4, "0")}`;
}

/** The type code sent to the workflows engine: the claim's largest type by SGD amount (first on a tie). */
export function primaryTypeCode(lines: readonly { typeCode: string; sgdCents: number }[]): string {
  const totals = new Map<string, number>();
  for (const l of lines) totals.set(l.typeCode, (totals.get(l.typeCode) ?? 0) + l.sgdCents);
  let best = "";
  let bestCents = -1;
  for (const [code, cents] of totals) {
    if (cents > bestCents) {
      best = code;
      bestCents = cents;
    }
  }
  return best;
}

/** Full submission checks (spec "Multi-line claims", "Receipts", "GST field"). Throws 400 / 422. */
async function validateForSubmit(db: Db, actor: ClaimsActor, loaded: LoadedClaim, types: Map<string, ClaimTypeRow>) {
  const { claim, lines } = loaded;
  const issues: Issue[] = [];
  const today = actor.today;
  const { submissionWindowDays: window } = await getClaimSettings(db, actor.orgId);
  const oldest = addDays(today, -window);
  if (lines.length < 1 || lines.length > MAX_LINES)
    issues.push({ path: "lines", message: `A claim has 1 to ${MAX_LINES} lines. Add a line or split the claim.` });
  const facts = await employmentFacts(db, actor.orgId, claim.employeeId, today);
  lines.forEach((l, i) => {
    const p = `lines.${i}`;
    const t = types.get(l.claimTypeId);
    if (!t) return;
    const why = ineligibleReason(t, facts);
    if (why) {
      throw new AppError("not_eligible", `${lineNo(i)}: ${why} Pick another claim type.`, {
        line: i,
        claimTypeId: t.id,
        typeCode: t.code,
      });
    }
    if (l.expenseDate > today)
      issues.push({
        path: `${p}.expenseDate`,
        message: `${lineNo(i)}: the expense date is in the future. Use the date on the receipt.`,
      });
    else if (l.expenseDate < oldest)
      issues.push({
        path: `${p}.expenseDate`,
        message: `${lineNo(i)}: expenses older than ${window} days cannot be claimed.`,
      });
    if (!l.merchant.trim())
      issues.push({ path: `${p}.merchant`, message: `${lineNo(i)}: enter where you spent it (merchant).` });
    if (!l.description.trim() || l.description.trim().length > 200)
      issues.push({ path: `${p}.description`, message: `${lineNo(i)}: describe the expense in 1 to 200 characters.` });
    if (l.gstCents !== null && l.gstCents > 0 && !t.gstApplicable)
      issues.push({
        path: `${p}.gstCents`,
        message: `${lineNo(i)}: ${t.name} doesn't take GST. Remove the GST amount.`,
      });
    const live = l.receipts.filter((r) => !r.deletedAt);
    if (receiptRequired(t, l.sgdCents) && live.length === 0)
      issues.push({
        path: `${p}.receiptIds`,
        message: `${lineNo(i)}: ${t.name} needs a receipt${t.receiptRule === "above" ? ` above ${sgd(t.receiptAboveCents ?? 0)}` : ""}. Attach a photo or PDF.`,
      });
    for (const r of l.receipts) {
      if (r.deletedAt || r.scanStatus === "infected")
        issues.push({
          path: `${p}.receiptIds`,
          message: `${lineNo(i)}: ${r.originalName} was removed by the virus scanner. Upload a different file.`,
        });
      else if (r.scanStatus === "pending_scan")
        issues.push({
          path: `${p}.receiptIds`,
          message: `${lineNo(i)}: ${r.originalName} is still being scanned. Try again in a minute.`,
        });
      else if (r.scanStatus === "scan_failed")
        issues.push({
          path: `${p}.receiptIds`,
          message: `${lineNo(i)}: ${r.originalName} couldn't be scanned. Upload it again or ask HR.`,
        });
    }
  });
  if (issues.length)
    throw new AppError(
      "validation_failed",
      issues.length === 1 ? (issues[0] as Issue).message : `Fix ${issues.length} problems before submitting.`,
      {
        issues,
      },
    );
}

export async function submitClaim(deps: AppDeps, actor: ClaimsActor, claimId: string) {
  const pre = await loadClaim(deps.db, actor.orgId, claimId);
  await assertEditable(deps.db, actor, pre.claim);
  await deps.db.transaction(async (tx) => {
    const loaded = await loadClaim(tx, actor.orgId, claimId, { lock: true });
    const { claim, lines } = loaded;
    if (claim.status !== "draft") throw new AppError("conflict", "This claim was already submitted.");
    const types = await typesById(
      tx,
      actor.orgId,
      lines.map((l) => l.claimTypeId),
    );
    await validateForSubmit(tx, actor, loaded, types);
    await lockCaps(
      tx,
      actor.orgId,
      claim.employeeId,
      lines.map((l) => l.claimTypeId),
    );
    const usage = await claimCapUsage(tx, {
      orgId: actor.orgId,
      employeeId: claim.employeeId,
      claimId,
      lines: lines.map((l, index) => ({
        index,
        claimTypeId: l.claimTypeId,
        expenseDate: l.expenseDate,
        sgdCents: l.sgdCents,
      })),
      types,
    });
    assertWithinCaps(usage, "submit");
    const total = sumCents(lines.map((l) => l.sgdCents));
    const number = claim.claimNumber ?? (await nextClaimNumber(tx, actor.orgId));
    const now = deps.clock.now();
    await tx
      .update(claims)
      .set({
        status: "submitted",
        claimNumber: number,
        totalCents: total,
        submittedAt: now,
        submittedByMembershipId: actor.membershipId,
        updatedAt: now,
      })
      .where(eq(claims.id, claimId));
    const requester =
      actor.employeeId === claim.employeeId
        ? actor.membershipId
        : ((await membershipOfEmployee(tx, actor.orgId, claim.employeeId)) ?? actor.membershipId);
    const typeCode = primaryTypeCode(
      lines.map((l) => ({ typeCode: types.get(l.claimTypeId)?.code ?? "", sgdCents: l.sgdCents })),
    );
    const request = await submitApproval(tx, deps, actor.auditCtx, {
      orgId: actor.orgId,
      subjectType: "claim",
      subjectId: claimId,
      requesterMembershipId: requester,
      requesterEmployeeId: claim.employeeId,
      attributes: { amountCents: total, typeCode },
    });
    await tx.update(claims).set({ approvalRequestId: request.requestId }).where(eq(claims.id, claimId));
    await recordAudit(tx, deps, actor.auditCtx, {
      action: "claim.submitted",
      targetType: "claim",
      targetId: claimId,
      meta: {
        claimNumber: number,
        totalCents: total,
        lines: lines.length,
        onBehalf: actor.employeeId !== claim.employeeId,
      },
    });
  });
}

/** Creates a draft and submits it at once (the mobile "Submit" path). The draft is kept if submission fails. */
export async function createAndSubmit(deps: AppDeps, actor: ClaimsActor, input: ClaimInput) {
  const id = await createDraft(deps, actor, input);
  try {
    await submitClaim(deps, actor, id);
  } catch (err) {
    if (err instanceof AppError) {
      throw new AppError(err.code, err.message, { ...(err.details as object | undefined), draftId: id });
    }
    throw err;
  }
  return id;
}

// ---------------------------------------------------------------------------------------------
// Withdraw, copy
// ---------------------------------------------------------------------------------------------

export async function withdrawClaim(deps: AppDeps, actor: ClaimsActor, claimId: string) {
  const { claim } = await loadClaim(deps.db, actor.orgId, claimId);
  await assertCanRead(deps.db, actor, claim);
  const isClaimant = actor.employeeId === claim.employeeId || actor.membershipId === claim.submittedByMembershipId;
  if (!isClaimant) throw new AppError("forbidden", "Only the employee or whoever submitted the claim can withdraw it.");
  if (claim.status !== "submitted")
    throw new AppError(
      "conflict",
      `This claim is ${claim.status}. Only a submitted claim waiting for approval can be withdrawn.`,
    );
  await deps.db.transaction(async (tx) => {
    const { claim: locked } = await loadClaim(tx, actor.orgId, claimId, { lock: true });
    if (locked.status !== "submitted") throw new AppError("conflict", `This claim is already ${locked.status}.`);
    const withdrawn = await withdrawSubject(tx, deps, actor.auditCtx, {
      orgId: actor.orgId,
      subjectType: "claim",
      subjectId: claimId,
    });
    // No open request (decided meanwhile, or submitted before the engine existed): withdraw locally.
    if (!withdrawn) await markWithdrawn(tx, deps, actor.orgId, claimId);
    await recordAudit(tx, deps, actor.auditCtx, { action: "claim.withdrawn", targetType: "claim", targetId: claimId });
  });
}

export async function markWithdrawn(tx: Db, deps: AppDeps, orgId: string, claimId: string) {
  await tx
    .update(claims)
    .set({ status: "withdrawn", decidedAt: deps.clock.now(), updatedAt: deps.clock.now() })
    .where(and(eq(claims.orgId, orgId), eq(claims.id, claimId), eq(claims.status, "submitted")));
}

/** Copies a rejected or withdrawn claim into a new draft with the same lines and receipts. */
export async function copyClaim(deps: AppDeps, actor: ClaimsActor, claimId: string) {
  const { claim, lines } = await loadClaim(deps.db, actor.orgId, claimId);
  await assertCanRead(deps.db, actor, claim);
  if (!(await canCreateFor(actor, claim.employeeId)))
    throw new AppError("not_found", "That claim doesn't exist or you can't see it.");
  if (claim.status !== "rejected" && claim.status !== "withdrawn")
    throw new AppError("conflict", "Only a rejected or withdrawn claim can be copied into a new draft.");
  const id = deps.ids.newId();
  await deps.db.transaction(async (tx) => {
    const now = deps.clock.now();
    await tx.insert(claims).values({
      id,
      orgId: actor.orgId,
      employeeId: claim.employeeId,
      status: "draft",
      title: claim.title,
      totalCents: claim.totalCents,
      createdByMembershipId: actor.membershipId,
      copiedFromClaimId: claim.id,
      createdAt: now,
      updatedAt: now,
    });
    for (const l of lines) {
      const lineId = deps.ids.newId();
      await tx.insert(claimLines).values({ ...l, id: lineId, claimId: id });
      let p = 0;
      for (const r of l.receipts.filter((f) => !f.deletedAt))
        await tx
          .insert(claimLineFiles)
          .values({ orgId: actor.orgId, claimLineId: lineId, fileId: r.id, position: ++p });
    }
    await recordAudit(tx, deps, actor.auditCtx, {
      action: "claim.copied",
      targetType: "claim",
      targetId: id,
      meta: { from: claim.id, fromNumber: claim.claimNumber },
    });
  });
  return id;
}

// ---------------------------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------------------------

export async function getClaim(deps: AppDeps, actor: ClaimsActor, claimId: string) {
  const loaded = await loadClaim(deps.db, actor.orgId, claimId);
  await assertCanRead(deps.db, actor, loaded.claim);
  return toClaimDto(deps, actor, loaded);
}

export interface ClaimListQuery {
  page: number;
  pageSize: number;
  sort: string;
  q?: string;
  status?: ClaimStatus[];
  mine?: boolean;
  employeeId?: string;
  claimTypeId?: string;
  payout?: "payroll" | "outside";
  expenseFrom?: string;
  expenseTo?: string;
}

export async function listClaims(deps: AppDeps, actor: ClaimsActor, query: ClaimListQuery) {
  const db = deps.db;
  const conds: (SQL | undefined)[] = [];
  if (query.mine) {
    if (!actor.employeeId) return { items: [], page: query.page, pageSize: query.pageSize, total: 0 };
    conds.push(eq(claims.employeeId, actor.employeeId));
  } else {
    const scope = await scopeFor(actor, "claims:read");
    const ids = scope === "all" ? null : [...scope];
    // Approvers also see the claims they hold tasks for, by the rule of `approverRole` (the claim
    // itself): not superseded tasks, and cover tasks only while open.
    const taskClaims = sql`${claims.id} in (select ar.subject_id from approval_requests ar join approval_tasks at on at.org_id = ar.org_id and at.request_id = ar.id where ar.org_id = ${actor.orgId} and ar.subject_type = 'claim' and at.assignee_membership_id = ${actor.membershipId} and at.status <> 'superseded' and (at.origin <> 'delegated' or at.status = 'pending'))`;
    if (ids !== null) conds.push(ids.length ? or(inArray(claims.employeeId, ids), taskClaims) : taskClaims);
    // Other people's drafts are private.
    conds.push(
      or(
        ne(claims.status, "draft"),
        actor.employeeId ? eq(claims.employeeId, actor.employeeId) : undefined,
        eq(claims.createdByMembershipId, actor.membershipId),
      ),
    );
  }
  if (query.status?.length) conds.push(inArray(claims.status, query.status));
  if (query.employeeId) conds.push(eq(claims.employeeId, query.employeeId));
  if (query.payout) conds.push(eq(claims.payoutMethod, query.payout));
  const lineFilter: SQL[] = [];
  if (query.claimTypeId) lineFilter.push(sql`l.claim_type_id = ${query.claimTypeId}`);
  if (query.expenseFrom) lineFilter.push(sql`l.expense_date >= ${query.expenseFrom}`);
  if (query.expenseTo) lineFilter.push(sql`l.expense_date <= ${query.expenseTo}`);
  if (lineFilter.length)
    conds.push(
      sql`exists (select 1 from claim_lines l where l.org_id = ${claims.orgId} and l.claim_id = ${claims.id} and ${sql.join(lineFilter, sql` and `)})`,
    );
  if (query.q) {
    const like = `%${query.q.replace(/[%_\\]/g, (m) => `\\${m}`)}%`;
    conds.push(
      or(
        ilike(claims.claimNumber, like),
        ilike(claims.title, like),
        sql`exists (select 1 from employees e where e.org_id = ${claims.orgId} and e.id = ${claims.employeeId} and (e.legal_name ilike ${like} or e.preferred_name ilike ${like} or e.employee_number ilike ${like}))`,
      ),
    );
  }
  const where = and(eq(claims.orgId, actor.orgId), ...conds);
  const desc_ = query.sort.startsWith("-");
  const field = query.sort.replace(/^-/, "");
  const col =
    field === "totalCents"
      ? claims.totalCents
      : field === "claimNumber"
        ? claims.claimNumber
        : field === "submittedAt"
          ? claims.submittedAt
          : field === "approvedOn"
            ? claims.approvedOn
            : claims.createdAt;
  const { limit, offset } = toLimitOffset(query);
  const [totalRow] = await db.select({ n: count() }).from(claims).where(where);
  const rows = await db
    .select()
    .from(claims)
    .where(where)
    .orderBy(desc_ ? sql`${col} desc nulls last` : sql`${col} asc nulls last`, desc(claims.createdAt))
    .limit(limit)
    .offset(offset);
  const ids = rows.map((r) => r.id);
  const lineAgg = ids.length
    ? await db
        .select({
          claimId: claimLines.claimId,
          lines: count(),
          from: sql<string>`min(${claimLines.expenseDate})::text`,
          to: sql<string>`max(${claimLines.expenseDate})::text`,
          gst: sql<string>`coalesce(sum(${claimLines.gstCents}), 0)::text`,
          types: sql<string[]>`array_agg(distinct ${claimTypes.name})`,
        })
        .from(claimLines)
        .innerJoin(claimTypes, and(eq(claimTypes.orgId, claimLines.orgId), eq(claimTypes.id, claimLines.claimTypeId)))
        .where(and(eq(claimLines.orgId, actor.orgId), inArray(claimLines.claimId, ids)))
        .groupBy(claimLines.claimId)
    : [];
  const agg = new Map(lineAgg.map((a) => [a.claimId, a]));
  const people = await employeeSummaries(
    db,
    actor.orgId,
    rows.map((r) => r.employeeId),
    actor.today,
  );
  const withTasks = await claimsWithTasks(db, actor.orgId, actor.membershipId, ids);
  const nowMs = deps.clock.now().getTime();
  return {
    items: rows.map((r) => {
      const a = agg.get(r.id);
      const p = people.get(r.employeeId);
      return {
        id: r.id,
        claimNumber: r.claimNumber,
        status: r.status,
        title: r.title,
        employee: {
          id: r.employeeId,
          name: p?.name ?? "",
          employeeNumber: p?.employeeNumber ?? "",
          departmentName: p?.departmentName ?? null,
        },
        totalCents: r.totalCents,
        gstCents: Number(a?.gst ?? 0),
        lineCount: Number(a?.lines ?? 0),
        typeNames: (a?.types ?? []).filter(Boolean).sort(),
        expenseFrom: a?.from ?? null,
        expenseTo: a?.to ?? null,
        submittedAt: r.submittedAt?.toISOString() ?? null,
        daysWaiting:
          r.status === "submitted" && r.submittedAt ? Math.floor((nowMs - r.submittedAt.getTime()) / 86_400_000) : null,
        approvedOn: r.approvedOn,
        payoutMethod: r.payoutMethod,
        reservedByPayrollRun: r.payrollRunId !== null && r.status === "approved",
        paidVia: r.paidVia,
        paidOn: r.paidOn,
        paidReference: r.paidReference,
        approverTask: withTasks.has(r.id),
      };
    }),
    page: query.page,
    pageSize: query.pageSize,
    total: Number(totalRow?.n ?? 0),
  };
}

/** Eligible, active claim types for an employee, with cap usage for the period containing `date`. */
export async function eligibleTypes(
  deps: AppDeps,
  actor: ClaimsActor,
  input: { employeeId?: string; date?: string; excludeClaimId?: string },
) {
  const employeeId = input.employeeId ?? actor.employeeId;
  if (!employeeId) return [];
  await assertCanCreateFor(deps.db, actor, employeeId);
  const date = input.date ?? actor.today;
  const facts = await employmentFacts(deps.db, actor.orgId, employeeId, actor.today);
  const rows = await deps.db
    .select()
    .from(claimTypes)
    .where(and(eq(claimTypes.orgId, actor.orgId), isNull(claimTypes.archivedAt)))
    .orderBy(asc(claimTypes.name));
  const out = [];
  for (const t of rows) {
    if (ineligibleReason(t, facts)) continue;
    const cap = await usageFor(deps.db, {
      orgId: actor.orgId,
      employeeId,
      type: t,
      date,
      excludeClaimId: input.excludeClaimId ?? null,
    });
    out.push({
      id: t.id,
      code: t.code,
      name: t.name,
      category: t.category,
      receiptRule: t.receiptRule,
      receiptAboveCents: t.receiptAboveCents,
      receiptHint: receiptRuleLabel(t),
      gstApplicable: t.gstApplicable,
      cap,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Receipts
// ---------------------------------------------------------------------------------------------

export async function uploadReceipt(
  deps: AppDeps,
  actor: ClaimsActor,
  input: { data: Uint8Array; fileName: string | null; employeeId?: string | null },
) {
  const employeeId = input.employeeId ?? actor.employeeId;
  if (!employeeId) {
    throw new AppError(
      "validation_failed",
      "Your account isn't linked to an employee record, so pick who the receipt is for.",
    );
  }
  await assertCanCreateFor(deps.db, actor, employeeId);
  const row = await storeFile(deps, {
    orgId: actor.orgId,
    purpose: RECEIPT_PURPOSE,
    data: input.data,
    fileName: input.fileName,
    ownerEmployeeId: employeeId,
    uploadedByMembershipId: actor.membershipId,
    accept: RECEIPT_TYPES,
    rejectMessage: RECEIPT_REJECT_MESSAGE,
    audit: actor.auditCtx,
  });
  return fileDto(row);
}

/**
 * A receipt the actor may open: their own upload not yet attached, or a receipt on a claim they
 * can read (medical receipts only for owners, hr_admins, the claimant and the current approver).
 * Anything else is 404, indistinguishable from a missing file.
 */
export async function receiptForDownload(deps: AppDeps, actor: ClaimsActor, fileId: string) {
  const notFound = () => new AppError("not_found", "That receipt doesn't exist or you can't see it.");
  const file = await actor.org.findById(files, fileId);
  if (!file || file.purpose !== RECEIPT_PURPOSE || file.deletedAt) throw notFound();
  const lines = await deps.db
    .select({ claimId: claimLines.claimId, category: claimTypes.category })
    .from(claimLineFiles)
    .innerJoin(
      claimLines,
      and(eq(claimLines.orgId, claimLineFiles.orgId), eq(claimLines.id, claimLineFiles.claimLineId)),
    )
    .innerJoin(claimTypes, and(eq(claimTypes.orgId, claimLines.orgId), eq(claimTypes.id, claimLines.claimTypeId)))
    .where(and(eq(claimLineFiles.orgId, actor.orgId), eq(claimLineFiles.fileId, fileId)));
  const ownsFile =
    file.uploadedByMembershipId === actor.membershipId ||
    (actor.employeeId !== null && file.ownerEmployeeId === actor.employeeId);
  if (ownsFile) return file;
  for (const l of lines) {
    const { claim } = await loadClaim(deps.db, actor.orgId, l.claimId);
    try {
      await assertCanRead(deps.db, actor, claim);
    } catch {
      continue;
    }
    if (l.category === "medical" && !(await canSeeMedical(deps.db, actor, claim))) continue;
    return file;
  }
  throw notFound();
}

/** Deletes the actor's own upload while no claim line uses it. */
export async function deleteReceipt(deps: AppDeps, actor: ClaimsActor, fileId: string) {
  const file = await actor.org.findById(files, fileId);
  if (!file || file.purpose !== RECEIPT_PURPOSE || file.uploadedByMembershipId !== actor.membershipId || file.deletedAt)
    throw new AppError("not_found", "That receipt doesn't exist or you can't see it.");
  const [used] = await deps.db
    .select({ n: count() })
    .from(claimLineFiles)
    .where(and(eq(claimLineFiles.orgId, actor.orgId), eq(claimLineFiles.fileId, fileId)));
  if (Number(used?.n ?? 0) > 0)
    throw new AppError("in_use", "This receipt is attached to a claim. Remove it from the claim line first.");
  await deps.db.transaction(async (tx) => {
    await tx.update(files).set({ deletedAt: deps.clock.now() }).where(eq(files.id, fileId));
    await recordAudit(tx, deps, actor.auditCtx, { action: "file.deleted", targetType: "file", targetId: fileId });
  });
  await deps.fileStore.delete(file.storageKey);
}

/** Totals for the employee's dashboard strip: waiting, approved-unpaid, paid this year. */
export async function myClaimTotals(deps: AppDeps, actor: ClaimsActor) {
  if (!actor.employeeId) return { submittedCents: 0, approvedCents: 0, paidThisYearCents: 0 };
  const year = actor.today.slice(0, 4);
  const [row] = await deps.db
    .select({
      submitted: sql<string>`coalesce(sum(case when ${claims.status} = 'submitted' then ${claims.totalCents} end), 0)::text`,
      approved: sql<string>`coalesce(sum(case when ${claims.status} = 'approved' then ${claims.totalCents} end), 0)::text`,
      paid: sql<string>`coalesce(sum(case when ${claims.status} = 'paid' and ${claims.paidOn} >= ${`${year}-01-01`} then ${claims.totalCents} end), 0)::text`,
    })
    .from(claims)
    .where(and(eq(claims.orgId, actor.orgId), eq(claims.employeeId, actor.employeeId)));
  return {
    submittedCents: Number(row?.submitted ?? 0),
    approvedCents: Number(row?.approved ?? 0),
    paidThisYearCents: Number(row?.paid ?? 0),
  };
}
