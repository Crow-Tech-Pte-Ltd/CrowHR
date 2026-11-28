import type {
  PayrollEmployeeDetailDto,
  PayrollItemInput,
  PayrollOverviewDto,
  PayrollRunDto,
  PayrollRunSummaryDto,
  PayrollSettingsDto,
  PayslipSummaryDto,
  PayslipViewDto,
} from "@crowhr/core";
import { type QueryClient, queryOptions } from "@tanstack/react-query";
import { type Locale, translate } from "../../../../i18n/index.ts";
import { downloadApiFile } from "../../../../lib/download.ts";
import { api } from "../../people/-lib/api.ts";

export { api, errorMessage, fieldErrors } from "../../people/-lib/api.ts";

export const runsQuery = queryOptions({
  queryKey: ["payroll", "runs"] as const,
  queryFn: () => api<{ items: PayrollRunSummaryDto[] }>("GET", "/payroll/runs"),
});

export const runQuery = (runId: string) =>
  queryOptions({
    queryKey: ["payroll", "run", runId] as const,
    queryFn: () => api<PayrollOverviewDto>("GET", `/payroll/runs/${runId}`),
  });

export const employeeDetailQuery = (runId: string, employeeId: string) =>
  queryOptions({
    queryKey: ["payroll", "run", runId, "employee", employeeId] as const,
    queryFn: () => api<PayrollEmployeeDetailDto>("GET", `/payroll/runs/${runId}/employees/${employeeId}`),
  });

export const adminPayslipQuery = (runId: string, payslipId: string) =>
  queryOptions({
    queryKey: ["payroll", "run", runId, "payslip", payslipId] as const,
    queryFn: () => api<PayslipViewDto>("GET", `/payroll/runs/${runId}/payslips/${payslipId}`),
  });

export const settingsQuery = queryOptions({
  queryKey: ["payroll", "settings"] as const,
  queryFn: () => api<PayrollSettingsDto>("GET", "/payroll/settings"),
});

export interface AllowanceSettingDto {
  allowanceTypeId: string;
  code: string;
  name: string;
  cpfLiable: boolean;
  prorate: boolean;
  grossRateIncluded: boolean | null;
}

export const allowanceSettingsQuery = queryOptions({
  queryKey: ["payroll", "allowance-settings"] as const,
  queryFn: () => api<{ items: AllowanceSettingDto[] }>("GET", "/payroll/allowance-settings"),
});

export const saveAllowanceSetting = (
  allowanceTypeId: string,
  body: Pick<AllowanceSettingDto, "cpfLiable" | "prorate" | "grossRateIncluded">,
) => api<AllowanceSettingDto>("PUT", `/payroll/allowance-settings/${allowanceTypeId}`, body);

export const myPayslipsQuery = queryOptions({
  queryKey: ["payslips", "mine"] as const,
  queryFn: () => api<{ items: PayslipSummaryDto[] }>("GET", "/payslips"),
});

export const myPayslipQuery = (payslipId: string) =>
  queryOptions({
    queryKey: ["payslips", payslipId] as const,
    queryFn: () => api<PayslipViewDto>("GET", `/payslips/${payslipId}`),
  });

export const runAction = (runId: string, action: "compute" | "submit" | "withdraw" | "release" | "mark-paid") =>
  api<PayrollRunDto>("POST", `/payroll/runs/${runId}/${action}`);

/** My open approval task for a run's request (the workflows engine routes payroll runs to owners). */
export const myRunTaskQuery = (requestId: string | null) =>
  queryOptions({
    queryKey: ["approvals", "tasks", "mine"] as const,
    queryFn: () => api<{ items: { taskId: string; requestId: string }[] }>("GET", "/approvals/tasks"),
    select: (d: { items: { taskId: string; requestId: string }[] }) =>
      d.items.find((t) => t.requestId === requestId) ?? null,
    enabled: !!requestId,
  });

export const decide = (taskId: string, outcome: "approved" | "rejected", comment?: string) =>
  api<unknown>("POST", `/approvals/tasks/${taskId}/decision`, {
    decision: outcome === "approved" ? "approve" : "reject",
    ...(comment ? { comment } : {}),
  });

export const reopen = (runId: string, reason: string) =>
  api<PayrollRunDto>("POST", `/payroll/runs/${runId}/reopen`, { reason });

/** Approved, unpaid run → draft (payslips hidden again until it is approved and released again). */
export const returnToDraft = (runId: string, reason: string) =>
  api<PayrollRunDto>("POST", `/payroll/runs/${runId}/return-to-draft`, { reason });

export const createRun = (body: {
  kind: "regular" | "off_cycle";
  month: string;
  payDate?: string | null;
  offCycleReason?: "final_pay" | "bonus" | null;
  employeeIds?: string[] | null;
}) => api<PayrollRunDto>("POST", "/payroll/runs", body);

export const addItem = (runId: string, body: PayrollItemInput) =>
  api<{ id: string }>("POST", `/payroll/runs/${runId}/items`, body);

export const updateItem = (runId: string, itemId: string, body: PayrollItemInput) =>
  api<void>("PUT", `/payroll/runs/${runId}/items/${itemId}`, body);

export const deleteItem = (runId: string, itemId: string) =>
  api<void>("DELETE", `/payroll/runs/${runId}/items/${itemId}`);

export function invalidateRun(qc: QueryClient, runId: string) {
  return Promise.all([
    qc.invalidateQueries({ queryKey: ["payroll", "run", runId] }),
    qc.invalidateQueries({ queryKey: runsQuery.queryKey }),
  ]);
}

export const RUN_STATUS: Record<
  PayrollRunDto["status"],
  { label: string; tone: "neutral" | "info" | "success" | "warning" }
> = {
  draft: { label: "Draft", tone: "neutral" },
  in_review: { label: "In review", tone: "info" },
  approved: { label: "Approved", tone: "success" },
  paid: { label: "Paid", tone: "success" },
};

export function monthName(month: string, locale: Locale = "en-SG", short = false): string {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return month;
  return new Intl.DateTimeFormat(locale, {
    timeZone: "UTC",
    month: short ? "short" : "long",
    ...(short ? {} : { year: "numeric" }),
  }).format(new Date(`${month}-01T00:00:00Z`));
}

export function runTitle(
  r: Pick<PayrollRunDto, "kind" | "offCycleReason" | "month">,
  locale: Locale = "en-SG",
): string {
  const month = monthName(r.month, locale);
  if (r.kind === "adjustment") return translate(locale, "people-payroll", "{month} adjustment", { month });
  if (r.kind === "off_cycle")
    return translate(
      locale,
      "people-payroll",
      r.offCycleReason === "final_pay" ? "{month} final pay" : "{month} bonus run",
      { month },
    );
  return translate(locale, "people-payroll", "{month} payroll", { month });
}

/** Use the server title in English and localise its fixed template for the web view. */
export function payslipTitle(
  slip: { title: string; runKind: string; offCycleReason?: string | null },
  month: string,
  locale: Locale,
): string {
  if (locale === "en-SG") return slip.title;
  const formattedMonth = monthName(month, locale);
  const message =
    slip.runKind === "adjustment"
      ? "Revised payslip, {month}"
      : slip.runKind === "regular"
        ? "Payslip, {month}"
        : slip.offCycleReason === "final_pay" || slip.title.startsWith("Final pay ")
          ? "Final pay payslip, {month}"
          : "Bonus payslip, {month}";
  return translate(locale, "people-payroll", message, { month: formattedMonth });
}

export type { Excluded } from "../../../../lib/download.ts";

export function downloadFile(path: string) {
  return downloadApiFile(`/api/v1${path}`);
}
