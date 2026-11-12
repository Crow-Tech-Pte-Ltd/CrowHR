import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { singaporeDate } from "../access/scope.ts";
import { recordAudit } from "../audit/audit.ts";
import {
  acknowledgementRequests,
  type DocumentCategory,
  type DocumentRow,
  type DocumentVersion,
  documentCategories,
  documentRetentionReviews,
  documents,
  documentVersions,
  documentViews,
  LETTER_KINDS,
  type LetterKind,
  type LetterTemplate,
  letterTemplates,
} from "../db/schema/documents.ts";
import { checklistItems, checklists, employees } from "../db/schema/employees.ts";
import { files } from "../db/schema/files.ts";
import { companyProfiles } from "../db/schema/organisation.ts";
import type { Db } from "../db/types.ts";
import type { AppDeps } from "../deps.ts";
import { addDays, displayDate, isIsoDate } from "../employees/dates.ts";
import { displayName } from "../employees/records.ts";
import { AppError } from "../errors.ts";
import { DOCUMENT_TYPES } from "../files/sniff.ts";
import { storeFile, storeFileInTx } from "../files/uploads.ts";
import { notify } from "../notifications/notify.ts";
import { renderLetterPdf } from "../pdf/letter.ts";
import { canReadCategory, canUploadTo, type DocActor, isHr } from "./access.ts";
import { ensureDocumentSetup } from "./defaults.ts";
import { addMonthsIso } from "./expiry.ts";
import { FIELDS, fieldDef, resolveAllFields } from "./fields.ts";
import { type Block, resolveFields } from "./markdown.ts";
import { validateTemplate } from "./templates.ts";

/**
 * Documents (openspec/changes/add-documents): categories, uploads with versions, access and audit,
 * expiry, soft delete and owner purge, letter templates and generation (KETs included),
 * acknowledgements. Routes stay thin; every rule lives here.
 */

export const MAX_DOCUMENT_BYTES = 20 * 1024 * 1024;
export const DOCUMENT_PURPOSE = "document";
export const EXPIRING_DAYS = 30;
const REJECT = "Upload a PDF, JPEG, PNG, WebP, DOCX or XLSX file (the type is checked from the file itself).";

const notFound = () => new AppError("not_found", "That document doesn't exist or you can't see it.");
const isoDate = z.string().refine(isIsoDate, { message: "Use the date format YYYY-MM-DD, like 2027-01-31." });

export type ExpiryState = "valid" | "expiring" | "expired";

/** valid / expiring (within 30 days) / expired, by today's date in Asia/Singapore. */
export function expiryState(expiresOn: string | null, today: string): ExpiryState | null {
  if (!expiresOn) return null;
  if (expiresOn < today) return "expired";
  if (expiresOn <= addDays(today, EXPIRING_DAYS)) return "expiring";
  return "valid";
}

// ----- Categories ---------------------------------------------------------------------------

export async function listCategories(
  deps: AppDeps,
  a: DocActor,
): Promise<(DocumentCategory & { documentCount: number })[]> {
  await ensureDocumentSetup(deps.db, deps.ids, a.orgId);
  const rows = await deps.db
    .select()
    .from(documentCategories)
    .where(eq(documentCategories.orgId, a.orgId))
    .orderBy(asc(documentCategories.position), asc(documentCategories.name));
  const counts = await deps.db
    .select({ id: documents.categoryId, employeeId: documents.employeeId, n: sql<number>`count(*)::int` })
    .from(documents)
    .where(and(eq(documents.orgId, a.orgId), isNull(documents.purgedAt)))
    .groupBy(documents.categoryId, documents.employeeId);
  // HR sees the organisation's counts; anyone else only the documents they could open, so the
  // list doesn't reveal how many medical or HR-only documents colleagues have.
  const byId = new Map(rows.map((r) => [r.id, r]));
  const count = new Map<string, number>();
  for (const c of counts) {
    const category = byId.get(c.id);
    if (!category || !(isHr(a) || (await canReadCategory(a, category, c.employeeId)))) continue;
    count.set(c.id, (count.get(c.id) ?? 0) + Number(c.n));
  }
  return rows.map((r) => ({ ...r, documentCount: count.get(r.id) ?? 0 }));
}

export const categoryInput = z.object({
  name: z.string().trim().min(1, "Give the category a name.").max(60, "Use at most 60 characters."),
  sensitivity: z.enum(["normal", "medical"]).default("normal"),
  employeeVisible: z.boolean().default(false),
  managerVisible: z.boolean().default(false),
  payrollVisible: z.boolean().default(false),
  employeeUploadable: z.boolean().default(false),
  expiryRequired: z.boolean().default(false),
  auditViews: z.boolean().default(false),
  retentionMonthsAfterExit: z.int().min(0).max(1200).nullable().default(12),
});
/** No defaults here: a patch changes only the fields it names. */
export const categoryPatch = z.object({
  name: z.string().trim().min(1, "Give the category a name.").max(60, "Use at most 60 characters.").optional(),
  sensitivity: z.enum(["normal", "medical"]).optional(),
  employeeVisible: z.boolean().optional(),
  managerVisible: z.boolean().optional(),
  payrollVisible: z.boolean().optional(),
  employeeUploadable: z.boolean().optional(),
  expiryRequired: z.boolean().optional(),
  auditViews: z.boolean().optional(),
  retentionMonthsAfterExit: z.int().min(0).max(1200).nullable().optional(),
});

function assertCategoryRules(c: {
  sensitivity?: string;
  managerVisible?: boolean;
  employeeUploadable?: boolean;
  employeeVisible?: boolean;
}) {
  if (c.sensitivity === "medical" && c.managerVisible) {
    throw new AppError(
      "validation_failed",
      "Medical documents are visible only to HR, owners and the employee, so a medical category can't be visible to managers.",
      { issues: [{ path: "managerVisible", message: "Turn off manager visibility for a medical category." }] },
    );
  }
  if (c.employeeUploadable && c.employeeVisible === false) {
    throw new AppError("validation_failed", "Employees can only upload to a category they can see.", {
      issues: [
        { path: "employeeVisible", message: "Make the category visible to employees, or turn off employee uploads." },
      ],
    });
  }
}

export async function createCategory(deps: AppDeps, a: DocActor, raw: z.input<typeof categoryInput>) {
  const input = categoryInput.parse(raw);
  assertCategoryRules(input);
  await ensureDocumentSetup(deps.db, deps.ids, a.orgId);
  const id = deps.ids.newId();
  await deps.db.transaction(async (tx) => {
    const [max] = await tx
      .select({ p: sql<number>`coalesce(max(${documentCategories.position}), 0)::int` })
      .from(documentCategories)
      .where(eq(documentCategories.orgId, a.orgId));
    await tx
      .insert(documentCategories)
      .values({ id, orgId: a.orgId, ...input, position: Number(max?.p ?? 0) + 10 })
      .catch((err: unknown) => {
        throw /document_categories_name_unique/.test(String((err as { cause?: unknown }).cause ?? err))
          ? new AppError("conflict", `A category called "${input.name}" already exists. Pick another name.`)
          : err;
      });
    await recordAudit(tx, deps, a.audit, {
      action: "document_category.created",
      targetType: "document_category",
      targetId: id,
      meta: { name: input.name },
    });
  });
  return a.org.getById(documentCategories, id, "category");
}

export async function updateCategory(deps: AppDeps, a: DocActor, id: string, raw: z.input<typeof categoryPatch>) {
  const patch = categoryPatch.parse(raw);
  const before = await a.org.getById(documentCategories, id, "category");
  const next = { ...before, ...patch };
  assertCategoryRules(next);
  await deps.db.transaction(async (tx) => {
    await tx
      .update(documentCategories)
      .set({ ...patch, updatedAt: deps.clock.now() })
      .where(a.org.whereId(documentCategories, id));
    await recordAudit(tx, deps, a.audit, {
      action: "document_category.updated",
      targetType: "document_category",
      targetId: id,
      meta: { changed: Object.keys(patch) },
    });
  });
  return a.org.getById(documentCategories, id, "category");
}

export async function deleteCategory(deps: AppDeps, a: DocActor, id: string) {
  const cat = await a.org.getById(documentCategories, id, "category");
  const [used] = await deps.db
    .select({ n: sql<number>`count(*)::int` })
    .from(documents)
    .where(and(eq(documents.orgId, a.orgId), eq(documents.categoryId, id)));
  const [tpl] = await deps.db
    .select({ n: sql<number>`count(*)::int` })
    .from(letterTemplates)
    .where(and(eq(letterTemplates.orgId, a.orgId), eq(letterTemplates.targetCategoryId, id)));
  if (Number(used?.n ?? 0) > 0 || Number(tpl?.n ?? 0) > 0) {
    throw new AppError(
      "in_use",
      `"${cat.name}" holds documents or is used by a letter template, so it can't be deleted. Move them to another category first.`,
    );
  }
  await deps.db.transaction(async (tx) => {
    await tx.delete(documentCategories).where(a.org.whereId(documentCategories, id));
    await recordAudit(tx, deps, a.audit, {
      action: "document_category.deleted",
      targetType: "document_category",
      targetId: id,
      meta: { name: cat.name },
    });
  });
}

// ----- Reading ------------------------------------------------------------------------------

export interface VersionView {
  id: string;
  version: number;
  fileName: string | null;
  mime: string | null;
  sizeBytes: number | null;
  sha256: string;
  expiresOn: string | null;
  source: "upload" | "generated";
  templateId: string | null;
  templateVersion: number | null;
  asAt: string | null;
  createdAt: string;
  superseded: boolean;
}

export interface DocumentView {
  id: string;
  employeeId: string;
  employeeName: string;
  employeeNumber: string;
  category: { id: string; name: string; sensitivity: "normal" | "medical" };
  title: string;
  notes: string | null;
  expiresOn: string | null;
  expiry: ExpiryState | null;
  source: "upload" | "generated";
  current: VersionView | null;
  previousVersions: VersionView[];
  acknowledgement: {
    id: string;
    status: "requested" | "acknowledged";
    requestedAt: string;
    acknowledgedAt: string | null;
    fileSha256: string | null;
    current: boolean;
  } | null;
  viewed: boolean;
  createdAt: string;
  deletedAt: string | null;
  canManage: boolean;
}

interface Loaded {
  doc: DocumentRow;
  category: DocumentCategory;
  employee: { id: string; name: string; number: string };
}

async function loadDoc(
  deps: AppDeps,
  a: DocActor,
  id: string,
  opts: { includeDeleted?: boolean } = {},
): Promise<Loaded> {
  const doc = await a.org.findById(documents, id);
  if (!doc || doc.purgedAt || (doc.deletedAt && !(opts.includeDeleted && isHr(a)))) throw notFound();
  const category = await a.org.getById(documentCategories, doc.categoryId, "category");
  if (!(await canReadCategory(a, category, doc.employeeId))) throw notFound();
  const [emp] = await deps.db.select().from(employees).where(a.org.whereId(employees, doc.employeeId));
  if (!emp) throw notFound();
  return { doc, category, employee: { id: emp.id, name: displayName(emp), number: emp.employeeNumber } };
}

async function versionViews(db: Db, orgId: string, docIds: string[]) {
  if (!docIds.length) return new Map<string, (DocumentVersion & { file: typeof files.$inferSelect | null })[]>();
  const rows = await db
    .select({ v: documentVersions, f: files })
    .from(documentVersions)
    .leftJoin(files, and(eq(files.orgId, documentVersions.orgId), eq(files.id, documentVersions.fileId)))
    .where(and(eq(documentVersions.orgId, orgId), inArray(documentVersions.documentId, docIds)))
    .orderBy(desc(documentVersions.version));
  const out = new Map<string, (DocumentVersion & { file: typeof files.$inferSelect | null })[]>();
  for (const r of rows) {
    const list = out.get(r.v.documentId) ?? [];
    list.push({ ...r.v, file: r.f });
    out.set(r.v.documentId, list);
  }
  return out;
}

function toVersionView(v: DocumentVersion & { file: typeof files.$inferSelect | null }): VersionView {
  return {
    id: v.id,
    version: v.version,
    fileName: v.file?.originalName ?? null,
    mime: v.file?.mime ?? null,
    sizeBytes: v.file?.sizeBytes ?? null,
    sha256: v.fileSha256,
    expiresOn: v.expiresOn,
    source: v.source,
    templateId: v.templateId,
    templateVersion: v.templateVersion,
    asAt: v.asAt,
    createdAt: v.createdAt.toISOString(),
    superseded: v.supersededAt !== null,
  };
}

async function toViews(deps: AppDeps, a: DocActor, loaded: Loaded[]): Promise<DocumentView[]> {
  const today = singaporeDate(deps.clock.now());
  const versions = await versionViews(
    deps.db,
    a.orgId,
    loaded.map((l) => l.doc.id),
  );
  const acks = loaded.length
    ? await deps.db
        .select()
        .from(acknowledgementRequests)
        .where(
          and(
            eq(acknowledgementRequests.orgId, a.orgId),
            inArray(
              acknowledgementRequests.documentId,
              loaded.map((l) => l.doc.id),
            ),
          ),
        )
        .orderBy(desc(acknowledgementRequests.requestedAt))
    : [];
  const viewed = loaded.length
    ? await deps.db
        .select({ versionId: documentViews.documentVersionId })
        .from(documentViews)
        .where(and(eq(documentViews.orgId, a.orgId), eq(documentViews.membershipId, a.membershipId)))
    : [];
  const viewedSet = new Set(viewed.map((v) => v.versionId));
  return loaded.map(({ doc, category, employee }) => {
    const all = versions.get(doc.id) ?? [];
    const current = all.find((v) => v.id === doc.currentVersionId) ?? all[0] ?? null;
    // The request for the current version if there is one, else the latest earlier one.
    const ack =
      acks.find((x) => x.documentId === doc.id && x.documentVersionId === current?.id) ??
      acks.find((x) => x.documentId === doc.id) ??
      null;
    return {
      id: doc.id,
      employeeId: employee.id,
      employeeName: employee.name,
      employeeNumber: employee.number,
      category: { id: category.id, name: category.name, sensitivity: category.sensitivity },
      title: doc.title,
      notes: doc.notes,
      expiresOn: current?.expiresOn ?? null,
      expiry: expiryState(current?.expiresOn ?? null, today),
      source: current?.source ?? "upload",
      current: current ? toVersionView(current) : null,
      // Previous versions stay downloadable by HR (spec "Replacement keeps history").
      previousVersions: isHr(a) ? all.filter((v) => v.id !== current?.id).map(toVersionView) : [],
      acknowledgement: ack
        ? {
            id: ack.id,
            status: ack.acknowledgedAt ? "acknowledged" : "requested",
            requestedAt: ack.requestedAt.toISOString(),
            acknowledgedAt: ack.acknowledgedAt?.toISOString() ?? null,
            fileSha256: ack.fileSha256,
            current: ack.documentVersionId === current?.id,
          }
        : null,
      viewed: current ? viewedSet.has(current.id) : false,
      createdAt: doc.createdAt.toISOString(),
      deletedAt: doc.deletedAt?.toISOString() ?? null,
      canManage: isHr(a),
    };
  });
}

export const listQuery = z.object({
  employeeId: z.uuid().optional(),
  categoryId: z.uuid().optional(),
  mine: z.enum(["true", "false"]).optional(),
  expiry: z.enum(["expiring", "expired", "attention"]).optional(),
  deleted: z.enum(["true"]).optional(),
  /** Paging is opt-in: without `page` the whole list is returned, as in 1.0. */
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(200, "Ask for at most 200 documents a page.").optional(),
});

export interface DocumentPage {
  items: DocumentView[];
  total: number;
  page?: number;
  pageSize?: number;
}

/** Documents the actor may see, filtered. Out-of-scope rows are never loaded into the response. */
export async function listDocuments(deps: AppDeps, a: DocActor, q: z.output<typeof listQuery>): Promise<DocumentPage> {
  await ensureDocumentSetup(deps.db, deps.ids, a.orgId);
  const paged = q.page !== undefined || q.pageSize !== undefined;
  const page = q.page ?? 1;
  const pageSize = q.pageSize ?? 50;
  const out = (items: DocumentView[], total: number): DocumentPage =>
    paged ? { items, total, page, pageSize } : { items, total };
  const employeeId = q.mine === "true" ? a.employeeId : q.employeeId;
  if (q.mine === "true" && !employeeId) return out([], 0);
  const rows = await deps.db
    .select({ doc: documents, category: documentCategories, emp: employees })
    .from(documents)
    .innerJoin(
      documentCategories,
      and(eq(documentCategories.orgId, documents.orgId), eq(documentCategories.id, documents.categoryId)),
    )
    .innerJoin(employees, and(eq(employees.orgId, documents.orgId), eq(employees.id, documents.employeeId)))
    .where(
      a.org.where(
        documents,
        isNull(documents.purgedAt),
        q.deleted === "true" && isHr(a) ? sql`${documents.deletedAt} is not null` : isNull(documents.deletedAt),
        employeeId ? eq(documents.employeeId, employeeId) : undefined,
        q.categoryId ? eq(documents.categoryId, q.categoryId) : undefined,
      ),
    )
    // The ID breaks ties, so pages never repeat or skip a document.
    .orderBy(asc(documentCategories.position), desc(documents.createdAt), desc(documents.id));
  const visible: Loaded[] = [];
  for (const r of rows) {
    if (!(await canReadCategory(a, r.category, r.doc.employeeId))) continue;
    visible.push({
      doc: r.doc,
      category: r.category,
      employee: { id: r.emp.id, name: displayName(r.emp), number: r.emp.employeeNumber },
    });
  }
  const window = <T>(list: T[]) => (paged ? list.slice((page - 1) * pageSize, page * pageSize) : list);
  // The expiry filter needs each document's current version; without it, only the page is loaded.
  if (!q.expiry) return out(await toViews(deps, a, window(visible)), visible.length);
  let views = await toViews(deps, a, visible);
  if (q.expiry === "expiring") views = views.filter((v) => v.expiry === "expiring");
  if (q.expiry === "expired") views = views.filter((v) => v.expiry === "expired");
  if (q.expiry === "attention") views = views.filter((v) => v.expiry === "expiring" || v.expiry === "expired");
  return out(window(views), views.length);
}

export async function getDocument(deps: AppDeps, a: DocActor, id: string): Promise<DocumentView> {
  const loaded = await loadDoc(deps, a, id, { includeDeleted: true });
  return (await toViews(deps, a, [loaded]))[0] as DocumentView;
}

/**
 * The file of a version, for download. Records the member's first view of the version (needed
 * before acknowledging) and audits every view of medical and identity documents.
 */
export async function openDocumentFile(deps: AppDeps, a: DocActor, id: string, versionId?: string) {
  const { doc, category } = await loadDoc(deps, a, id);
  const targetId = versionId ?? doc.currentVersionId;
  if (versionId && versionId !== doc.currentVersionId && !isHr(a)) throw notFound();
  const [version] = targetId
    ? await deps.db
        .select()
        .from(documentVersions)
        .where(and(a.org.whereId(documentVersions, targetId), eq(documentVersions.documentId, doc.id)))
    : [];
  if (!version?.fileId) throw notFound();
  const file = await a.org.findById(files, version.fileId);
  if (!file || file.deletedAt) throw notFound();
  if (file.scanStatus === "infected") throw new AppError("not_found", "This file was removed by the virus scanner.");
  const stored = await deps.fileStore.get(file.storageKey);
  if (!stored) throw notFound();
  await deps.db.transaction(async (tx) => {
    await tx
      .insert(documentViews)
      .values({
        orgId: a.orgId,
        documentVersionId: version.id,
        membershipId: a.membershipId,
        firstViewedAt: deps.clock.now(),
      })
      .onConflictDoNothing();
    if (category.auditViews || category.sensitivity === "medical") {
      await recordAudit(tx, deps, a.audit, {
        action: "document.viewed",
        targetType: "document",
        targetId: doc.id,
        meta: { versionId: version.id, category: category.name, employeeId: doc.employeeId },
      });
    }
  });
  return { file, data: stored.data };
}

// ----- Writing ------------------------------------------------------------------------------

export const uploadQuery = z.object({
  employeeId: z.uuid(),
  categoryId: z.uuid(),
  title: z.string().trim().min(1, "Give the document a title.").max(120, "Use at most 120 characters for the title."),
  expiresOn: isoDate.optional(),
  notes: z.string().trim().max(1000).optional(),
  fileName: z.string().max(255).optional(),
});

async function assertEmployeeInOrg(a: DocActor, employeeId: string) {
  const emp = await a.org.findById(employees, employeeId);
  if (!emp) throw new AppError("not_found", "That employee doesn't exist or you can't see them.");
  return emp;
}

export async function uploadDocument(deps: AppDeps, a: DocActor, q: z.output<typeof uploadQuery>, data: Uint8Array) {
  await ensureDocumentSetup(deps.db, deps.ids, a.orgId);
  await assertEmployeeInOrg(a, q.employeeId);
  const category = await a.org.findById(documentCategories, q.categoryId);
  if (!category) throw new AppError("not_found", "That category doesn't exist.");
  if (!canUploadTo(a, category, q.employeeId)) {
    if (a.employeeId === q.employeeId && category.employeeVisible)
      throw new AppError("forbidden", `Employees can't upload to "${category.name}". Ask HR to add it for you.`);
    throw new AppError("not_found", "That employee doesn't exist or you can't see them.");
  }
  if (category.expiryRequired && !q.expiresOn) {
    throw new AppError("validation_failed", `"${category.name}" documents need an expiry date.`, {
      issues: [{ path: "expiresOn", message: "Enter the expiry date shown on the document." }],
    });
  }
  const file = await storeFile(deps, {
    orgId: a.orgId,
    purpose: DOCUMENT_PURPOSE,
    data,
    fileName: q.fileName ?? null,
    ownerEmployeeId: q.employeeId,
    uploadedByMembershipId: a.membershipId,
    accept: DOCUMENT_TYPES,
    rejectMessage: REJECT,
    audit: a.audit,
    maxBytes: MAX_DOCUMENT_BYTES,
  });
  const id = deps.ids.newId();
  await deps.db.transaction(async (tx) => {
    await insertDocument(tx, deps, a, {
      id,
      employeeId: q.employeeId,
      categoryId: category.id,
      title: q.title,
      notes: q.notes ?? null,
      version: { fileId: file.id, sha256: file.sha256, expiresOn: q.expiresOn ?? null, source: "upload" },
    });
  });
  return getDocument(deps, a, id);
}

interface NewVersion {
  fileId: string;
  sha256: string;
  expiresOn: string | null;
  source: "upload" | "generated";
  templateId?: string;
  templateVersion?: number;
  asAt?: string;
  fieldSnapshot?: Record<string, string>;
  overrides?: Record<string, string>;
}

async function insertDocument(
  tx: Db,
  deps: AppDeps,
  a: Pick<DocActor, "orgId" | "membershipId" | "audit">,
  input: {
    id: string;
    employeeId: string;
    categoryId: string;
    title: string;
    notes: string | null;
    version: NewVersion;
  },
) {
  const versionId = deps.ids.newId();
  const now = deps.clock.now();
  await tx.insert(documents).values({
    id: input.id,
    orgId: a.orgId,
    employeeId: input.employeeId,
    categoryId: input.categoryId,
    title: input.title,
    notes: input.notes,
    createdByMembershipId: a.membershipId,
    createdAt: now,
    updatedAt: now,
  });
  await insertVersion(tx, deps, a, input.id, 1, versionId, input.version);
  await tx
    .update(documents)
    .set({ currentVersionId: versionId })
    .where(and(eq(documents.orgId, a.orgId), eq(documents.id, input.id)));
  await recordAudit(tx, deps, a.audit, {
    action: input.version.source === "generated" ? "document.generated" : "document.uploaded",
    targetType: "document",
    targetId: input.id,
    meta: {
      employeeId: input.employeeId,
      categoryId: input.categoryId,
      versionId,
      templateId: input.version.templateId ?? null,
    },
  });
  return versionId;
}

async function insertVersion(
  tx: Db,
  deps: AppDeps,
  a: Pick<DocActor, "orgId" | "membershipId">,
  documentId: string,
  version: number,
  id: string,
  v: NewVersion,
) {
  await tx.insert(documentVersions).values({
    id,
    orgId: a.orgId,
    documentId,
    version,
    fileId: v.fileId,
    fileSha256: v.sha256,
    expiresOn: v.expiresOn,
    source: v.source,
    templateId: v.templateId ?? null,
    templateVersion: v.templateVersion ?? null,
    asAt: v.asAt ?? null,
    fieldSnapshot: v.fieldSnapshot ?? null,
    overrides: v.overrides ?? null,
    uploadedByMembershipId: a.membershipId,
    createdAt: deps.clock.now(),
  });
}

export const replaceQuery = z.object({ expiresOn: isoDate.optional(), fileName: z.string().max(255).optional() });

/** A replacement file: a new version; the old one is marked superseded and kept for HR. */
export async function replaceDocument(
  deps: AppDeps,
  a: DocActor,
  id: string,
  q: z.output<typeof replaceQuery>,
  data: Uint8Array,
) {
  const { doc, category } = await loadDoc(deps, a, id);
  if (!isHr(a)) throw notFound();
  if (category.expiryRequired && !q.expiresOn) {
    throw new AppError("validation_failed", `"${category.name}" documents need an expiry date.`, {
      issues: [{ path: "expiresOn", message: "Enter the expiry date of the new document." }],
    });
  }
  const file = await storeFile(deps, {
    orgId: a.orgId,
    purpose: DOCUMENT_PURPOSE,
    data,
    fileName: q.fileName ?? null,
    ownerEmployeeId: doc.employeeId,
    uploadedByMembershipId: a.membershipId,
    accept: DOCUMENT_TYPES,
    rejectMessage: REJECT,
    audit: a.audit,
    maxBytes: MAX_DOCUMENT_BYTES,
  });
  await deps.db.transaction(async (tx) => {
    const [max] = await tx
      .select({ v: sql<number>`max(${documentVersions.version})::int` })
      .from(documentVersions)
      .where(and(eq(documentVersions.orgId, a.orgId), eq(documentVersions.documentId, doc.id)));
    const versionId = deps.ids.newId();
    const now = deps.clock.now();
    if (doc.currentVersionId)
      await tx
        .update(documentVersions)
        .set({ supersededAt: now })
        .where(a.org.whereId(documentVersions, doc.currentVersionId));
    await insertVersion(tx, deps, a, doc.id, Number(max?.v ?? 0) + 1, versionId, {
      fileId: file.id,
      sha256: file.sha256,
      expiresOn: q.expiresOn ?? null,
      source: "upload",
    });
    await tx
      .update(documents)
      .set({ currentVersionId: versionId, updatedAt: now })
      .where(a.org.whereId(documents, doc.id));
    await recordAudit(tx, deps, a.audit, {
      action: "document.replaced",
      targetType: "document",
      targetId: doc.id,
      meta: { versionId },
    });
  });
  return getDocument(deps, a, id);
}

export const documentPatch = z.object({
  title: z.string().trim().min(1, "Give the document a title.").max(120).optional(),
  notes: z.string().trim().max(1000).nullable().optional(),
  categoryId: z.uuid().optional(),
});

export async function updateDocument(deps: AppDeps, a: DocActor, id: string, patch: z.output<typeof documentPatch>) {
  const { doc } = await loadDoc(deps, a, id);
  if (patch.categoryId) await a.org.getById(documentCategories, patch.categoryId, "category");
  await deps.db.transaction(async (tx) => {
    await tx
      .update(documents)
      .set({ ...patch, updatedAt: deps.clock.now() })
      .where(a.org.whereId(documents, doc.id));
    await recordAudit(tx, deps, a.audit, {
      action: "document.updated",
      targetType: "document",
      targetId: doc.id,
      meta: { changed: Object.keys(patch) },
    });
  });
  return getDocument(deps, a, id);
}

/** Soft delete: hidden from everyone but HR's "Deleted" view, kept, audited. */
export async function deleteDocument(deps: AppDeps, a: DocActor, id: string, reason: string) {
  const { doc } = await loadDoc(deps, a, id);
  await deps.db.transaction((tx) => softDeleteTx(tx, deps, a, doc.id, reason));
}

async function softDeleteTx(tx: Db, deps: AppDeps, a: DocActor, documentId: string, reason: string) {
  await tx
    .update(documents)
    .set({
      deletedAt: deps.clock.now(),
      deletedByMembershipId: a.membershipId,
      deleteReason: reason,
      updatedAt: deps.clock.now(),
    })
    .where(a.org.whereId(documents, documentId));
  await recordAudit(tx, deps, a.audit, {
    action: "document.deleted",
    targetType: "document",
    targetId: documentId,
    meta: { reason },
  });
}

/**
 * Owner-only purge of a soft-deleted document: removes every version's file from storage and
 * replaces the title and notes with a tombstone. The audit event keeps the reason and a hash of
 * the original title.
 */
export async function purgeDocument(deps: AppDeps, a: DocActor, id: string, reason: string) {
  if (!a.roles.has("owner")) throw new AppError("forbidden", "Only an owner can permanently delete a document.");
  const { doc } = await loadDoc(deps, a, id, { includeDeleted: true });
  if (!doc.deletedAt)
    throw new AppError("conflict", "Delete the document first; only deleted documents can be purged.");
  const versions = await deps.db
    .select()
    .from(documentVersions)
    .where(and(eq(documentVersions.orgId, a.orgId), eq(documentVersions.documentId, doc.id)));
  const fileRows = versions.flatMap((v) => (v.fileId ? [v.fileId] : []));
  const stored = fileRows.length
    ? await deps.db
        .select()
        .from(files)
        .where(and(eq(files.orgId, a.orgId), inArray(files.id, fileRows)))
    : [];
  const titleHash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(doc.title)))]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  await deps.db.transaction(async (tx) => {
    const now = deps.clock.now();
    await tx
      .update(documentVersions)
      .set({ fileId: null, fieldSnapshot: null, overrides: null })
      .where(and(eq(documentVersions.orgId, a.orgId), eq(documentVersions.documentId, doc.id)));
    if (fileRows.length)
      await tx
        .update(files)
        .set({ deletedAt: now })
        .where(and(eq(files.orgId, a.orgId), inArray(files.id, fileRows)));
    await tx
      .update(documents)
      .set({ title: "Purged document", notes: null, purgedAt: now, updatedAt: now })
      .where(a.org.whereId(documents, doc.id));
    await recordAudit(tx, deps, a.audit, {
      action: "document.purged",
      targetType: "document",
      targetId: doc.id,
      meta: { reason, titleSha256: titleHash, versions: versions.length },
    });
  });
  for (const f of stored) await deps.fileStore.delete(f.storageKey).catch(() => {});
}

// ----- Templates ----------------------------------------------------------------------------

export const templateInput = z.object({
  kind: z.enum(LETTER_KINDS),
  name: z.string().trim().min(1, "Give the template a name.").max(80),
  bodyMd: z.string().max(50_000, "Keep the template under 50,000 characters."),
  targetCategoryId: z.uuid().optional(),
  active: z.boolean().default(true),
});

export const templatePatch = z.object({
  kind: z.enum(LETTER_KINDS).optional(),
  name: z.string().trim().min(1, "Give the template a name.").max(80).optional(),
  bodyMd: z.string().max(50_000, "Keep the template under 50,000 characters.").optional(),
  targetCategoryId: z.uuid().optional(),
  active: z.boolean().optional(),
});

export interface TemplateView {
  id: string;
  kind: LetterKind;
  name: string;
  bodyMd: string;
  version: number;
  active: boolean;
  targetCategoryId: string;
  fields: string[];
  usesSalary: boolean;
  updatedAt: string;
}

function toTemplateView(t: LetterTemplate, asAt: string): TemplateView {
  const fields = validateTemplate(t.kind, t.bodyMd, asAt).fields;
  return {
    id: t.id,
    kind: t.kind,
    name: t.name,
    bodyMd: t.bodyMd,
    version: t.version,
    active: t.active,
    targetCategoryId: t.targetCategoryId,
    fields,
    usesSalary: fields.some((f) => fieldDef(f)?.sensitivity === "salary"),
    updatedAt: t.updatedAt.toISOString(),
  };
}

export async function listTemplates(deps: AppDeps, a: DocActor) {
  await ensureDocumentSetup(deps.db, deps.ids, a.orgId);
  const rows = await deps.db
    .select()
    .from(letterTemplates)
    .where(eq(letterTemplates.orgId, a.orgId))
    .orderBy(asc(letterTemplates.name));
  const today = singaporeDate(deps.clock.now());
  return rows.map((t) => toTemplateView(t, today));
}

function assertValid(kind: LetterKind, body: string, today: string) {
  const check = validateTemplate(kind, body, today);
  if (check.issues.length) {
    throw new AppError("validation_failed", check.issues[0]?.message ?? "The template needs fixing.", {
      issues: check.issues.map((i) => ({ path: "bodyMd", message: i.message, line: i.line })),
    });
  }
}

async function categoryFor(deps: AppDeps, a: DocActor, kind: LetterKind, requested?: string) {
  if (requested) return (await a.org.getById(documentCategories, requested, "category")).id;
  const key = kind === "offer" || kind === "ket" ? "contract" : "letters";
  const [row] = await deps.db
    .select()
    .from(documentCategories)
    .where(and(eq(documentCategories.orgId, a.orgId), eq(documentCategories.systemKey, key)));
  if (!row) throw new AppError("conflict", "Pick the category the letters are filed under.");
  return row.id;
}

export async function createTemplate(deps: AppDeps, a: DocActor, raw: z.input<typeof templateInput>) {
  const input = templateInput.parse(raw);
  await ensureDocumentSetup(deps.db, deps.ids, a.orgId);
  assertValid(input.kind, input.bodyMd, singaporeDate(deps.clock.now()));
  const id = deps.ids.newId();
  const targetCategoryId = await categoryFor(deps, a, input.kind, input.targetCategoryId);
  await deps.db.transaction(async (tx) => {
    await tx
      .insert(letterTemplates)
      .values({
        id,
        orgId: a.orgId,
        kind: input.kind,
        name: input.name,
        bodyMd: input.bodyMd,
        active: input.active,
        targetCategoryId,
        updatedByMembershipId: a.membershipId,
      })
      .catch((err: unknown) => {
        throw /letter_templates_name_unique/.test(String((err as { cause?: unknown }).cause ?? err))
          ? new AppError("conflict", `A template called "${input.name}" already exists. Pick another name.`)
          : err;
      });
    await recordAudit(tx, deps, a.audit, {
      action: "letter_template.created",
      targetType: "letter_template",
      targetId: id,
      meta: { kind: input.kind },
    });
  });
  return toTemplateView(await a.org.getById(letterTemplates, id, "template"), singaporeDate(deps.clock.now()));
}

export async function updateTemplate(
  deps: AppDeps,
  a: DocActor,
  id: string,
  raw: Partial<z.input<typeof templateInput>>,
) {
  const before = await a.org.getById(letterTemplates, id, "template");
  const input = templateInput.parse({ ...before, ...raw, kind: raw.kind ?? before.kind });
  assertValid(input.kind, input.bodyMd, singaporeDate(deps.clock.now()));
  const targetCategoryId = await categoryFor(deps, a, input.kind, input.targetCategoryId ?? before.targetCategoryId);
  await deps.db.transaction(async (tx) => {
    await tx
      .update(letterTemplates)
      .set({
        kind: input.kind,
        name: input.name,
        bodyMd: input.bodyMd,
        active: input.active,
        targetCategoryId,
        version: before.version + (input.bodyMd !== before.bodyMd ? 1 : 0),
        updatedByMembershipId: a.membershipId,
        updatedAt: deps.clock.now(),
      })
      .where(a.org.whereId(letterTemplates, id));
    await recordAudit(tx, deps, a.audit, {
      action: "letter_template.updated",
      targetType: "letter_template",
      targetId: id,
      meta: { version: before.version + 1 },
    });
  });
  return toTemplateView(await a.org.getById(letterTemplates, id, "template"), singaporeDate(deps.clock.now()));
}

// ----- Generation ---------------------------------------------------------------------------

export const generateInput = z.object({
  templateId: z.uuid(),
  employeeId: z.uuid(),
  asAt: isoDate.optional(),
  title: z.string().trim().min(1).max(120).optional(),
  signatoryName: z.string().trim().min(1).max(120).optional(),
  /** Values entered for this document only (terms, signatory title, or a value HR corrects). */
  overrides: z.record(z.string(), z.string().trim().max(2000)).default({}),
  requestAcknowledgement: z.boolean().default(false),
  /** Preview: resolve and render without saving. */
  dryRun: z.boolean().default(false),
});

export interface MissingField {
  id: string;
  label: string;
  where: string;
}

export interface Resolution {
  template: LetterTemplate;
  values: Record<string, string>;
  missing: MissingField[];
  blocks: Block[];
  asAt: string;
}

/** Resolves a template for an employee. Salary fields need salary read for that employee. */
export async function resolveLetter(
  deps: AppDeps,
  a: DocActor & { canReadSalary(employeeId: string): Promise<boolean> },
  db: Db,
  input: z.output<typeof generateInput>,
): Promise<Resolution> {
  const template = await a.org.findById(letterTemplates, input.templateId);
  if (!template) throw new AppError("not_found", "That template doesn't exist.");
  await assertEmployeeInOrg(a, input.employeeId);
  const today = singaporeDate(deps.clock.now());
  const asAt = input.asAt ?? today;
  const check = validateTemplate(template.kind, template.bodyMd, today);
  if (check.issues.length)
    throw new AppError("validation_failed", `The template needs fixing first: ${check.issues[0]?.message}`);
  const salaryFields = check.fields.filter((f) => fieldDef(f)?.sensitivity === "salary");
  if (salaryFields.length && !(await a.canReadSalary(input.employeeId))) {
    throw new AppError(
      "forbidden",
      `This template uses salary fields (${salaryFields.join(", ")}), which need a payroll admin or owner to generate.`,
      { fields: salaryFields },
    );
  }
  const resolved = await resolveAllFields(db, {
    orgId: a.orgId,
    employeeId: input.employeeId,
    asAt,
    today,
    signatoryName: input.signatoryName ?? a.displayName,
  });
  const values: Record<string, string> = {};
  const missing: MissingField[] = [];
  for (const id of check.fields) {
    const override = input.overrides[id];
    const v = override?.length ? override : resolved[id];
    if (v === null || v === undefined || v === "") {
      const def = fieldDef(id);
      missing.push({ id, label: def?.label ?? id, where: def?.where ?? "" });
    } else values[id] = v;
  }
  const blocks = resolveFields(check.blocks, (id) => values[id] ?? `[${fieldDef(id)?.label ?? id}]`);
  return { template, values, missing, blocks, asAt };
}

export function missingMessage(missing: readonly MissingField[]): string {
  return `Fill in ${missing.length === 1 ? "this field" : "these fields"} first: ${missing
    .map((m) => `${m.label}${m.where ? ` (${m.where})` : ""}`)
    .join("; ")}.`;
}

/** Renders and files a generated letter in `tx`. Returns the new document id. */
export async function fileGeneratedLetter(
  tx: Db,
  deps: AppDeps,
  a: Pick<DocActor, "orgId" | "membershipId" | "audit" | "displayName">,
  r: Resolution,
  input: { employeeId: string; title?: string; overrides: Record<string, string> },
) {
  const [profile] = await tx.select().from(companyProfiles).where(eq(companyProfiles.orgId, a.orgId));
  const logo =
    profile?.logoFileKey && profile.logoContentType === "image/png"
      ? ((await deps.fileStore.get(profile.logoFileKey))?.data ?? null)
      : null;
  const [emp] = await tx
    .select()
    .from(employees)
    .where(and(eq(employees.orgId, a.orgId), eq(employees.id, input.employeeId)));
  const title = input.title ?? `${r.template.name}: ${emp ? displayName(emp) : ""}`.slice(0, 120);
  const pdf = await renderLetterPdf({
    title,
    org: {
      name: r.values["org.legal_name"] ?? profile?.legalName ?? "",
      address: r.values["org.address"] ?? null,
      uen: profile?.uen ?? null,
    },
    logoPng: logo,
    blocks: r.blocks,
    createdAt: deps.clock.now(),
    author: a.displayName,
  });
  const file = await storeFileInTx(tx, deps, {
    orgId: a.orgId,
    purpose: DOCUMENT_PURPOSE,
    data: pdf,
    fileName: `${
      title
        .replace(/[^A-Za-z0-9 _()-]+/g, " ")
        .trim()
        .slice(0, 80) || "letter"
    }.pdf`,
    ownerEmployeeId: input.employeeId,
    uploadedByMembershipId: a.membershipId,
    accept: ["application/pdf"],
    rejectMessage: REJECT,
    audit: a.audit,
    maxBytes: MAX_DOCUMENT_BYTES,
  });
  // Snapshot: resolved values except salary-class fields (design decision 4).
  const snapshot = Object.fromEntries(
    Object.entries(r.values).filter(([id]) => fieldDef(id)?.sensitivity !== "salary"),
  );
  const id = deps.ids.newId();
  await insertDocument(tx, deps, a, {
    id,
    employeeId: input.employeeId,
    categoryId: r.template.targetCategoryId,
    title,
    notes: null,
    version: {
      fileId: file.id,
      sha256: file.sha256,
      expiresOn: null,
      source: "generated",
      templateId: r.template.id,
      templateVersion: r.template.version,
      asAt: r.asAt,
      fieldSnapshot: snapshot,
      overrides: Object.keys(input.overrides).length ? input.overrides : undefined,
    },
  });
  if (r.template.kind === "ket") await completeIssueKets(tx, deps, a, input.employeeId);
  return id;
}

/** Onboarding checklist item "Issue KETs" (people's default template) is done once a KET is generated. */
async function completeIssueKets(tx: Db, deps: AppDeps, a: Pick<DocActor, "orgId" | "audit">, employeeId: string) {
  const open = await tx
    .select({ id: checklistItems.id })
    .from(checklistItems)
    .innerJoin(
      checklists,
      and(eq(checklists.orgId, checklistItems.orgId), eq(checklists.id, checklistItems.checklistId)),
    )
    .where(
      and(
        eq(checklistItems.orgId, a.orgId),
        eq(checklists.employeeId, employeeId),
        eq(checklistItems.title, "Issue KETs"),
        eq(checklistItems.status, "open"),
      ),
    );
  for (const item of open) {
    await tx
      .update(checklistItems)
      .set({ status: "done", doneAt: deps.clock.now() })
      .where(eq(checklistItems.id, item.id));
    await recordAudit(tx, deps, a.audit, {
      action: "checklist_item.completed",
      targetType: "checklist_item",
      targetId: item.id,
      meta: { by: "ket_generated" },
    });
  }
}

export async function requestAcknowledgementTx(
  tx: Db,
  deps: AppDeps,
  a: Pick<DocActor, "orgId" | "membershipId" | "audit">,
  doc: { id: string; employeeId: string; title: string; currentVersionId: string },
) {
  const id = deps.ids.newId();
  const inserted = await tx
    .insert(acknowledgementRequests)
    .values({
      id,
      orgId: a.orgId,
      documentId: doc.id,
      documentVersionId: doc.currentVersionId,
      employeeId: doc.employeeId,
      requestedByMembershipId: a.membershipId,
      requestedAt: deps.clock.now(),
    })
    .onConflictDoNothing()
    .returning();
  if (!inserted.length) return null;
  await recordAudit(tx, deps, a.audit, {
    action: "document.acknowledgement_requested",
    targetType: "document",
    targetId: doc.id,
    meta: { versionId: doc.currentVersionId },
  });
  const members = await tx.execute<{ id: string }>(
    sql`select id from memberships where org_id = ${a.orgId} and employee_id = ${doc.employeeId} and status = 'active'`,
  );
  const recipients = (
    (members as unknown as { rows?: { id: string }[] }).rows ?? (members as unknown as { id: string }[])
  ).map((m) => m.id);
  await notify(tx, deps, {
    orgId: a.orgId,
    recipients,
    kind: "acknowledgement_requested",
    title: `Please read and acknowledge: ${doc.title}`,
    link: `/documents?open=${doc.id}`,
    subjectType: "document",
    subjectId: doc.id,
    email: {
      headline: `HR asked you to read and acknowledge "${doc.title}".`,
      linkPath: `/documents?open=${doc.id}`,
      actionLabel: "Open document",
    },
  });
  return id;
}

export async function generateLetter(
  deps: AppDeps,
  a: DocActor & { canReadSalary(employeeId: string): Promise<boolean> },
  input: z.output<typeof generateInput>,
) {
  await ensureDocumentSetup(deps.db, deps.ids, a.orgId);
  const r = await resolveLetter(deps, a, deps.db, input);
  if (input.dryRun) return { preview: r, documentId: null };
  if (r.missing.length) {
    throw new AppError("missing_fields", missingMessage(r.missing), { missing: r.missing });
  }
  if (input.requestAcknowledgement) {
    // As for an uploaded document: the employee must be able to open it to acknowledge it.
    const [category] = await deps.db
      .select()
      .from(documentCategories)
      .where(and(eq(documentCategories.orgId, a.orgId), eq(documentCategories.id, r.template.targetCategoryId)));
    if (!category?.employeeVisible) {
      throw new AppError(
        "conflict",
        `Employees can't see "${category?.name ?? "this category's"}" documents, so they can't acknowledge this letter. Generate it without an acknowledgement, or file the template's letters in a category they can see.`,
      );
    }
  }
  const id = await deps.db.transaction(async (tx) => {
    const docId = await fileGeneratedLetter(tx, deps, a, r, input);
    if (input.requestAcknowledgement) {
      const [doc] = await tx
        .select()
        .from(documents)
        .where(and(eq(documents.orgId, a.orgId), eq(documents.id, docId)));
      if (doc?.currentVersionId)
        await requestAcknowledgementTx(tx, deps, a, { ...doc, currentVersionId: doc.currentVersionId });
    }
    return docId;
  });
  return { preview: r, documentId: id };
}

// ----- Acknowledgements ---------------------------------------------------------------------

export async function requestAcknowledgement(deps: AppDeps, a: DocActor, id: string) {
  const { doc, category } = await loadDoc(deps, a, id);
  if (!category.employeeVisible) {
    throw new AppError(
      "conflict",
      `Employees can't see "${category.name}" documents, so they can't acknowledge this one. Move it to a category they can see.`,
    );
  }
  if (!doc.currentVersionId) throw notFound();
  const currentVersionId = doc.currentVersionId;
  const created = await deps.db.transaction((tx) =>
    requestAcknowledgementTx(tx, deps, a, { ...doc, currentVersionId }),
  );
  if (!created) throw new AppError("conflict", "An acknowledgement is already requested for this version.");
  return getDocument(deps, a, id);
}

/**
 * The employee acknowledges the current version: only after opening it (409 `not_viewed`),
 * recording the time, IP, user agent and the SHA-256 of that exact file. Not revocable.
 */
export async function acknowledge(deps: AppDeps, a: DocActor, id: string) {
  const { doc } = await loadDoc(deps, a, id);
  if (doc.employeeId !== a.employeeId) throw notFound();
  const [req] = await deps.db
    .select()
    .from(acknowledgementRequests)
    .where(
      and(
        eq(acknowledgementRequests.orgId, a.orgId),
        eq(acknowledgementRequests.documentId, doc.id),
        eq(acknowledgementRequests.documentVersionId, doc.currentVersionId ?? ""),
        eq(acknowledgementRequests.employeeId, doc.employeeId),
      ),
    );
  if (!req) throw new AppError("conflict", "Nobody has asked you to acknowledge this document.");
  if (req.acknowledgedAt) return getDocument(deps, a, id);
  const [viewed] = await deps.db
    .select()
    .from(documentViews)
    .where(
      and(
        eq(documentViews.orgId, a.orgId),
        eq(documentViews.documentVersionId, req.documentVersionId),
        eq(documentViews.membershipId, a.membershipId),
      ),
    );
  if (!viewed) throw new AppError("not_viewed", "Open the document and read it before acknowledging it.");
  const [version] = await deps.db
    .select()
    .from(documentVersions)
    .where(a.org.whereId(documentVersions, req.documentVersionId));
  await deps.db.transaction(async (tx) => {
    const now = deps.clock.now();
    await tx
      .update(acknowledgementRequests)
      .set({
        acknowledgedAt: now,
        acknowledgedByMembershipId: a.membershipId,
        ip: a.ip,
        userAgent: a.userAgent,
        fileSha256: version?.fileSha256 ?? null,
      })
      .where(and(eq(acknowledgementRequests.id, req.id), isNull(acknowledgementRequests.acknowledgedAt)));
    await recordAudit(tx, deps, a.audit, {
      action: "document.acknowledged",
      targetType: "document",
      targetId: doc.id,
      meta: { versionId: req.documentVersionId, fileSha256: version?.fileSha256 ?? null },
    });
  });
  return getDocument(deps, a, id);
}

export interface AckRow {
  id: string;
  documentId: string;
  documentTitle: string;
  employeeId: string;
  employeeName: string;
  employeeNumber: string;
  version: number;
  requestedAt: string;
  acknowledgedAt: string | null;
  fileSha256: string | null;
  ip: string | null;
}

export async function listAcknowledgements(
  deps: AppDeps,
  a: DocActor,
  q: { status?: "outstanding" | "completed"; documentId?: string; employeeId?: string },
) {
  const rows = await deps.db
    .select({ r: acknowledgementRequests, d: documents, e: employees, v: documentVersions })
    .from(acknowledgementRequests)
    .innerJoin(
      documents,
      and(eq(documents.orgId, acknowledgementRequests.orgId), eq(documents.id, acknowledgementRequests.documentId)),
    )
    .innerJoin(
      employees,
      and(eq(employees.orgId, acknowledgementRequests.orgId), eq(employees.id, acknowledgementRequests.employeeId)),
    )
    .innerJoin(
      documentVersions,
      and(
        eq(documentVersions.orgId, acknowledgementRequests.orgId),
        eq(documentVersions.id, acknowledgementRequests.documentVersionId),
      ),
    )
    .where(
      a.org.where(
        acknowledgementRequests,
        isNull(documents.deletedAt),
        q.documentId ? eq(acknowledgementRequests.documentId, q.documentId) : undefined,
        q.employeeId ? eq(acknowledgementRequests.employeeId, q.employeeId) : undefined,
        q.status === "outstanding" ? isNull(acknowledgementRequests.acknowledgedAt) : undefined,
        q.status === "completed" ? sql`${acknowledgementRequests.acknowledgedAt} is not null` : undefined,
      ),
    )
    .orderBy(desc(acknowledgementRequests.requestedAt));
  return rows.map(
    (x): AckRow => ({
      id: x.r.id,
      documentId: x.d.id,
      documentTitle: x.d.title,
      employeeId: x.e.id,
      employeeName: displayName(x.e),
      employeeNumber: x.e.employeeNumber,
      version: x.v.version,
      requestedAt: x.r.requestedAt.toISOString(),
      acknowledgedAt: x.r.acknowledgedAt?.toISOString() ?? null,
      fileSha256: x.r.fileSha256,
      ip: x.r.ip,
    }),
  );
}

// ----- Retention ----------------------------------------------------------------------------

export async function listRetentionReviews(deps: AppDeps, a: DocActor) {
  const rows = await deps.db
    .select({ r: documentRetentionReviews, d: documents, e: employees, c: documentCategories })
    .from(documentRetentionReviews)
    .innerJoin(
      documents,
      and(eq(documents.orgId, documentRetentionReviews.orgId), eq(documents.id, documentRetentionReviews.documentId)),
    )
    .innerJoin(employees, and(eq(employees.orgId, documents.orgId), eq(employees.id, documents.employeeId)))
    .innerJoin(
      documentCategories,
      and(eq(documentCategories.orgId, documents.orgId), eq(documentCategories.id, documents.categoryId)),
    )
    .where(
      a.org.where(documentRetentionReviews, isNull(documentRetentionReviews.resolvedAt), isNull(documents.deletedAt)),
    )
    .orderBy(asc(documentRetentionReviews.reviewFrom));
  return rows.map((x) => ({
    id: x.r.id,
    documentId: x.d.id,
    documentTitle: x.d.title,
    category: x.c.name,
    employeeId: x.e.id,
    employeeName: displayName(x.e),
    reason: x.r.reason,
    reviewFrom: x.r.reviewFrom,
    flaggedAt: x.r.flaggedAt.toISOString(),
  }));
}

export const resolveRetentionInput = z.discriminatedUnion("resolution", [
  z.object({
    resolution: z.literal("keep"),
    keepMonths: z.int().min(1).max(120).default(12),
    reason: z.string().trim().max(300).optional(),
  }),
  z.object({
    resolution: z.literal("delete"),
    reason: z.string().trim().min(1, "Say why the document is no longer needed.").max(300),
  }),
]);

/** HR decides on a flagged document: keep it (flag again later) or delete it (soft; owners purge). */
export async function resolveRetention(
  deps: AppDeps,
  a: DocActor,
  id: string,
  input: z.output<typeof resolveRetentionInput>,
) {
  const review = await a.org.getById(documentRetentionReviews, id, "review");
  if (review.resolvedAt) throw new AppError("already_decided", "This review was already decided.");
  const today = singaporeDate(deps.clock.now());
  // Calendar months, clamped to the month's last day (31 Oct + 4 months = 28 Feb), as the sweep does.
  const keepUntil = input.resolution === "keep" ? addMonthsIso(today, input.keepMonths) : null;
  await deps.db.transaction(async (tx) => {
    await tx
      .update(documentRetentionReviews)
      .set({
        resolvedAt: deps.clock.now(),
        resolution: input.resolution,
        keepUntil,
        resolvedByMembershipId: a.membershipId,
      })
      .where(a.org.whereId(documentRetentionReviews, id));
    await recordAudit(tx, deps, a.audit, {
      action: "document.retention_reviewed",
      targetType: "document",
      targetId: review.documentId,
      meta: { resolution: input.resolution, keepUntil, reason: input.reason ?? null },
    });
    if (input.resolution === "delete")
      await softDeleteTx(tx, deps, a, review.documentId, `Retention review: ${input.reason}`);
  });
}

export { displayDate, FIELDS };
