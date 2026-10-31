import { z } from "zod";
import { actorFrom } from "../employees/access.ts";
import { createTemplate, listTemplates, templateInput } from "../employees/checklists.ts";
import { allowanceTypeInput, createAllowanceType, listAllowanceTypes } from "../employees/profile.ts";
import { AppError } from "../errors.ts";
import { defineModule, defineRoute } from "../http/route.ts";
import {
  companyProfileInput,
  getCompanyProfile,
  readCompanyLogo,
  saveCompanyLogo,
  saveCompanyProfile,
  toView,
} from "./profile.ts";
import { setupChecklist } from "./setup-checklist.ts";
import { archiveStructure, createStructure, listStructure, STRUCTURE_KINDS, updateStructure } from "./structure.ts";
import {
  createScheduleInput,
  createWorkSchedule,
  listWorkSchedules,
  setDefaultWorkSchedule,
  updateScheduleInput,
  updateWorkSchedule,
} from "./work-schedules.ts";

const profileSchema = z.object({
  legalName: z.string(),
  tradingName: z.string().nullable(),
  uen: z.string(),
  csn: z.string().nullable(),
  address: z.object({
    block: z.string().nullable(),
    street: z.string().nullable(),
    unit: z.string().nullable(),
    building: z.string().nullable(),
    postalCode: z.string().nullable(),
  }),
  hasLogo: z.boolean(),
  timeZone: z.literal("Asia/Singapore"),
  currency: z.literal("SGD"),
  payrollReady: z.boolean(),
  missingForPayroll: z.array(z.string()),
  updatedAt: z.string(),
});

const structureItem = z.object({
  id: z.string(),
  name: z.string(),
  code: z.string().nullable().optional(),
  departmentId: z.string().nullable().optional(),
  address: z.string().nullable().optional(),
  postalCode: z.string().nullable().optional(),
  archived: z.boolean(),
  archivedAt: z.string().nullable(),
  employeeCount: z.number().int(),
});

const workWeek = z.array(z.object({ type: z.enum(["working", "half", "off", "rest"]), minutes: z.number().int() }));
const scheduleSchema = z.object({
  id: z.string(),
  name: z.string(),
  kind: z.enum(["fixed", "shift"]),
  isDefault: z.boolean(),
  archived: z.boolean(),
  current: z
    .object({ effectiveFrom: z.string(), days: workWeek.nullable(), weeklyMinutes: z.number().int() })
    .nullable(),
  versions: z.array(
    z.object({
      effectiveFrom: z.string(),
      effectiveTo: z.string().nullable(),
      days: workWeek.nullable(),
      weeklyMinutes: z.number().int(),
    }),
  ),
});

const kindParam = z.object({ kind: z.enum(STRUCTURE_KINDS) });
const kindIdParam = z.object({ kind: z.enum(STRUCTURE_KINDS), id: z.uuid() });
const idParam = z.object({ id: z.uuid() });
const anyBody = z.record(z.string(), z.unknown());

const templateSchema = z.object({
  id: z.string(),
  kind: z.enum(["onboarding", "offboarding"]),
  name: z.string(),
  isDefault: z.boolean(),
  items: z.array(
    z.object({
      title: z.string(),
      assigneeRole: z.enum(["hr_admin", "payroll_admin", "manager", "employee"]),
      dueOffsetDays: z.number().int(),
    }),
  ),
});
const allowanceTypeSchema = z.object({ id: z.string(), code: z.string(), name: z.string(), archived: z.boolean() });

export const organisationModule = defineModule({
  name: "organisation",
  basePath: "/organisation",
  tag: "Organisation",
  feature: "organisation",
  routes: [
    defineRoute({
      method: "get",
      path: "/profile",
      summary: "Get the company profile (legal entity)",
      access: { permission: "org_structure:read" },
      responses: { 200: z.object({ profile: profileSchema.nullable() }) },
      handler: async ({ c, deps }) => {
        const { actor } = actorFrom(c);
        const p = await getCompanyProfile(deps, actor.orgId);
        return { profile: p ? toView(p) : null };
      },
    }),
    defineRoute({
      method: "put",
      path: "/profile",
      summary: "Save the company profile",
      description: "Legal name, UEN (ACRA formats), CSN (UEN + payment type + serial) and registered address.",
      access: { permission: "org_structure:update" },
      request: { body: companyProfileInput },
      responses: { 200: z.object({ profile: profileSchema }) },
      errors: ["conflict"],
      handler: async ({ c, deps, body }) => {
        const { actor, ports } = actorFrom(c);
        return { profile: await saveCompanyProfile(deps, ports, actor, body) };
      },
    }),
    defineRoute({
      method: "put",
      path: "/profile/logo",
      summary: "Upload the company logo (PNG or SVG, at most 1 MB)",
      access: { permission: "org_structure:update" },
      request: {
        body: z.object({
          contentType: z.string(),
          dataBase64: z.string().max(1_500_000, "The logo must be at most 1 MB."),
        }),
      },
      responses: { 204: null },
      errors: ["conflict"],
      handler: async ({ c, deps, body }) => {
        const { actor, ports } = actorFrom(c);
        let data: Uint8Array;
        try {
          data = Uint8Array.from(atob(body.dataBase64), (ch) => ch.charCodeAt(0));
        } catch {
          throw new AppError("validation_failed", "The logo data is not valid base64.");
        }
        await saveCompanyLogo(deps, ports, actor, { data, contentType: body.contentType });
      },
    }),
    defineRoute({
      method: "get",
      path: "/profile/logo",
      summary: "Download the company logo",
      access: { permission: "org_structure:read" },
      responses: { 200: { description: "The logo image", contentType: "image/png" } },
      errors: ["not_found"],
      handler: async ({ c, deps }) => {
        const { actor } = actorFrom(c);
        const file = await readCompanyLogo(deps, actor.orgId);
        return new Response(file.data as BodyInit, {
          headers: { "content-type": file.contentType, "cache-control": "private, max-age=300" },
        });
      },
    }),
    defineRoute({
      method: "get",
      path: "/setup-checklist",
      summary: "Organisation setup progress (derived from data)",
      access: { permission: "org_structure:update" },
      responses: {
        200: z.object({
          complete: z.boolean(),
          steps: z.array(
            z.object({
              id: z.enum(["company_profile", "department", "work_schedule", "employee"]),
              title: z.string(),
              done: z.boolean(),
              href: z.string(),
            }),
          ),
        }),
      },
      handler: async ({ c, deps }) => setupChecklist(deps.db, actorFrom(c).actor.orgId),
    }),
    defineRoute({
      method: "get",
      path: "/structure/:kind",
      summary: "List departments, teams, locations or cost centres",
      access: { permission: "org_structure:read" },
      request: { params: kindParam },
      responses: { 200: z.object({ items: z.array(structureItem) }) },
      handler: async ({ c, deps, params }) => ({ items: await listStructure(deps, actorFrom(c).actor, params.kind) }),
    }),
    defineRoute({
      method: "post",
      path: "/structure/:kind",
      summary: "Create a department, team, location or cost centre",
      access: { permission: "org_structure:create" },
      request: { params: kindParam, body: anyBody },
      responses: { 201: structureItem },
      errors: ["conflict"],
      handler: async ({ c, deps, params, body }) => {
        const { actor, ports } = actorFrom(c);
        return createStructure(deps, ports, actor, params.kind, body);
      },
    }),
    defineRoute({
      method: "patch",
      path: "/structure/:kind/:id",
      summary: "Rename or edit a structure entry",
      access: { permission: "org_structure:update" },
      request: { params: kindIdParam, body: anyBody },
      responses: { 200: structureItem },
      errors: ["not_found", "conflict"],
      handler: async ({ c, deps, params, body }) => {
        const { actor, ports } = actorFrom(c);
        return updateStructure(deps, ports, actor, params.kind, params.id, body);
      },
    }),
    defineRoute({
      method: "post",
      path: "/structure/:kind/:id/archive",
      summary: "Archive or restore a structure entry",
      description:
        "Archiving an entry used by current employees fails with 409 conflict, reason in_use, and the count.",
      access: { permission: "org_structure:archive" },
      request: { params: kindIdParam, body: z.object({ archived: z.boolean() }) },
      responses: { 200: structureItem },
      errors: ["not_found", "conflict"],
      handler: async ({ c, deps, params, body }) => {
        const { actor, ports } = actorFrom(c);
        return archiveStructure(deps, ports, actor, params.kind, params.id, body.archived);
      },
    }),
    defineRoute({
      method: "get",
      path: "/work-schedules",
      summary: "List work schedules with their versions",
      access: { permission: "org_structure:read" },
      responses: { 200: z.object({ items: z.array(scheduleSchema) }) },
      handler: async ({ c, deps }) => ({ items: await listWorkSchedules(deps, actorFrom(c).actor) }),
    }),
    defineRoute({
      method: "post",
      path: "/work-schedules",
      summary: "Create a work schedule",
      access: { permission: "org_structure:create" },
      request: { body: createScheduleInput },
      responses: { 201: scheduleSchema },
      errors: ["conflict"],
      handler: async ({ c, deps, body }) => {
        const { actor, ports } = actorFrom(c);
        return createWorkSchedule(deps, ports, actor, body);
      },
    }),
    defineRoute({
      method: "put",
      path: "/work-schedules/:id",
      summary: "Change a work schedule from a date (new effective-dated version)",
      access: { permission: "org_structure:update" },
      request: { params: idParam, body: updateScheduleInput },
      responses: { 200: scheduleSchema },
      errors: ["not_found", "conflict"],
      handler: async ({ c, deps, params, body }) => {
        const { actor, ports } = actorFrom(c);
        return updateWorkSchedule(deps, ports, actor, params.id, body);
      },
    }),
    defineRoute({
      method: "post",
      path: "/work-schedules/:id/default",
      summary: "Make a work schedule the organisation default",
      access: { permission: "org_structure:update" },
      request: { params: idParam },
      responses: { 200: scheduleSchema },
      errors: ["not_found", "conflict"],
      handler: async ({ c, deps, params }) => {
        const { actor, ports } = actorFrom(c);
        return setDefaultWorkSchedule(deps, ports, actor, params.id);
      },
    }),
    defineRoute({
      method: "get",
      path: "/allowance-types",
      summary: "List recurring allowance types",
      access: { permission: "org_structure:read" },
      responses: { 200: z.object({ items: z.array(allowanceTypeSchema) }) },
      handler: async ({ c, deps }) => ({ items: await listAllowanceTypes(deps, actorFrom(c).actor) }),
    }),
    defineRoute({
      method: "post",
      path: "/allowance-types",
      summary: "Create an allowance type",
      access: { permission: "compensation:create" },
      request: { body: allowanceTypeInput },
      responses: { 201: allowanceTypeSchema },
      errors: ["conflict"],
      handler: async ({ c, deps, body }) => {
        const { actor, ports } = actorFrom(c);
        return createAllowanceType(deps, ports, actor, body);
      },
    }),
    defineRoute({
      method: "get",
      path: "/checklist-templates",
      summary: "List onboarding and offboarding checklist templates",
      access: { permission: "employment:update" },
      responses: { 200: z.object({ items: z.array(templateSchema) }) },
      handler: async ({ c, deps }) => ({ items: await listTemplates(deps, actorFrom(c).actor) }),
    }),
    defineRoute({
      method: "post",
      path: "/checklist-templates",
      summary: "Create a checklist template",
      access: { permission: "employment:update" },
      request: { body: templateInput },
      responses: { 201: templateSchema },
      handler: async ({ c, deps, body }) => {
        const { actor, ports } = actorFrom(c);
        return createTemplate(deps, ports, actor, body);
      },
    }),
  ],
});
