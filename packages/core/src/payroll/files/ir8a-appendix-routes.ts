import { z } from "zod";
import { defineRoute } from "../../http/route.ts";
import { appendixEntrySchema, appendixListSchema } from "../api-schemas.ts";
import { payrollActor } from "../routes.ts";
import { appendixEntryInput, createAppendixEntryInput } from "./ir8a-appendix-input.ts";
import {
  createAppendixEntry,
  deleteAppendixEntry,
  listAppendixEntries,
  replaceAppendixEntry,
} from "./ir8a-appendix-service.ts";

/**
 * IR8A Appendix 8A (benefits-in-kind) and 8B (share-plan gains) records (add-ir8a-appendix-8a-8b),
 * mounted in the payroll module. Owner and payroll_admin only (`payroll:read` / `payroll:update`).
 */

const yearParams = z.object({ year: z.coerce.number().int().min(2000).max(2100) });
const entryParams = z.object({ entryId: z.uuid() });

const exampleEntry = {
  kind: "residence",
  basis: "rented",
  address: "1 Example Road #01-01 Singapore 123456",
  occupiedFrom: "2026-01-01",
  occupiedTo: "2026-12-31",
  employeesSharing: 1,
  rentPaidByEmployerCents: 4_800_000,
} as const;

export const ir8aAppendixRoutes = [
  defineRoute({
    method: "get",
    path: "/years/:year/ir8a/appendices",
    summary: "Appendix 8A benefits-in-kind and Appendix 8B share gains recorded for an income year",
    description:
      "Each record with the values Crow HR computes from IRAS's formulas (and their working), and each employee's Appendix 8A total (IR8A d8) and Appendix 8B totals (d7(a), d7(b)).",
    access: { permission: "payroll:read" },
    request: { params: yearParams },
    responses: { 200: appendixListSchema },
    errors: ["validation_failed"],
    handler: ({ c, deps, auth, params }) => listAppendixEntries(deps, payrollActor(c, auth), params.year),
  }),
  defineRoute({
    method: "post",
    path: "/years/:year/ir8a/appendices",
    summary: "Record a benefit-in-kind (Appendix 8A) or share-plan gain (Appendix 8B) for an employee",
    description:
      "`entry.kind` is `residence` (items 1–2, at most 10 per employee and year), `hotel` (item 3), `car` (4i), `other` (4a–4h, 4j) or `share_gain` (Appendix 8B, at most 30). Dates must be in the income year. Audit-logged.",
    access: { permission: "payroll:update" },
    request: { params: yearParams, body: createAppendixEntryInput },
    responses: { 201: appendixEntrySchema },
    errors: ["validation_failed", "not_found", "conflict"],
    example: { body: { employeeId: "0190f2a4-0000-7000-8000-000000000001", entry: exampleEntry } },
    handler: async ({ c, deps, auth, params, body }) =>
      createAppendixEntry(deps, payrollActor(c, auth), params.year, body),
  }),
  defineRoute({
    method: "put",
    path: "/ir8a/appendices/:entryId",
    summary: "Replace an Appendix 8A or 8B record (same employee, year and kind)",
    access: { permission: "payroll:update" },
    request: { params: entryParams, body: z.object({ entry: appendixEntryInput }) },
    responses: { 200: appendixEntrySchema },
    errors: ["validation_failed", "not_found", "conflict"],
    example: { body: { entry: exampleEntry } },
    handler: ({ c, deps, auth, params, body }) =>
      replaceAppendixEntry(deps, payrollActor(c, auth), params.entryId, body.entry),
  }),
  defineRoute({
    method: "delete",
    path: "/ir8a/appendices/:entryId",
    summary: "Delete an Appendix 8A or 8B record",
    access: { permission: "payroll:update" },
    request: { params: entryParams },
    responses: { 204: null },
    errors: ["not_found"],
    handler: async ({ c, deps, auth, params }) => {
      await deleteAppendixEntry(deps, payrollActor(c, auth), params.entryId);
    },
  }),
];
