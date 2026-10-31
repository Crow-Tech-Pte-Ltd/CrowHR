import type {
  ErrorEnvelope,
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
import { ApiError } from "../../../../lib/api.ts";
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

export const createRun = (body: {
  kind: "regular" | "off_cycle";
  month: string;
  payDate?: string | null;
  offCycleReason?: "final_pay" | "bonus" | null;
  employeeIds?: string[] | null;
}) => api<PayrollRunDto>("POST", "/payroll/runs", body);

export const addItem = (runId: string, body: PayrollItemInput) =>
  api<{ id: string }>("POST", `/payroll/runs/${runId}/items`, body);

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

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

export function monthName(month: string): string {
  return `${MONTHS[Number(month.slice(5, 7)) - 1]} ${month.slice(0, 4)}`;
}

export function runTitle(r: Pick<PayrollRunDto, "kind" | "offCycleReason" | "month">): string {
  if (r.kind === "adjustment") return `${monthName(r.month)} adjustment`;
  if (r.kind === "off_cycle")
    return `${monthName(r.month)} ${r.offCycleReason === "final_pay" ? "final pay" : "bonus run"}`;
  return `${monthName(r.month)} payroll`;
}

export interface Excluded {
  employeeName: string;
  reason: string;
}

/** Downloads a generated file (sensitive exports may answer 403 reauth_required: wrap in useReauth). */
export async function downloadFile(path: string): Promise<{ fileName: string; excluded: Excluded[] }> {
  const res = await fetch(`/api/v1${path}`, { credentials: "same-origin" });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as ErrorEnvelope | null;
    throw new ApiError(res.status, body);
  }
  const fileName = /filename="([^"]+)"/.exec(res.headers.get("content-disposition") ?? "")?.[1] ?? "download";
  const excluded = JSON.parse(decodeURIComponent(res.headers.get("x-crowhr-excluded") ?? "%5B%5D")) as Excluded[];
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
  return { fileName, excluded };
}
