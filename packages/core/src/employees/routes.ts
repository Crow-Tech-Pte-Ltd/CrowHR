import { z } from "zod";
import { revealSensitive } from "../access/nric.ts";
import { sensitive } from "../access/sensitivity.ts";
import { AppError } from "../errors.ts";
import { csvEnum, listQuery } from "../http/list.ts";
import { defineModule, defineRoute } from "../http/route.ts";
import { WORK_PASS_TYPES } from "../organisation/statutory.ts";
import { actorFrom, assertCanRead } from "./access.ts";
import {
  changeRequestSchema,
  checklistSchema,
  compensationSchema,
  directoryRowSchema,
  employeeDetailSchema,
  importPreviewSchema,
  workPassSchema,
} from "./api-schemas.ts";
import { SG_BANKS } from "./banks.ts";
import {
  cancelOwnChangeRequest,
  changeRequestInput,
  decidableChangeRequests,
  decideChangeRequest,
  decisionInput,
  ownChangeRequests,
  submitChangeRequest,
} from "./change-requests.ts";
import { checklistInbox, completeItemInput, employeeChecklists, updateChecklistItem } from "./checklists.ts";
import { singaporeToday } from "./dates.ts";
import { availableExportColumns, EXPORT_COLUMNS, exportEmployees } from "./export.ts";
import { commitImport, getImport, previewImport } from "./import/service.ts";
import { TEMPLATES, templateCsv } from "./import/templates.ts";
import { applyEvent, cancelEvent, ctxFor, eventInput, hire } from "./lifecycle.ts";
import {
  adminProfilePatch,
  bankAccountForPayment,
  decryptIdNumber,
  replaceEmergencyContacts,
  selfServicePatch,
  setBankAccount,
  updateOwnProfile,
  updatePersonal,
} from "./profile.ts";
import { assertEmployeeInOrg, compensationOf, EMPLOYEE_STATUSES, getEmployee, listDirectory } from "./records.ts";
import {
  bankAccountInput,
  EMPLOYMENT_TYPES,
  emergencyContactsInput,
  GENDERS,
  hireInput,
  RACES,
  RELIGIONS,
  TERMINATION_REASONS,
  workPassInput,
  workPassPatch,
} from "./schemas.ts";
import { addWorkPass, updateWorkPass } from "./work-pass.ts";

const idParam = z.object({ id: z.uuid() });

const directoryFilters = {
  departmentId: z.uuid().optional(),
  teamId: z.uuid().optional(),
  locationId: z.uuid().optional(),
  costCentreId: z.uuid().optional(),
  managerId: z.uuid().optional(),
  status: csvEnum(EMPLOYEE_STATUSES),
  scope: z.enum(["all", "team"]).optional(),
};

const listParams = listQuery({
  sort: ["name", "employeeNumber", "department", "hireDate", "jobTitle"],
  defaultSort: "name",
  search: true,
  filters: directoryFilters,
});

const exportQuery = z.object({
  format: z.enum(["csv", "xlsx"]).default("csv"),
  columns: z
    .string()
    .transform((s) =>
      s
        .split(",")
        .map((v) => v.trim())
        .filter(Boolean),
    )
    .optional(),
  q: z.string().trim().max(200).optional(),
  ...directoryFilters,
});

function filtersFrom(q: {
  q?: unknown;
  departmentId?: string;
  teamId?: string;
  locationId?: string;
  costCentreId?: string;
  managerId?: string;
  status?: (typeof EMPLOYEE_STATUSES)[number][];
  scope?: "all" | "team";
}) {
  return { ...q, q: typeof q.q === "string" ? q.q : undefined, teamOnly: q.scope === "team" };
}

const SORT_KEY: Record<string, (r: z.infer<typeof directoryRowSchema>) => string> = {
  name: (r) => r.name.toLowerCase(),
  employeeNumber: (r) => r.employeeNumber,
  department: (r) => (r.department?.name ?? "").toLowerCase(),
  hireDate: (r) => r.hireDate ?? "",
  jobTitle: (r) => (r.jobTitle ?? "").toLowerCase(),
};

export const employeesModule = defineModule({
  name: "employees",
  basePath: "/employees",
  tag: "Employees",
  routes: [
    defineRoute({
      method: "get",
      path: "/",
      summary: "Employee directory",
      description: "Directory fields are visible to every member. Work pass state only to readers of all work passes.",
      access: { permission: "directory:read" },
      request: { query: listParams },
      responses: {
        200: z.object({
          items: z.array(directoryRowSchema),
          page: z.number().int(),
          pageSize: z.number().int(),
          total: z.number().int(),
        }),
      },
      handler: async ({ c, deps, query }) => {
        const rows = await listDirectory(deps, actorFrom(c).actor, filtersFrom(query));
        const desc = query.sort.startsWith("-");
        const key = SORT_KEY[desc ? query.sort.slice(1) : query.sort] ?? SORT_KEY.name;
        rows.sort((a, b) => {
          const ka = (key as (r: typeof a) => string)(a);
          const kb = (key as (r: typeof b) => string)(b);
          return (ka < kb ? -1 : ka > kb ? 1 : a.id < b.id ? -1 : 1) * (desc ? -1 : 1);
        });
        const start = (query.page - 1) * query.pageSize;
        return {
          items: rows.slice(start, start + query.pageSize),
          page: query.page,
          pageSize: query.pageSize,
          total: rows.length,
        };
      },
    }),
    defineRoute({
      method: "post",
      path: "/",
      summary: "Hire an employee",
      description:
        "Creates the employee, tenure, employment record, optional compensation (payroll roles only), onboarding checklist and sign-in invitation.",
      access: { permission: "employment:create" },
      request: { body: hireInput },
      responses: {
        201: z.object({
          employeeId: z.string(),
          /** The sign-in invitation (null when there was no work email or `invite: false`). */
          invite: z
            .object({
              status: z.enum(["emailed", "link", "linked", "skipped"]),
              /** Shown once to copy when email isn't configured. */
              inviteUrl: z.string().nullable(),
              message: z.string(),
            })
            .nullable(),
        }),
      },
      errors: ["conflict", "duplicate_id_number", "reporting_cycle"],
      handler: async ({ c, deps, body }) => {
        const { actor, ports } = actorFrom(c);
        return hire(ctxFor(deps, ports, actor), body);
      },
    }),
    defineRoute({
      method: "get",
      path: "/export/columns",
      summary: "Columns the caller may export",
      access: { permission: "directory:read" },
      responses: {
        200: z.object({ items: z.array(z.object({ key: z.string(), label: z.string(), unmasked: z.boolean() })) }),
      },
      handler: async ({ c }) => {
        const cols = await availableExportColumns(actorFrom(c).actor, { unmasked: true });
        return { items: cols.map((col) => ({ key: col.key, label: col.label, unmasked: !!col.unmasked })) };
      },
    }),
    defineRoute({
      method: "get",
      path: "/export",
      summary: "Export the employee list (CSV or XLSX, masked identifiers)",
      access: { permission: "directory:read" },
      request: { query: exportQuery },
      responses: { 200: { description: "CSV or XLSX file", contentType: "text/csv" } },
      errors: ["forbidden"],
      handler: async ({ c, deps, query }) => {
        const { actor, ports } = actorFrom(c);
        const out = await exportEmployees(deps, ports, actor, {
          columns: query.columns,
          format: query.format,
          filters: filtersFrom(query),
        });
        return fileResponse(out);
      },
    }),
    defineRoute({
      method: "get",
      path: "/export/unmasked",
      summary: "Export with unmasked NRIC/FIN or bank numbers (requires recent sign-in)",
      access: { permission: "personal_details:read" },
      recentAuth: true,
      request: { query: exportQuery },
      responses: { 200: { description: "CSV or XLSX file", contentType: "text/csv" } },
      errors: ["forbidden", "reauth_required"],
      handler: async ({ c, deps, query }) => {
        const { actor, ports } = actorFrom(c);
        const out = await exportEmployees(deps, ports, actor, {
          columns: query.columns,
          format: query.format,
          filters: filtersFrom(query),
          unmasked: true,
        });
        return fileResponse(out);
      },
    }),
    defineRoute({
      method: "get",
      path: "/:id",
      summary: "Get an employee",
      description: "Sections the caller may not read are omitted and listed in redactedFields.",
      access: { permission: "directory:read" },
      request: { params: idParam },
      responses: { 200: employeeDetailSchema },
      errors: ["not_found"],
      handler: async ({ c, deps, params }) => getEmployee(deps, actorFrom(c).actor, params.id),
    }),
    defineRoute({
      method: "patch",
      path: "/:id",
      summary: "Update personal and identity details (HR)",
      access: { permission: "personal_details:update" },
      request: { params: idParam, body: adminProfilePatch },
      responses: { 204: null },
      errors: ["not_found", "conflict", "duplicate_id_number"],
      handler: async ({ c, deps, params, body }) => {
        const { actor, ports } = actorFrom(c);
        await updatePersonal(deps, ports, actor, params.id, body);
      },
    }),
    defineRoute({
      method: "put",
      path: "/:id/emergency-contacts",
      summary: "Replace emergency contacts (at most 3)",
      example: { body: { contacts: [{ name: "Tan Ah Kow", relationship: "Father", phone: "91234567" }] } },
      access: { permission: "emergency_contacts:update" },
      request: { params: idParam, body: z.object({ contacts: emergencyContactsInput }) },
      responses: { 204: null },
      errors: ["not_found"],
      handler: async ({ c, deps, params, body }) => {
        const { actor, ports } = actorFrom(c);
        await replaceEmergencyContacts(deps, ports, actor, params.id, body.contacts);
      },
    }),
    defineRoute({
      method: "post",
      path: "/:id/events",
      summary: "Record a lifecycle event",
      example: { body: { type: "transfer", effectiveDate: "2026-12-01", changes: { jobTitle: "Senior Barista" } } },
      description:
        "transfer, promotion, salary_change, probation_confirmed, resignation, termination or rehire. Future-dated events are scheduled.",
      access: { permission: "employment:read" },
      request: { params: idParam, body: eventInput },
      responses: { 201: z.object({ eventId: z.string(), status: z.enum(["scheduled", "effective", "cancelled"]) }) },
      errors: ["not_found", "conflict", "reporting_cycle", "self_change_requires_approval"],
      handler: async ({ c, deps, params, body }) => {
        const { actor, ports } = actorFrom(c);
        await assertCanRead(actor, "directory", params.id);
        return applyEvent(ctxFor(deps, ports, actor), params.id, body);
      },
    }),
    defineRoute({
      method: "post",
      path: "/:id/events/:eventId/cancel",
      summary: "Cancel a scheduled lifecycle event",
      access: { permission: "employment:read" },
      request: { params: z.object({ id: z.uuid(), eventId: z.uuid() }) },
      responses: { 204: null },
      errors: ["not_found", "conflict"],
      handler: async ({ c, deps, params }) => {
        const { actor, ports } = actorFrom(c);
        await cancelEvent(ctxFor(deps, ports, actor), params.id, params.eventId);
      },
    }),
    defineRoute({
      method: "post",
      path: "/:id/nric/reveal",
      summary: "Reveal the full NRIC/FIN once (re-authentication, 30 per hour, audited)",
      access: { permission: "personal_details:read" },
      recentAuth: true,
      request: { params: idParam },
      responses: { 200: z.object({ value: sensitive(z.string(), "nric") }) },
      errors: ["not_found", "reauth_required", "rate_limited"],
      handler: async ({ c, deps, params }) => {
        const { actor, ports } = actorFrom(c);
        await assertEmployeeInOrg(deps.db, actor.orgId, params.id);
        await assertCanRead(actor, "personal", params.id);
        const value = await revealSensitive(c, {
          cls: "nric",
          employeeId: params.id,
          load: () => decryptIdNumber(deps, ports, actor, params.id),
        });
        return { value };
      },
    }),
    defineRoute({
      method: "post",
      path: "/:id/bank/reveal",
      summary: "Reveal the full current bank account number once (re-authentication, 30 per hour, audited)",
      access: { permission: "bank_details:read" },
      recentAuth: true,
      request: { params: idParam },
      responses: { 200: z.object({ value: sensitive(z.string(), "bank") }) },
      errors: ["not_found", "reauth_required", "rate_limited"],
      handler: async ({ c, deps, params }) => {
        const { actor, ports } = actorFrom(c);
        await assertEmployeeInOrg(deps.db, actor.orgId, params.id);
        await assertCanRead(actor, "bank", params.id);
        const value = await revealSensitive(c, {
          cls: "bank",
          employeeId: params.id,
          load: async () =>
            (await bankAccountForPayment(deps, ports, actor.orgId, params.id, singaporeToday(deps.clock.now())))
              ?.accountNumber ?? null,
        });
        return { value };
      },
    }),
    defineRoute({
      method: "get",
      path: "/:id/compensation",
      summary: "Compensation history",
      access: { permission: "compensation:read" },
      request: { params: idParam },
      responses: {
        200: z.object({
          current: compensationSchema.nullable(),
          history: z.array(compensationSchema),
          allowances: z.array(
            z.object({
              id: z.string(),
              allowanceTypeId: z.string(),
              name: z.string(),
              amountCents: z.number().int(),
              effectiveFrom: z.string(),
              effectiveTo: z.string().nullable(),
            }),
          ),
        }),
      },
      errors: ["not_found"],
      handler: async ({ c, deps, params, grant }) => {
        const { actor } = actorFrom(c);
        await assertEmployeeInOrg(deps.db, actor.orgId, params.id);
        await grant.assertEmployee(params.id, "employee record");
        await assertCanRead(actor, "compensation", params.id);
        return compensationOf(deps.db, actor.orgId, params.id, singaporeToday(deps.clock.now()));
      },
    }),
    defineRoute({
      method: "post",
      path: "/:id/work-passes",
      summary: "Add a work pass",
      example: {
        body: { passType: "S_PASS", passNumber: "G1234567X", issuedOn: "2026-01-02", expiresOn: "2028-01-01" },
      },
      access: { permission: "work_pass:create" },
      request: { params: idParam, body: workPassInput },
      responses: { 201: workPassSchema },
      errors: ["not_found"],
      handler: async ({ c, deps, params, body }) => {
        const { actor, ports } = actorFrom(c);
        return addWorkPass(deps, ports, actor, params.id, body);
      },
    }),
    defineRoute({
      method: "patch",
      path: "/:id/work-passes/:passId",
      summary: "Update or cancel a work pass",
      access: { permission: "work_pass:update" },
      request: { params: z.object({ id: z.uuid(), passId: z.uuid() }), body: workPassPatch },
      responses: { 200: workPassSchema },
      errors: ["not_found"],
      handler: async ({ c, deps, params, body }) => {
        const { actor, ports } = actorFrom(c);
        return updateWorkPass(deps, ports, actor, params.id, params.passId, body);
      },
    }),
    defineRoute({
      method: "post",
      path: "/:id/bank-accounts",
      summary: "Set the bank account from a date (previous one kept as history)",
      example: {
        body: {
          bankCode: "DBSSSGSG",
          accountNumber: "0123456789",
          holderName: "Tan Mei Ling",
          effectiveFrom: "2026-11-01",
        },
      },
      access: { permission: "bank_details:update" },
      request: { params: idParam, body: bankAccountInput },
      responses: { 201: z.object({ id: z.string(), accountMasked: z.string() }) },
      errors: ["not_found", "self_change_requires_approval"],
      handler: async ({ c, deps, params, body }) => {
        const { actor, ports } = actorFrom(c);
        return setBankAccount(deps, ports, actor, params.id, body);
      },
    }),
    defineRoute({
      method: "get",
      path: "/:id/checklists",
      summary: "Onboarding and offboarding checklists",
      access: { permission: "employment:read" },
      request: { params: idParam },
      responses: { 200: z.object({ items: z.array(checklistSchema) }) },
      errors: ["not_found"],
      handler: async ({ c, deps, params }) => ({
        items: await assertEmployeeInOrg(deps.db, actorFrom(c).actor.orgId, params.id).then(() =>
          employeeChecklists(deps, actorFrom(c).actor, params.id),
        ),
      }),
    }),
  ],
});

function fileResponse(out: { body: Uint8Array | string; contentType: string; fileName: string }) {
  return new Response(out.body as BodyInit, {
    headers: {
      "content-type": out.contentType,
      "content-disposition": `attachment; filename="${out.fileName}"`,
      "cache-control": "no-store",
    },
  });
}

const importKind = z.enum(["employees", "compensation", "ytd"]);

/** Self-service, checklist work, change-request decisions, imports and reference lists. */
export const peopleModule = defineModule({
  name: "people",
  basePath: "/people",
  tag: "People",
  routes: [
    defineRoute({
      method: "get",
      path: "/reference",
      summary: "Reference lists for people forms (banks, pass types, races, religions)",
      access: "authenticated",
      responses: {
        200: z.object({
          banks: z.array(z.object({ code: z.string(), name: z.string() })),
          workPassTypes: z.array(z.object({ code: z.string(), label: z.string() })),
          races: z.array(z.string()),
          religions: z.array(z.string()),
          genders: z.array(z.string()),
          employmentTypes: z.array(z.string()),
          terminationReasons: z.array(z.string()),
          exportColumns: z.array(z.object({ key: z.string(), label: z.string() })),
        }),
      },
      handler: () => ({
        banks: SG_BANKS.map((b) => ({ code: b.code, name: b.name })),
        workPassTypes: WORK_PASS_TYPES.map((p) => ({ code: p.code, label: p.label })),
        races: [...RACES],
        religions: [...RELIGIONS],
        genders: [...GENDERS],
        employmentTypes: [...EMPLOYMENT_TYPES],
        terminationReasons: [...TERMINATION_REASONS],
        exportColumns: EXPORT_COLUMNS.map((col) => ({ key: col.key, label: col.label })),
      }),
    }),
    defineRoute({
      method: "get",
      path: "/inbox",
      summary: "People work assigned to me: open checklist items and change requests to decide",
      access: "authenticated",
      responses: {
        200: z.object({
          checklistItems: z.array(
            z.object({
              itemId: z.string(),
              employeeId: z.string(),
              title: z.string(),
              dueOn: z.string(),
              kind: z.enum(["onboarding", "offboarding"]),
            }),
          ),
          changeRequests: z.array(changeRequestSchema.extend({ employeeId: z.string() })),
        }),
      },
      handler: async ({ c, deps }) => {
        const { actor } = actorFrom(c);
        return {
          checklistItems: await checklistInbox(deps, actor),
          changeRequests: await decidableChangeRequests(deps, actor),
        };
      },
    }),
    defineRoute({
      method: "post",
      path: "/checklist-items/:itemId",
      summary: "Complete, skip (with reason) or reopen a checklist item",
      example: { body: { action: "done" } },
      access: "authenticated",
      request: { params: z.object({ itemId: z.uuid() }), body: completeItemInput },
      responses: { 204: null },
      errors: ["not_found", "forbidden", "conflict"],
      handler: async ({ c, deps, params, body }) => {
        const { actor, ports } = actorFrom(c);
        await updateChecklistItem(deps, ports, actor, params.itemId, body);
      },
    }),
    defineRoute({
      method: "post",
      path: "/change-requests/:requestId/decision",
      summary: "Approve or reject a profile change request",
      example: { body: { decision: "approve", effectiveFrom: "2026-11-01" } },
      description: "Stands in for the workflows onApproved callback until workflows lands.",
      access: "authenticated",
      request: { params: z.object({ requestId: z.uuid() }), body: decisionInput },
      responses: { 200: changeRequestSchema },
      errors: ["not_found", "forbidden", "conflict", "duplicate_id_number", "self_change_requires_approval"],
      handler: async ({ c, deps, params, body }) => {
        const { actor, ports } = actorFrom(c);
        return decideChangeRequest(deps, ports, actor, params.requestId, body);
      },
    }),
    defineRoute({
      method: "get",
      path: "/me/profile",
      summary: "My profile, with my pending change requests",
      access: "authenticated",
      responses: { 200: z.object({ employee: employeeDetailSchema, changeRequests: z.array(changeRequestSchema) }) },
      errors: ["not_found"],
      handler: async ({ c, deps }) => {
        const { actor } = actorFrom(c);
        if (!actor.employeeId) {
          throw new AppError("not_found", "Your account is not linked to an employee record. Ask HR to link it.");
        }
        return {
          employee: await getEmployee(deps, actor, actor.employeeId),
          changeRequests: await ownChangeRequests(deps, actor),
        };
      },
    }),
    defineRoute({
      method: "patch",
      path: "/me/profile",
      summary: "Edit my preferred name, personal email, mobile, address and emergency contacts",
      access: "authenticated",
      request: { body: selfServicePatch },
      responses: { 204: null },
      errors: ["not_found"],
      handler: async ({ c, deps, body }) => {
        const { actor, ports } = actorFrom(c);
        await updateOwnProfile(deps, ports, actor, body);
      },
    }),
    defineRoute({
      method: "post",
      path: "/me/change-requests",
      summary: "Request a change to sensitive details (legal name, ID, DOB, residency, race, religion, bank)",
      access: "authenticated",
      request: { body: changeRequestInput },
      responses: { 201: z.object({ items: z.array(changeRequestSchema) }) },
      errors: ["not_found"],
      handler: async ({ c, deps, body }) => {
        const { actor, ports } = actorFrom(c);
        return { items: await submitChangeRequest(deps, ports, actor, body) };
      },
    }),
    defineRoute({
      method: "post",
      path: "/me/change-requests/:requestId/cancel",
      summary: "Withdraw my pending change request",
      access: "authenticated",
      request: { params: z.object({ requestId: z.uuid() }) },
      responses: { 204: null },
      errors: ["not_found", "conflict"],
      handler: async ({ c, deps, params }) => {
        const { actor, ports } = actorFrom(c);
        await cancelOwnChangeRequest(deps, ports, actor, params.requestId);
      },
    }),
    defineRoute({
      method: "get",
      path: "/imports/templates/:kind",
      summary: "Download an import template (CSV)",
      access: { permission: "employment:read" },
      request: { params: z.object({ kind: importKind }) },
      responses: { 200: { description: "CSV template", contentType: "text/csv" } },
      handler: ({ params }) =>
        new Response(`﻿${templateCsv(params.kind)}`, {
          headers: {
            "content-type": "text/csv; charset=utf-8",
            "content-disposition": `attachment; filename="${TEMPLATES[params.kind].fileName}"`,
          },
        }),
    }),
    defineRoute({
      method: "post",
      path: "/imports/:kind/preview",
      summary: "Upload a CSV and preview the import (nothing is written)",
      example: { body: { fileName: "staff.csv", content: "legal_name\nTan Mei Ling\n" } },
      access: { permission: "employment:read" },
      request: {
        params: z.object({ kind: importKind }),
        body: z.object({ fileName: z.string().max(200).nullish(), content: z.string().max(5 * 1024 * 1024 + 1024) }),
      },
      responses: { 201: importPreviewSchema },
      errors: ["forbidden"],
      handler: async ({ c, deps, params, body }) => {
        const { actor, ports } = actorFrom(c);
        return previewImport(deps, ports, actor, params.kind, { name: body.fileName, content: body.content });
      },
    }),
    defineRoute({
      method: "get",
      path: "/imports/:jobId",
      summary: "Get an import preview",
      access: { permission: "employment:read" },
      request: { params: z.object({ jobId: z.uuid() }) },
      responses: { 200: importPreviewSchema },
      errors: ["not_found"],
      handler: async ({ c, deps, params }) => getImport(deps, actorFrom(c).actor, params.jobId),
    }),
    defineRoute({
      method: "post",
      path: "/imports/:jobId/commit",
      summary: "Confirm an import: all rows in one transaction, or none",
      access: { permission: "employment:read" },
      request: { params: z.object({ jobId: z.uuid() }) },
      responses: { 200: importPreviewSchema },
      errors: ["not_found", "conflict"],
      handler: async ({ c, deps, params }) => {
        const { actor, ports } = actorFrom(c);
        return commitImport(deps, ports, actor, params.jobId);
      },
    }),
  ],
});
