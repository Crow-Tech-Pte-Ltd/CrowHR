import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { authorize } from "../access/authorize.ts";
import { singaporeDate } from "../access/scope.ts";
import type { AppContext } from "../context.ts";
import { documentRequests, LETTER_KINDS } from "../db/schema/documents.ts";
import { AppError } from "../errors.ts";
import { type ExportColumn, toCsvDocument } from "../export/index.ts";
import { fileResponseHeaders, readBodyLimited } from "../files/uploads.ts";
import { defineModule, defineRoute, reply } from "../http/route.ts";
import { submitApproval } from "../workflows/engine.ts";
import { docActor, isHr } from "./access.ts";
import { FIELDS } from "./fields.ts";
import {
  acknowledge,
  categoryInput,
  categoryPatch,
  createCategory,
  createTemplate,
  deleteCategory,
  deleteDocument,
  documentPatch,
  generateInput,
  generateLetter,
  getDocument,
  listAcknowledgements,
  listCategories,
  listDocuments,
  listQuery,
  listRetentionReviews,
  listTemplates,
  MAX_DOCUMENT_BYTES,
  openDocumentFile,
  purgeDocument,
  replaceDocument,
  replaceQuery,
  requestAcknowledgement,
  resolveRetention,
  resolveRetentionInput,
  templateInput,
  templatePatch,
  updateCategory,
  updateDocument,
  updateTemplate,
  uploadDocument,
  uploadQuery,
} from "./service.ts";
import { validateTemplate } from "./templates.ts";

const category = z.object({
  id: z.uuid(),
  systemKey: z.string().nullable(),
  name: z.string(),
  sensitivity: z.enum(["normal", "medical"]),
  employeeVisible: z.boolean(),
  managerVisible: z.boolean(),
  payrollVisible: z.boolean(),
  employeeUploadable: z.boolean(),
  expiryRequired: z.boolean(),
  auditViews: z.boolean(),
  retentionMonthsAfterExit: z.int().nullable(),
  position: z.int(),
  documentCount: z.int(),
});
type CategoryRow = Omit<z.input<typeof category>, "documentCount"> & { documentCount?: number };
const toCategory = (c: CategoryRow): z.input<typeof category> => ({
  id: c.id,
  systemKey: c.systemKey,
  name: c.name,
  sensitivity: c.sensitivity,
  employeeVisible: c.employeeVisible,
  managerVisible: c.managerVisible,
  payrollVisible: c.payrollVisible,
  employeeUploadable: c.employeeUploadable,
  expiryRequired: c.expiryRequired,
  auditViews: c.auditViews,
  retentionMonthsAfterExit: c.retentionMonthsAfterExit,
  position: c.position,
  documentCount: c.documentCount ?? 0,
});

const version = z.object({
  id: z.uuid(),
  version: z.int(),
  fileName: z.string().nullable(),
  mime: z.string().nullable(),
  sizeBytes: z.int().nullable(),
  sha256: z.string(),
  expiresOn: z.string().nullable(),
  source: z.enum(["upload", "generated"]),
  templateId: z.uuid().nullable(),
  templateVersion: z.int().nullable(),
  asAt: z.string().nullable(),
  createdAt: z.string(),
  superseded: z.boolean(),
});

const documentView = z.object({
  id: z.uuid(),
  employeeId: z.uuid(),
  employeeName: z.string(),
  employeeNumber: z.string(),
  category: z.object({ id: z.uuid(), name: z.string(), sensitivity: z.enum(["normal", "medical"]) }),
  title: z.string(),
  notes: z.string().nullable(),
  expiresOn: z.string().nullable(),
  expiry: z.enum(["valid", "expiring", "expired"]).nullable(),
  source: z.enum(["upload", "generated"]),
  current: version.nullable(),
  previousVersions: z.array(version).meta({ description: "Superseded versions (HR only)." }),
  acknowledgement: z
    .object({
      id: z.uuid(),
      status: z.enum(["requested", "acknowledged"]),
      requestedAt: z.string(),
      acknowledgedAt: z.string().nullable(),
      fileSha256: z.string().nullable(),
      current: z.boolean().meta({ description: "False when a newer version needs a new acknowledgement." }),
    })
    .nullable(),
  viewed: z.boolean(),
  createdAt: z.string(),
  deletedAt: z.string().nullable(),
  canManage: z.boolean(),
});

const template = z.object({
  id: z.uuid(),
  kind: z.enum(LETTER_KINDS),
  name: z.string(),
  bodyMd: z.string(),
  version: z.int(),
  active: z.boolean(),
  targetCategoryId: z.uuid(),
  fields: z.array(z.string()),
  usesSalary: z.boolean(),
  updatedAt: z.string(),
});

const missing = z.object({ id: z.string(), label: z.string(), where: z.string() });
const idParam = z.object({ id: z.uuid() });
const reasonBody = z.object({ reason: z.string().trim().min(1, "Say why.").max(300) });

const ackRow = z.object({
  id: z.uuid(),
  documentId: z.uuid(),
  documentTitle: z.string(),
  employeeId: z.uuid(),
  employeeName: z.string(),
  employeeNumber: z.string(),
  version: z.int(),
  requestedAt: z.string(),
  acknowledgedAt: z.string().nullable(),
  fileSha256: z.string().nullable(),
  ip: z.string().nullable(),
});

const ACK_COLUMNS: ExportColumn[] = [
  { key: "documentTitle", title: "Document", type: "text" },
  { key: "version", title: "Version", type: "integer" },
  { key: "employeeNumber", title: "Employee no.", type: "text" },
  { key: "employeeName", title: "Employee", type: "text" },
  { key: "requestedAt", title: "Requested", type: "datetime" },
  { key: "acknowledgedAt", title: "Acknowledged", type: "datetime" },
  { key: "fileSha256", title: "File SHA-256", type: "text" },
  { key: "ip", title: "IP address", type: "text" },
];

async function salaryActor(c: AppContext) {
  const a = await docActor(c);
  return {
    ...a,
    async canReadSalary(employeeId: string) {
      try {
        return (await authorize(c, "compensation:read")).canAccessEmployee(employeeId);
      } catch {
        return false;
      }
    },
  };
}

const hrOnly = async (c: AppContext) => {
  const a = await docActor(c);
  if (!isHr(a)) throw new AppError("forbidden", "Only owners and HR admins can do this.");
  return a;
};

/** Employee documents, letters and acknowledgements (openspec/changes/add-documents). */
export const documentsModule = defineModule({
  name: "documents",
  basePath: "/documents",
  tag: "Documents",
  routes: [
    // ----- Categories --------------------------------------------------------------------
    defineRoute({
      method: "get",
      path: "/categories",
      summary: "Document categories with their access flags",
      access: { permission: "documents:read" },
      responses: { 200: z.object({ items: z.array(category) }) },
      handler: async ({ c, deps }) => ({
        items: (await listCategories(deps, await docActor(c))).map((r) => toCategory(r)),
      }),
    }),
    defineRoute({
      method: "post",
      path: "/categories",
      summary: "Add a document category",
      access: { permission: "documents:update" },
      request: { body: categoryInput },
      responses: { 201: category },
      errors: ["conflict"],
      handler: async ({ c, deps, body }) => reply(201, toCategory(await createCategory(deps, await docActor(c), body))),
    }),
    defineRoute({
      method: "patch",
      path: "/categories/:id",
      summary: "Change a category (medical categories can't be visible to managers)",
      access: { permission: "documents:update" },
      request: { params: idParam, body: categoryPatch },
      example: { body: { name: "Licences" } },
      responses: { 200: category },
      handler: async ({ c, deps, params, body }) =>
        toCategory(await updateCategory(deps, await docActor(c), params.id, body)),
    }),
    defineRoute({
      method: "delete",
      path: "/categories/:id",
      summary: "Delete an empty category",
      access: { permission: "documents:delete" },
      request: { params: idParam },
      responses: { 204: null },
      errors: ["in_use"],
      handler: async ({ c, deps, params }) => {
        await deleteCategory(deps, await docActor(c), params.id);
      },
    }),

    // ----- Lists and uploads -------------------------------------------------------------
    defineRoute({
      method: "get",
      path: "/",
      summary: "Documents the member may see (`mine=true`, `employeeId`, `categoryId`, `expiry`)",
      access: { permission: "documents:read" },
      request: { query: listQuery },
      responses: { 200: z.object({ items: z.array(documentView) }) },
      handler: async ({ c, deps, query }) => ({ items: await listDocuments(deps, await docActor(c), query) }),
    }),
    defineRoute({
      method: "post",
      path: "/upload",
      summary:
        "Upload a document for an employee (raw bytes in the body; PDF, JPEG, PNG, WebP, DOCX or XLSX, at most 20 MB)",
      description:
        "The file type is detected from its content. DOCX and XLSX must be valid OOXML packages; macro-enabled files are refused. Employees may upload only to their own employee-uploadable categories.",
      access: { permission: "documents:create" },
      request: { query: uploadQuery },
      responses: { 201: documentView },
      errors: ["file_too_large", "unsupported_file_type", "not_found"],
      handler: async ({ c, deps, query }) =>
        reply(
          201,
          await uploadDocument(deps, await docActor(c), query, await readBodyLimited(c.req.raw, MAX_DOCUMENT_BYTES)),
        ),
    }),

    // ----- Acknowledgements and retention (HR) -------------------------------------------
    defineRoute({
      method: "get",
      path: "/acknowledgements",
      summary: "Outstanding and completed acknowledgements (`format=csv` to download)",
      access: { permission: "documents:update" },
      request: {
        query: z.object({
          status: z.enum(["outstanding", "completed"]).optional(),
          documentId: z.uuid().optional(),
          employeeId: z.uuid().optional(),
          format: z.enum(["json", "csv"]).default("json"),
        }),
      },
      responses: { 200: z.object({ items: z.array(ackRow) }) },
      handler: async ({ c, deps, query }) => {
        const items = await listAcknowledgements(deps, await docActor(c), query);
        if (query.format === "csv") {
          return new Response(toCsvDocument(ACK_COLUMNS, items as unknown as Record<string, string>[]), {
            headers: {
              "content-type": "text/csv; charset=utf-8",
              "content-disposition": `attachment; filename="acknowledgements-${singaporeDate(deps.clock.now())}.csv"`,
              "x-content-type-options": "nosniff",
              "cache-control": "no-store",
            },
          });
        }
        return { items };
      },
    }),
    defineRoute({
      method: "get",
      path: "/retention",
      summary: "Documents flagged for a retention review (nothing is deleted without a decision)",
      access: { permission: "documents:update" },
      responses: {
        200: z.object({
          items: z.array(
            z.object({
              id: z.uuid(),
              documentId: z.uuid(),
              documentTitle: z.string(),
              category: z.string(),
              employeeId: z.uuid(),
              employeeName: z.string(),
              reason: z.string(),
              reviewFrom: z.string(),
              flaggedAt: z.string(),
            }),
          ),
        }),
      },
      handler: async ({ c, deps }) => ({ items: await listRetentionReviews(deps, await docActor(c)) }),
    }),
    defineRoute({
      method: "post",
      path: "/retention/:id/resolve",
      summary: "Keep a flagged document for longer, or delete it (soft; an owner can then purge it)",
      access: { permission: "documents:update" },
      request: { params: idParam, body: resolveRetentionInput },
      example: { body: { resolution: "keep", keepMonths: 12 } },
      responses: { 204: null },
      errors: ["already_decided"],
      handler: async ({ c, deps, params, body }) => {
        await resolveRetention(deps, await hrOnly(c), params.id, body);
      },
    }),

    // ----- Templates and generation ------------------------------------------------------
    defineRoute({
      method: "get",
      path: "/fields",
      summary: "The merge fields a letter template may use",
      access: { permission: "documents:update" },
      responses: {
        200: z.object({
          items: z.array(
            z.object({
              id: z.string(),
              label: z.string(),
              group: z.string(),
              sensitivity: z.string().optional(),
              where: z.string(),
              perDocument: z.boolean().optional(),
            }),
          ),
        }),
      },
      handler: () => ({ items: FIELDS.map((f) => ({ ...f })) }),
    }),
    defineRoute({
      method: "get",
      path: "/templates",
      summary: "Letter templates",
      access: { permission: "documents:update" },
      responses: { 200: z.object({ items: z.array(template) }) },
      handler: async ({ c, deps }) => ({ items: await listTemplates(deps, await docActor(c)) }),
    }),
    defineRoute({
      method: "post",
      path: "/templates/check",
      summary: "Check a template body without saving: unknown fields, disallowed Markdown, KET items",
      access: { permission: "documents:update" },
      request: { body: z.object({ kind: z.enum(LETTER_KINDS), bodyMd: z.string().max(50_000) }) },
      responses: {
        200: z.object({
          issues: z.array(z.object({ line: z.int(), message: z.string() })),
          fields: z.array(z.string()),
          blocks: z.array(z.record(z.string(), z.unknown())),
        }),
      },
      handler: ({ deps, body }) => {
        const r = validateTemplate(body.kind, body.bodyMd, singaporeDate(deps.clock.now()));
        return { issues: r.issues, fields: r.fields, blocks: r.blocks as unknown as Record<string, unknown>[] };
      },
    }),
    defineRoute({
      method: "post",
      path: "/templates",
      summary: "Create a letter template",
      access: { permission: "documents:update" },
      request: { body: templateInput },
      responses: { 201: template },
      errors: ["conflict"],
      handler: async ({ c, deps, body }) => reply(201, await createTemplate(deps, await hrOnly(c), body)),
    }),
    defineRoute({
      method: "put",
      path: "/templates/:id",
      summary: "Update a letter template (a new version)",
      access: { permission: "documents:update" },
      request: { params: idParam, body: templatePatch },
      example: { body: { name: "Offer letter (2027)" } },
      responses: { 200: template },
      handler: async ({ c, deps, params, body }) => updateTemplate(deps, await hrOnly(c), params.id, body),
    }),
    defineRoute({
      method: "post",
      path: "/generate",
      summary: "Generate a letter from a template for an employee (or preview it with `dryRun`)",
      description:
        "Every merge field is resolved as at `asAt`. Missing values block generation (422 `missing_fields`, with where to fill each). Templates with salary fields need salary read for the employee (403 otherwise).",
      access: { permission: "documents:update" },
      request: { body: generateInput },
      responses: {
        200: z.object({
          documentId: z.uuid().nullable(),
          missing: z.array(missing),
          values: z.record(z.string(), z.string()),
          blocks: z.array(z.record(z.string(), z.unknown())),
        }),
      },
      errors: ["missing_fields", "forbidden", "not_found"],
      crossOrgExempt: "IDs are in the body; tested in documents/generate tests.",
      handler: async ({ c, deps, body }) => {
        const a = await salaryActor(c);
        if (!isHr(a)) throw new AppError("forbidden", "Only owners and HR admins can generate letters.");
        const out = await generateLetter(deps, a, body);
        return {
          documentId: out.documentId,
          missing: out.preview.missing,
          values: out.preview.values,
          blocks: out.preview.blocks as unknown as Record<string, unknown>[],
        };
      },
    }),

    // ----- Employee requests -------------------------------------------------------------
    defineRoute({
      method: "get",
      path: "/requests",
      summary: "My letter requests",
      access: "authenticated",
      responses: {
        200: z.object({
          items: z.array(
            z.object({
              id: z.uuid(),
              kind: z.enum(LETTER_KINDS),
              purpose: z.string().nullable(),
              status: z.enum(["pending", "approved", "rejected", "withdrawn"]),
              documentId: z.uuid().nullable(),
              createdAt: z.string(),
            }),
          ),
        }),
      },
      handler: async ({ deps, auth }) => {
        if (!auth.employeeId) return { items: [] };
        const rows = await deps.db
          .select()
          .from(documentRequests)
          .where(and(eq(documentRequests.orgId, auth.orgId), eq(documentRequests.employeeId, auth.employeeId)))
          .orderBy(desc(documentRequests.createdAt));
        return {
          items: rows.map((r) => ({
            id: r.id,
            kind: r.kind,
            purpose: r.purpose,
            status: r.status,
            documentId: r.documentId,
            createdAt: r.createdAt.toISOString(),
          })),
        };
      },
    }),
    defineRoute({
      method: "post",
      path: "/requests",
      summary: "Ask HR for an employment letter; on approval it is generated and filed in your documents",
      access: "authenticated",
      request: {
        body: z.object({
          kind: z.literal("employment_certificate"),
          purpose: z.string().trim().min(1, "Say what the letter is for, e.g. a visa or a bank loan.").max(200),
        }),
      },
      responses: { 201: z.object({ id: z.uuid(), status: z.literal("pending") }) },
      handler: async ({ c, deps, auth, body }) => {
        if (!auth.employeeId || auth.membershipStatus !== "active")
          throw new AppError(
            "forbidden",
            "Your account isn't linked to an employee record, so you can't request letters.",
          );
        const employeeId = auth.employeeId;
        const id = deps.ids.newId();
        // Resolve the actor before the transaction: role lookups use the main connection.
        const audit = (await docActor(c)).audit;
        await deps.db.transaction(async (tx) => {
          await tx.insert(documentRequests).values({
            id,
            orgId: auth.orgId,
            employeeId,
            kind: body.kind,
            purpose: body.purpose,
            requestedByMembershipId: auth.membershipId,
          });
          const res = await submitApproval(tx, deps, audit, {
            orgId: auth.orgId,
            subjectType: "document_request",
            subjectId: id,
            requesterMembershipId: auth.membershipId,
            requesterEmployeeId: employeeId,
            attributes: { typeCode: "employment_certificate" },
          });
          await tx
            .update(documentRequests)
            .set({ approvalRequestId: res.requestId })
            .where(eq(documentRequests.id, id));
        });
        return reply(201, { id, status: "pending" as const });
      },
    }),

    // ----- One document ------------------------------------------------------------------
    defineRoute({
      method: "get",
      path: "/:id",
      summary: "A document with its versions and acknowledgement",
      access: { permission: "documents:read" },
      request: { params: idParam },
      responses: { 200: documentView },
      errors: ["not_found"],
      handler: async ({ c, deps, params }) => getDocument(deps, await docActor(c), params.id),
    }),
    defineRoute({
      method: "get",
      path: "/:id/file",
      summary: "Download (or view) the document; records the first view and audits medical and identity views",
      description:
        "Served with the detected type, `Content-Disposition: attachment` (images and PDFs may be viewed inline with `inline=1`), `X-Content-Type-Options: nosniff` and a sandbox CSP. 404 for anyone who may not see it.",
      access: { permission: "documents:read" },
      request: { params: idParam, query: z.object({ version: z.uuid().optional(), inline: z.enum(["1"]).optional() }) },
      responses: { 200: { description: "The file", contentType: "application/octet-stream" } },
      errors: ["not_found"],
      handler: async ({ c, deps, params, query }) => {
        const { file, data } = await openDocumentFile(deps, await docActor(c), params.id, query.version);
        const inlineOk = ["image/jpeg", "image/png", "image/webp", "application/pdf"].includes(file.mime);
        return new Response(data as BodyInit, {
          headers: fileResponseHeaders(file, { inline: !!query.inline && inlineOk }),
        });
      },
    }),
    defineRoute({
      method: "post",
      path: "/:id/versions",
      summary: "Replace the file (raw bytes in the body): a new version; the old one is kept for HR",
      access: { permission: "documents:update" },
      request: { params: idParam, query: replaceQuery },
      responses: { 201: documentView },
      errors: ["file_too_large", "unsupported_file_type", "not_found"],
      crossOrgExempt: "Raw-body upload; the document lookup is the same org-scoped 404 as GET /documents/{id}.",
      handler: async ({ c, deps, params, query }) =>
        reply(
          201,
          await replaceDocument(
            deps,
            await docActor(c),
            params.id,
            query,
            await readBodyLimited(c.req.raw, MAX_DOCUMENT_BYTES),
          ),
        ),
    }),
    defineRoute({
      method: "patch",
      path: "/:id",
      summary: "Rename, re-note or re-file a document",
      access: { permission: "documents:update" },
      request: { params: idParam, body: documentPatch },
      example: { body: { title: "Renewed licence" } },
      responses: { 200: documentView },
      handler: async ({ c, deps, params, body }) => updateDocument(deps, await docActor(c), params.id, body),
    }),
    defineRoute({
      method: "delete",
      path: "/:id",
      summary: "Delete a document (soft: hidden, kept and audited)",
      access: { permission: "documents:delete" },
      request: { params: idParam, query: z.object({ reason: z.string().trim().max(300).optional() }) },
      responses: { 204: null },
      handler: async ({ c, deps, params, query }) => {
        await deleteDocument(deps, await docActor(c), params.id, query.reason || "No reason given");
      },
    }),
    defineRoute({
      method: "post",
      path: "/:id/purge",
      summary: "Permanently remove a deleted document and its files (owners only)",
      access: { permission: "documents:delete" },
      recentAuth: true,
      request: { params: idParam, body: reasonBody },
      example: { body: { reason: "Uploaded to the wrong employee" } },
      responses: { 204: null },
      errors: ["conflict"],
      handler: async ({ c, deps, params, body }) => {
        await purgeDocument(deps, await docActor(c), params.id, body.reason);
      },
    }),
    defineRoute({
      method: "post",
      path: "/:id/acknowledgements",
      summary: "Ask the employee to read and acknowledge the current version",
      access: { permission: "documents:update" },
      request: { params: idParam },
      example: { body: {} },
      responses: { 200: documentView },
      errors: ["conflict"],
      handler: async ({ c, deps, params }) => requestAcknowledgement(deps, await docActor(c), params.id),
    }),
    defineRoute({
      method: "post",
      path: "/:id/acknowledge",
      summary:
        "Acknowledge the document (employee; open it first). Records time, IP, user agent and the file's SHA-256",
      access: { permission: "documents:read" },
      request: { params: idParam },
      example: { body: {} },
      responses: { 200: documentView },
      errors: ["not_viewed", "conflict"],
      handler: async ({ c, deps, params }) => acknowledge(deps, await docActor(c), params.id),
    }),
  ],
});
