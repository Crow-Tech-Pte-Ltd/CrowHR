import { and, desc, eq, inArray, isNotNull } from "drizzle-orm";
import { z } from "zod";
import { auditContext } from "../audit/audit.ts";
import type { AppContext, AuthContext } from "../context.ts";
import {
  type PayrollPayslip,
  type PayrollRun,
  type PayrollRunItem,
  payrollPayslips,
  payrollRuns,
} from "../db/schema/payroll.ts";
import { AppError } from "../errors.ts";
import { defineModule, defineRoute } from "../http/route.ts";
import {
  createRunSchema,
  employeeDetailSchema,
  itemInputSchema,
  overviewSchema,
  type payResultSchema,
  payslipSummarySchema,
  payslipViewSchema,
  runSchema,
  runSummarySchema,
  settingsInputSchema,
  settingsSchema,
} from "./api-schemas.ts";
import { monthLabel } from "./engine/dates.ts";
import { bankPaymentFile, cpfEzpayFile, type GeneratedFile } from "./files/service.ts";
import { buildPayslipView } from "./payslip.ts";
import { renderPayslipPdf } from "./payslip-pdf.ts";
import { employeeDetail, runOverview } from "./review.ts";
import {
  addItem,
  computeRun,
  createRun,
  decideRun,
  deleteItem,
  deleteRun,
  getSettings,
  listAllowanceSettings,
  loadRun,
  markPaid,
  type PayrollActor,
  releaseRun,
  reopenRun,
  setAllowanceSetting,
  submitRun,
  updateItem,
  updateRun,
  updateSettings,
  withdrawRun,
} from "./service.ts";

export function payrollActor(c: AppContext, auth: AuthContext): PayrollActor {
  return {
    orgId: auth.orgId,
    userId: auth.user.id,
    membershipId: auth.membershipId,
    employeeId: auth.employeeId,
    isOwner: auth.membershipStatus === "active" && auth.roles.includes("owner"),
    audit: auditContext(c),
  };
}

const iso = (d: Date | null) => (d ? d.toISOString() : null);

export function toRunDto(r: PayrollRun): z.input<typeof runSchema> {
  return {
    id: r.id,
    kind: r.kind,
    offCycleReason: r.offCycleReason,
    month: r.month,
    periodStart: r.periodStart,
    periodEnd: r.periodEnd,
    payDate: r.payDate,
    status: r.status,
    employeeIds: r.employeeIds,
    adjustsRunId: r.adjustsRunId,
    supersededByRunId: r.supersededByRunId,
    reopenReason: r.reopenReason,
    approvalRequestId: r.approvalRequestId,
    submittedBy: r.submittedBy,
    submittedAt: iso(r.submittedAt),
    decidedBy: r.decidedBy,
    decidedAt: iso(r.decidedAt),
    decisionComment: r.decisionComment,
    selfApproved: r.selfApproved,
    computedAt: iso(r.computedAt),
    inputHash: r.inputHash,
    resultHash: r.resultHash,
    totals: r.totals,
    releasedAt: iso(r.releasedAt),
    paidAt: iso(r.paidAt),
    createdAt: r.createdAt.toISOString(),
    inputsChangedSinceCompute: !!(r.computedAt && r.inputsChangedAt && r.inputsChangedAt > r.computedAt),
  };
}

const summary = (r: PayrollRun) => {
  const d = toRunDto(r);
  return {
    id: d.id,
    kind: d.kind,
    offCycleReason: d.offCycleReason,
    month: d.month,
    payDate: d.payDate,
    status: d.status,
    supersededByRunId: d.supersededByRunId,
    adjustsRunId: d.adjustsRunId,
    releasedAt: d.releasedAt,
    totals: d.totals,
    computedAt: d.computedAt,
  };
};

export function toItemDto(i: PayrollRunItem) {
  return {
    id: i.id,
    employeeId: i.employeeId,
    kind: i.kind,
    label: i.label,
    amountCents: i.amountCents,
    wageClass: i.wageClass,
    cpfLiable: i.cpfLiable,
    awPayableDate: i.awPayableDate,
    minutes: i.minutes,
    days: i.halfDays === null ? null : i.halfDays / 2,
    date: i.itemDate,
    periodStart: i.periodStart,
    periodEnd: i.periodEnd,
    deductionCategory: i.deductionCategory,
    source: i.source,
    copiedFromItemId: i.copiedFromItemId,
  };
}

const runParams = z.object({ runId: z.uuid() });
const itemParams = z.object({ runId: z.uuid(), itemId: z.uuid() });
const exampleItem = {
  employeeId: "0190f3c2-0000-7000-8000-000000000001",
  kind: "bonus",
  label: "Bonus",
  amountCents: 100_000,
  wageClass: "AW",
  awPayableDate: "2026-10-31",
};

export async function payslipFor(c: AppContext, slip: PayrollPayslip, run: PayrollRun) {
  void c;
  return buildPayslipView(slip, run, monthLabel(run.month));
}

function fileResponse(f: GeneratedFile): Response {
  return new Response(f.body, {
    headers: {
      "content-type": f.contentType,
      "content-disposition": `attachment; filename="${f.fileName}"`,
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "x-crowhr-excluded": encodeURIComponent(JSON.stringify(f.excluded)),
    },
  });
}

/** PDF of a payslip. Byte-stable: dated by release (or approval, or the pay date for a draft preview). */
export async function payslipPdfResponse(slip: PayrollPayslip, run: PayrollRun): Promise<Response> {
  const view = buildPayslipView(slip, run, monthLabel(run.month));
  const createdAt = run.releasedAt ?? run.decidedAt ?? new Date(`${run.payDate}T00:00:00+08:00`);
  const bytes = await renderPayslipPdf(view, { createdAt });
  const name = `payslip-${run.month}-${slip.employeeNumber}${run.kind === "adjustment" ? "-revised" : run.kind === "off_cycle" ? `-${run.offCycleReason}` : ""}.pdf`;
  return new Response(bytes as BodyInit, {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `attachment; filename="${name}"`,
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}

export const payrollModule = defineModule({
  name: "payroll",
  basePath: "/payroll",
  tag: "Payroll",
  routes: [
    defineRoute({
      method: "get",
      path: "/settings",
      summary: "Payroll settings (pay day, release, CPF advice code, levy and bank file defaults)",
      access: { permission: "payroll:read" },
      responses: { 200: settingsSchema },
      handler: ({ deps, auth }) => getSettings(deps.db, auth.orgId),
    }),
    defineRoute({
      method: "put",
      path: "/settings",
      summary: "Update payroll settings",
      access: { permission: "payroll:update" },
      recentAuth: true,
      request: { body: settingsInputSchema },
      responses: { 200: settingsSchema },
      handler: ({ c, deps, auth, body }) => updateSettings(deps, payrollActor(c, auth), body),
    }),
    defineRoute({
      method: "get",
      path: "/allowance-settings",
      summary: "CPF and pro-ration treatment of each allowance type",
      access: { permission: "payroll:read" },
      responses: {
        200: z.object({
          items: z.array(
            z.object({
              allowanceTypeId: z.uuid(),
              code: z.string(),
              name: z.string(),
              cpfLiable: z.boolean(),
              prorate: z.boolean(),
            }),
          ),
        }),
      },
      handler: async ({ deps, auth }) => ({ items: await listAllowanceSettings(deps.db, auth.orgId) }),
    }),
    defineRoute({
      method: "put",
      path: "/allowance-settings/:allowanceTypeId",
      summary: "Set whether an allowance type is CPF-liable and pro-rated",
      access: { permission: "payroll:update" },
      request: {
        params: z.object({ allowanceTypeId: z.uuid() }),
        body: z.object({ cpfLiable: z.boolean(), prorate: z.boolean() }),
      },
      example: { body: { cpfLiable: true, prorate: true } },
      responses: {
        200: z.object({
          allowanceTypeId: z.uuid(),
          code: z.string(),
          name: z.string(),
          cpfLiable: z.boolean(),
          prorate: z.boolean(),
        }),
      },
      errors: ["not_found"],
      handler: async ({ c, deps, auth, params, body }) => {
        const out = await setAllowanceSetting(deps, payrollActor(c, auth), params.allowanceTypeId, body);
        if (!out) throw new AppError("not_found", "That allowance type doesn't exist or you can't see it.");
        return out;
      },
    }),
    defineRoute({
      method: "get",
      path: "/runs",
      summary: "List payroll runs, newest month first",
      access: { permission: "payroll:read" },
      responses: { 200: z.object({ items: z.array(runSummarySchema) }) },
      handler: async ({ deps, auth }) => {
        const rows = await deps.db
          .select()
          .from(payrollRuns)
          .where(eq(payrollRuns.orgId, auth.orgId))
          .orderBy(desc(payrollRuns.month), desc(payrollRuns.createdAt));
        return { items: rows.map(summary) };
      },
    }),
    defineRoute({
      method: "post",
      path: "/runs",
      summary: "Create a regular or off-cycle (final pay, bonus) payroll run",
      access: { permission: "payroll:create" },
      request: { body: createRunSchema },
      responses: { 201: runSchema },
      errors: ["conflict", "not_found"],
      handler: async ({ c, deps, auth, body }) => toRunDto(await createRun(deps, payrollActor(c, auth), body)),
    }),
    defineRoute({
      method: "get",
      path: "/runs/:runId",
      summary: "Run overview: issues first, totals, changes since last month, and the employee table",
      access: { permission: "payroll:read" },
      request: { params: runParams },
      responses: { 200: overviewSchema },
      errors: ["not_found"],
      handler: async ({ deps, auth, params }) => {
        const o = await runOverview(deps.db, auth.orgId, params.runId);
        return { ...o, run: toRunDto(o.run) };
      },
    }),
    defineRoute({
      method: "patch",
      path: "/runs/:runId",
      summary: "Change a draft run's pay date",
      access: { permission: "payroll:update" },
      request: { params: runParams, body: z.object({ payDate: z.iso.date() }) },
      example: { body: { payDate: "2026-10-30" } },
      responses: { 200: runSchema },
      errors: ["not_found", "conflict"],
      handler: async ({ c, deps, auth, params, body }) =>
        toRunDto(await updateRun(deps, payrollActor(c, auth), params.runId, body)),
    }),
    defineRoute({
      method: "delete",
      path: "/runs/:runId",
      summary: "Delete a draft run",
      access: { permission: "payroll:update" },
      request: { params: runParams },
      responses: { 204: null },
      errors: ["not_found", "conflict"],
      handler: async ({ c, deps, auth, params }) => {
        await deleteRun(deps, payrollActor(c, auth), params.runId);
      },
    }),
    defineRoute({
      method: "post",
      path: "/runs/:runId/compute",
      summary: "Compute every employee's pay from the current records and the run's items",
      access: { permission: "payroll:update" },
      request: { params: runParams },
      responses: { 200: runSchema },
      errors: ["not_found", "conflict"],
      handler: async ({ c, deps, auth, params }) =>
        toRunDto(await computeRun(deps, payrollActor(c, auth), params.runId)),
    }),
    defineRoute({
      method: "get",
      path: "/runs/:runId/employees/:employeeId",
      summary: "One employee in a run: inputs, every line, the full CPF/SDL/SHG working and the issues",
      access: { permission: "payroll:read" },
      request: { params: z.object({ runId: z.uuid(), employeeId: z.uuid() }) },
      responses: { 200: employeeDetailSchema },
      errors: ["not_found"],
      handler: async ({ deps, auth, params }) => {
        const d = await employeeDetail(deps.db, auth.orgId, params.runId, params.employeeId);
        return {
          run: summary(d.run),
          employeeId: params.employeeId,
          payslipId: d.slip?.id ?? null,
          employeeName: d.slip?.employeeName ?? null,
          input: (d.slip?.input as unknown as Record<string, unknown>) ?? null,
          inputHash: d.slip?.inputHash ?? null,
          result: (d.slip?.result as unknown as z.input<typeof payResultSchema> | undefined) ?? null,
          resultHash: d.slip?.resultHash ?? null,
          items: d.items.map(toItemDto),
        };
      },
    }),
    defineRoute({
      method: "post",
      path: "/runs/:runId/items",
      summary: "Add a pay item (bonus, commission, back pay, overtime, no-pay leave, hours, deduction) to a draft run",
      access: { permission: "payroll:update" },
      request: { params: runParams, body: itemInputSchema },
      example: { body: exampleItem },
      responses: { 201: z.object({ id: z.uuid() }) },
      errors: ["not_found", "conflict"],
      handler: async ({ c, deps, auth, params, body }) => ({
        id: await addItem(deps, payrollActor(c, auth), params.runId, body),
      }),
    }),
    defineRoute({
      method: "put",
      path: "/runs/:runId/items/:itemId",
      summary: "Replace a pay item on a draft run",
      access: { permission: "payroll:update" },
      request: { params: itemParams, body: itemInputSchema },
      example: { body: exampleItem },
      responses: { 204: null },
      errors: ["not_found", "conflict"],
      handler: async ({ c, deps, auth, params, body }) => {
        await updateItem(deps, payrollActor(c, auth), params.runId, params.itemId, body);
      },
    }),
    defineRoute({
      method: "delete",
      path: "/runs/:runId/items/:itemId",
      summary: "Remove a pay item from a draft run",
      access: { permission: "payroll:update" },
      request: { params: itemParams },
      responses: { 204: null },
      errors: ["not_found", "conflict"],
      handler: async ({ c, deps, auth, params }) => {
        await deleteItem(deps, payrollActor(c, auth), params.runId, params.itemId);
      },
    }),
    defineRoute({
      method: "post",
      path: "/runs/:runId/submit",
      summary: "Submit a computed run with no blocking issues for approval",
      access: { permission: "payroll:update" },
      request: { params: runParams },
      responses: { 200: runSchema },
      errors: ["not_found", "conflict"],
      handler: async ({ c, deps, auth, params }) =>
        toRunDto(await submitRun(deps, payrollActor(c, auth), params.runId)),
    }),
    defineRoute({
      method: "post",
      path: "/runs/:runId/withdraw",
      summary: "Withdraw a run in review back to draft",
      access: { permission: "payroll:update" },
      request: { params: runParams },
      responses: { 200: runSchema },
      errors: ["not_found", "conflict"],
      handler: async ({ c, deps, auth, params }) =>
        toRunDto(await withdrawRun(deps, payrollActor(c, auth), params.runId)),
    }),
    defineRoute({
      method: "post",
      path: "/runs/:runId/decision",
      summary: "Approve or reject a run in review (until the approvals engine is wired)",
      description:
        "Local approvals: an owner or payroll admin other than the submitter decides; an owner who submitted may decide and the decision is marked self-approved. When the workflows engine is wired this answers 409 and decisions go through the approvals inbox.",
      access: { permission: "payroll:finalise" },
      request: {
        params: runParams,
        body: z.object({
          outcome: z.enum(["approved", "rejected"]),
          comment: z.string().max(500).nullable().optional(),
        }),
      },
      example: { body: { outcome: "approved" } },
      responses: { 200: runSchema },
      errors: ["not_found", "conflict"],
      handler: async ({ c, deps, auth, params, body }) =>
        toRunDto(await decideRun(deps, payrollActor(c, auth), params.runId, body)),
    }),
    defineRoute({
      method: "post",
      path: "/runs/:runId/release",
      summary: "Release an approved run's payslips to employees",
      access: { permission: "payroll:finalise" },
      request: { params: runParams },
      responses: { 200: runSchema },
      errors: ["not_found", "conflict"],
      handler: async ({ c, deps, auth, params }) =>
        toRunDto(await releaseRun(deps, payrollActor(c, auth), params.runId)),
    }),
    defineRoute({
      method: "post",
      path: "/runs/:runId/mark-paid",
      summary: "Record that an approved run has been paid (locks it)",
      access: { permission: "payroll:finalise" },
      request: { params: runParams },
      responses: { 200: runSchema },
      errors: ["not_found", "conflict"],
      handler: async ({ c, deps, auth, params }) => toRunDto(await markPaid(deps, payrollActor(c, auth), params.runId)),
    }),
    defineRoute({
      method: "post",
      path: "/runs/:runId/reopen",
      summary: "Reopen an approved or paid run as a new adjustment run (the original is never changed)",
      access: { permission: "payroll:create" },
      request: { params: runParams, body: z.object({ reason: z.string().max(500) }) },
      example: { body: { reason: "Missed transport allowance" } },
      responses: { 201: runSchema },
      errors: ["not_found", "conflict"],
      handler: async ({ c, deps, auth, params, body }) =>
        toRunDto(await reopenRun(deps, payrollActor(c, auth), params.runId, body.reason)),
    }),
    defineRoute({
      method: "get",
      path: "/runs/:runId/payslips/:payslipId",
      summary: "A payslip of a run, as the employee will see it",
      access: { permission: "payroll:read" },
      request: { params: z.object({ runId: z.uuid(), payslipId: z.uuid() }) },
      responses: { 200: payslipViewSchema },
      errors: ["not_found"],
      handler: async ({ c, deps, auth, params }) => {
        const run = await loadRun(deps.db, auth.orgId, params.runId);
        const [slip] = await deps.db
          .select()
          .from(payrollPayslips)
          .where(
            and(
              eq(payrollPayslips.orgId, auth.orgId),
              eq(payrollPayslips.runId, run.id),
              eq(payrollPayslips.id, params.payslipId),
            ),
          );
        if (!slip) throw new AppError("not_found", "That payslip doesn't exist or you can't see it.");
        return payslipFor(c, slip, run);
      },
    }),
    defineRoute({
      method: "get",
      path: "/runs/:runId/files/cpf-ezpay",
      summary: "CPF EZPay (FTP) submission file for the amounts this run charged",
      description:
        "Fixed-width file per CPF Board's CPF EZPay (FTP) File Specifications (16 Jan 2025), for upload in CPF EZPay. Employees left out (e.g. SHG for foreigners without a CPF account) are listed in the x-crowhr-excluded header (URL-encoded JSON).",
      access: { permission: "payroll:read" },
      recentAuth: true,
      request: { params: runParams },
      responses: { 200: { description: "CPF EZPay .DTL file", contentType: "text/plain" } },
      errors: ["not_found", "conflict", "reauth_required"],
      handler: async ({ c, deps, auth, params }) =>
        fileResponse(await cpfEzpayFile(deps, payrollActor(c, auth), params.runId)),
    }),
    defineRoute({
      method: "get",
      path: "/runs/:runId/files/bank",
      summary: "Generic ISO 20022 pain.001.001.03 salary credit-transfer file (not a bank-specific format)",
      description:
        "Open-standard file for banks that accept ISO 20022 pain.001 uploads. DBS, OCBC and UOB bulk formats are not public and are not produced; test the file with your bank before first use. Excluded employees are listed in the x-crowhr-excluded header (URL-encoded JSON).",
      access: { permission: "payroll:read" },
      recentAuth: true,
      request: { params: runParams },
      responses: { 200: { description: "pain.001.001.03 XML", contentType: "application/xml" } },
      errors: ["not_found", "conflict", "reauth_required"],
      handler: async ({ c, deps, auth, params }) =>
        fileResponse(await bankPaymentFile(deps, payrollActor(c, auth), params.runId)),
    }),
    defineRoute({
      method: "get",
      path: "/runs/:runId/payslips/:payslipId/pdf",
      summary: "Download a payslip of a run as PDF (preview before release)",
      access: { permission: "payroll:read" },
      request: { params: z.object({ runId: z.uuid(), payslipId: z.uuid() }) },
      responses: { 200: { description: "Payslip PDF", contentType: "application/pdf" } },
      errors: ["not_found"],
      handler: async ({ deps, auth, params }) => {
        const run = await loadRun(deps.db, auth.orgId, params.runId);
        const [slip] = await deps.db
          .select()
          .from(payrollPayslips)
          .where(
            and(
              eq(payrollPayslips.orgId, auth.orgId),
              eq(payrollPayslips.runId, run.id),
              eq(payrollPayslips.id, params.payslipId),
            ),
          );
        if (!slip) throw new AppError("not_found", "That payslip doesn't exist or you can't see it.");
        return payslipPdfResponse(slip, run);
      },
    }),
  ],
});

/** Employee self-service: Me → Payslips (also for former members, read-only). */
export const payslipsModule = defineModule({
  name: "payslips",
  basePath: "/payslips",
  tag: "Payslips",
  routes: [
    defineRoute({
      method: "get",
      path: "/",
      summary: "My released payslips, newest first",
      access: { permission: "payslips:read" },
      responses: { 200: z.object({ items: z.array(payslipSummarySchema) }) },
      handler: async ({ deps, auth }) => {
        if (!auth.employeeId) return { items: [] };
        const rows = await deps.db
          .select({ slip: payrollPayslips, run: payrollRuns })
          .from(payrollPayslips)
          .innerJoin(
            payrollRuns,
            and(eq(payrollRuns.orgId, payrollPayslips.orgId), eq(payrollRuns.id, payrollPayslips.runId)),
          )
          .where(
            and(
              eq(payrollPayslips.orgId, auth.orgId),
              eq(payrollPayslips.employeeId, auth.employeeId),
              isNotNull(payrollPayslips.releasedAt),
              inArray(payrollRuns.status, ["approved", "paid"]),
            ),
          )
          .orderBy(desc(payrollRuns.month), desc(payrollRuns.payDate));
        return {
          items: rows.map(({ slip, run }) => ({
            id: slip.id,
            runId: run.id,
            title: buildPayslipView(slip, run, monthLabel(run.month)).title,
            month: run.month,
            payDate: run.payDate,
            netCents: slip.netCents,
            netPayableCents: slip.netPayableCents,
            runKind: run.kind,
            releasedAt: (slip.releasedAt as Date).toISOString(),
            revised: run.supersededByRunId !== null,
          })),
        };
      },
    }),
    defineRoute({
      method: "get",
      path: "/:payslipId",
      summary: "One of my released payslips",
      access: { permission: "payslips:read" },
      request: { params: z.object({ payslipId: z.uuid() }) },
      responses: { 200: payslipViewSchema },
      errors: ["not_found"],
      handler: async ({ c, deps, auth, grant, params }) => {
        const { slip, run } = await ownReleasedPayslip(deps.db, auth, params.payslipId, grant.all);
        return payslipFor(c, slip, run);
      },
    }),
    defineRoute({
      method: "get",
      path: "/:payslipId/pdf",
      summary: "Download one of my released payslips as PDF",
      access: { permission: "payslips:read" },
      request: { params: z.object({ payslipId: z.uuid() }) },
      responses: { 200: { description: "Payslip PDF", contentType: "application/pdf" } },
      errors: ["not_found"],
      handler: async ({ deps, auth, grant, params }) => {
        const { slip, run } = await ownReleasedPayslip(deps.db, auth, params.payslipId, grant.all);
        return payslipPdfResponse(slip, run);
      },
    }),
  ],
});

/** A released payslip the caller may read: their own, or any for owner/payroll_admin. 404 otherwise. */
export async function ownReleasedPayslip(
  db: import("../db/types.ts").Db,
  auth: AuthContext,
  payslipId: string,
  all: boolean,
): Promise<{ slip: PayrollPayslip; run: PayrollRun }> {
  const [row] = await db
    .select({ slip: payrollPayslips, run: payrollRuns })
    .from(payrollPayslips)
    .innerJoin(
      payrollRuns,
      and(eq(payrollRuns.orgId, payrollPayslips.orgId), eq(payrollRuns.id, payrollPayslips.runId)),
    )
    .where(and(eq(payrollPayslips.orgId, auth.orgId), eq(payrollPayslips.id, payslipId)));
  const visible =
    row &&
    (all || (auth.employeeId !== null && row.slip.employeeId === auth.employeeId)) &&
    row.slip.releasedAt !== null &&
    (row.run.status === "approved" || row.run.status === "paid");
  if (!row || !visible) throw new AppError("not_found", "That payslip doesn't exist or you can't see it.");
  return row;
}
