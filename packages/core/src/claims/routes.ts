import { z } from "zod";
import { CLAIM_STATUSES } from "../db/schema/claims.ts";
import { AppError } from "../errors.ts";
import { fileScannerOf } from "../files/scanner.ts";
import { fileResponseHeaders, readBodyLimited } from "../files/uploads.ts";
import { csvEnum, listQuery, pageOf } from "../http/list.ts";
import { defineModule, defineRoute, reply } from "../http/route.ts";
import { claimsActorFrom } from "./access.ts";
import {
  claimInputSchema,
  claimRowSchema,
  claimSchema,
  claimTypeInputSchema,
  claimTypeSchema,
  createClaimSchema,
  eligibleTypeSchema,
  fileSchema,
  markPaidSchema,
  reportRangeShape,
  summaryRowSchema,
} from "./api-schemas.ts";
import { markPaidOutside } from "./payouts.ts";
import { payableForPeriod } from "./reimbursement.ts";
import { claimsSummary, exportClaims } from "./reports.ts";
import {
  copyClaim,
  createAndSubmit,
  createDraft,
  deleteDraft,
  deleteReceipt,
  eligibleTypes,
  getClaim,
  listClaims,
  myClaimTotals,
  receiptForDownload,
  submitClaim,
  updateDraft,
  uploadReceipt,
  withdrawClaim,
} from "./service.ts";
import {
  type ClaimTypeRow,
  createClaimType,
  createStarterTypes,
  deleteClaimType,
  getClaimSettings,
  listClaimTypes,
  STARTER_CLAIM_TYPES,
  setClaimTypeArchived,
  updateClaimSettings,
  updateClaimType,
} from "./types.ts";

const id = z.object({ id: z.uuid() });
const fileIdParam = z.object({ fileId: z.uuid() });

const toTypeDto = (r: ClaimTypeRow & { inUse: boolean }) => ({
  id: r.id,
  code: r.code,
  name: r.name,
  category: r.category,
  receiptRule: r.receiptRule,
  receiptAboveCents: r.receiptAboveCents,
  capCents: r.capCents,
  capPeriod: r.capPeriod,
  eligibleEmploymentTypes: r.eligibleEmploymentTypes,
  availableDuringProbation: r.availableDuringProbation,
  defaultPayout: r.defaultPayout,
  gstApplicable: r.gstApplicable,
  taxable: r.taxable,
  glCode: r.glCode,
  archived: r.archivedAt !== null,
  inUse: r.inUse,
});

const settingsSchema = z.object({
  submissionWindowDays: z.int().min(7).max(730),
  /** Whether uploads are virus-scanned on this server (owners see "scanning is off" otherwise). */
  scanning: z.boolean().optional(),
});

const exampleLine = {
  claimTypeId: "0192f0c0-0000-7000-8000-000000000001",
  expenseDate: "2026-10-30",
  merchant: "Grab",
  description: "Taxi to client meeting",
  currency: "SGD",
  amountMinor: 1850,
  receiptIds: [],
};

const claimList = listQuery({
  sort: ["createdAt", "submittedAt", "approvedOn", "totalCents", "claimNumber"],
  defaultSort: "-createdAt",
  search: true,
  filters: {
    status: csvEnum(CLAIM_STATUSES).optional(),
    mine: z
      .enum(["true", "false"])
      .optional()
      .transform((v) => v === "true"),
    employeeId: z.uuid().optional(),
    claimTypeId: z.uuid().optional(),
    payout: z.enum(["payroll", "outside"]).optional(),
    expenseFrom: z.iso.date().optional(),
    expenseTo: z.iso.date().optional(),
  },
});

function assertRange(q: { from: string; to: string }) {
  if (q.from > q.to)
    throw new AppError("validation_failed", "The start date must be on or before the end date.", {
      issues: [{ path: "from", message: "Pick a start date on or before the end date." }],
    });
}

function fileResponse(out: { body: Uint8Array | string; contentType: string; fileName: string }) {
  return new Response(out.body as BodyInit, {
    headers: {
      "content-type": out.contentType,
      "content-disposition": `attachment; filename="${out.fileName}"`,
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}

/** Claims and expenses (openspec/changes/add-claims). Approvals are decided in the Inbox (workflows). */
export const claimsModule = defineModule({
  name: "claims",
  feature: "claims",
  basePath: "/claims",
  tag: "Claims",
  routes: [
    // ----- Claim types (Settings → Claim types) ---------------------------------------------
    defineRoute({
      method: "get",
      path: "/types",
      summary: "List claim types",
      access: { permission: "claim_types:read" },
      request: { query: z.object({ includeArchived: z.enum(["true", "false"]).optional() }) },
      responses: { 200: z.object({ items: z.array(claimTypeSchema) }) },
      handler: async ({ c, deps, query }) => ({
        items: (
          await listClaimTypes(deps, claimsActorFrom(c), { includeArchived: query.includeArchived === "true" })
        ).map(toTypeDto),
      }),
    }),
    defineRoute({
      method: "get",
      path: "/types/starter",
      summary: "The suggested starter set of claim types (not yet created)",
      access: { permission: "claim_types:read" },
      responses: { 200: z.object({ items: z.array(claimTypeInputSchema) }) },
      handler: () => ({ items: STARTER_CLAIM_TYPES.map((t) => ({ ...t })) }),
    }),
    defineRoute({
      method: "post",
      path: "/types/starter",
      summary: "Create the starter claim types (or a chosen subset) that don't exist yet",
      access: { permission: "policies:update" },
      request: { body: z.object({ codes: z.array(z.string()).max(20).optional() }) },
      responses: { 201: z.object({ items: z.array(claimTypeSchema) }) },
      handler: async ({ c, deps, body }) => ({
        items: (await createStarterTypes(deps, claimsActorFrom(c), body.codes)).map(toTypeDto),
      }),
    }),
    defineRoute({
      method: "post",
      path: "/types",
      summary: "Create a claim type",
      access: { permission: "policies:update" },
      request: { body: claimTypeInputSchema },
      responses: { 201: claimTypeSchema },
      errors: ["conflict"],
      handler: async ({ c, deps, body }) => toTypeDto(await createClaimType(deps, claimsActorFrom(c), body)),
    }),
    defineRoute({
      method: "patch",
      path: "/types/:id",
      summary: "Update a claim type",
      access: { permission: "policies:update" },
      request: { params: id, body: claimTypeInputSchema.partial() },
      responses: { 200: claimTypeSchema },
      errors: ["not_found", "conflict"],
      example: { body: { name: "Transport" } },
      handler: async ({ c, deps, params, body }) =>
        toTypeDto(await updateClaimType(deps, claimsActorFrom(c), params.id, body)),
    }),
    defineRoute({
      method: "post",
      path: "/types/:id/archive",
      summary: "Archive a claim type (it stays on existing claims)",
      access: { permission: "policies:update" },
      request: { params: id },
      responses: { 200: claimTypeSchema },
      errors: ["not_found"],
      handler: async ({ c, deps, params }) =>
        toTypeDto(await setClaimTypeArchived(deps, claimsActorFrom(c), params.id, true)),
    }),
    defineRoute({
      method: "post",
      path: "/types/:id/restore",
      summary: "Restore an archived claim type",
      access: { permission: "policies:update" },
      request: { params: id },
      responses: { 200: claimTypeSchema },
      errors: ["not_found"],
      handler: async ({ c, deps, params }) =>
        toTypeDto(await setClaimTypeArchived(deps, claimsActorFrom(c), params.id, false)),
    }),
    defineRoute({
      method: "delete",
      path: "/types/:id",
      summary: "Delete an unused claim type (used ones can only be archived)",
      access: { permission: "policies:update" },
      request: { params: id },
      responses: { 204: null },
      errors: ["not_found", "in_use"],
      handler: async ({ c, deps, params }) => {
        await deleteClaimType(deps, claimsActorFrom(c), params.id);
      },
    }),
    defineRoute({
      method: "get",
      path: "/settings",
      summary: "Claim settings (submission window, whether receipts are virus-scanned)",
      access: { permission: "claim_types:read" },
      responses: { 200: settingsSchema },
      handler: async ({ deps, auth }) => ({
        ...(await getClaimSettings(deps.db, auth.orgId)),
        scanning: fileScannerOf(deps) !== null,
      }),
    }),
    defineRoute({
      method: "put",
      path: "/settings",
      summary: "Update claim settings",
      access: { permission: "policies:update" },
      request: {
        body: z.object({
          submissionWindowDays: z.int().min(7, "Allow at least 7 days.").max(730, "At most 730 days."),
        }),
      },
      responses: { 200: settingsSchema },
      handler: async ({ c, deps, body }) => ({
        ...(await updateClaimSettings(deps, claimsActorFrom(c), body)),
        scanning: fileScannerOf(deps) !== null,
      }),
    }),

    // ----- Employee: types, receipts, my totals ---------------------------------------------
    defineRoute({
      method: "get",
      path: "/eligible-types",
      summary: "Claim types the employee may use, with cap usage for the period containing `date`",
      access: { permission: "claims:create" },
      request: {
        query: z.object({
          employeeId: z.uuid().optional(),
          date: z.iso.date().optional(),
          excludeClaimId: z.uuid().optional(),
        }),
      },
      responses: { 200: z.object({ items: z.array(eligibleTypeSchema) }) },
      errors: ["not_found"],
      handler: async ({ c, deps, query }) => ({ items: await eligibleTypes(deps, claimsActorFrom(c), query) }),
    }),
    defineRoute({
      method: "get",
      path: "/me/totals",
      summary: "My claim totals: waiting, approved and not yet paid, paid this year",
      access: "authenticated",
      responses: {
        200: z.object({ submittedCents: z.int(), approvedCents: z.int(), paidThisYearCents: z.int() }),
      },
      handler: async ({ c, deps }) => myClaimTotals(deps, claimsActorFrom(c)),
    }),
    defineRoute({
      method: "post",
      path: "/receipts",
      maxBodyBytes: 10 * 1024 * 1024,
      summary: "Upload a receipt (raw bytes in the body; PDF, JPEG, PNG, WebP or HEIC, at most 10 MB)",
      description:
        "Send the file as the raw request body (any Content-Type; the type is detected from the file's signature, never from the name or header). `fileName` is for display only. Owners and hr_admins may upload for another employee with `employeeId`.",
      access: { permission: "claims:create" },
      request: {
        query: z.object({ fileName: z.string().max(255).optional(), employeeId: z.uuid().optional() }),
      },
      responses: { 201: fileSchema },
      errors: ["file_too_large", "unsupported_file_type", "not_found"],
      handler: async ({ c, deps, query }) => {
        const data = await readBodyLimited(c.req.raw);
        return reply(
          201,
          await uploadReceipt(deps, claimsActorFrom(c), {
            data,
            fileName: query.fileName ?? null,
            employeeId: query.employeeId,
          }),
        );
      },
    }),
    defineRoute({
      method: "get",
      path: "/receipts/:fileId",
      summary: "Download or view a receipt",
      description:
        "Images are served inline, PDFs and HEIC as attachments, always with the detected type, `X-Content-Type-Options: nosniff` and a sandbox CSP. 404 for anyone who may not see it.",
      access: { permission: "claims:read" },
      request: { params: fileIdParam, query: z.object({ download: z.enum(["1"]).optional() }) },
      responses: { 200: { description: "The receipt file", contentType: "application/octet-stream" } },
      errors: ["not_found"],
      handler: async ({ c, deps, params, query }) => {
        const file = await receiptForDownload(deps, claimsActorFrom(c), params.fileId);
        const stored = await deps.fileStore.get(file.storageKey);
        if (!stored) throw new AppError("not_found", "That receipt doesn't exist or you can't see it.");
        const inline =
          !query.download && (file.mime === "image/jpeg" || file.mime === "image/png" || file.mime === "image/webp");
        return new Response(stored.data as BodyInit, { headers: fileResponseHeaders(file, { inline }) });
      },
    }),
    defineRoute({
      method: "delete",
      path: "/receipts/:fileId",
      summary: "Delete an uploaded receipt that no claim line uses",
      access: { permission: "claims:create" },
      request: { params: fileIdParam },
      responses: { 204: null },
      errors: ["not_found", "in_use"],
      handler: async ({ c, deps, params }) => {
        await deleteReceipt(deps, claimsActorFrom(c), params.fileId);
      },
    }),

    // ----- Payout outside payroll ------------------------------------------------------------
    defineRoute({
      method: "post",
      path: "/mark-paid",
      summary: "Mark approved claims paid outside payroll (bulk, with a date and reference)",
      access: { permission: "claims:pay" },
      request: { body: markPaidSchema },
      responses: { 200: z.object({ paid: z.int() }) },
      errors: ["not_found", "conflict"],
      handler: async ({ c, deps, body }) => markPaidOutside(deps, claimsActorFrom(c), body),
    }),

    defineRoute({
      method: "get",
      path: "/payable",
      summary: "Approved claims a payroll run for the period would reimburse (one entry per claim and type)",
      description:
        "The same list payroll reads through `ReimbursementSource.listPayable`: approved, unpaid, payroll-payout claims approved (Asia/Singapore date) on or before `periodEnd`.",
      access: { permission: "claims:pay" },
      request: { query: z.object({ periodEnd: z.iso.date({ error: "Use a date in the form YYYY-MM-DD." }) }) },
      responses: {
        200: z.object({
          items: z.array(
            z.object({
              claimId: z.uuid(),
              employeeId: z.uuid(),
              typeName: z.string(),
              amountCents: z.int(),
              claimNumber: z.string().nullable(),
              employeeName: z.string(),
              approvedOn: z.string().nullable(),
              reserved: z.boolean(),
            }),
          ),
          totalCents: z.int(),
        }),
      },
      handler: async ({ deps, auth, query }) => {
        const items = await payableForPeriod(deps.db, auth.orgId, query.periodEnd);
        return { items, totalCents: items.reduce((s, i) => s + i.amountCents, 0) };
      },
    }),

    // ----- Reports ---------------------------------------------------------------------------
    defineRoute({
      method: "get",
      path: "/reports/summary",
      summary: "Claim totals by type, department, employee or month, per status (expense-date range)",
      access: { permission: "reports_claims:read" },
      request: {
        query: z.object({
          ...reportRangeShape,
          by: z.enum(["type", "department", "employee", "month"]).default("type"),
        }),
      },
      responses: { 200: z.object({ items: z.array(summaryRowSchema) }) },
      handler: async ({ deps, auth, query }) => {
        assertRange(query);
        return { items: (await claimsSummary(deps.db, auth.orgId, query)) as z.input<typeof summaryRowSchema>[] };
      },
    }),
    defineRoute({
      method: "get",
      path: "/reports/export",
      summary: "Export claims (summary, line register or payout register) as CSV or XLSX",
      access: { permission: "reports_claims:export" },
      request: {
        query: z.object({
          ...reportRangeShape,
          report: z.enum(["summary", "lines", "payouts"]).default("lines"),
          by: z.enum(["type", "department", "employee", "month"]).default("type"),
          format: z.enum(["csv", "xlsx"]).default("csv"),
        }),
      },
      responses: { 200: { description: "CSV or XLSX file", contentType: "text/csv" } },
      handler: async ({ c, deps, query }) => {
        assertRange(query);
        return fileResponse(await exportClaims(deps, claimsActorFrom(c), query));
      },
    }),

    // ----- Claims ----------------------------------------------------------------------------
    defineRoute({
      method: "get",
      path: "/",
      summary: "List claims (own, team or all by role; `mine=true` for your own)",
      access: { permission: "claims:read" },
      request: { query: claimList },
      responses: { 200: pageOf(claimRowSchema) },
      handler: async ({ c, deps, query }) =>
        listClaims(deps, claimsActorFrom(c), { ...query, q: query.q as string | undefined }),
    }),
    defineRoute({
      method: "post",
      path: "/",
      summary: "Create a draft claim, or create and submit it (`submit: true`)",
      access: { permission: "claims:create" },
      request: { body: createClaimSchema },
      responses: { 201: claimSchema },
      errors: ["not_found", "cap_exceeded", "not_eligible"],
      handler: async ({ c, deps, body }) => {
        const actor = claimsActorFrom(c);
        const claimId = body.submit ? await createAndSubmit(deps, actor, body) : await createDraft(deps, actor, body);
        return reply(201, await getClaim(deps, actor, claimId));
      },
    }),
    defineRoute({
      method: "get",
      path: "/:id",
      summary: "Get a claim (lines, receipts subject to medical sensitivity, cap usage, duplicate flags)",
      access: { permission: "claims:read" },
      request: { params: id },
      responses: { 200: claimSchema },
      errors: ["not_found"],
      handler: async ({ c, deps, params }) => getClaim(deps, claimsActorFrom(c), params.id),
    }),
    defineRoute({
      method: "put",
      path: "/:id",
      summary: "Replace a draft claim's title and lines",
      access: { permission: "claims:create" },
      request: { params: id, body: claimInputSchema },
      responses: { 200: claimSchema },
      errors: ["not_found", "conflict"],
      example: { body: { lines: [exampleLine] } },
      handler: async ({ c, deps, params, body }) => {
        const actor = claimsActorFrom(c);
        await updateDraft(deps, actor, params.id, body);
        return getClaim(deps, actor, params.id);
      },
    }),
    defineRoute({
      method: "delete",
      path: "/:id",
      summary: "Delete a draft claim",
      access: { permission: "claims:create" },
      request: { params: id },
      responses: { 204: null },
      errors: ["not_found", "conflict"],
      handler: async ({ c, deps, params }) => {
        await deleteDraft(deps, claimsActorFrom(c), params.id);
      },
    }),
    defineRoute({
      method: "post",
      path: "/:id/submit",
      summary: "Submit a draft claim for approval",
      access: { permission: "claims:create" },
      request: { params: id },
      responses: { 200: claimSchema },
      errors: ["not_found", "conflict", "cap_exceeded", "not_eligible"],
      handler: async ({ c, deps, params }) => {
        const actor = claimsActorFrom(c);
        await submitClaim(deps, actor, params.id);
        return getClaim(deps, actor, params.id);
      },
    }),
    defineRoute({
      method: "post",
      path: "/:id/withdraw",
      summary: "Withdraw a submitted claim",
      access: { permission: "claims:read" },
      request: { params: id },
      responses: { 200: claimSchema },
      errors: ["not_found", "conflict"],
      handler: async ({ c, deps, params }) => {
        const actor = claimsActorFrom(c);
        await withdrawClaim(deps, actor, params.id);
        return getClaim(deps, actor, params.id);
      },
    }),
    defineRoute({
      method: "post",
      path: "/:id/copy",
      summary: "Copy a rejected or withdrawn claim into a new draft",
      access: { permission: "claims:create" },
      request: { params: id },
      responses: { 201: claimSchema },
      errors: ["not_found", "conflict"],
      handler: async ({ c, deps, params }) => {
        const actor = claimsActorFrom(c);
        return reply(201, await getClaim(deps, actor, await copyClaim(deps, actor, params.id)));
      },
    }),
  ],
});
