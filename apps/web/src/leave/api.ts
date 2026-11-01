import { toast } from "@crowhr/ui";
import { queryOptions, useMutation, useQueryClient } from "@tanstack/react-query";
import { ApiError, apiGet, apiPost, apiPut } from "../lib/api.ts";

/** Wire shapes of `/api/v1/leave` (mirror packages/core/src/leave/routes.ts, views.ts and admin.ts). */
export type Session = "full" | "am" | "pm";
export type Unit = "days" | "hours";
export type LeaveStatus = "pending" | "approved" | "rejected" | "withdrawn" | "cancellation_pending" | "cancelled";

export interface LeaveTypeView {
  id: string;
  code: string;
  name: string;
  statutoryCode: string | null;
  paid: boolean;
  halfDays: boolean;
  attachment: "none" | "optional" | "required";
  attachmentLabel: string | null;
  sensitive: boolean;
  needsChild: boolean;
  perChild: boolean;
  unlimited: boolean;
  archived: boolean;
  encashable: boolean;
  employeeEncashmentRequests: boolean;
}

export interface Balance {
  typeId: string;
  code: string;
  name: string;
  statutoryCode: string | null;
  unit: Unit;
  tracked: boolean;
  eligible: boolean;
  eligibleFrom: string | null;
  year: number;
  childId: string | null;
  entitlement: number;
  carriedForward: number;
  expired: number;
  adjustments: number;
  taken: number;
  pending: number;
  available: number | null;
  carryExpiresOn: string | null;
  explanation: string[];
}

export interface QuoteInput {
  employeeId?: string;
  leaveTypeId: string;
  startDate: string;
  endDate: string;
  startSession: Session;
  endSession: Session;
  childId?: string | null;
}

export interface Quote {
  employeeId: string;
  type: LeaveTypeView;
  unit: Unit;
  quantity: number;
  days: { date: string; session: Session; quantity: number; note: string | null }[];
  years: { year: number; quantity: number; tracked: boolean; available: number | null; after: number | null }[];
  issues: { code: string; path: string; message: string }[];
  warnings: string[];
  ok: boolean;
}

export interface Attachment {
  filename: string;
  contentType: string;
  dataBase64: string;
}

export interface LeaveRequest {
  id: string;
  employee: { id: string; name: string };
  type: { id: string; code: string; name: string };
  startDate: string;
  endDate: string;
  startSession: Session;
  endSession: Session;
  unit: Unit;
  quantity: number;
  reason: string | null;
  status: LeaveStatus;
  child: { id: string; name: string } | null;
  attachments: { id: string; filename: string; contentType: string; sizeBytes: number }[];
  approvalRequestId: string | null;
  cancellationRequestId: string | null;
  onBehalf: boolean;
  cancelReason: string | null;
  createdAt: string;
  decidedAt: string | null;
  days?: { date: string; session: Session; quantity: number }[];
}

export interface CalendarEntry {
  date: string;
  session: Session;
  status: "approved" | "pending";
  label: string;
  typeCode: string | null;
  requestId: string | null;
}

export interface CalendarView {
  from: string;
  to: string;
  holidays: { date: string; name: string }[];
  people: { employeeId: string; name: string; self: boolean; entries: CalendarEntry[] }[];
}

export interface Child {
  id: string;
  employeeId: string;
  name: string;
  birthDate: string | null;
  expectedDeliveryDate: string | null;
  isCitizen: boolean;
  birthOrder: number;
  stillborn: boolean;
  adoptionIntentDate: string | null;
  marriedToMother: boolean | null;
}

export type Entitlement =
  | { basis: "statutory" }
  | { basis: "fixed"; days: number }
  | { basis: "by_service"; steps: { fromServiceYear: number; days: number }[] }
  | { basis: "unlimited" };

export interface Policy {
  entitlement: Entitlement;
  minServiceMonths: number;
  prorate: boolean;
  accrual: "upfront" | "monthly";
  carryForward: { maxDays: number | null; expiresAfterMonths: number | null } | null;
  encashable: boolean;
  employeeEncashmentRequests?: boolean;
}

export interface PolicyView extends LeaveTypeView {
  kind: "statutory" | "company";
  dayCounting: "working_days" | "working_days_including_holidays";
  policy: Policy;
  sortOrder: number;
}

export interface Holiday {
  id: string | null;
  date: string;
  name: string;
  source: "gazetted" | "organisation";
}

export interface LeaveSettings {
  offDayHoliday: "extra_pay" | "next_working_day";
  unpaidServiceRule: "none" | "whole_month" | "any_day";
  fullTimeScheduleId: string | null;
}

export interface GovernmentPaidRow {
  requestId: string;
  employeeId: string;
  employeeName: string;
  leaveType: string;
  scheme: string;
  child: string | null;
  startDate: string;
  endDate: string;
  days: number;
  employerDays: number;
  governmentDays: number;
  unpaidDays: number;
  claimBy: string | null;
  claimVia: string;
}

const qs = (o: Record<string, string | number | undefined | null>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== null && v !== "") p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : "";
};

export const leaveKeys = {
  all: ["leave"] as const,
  types: ["leave", "types"] as const,
  balances: (employeeId?: string, year?: number) => ["leave", "balances", employeeId ?? "me", year ?? "now"] as const,
  requests: (q: Record<string, string | undefined>) => ["leave", "requests", q] as const,
  request: (id: string) => ["leave", "request", id] as const,
  calendar: (from: string, to: string, view: string) => ["leave", "calendar", from, to, view] as const,
  children: (employeeId?: string) => ["leave", "children", employeeId ?? "me"] as const,
  policies: ["leave", "policies"] as const,
  holidays: (year: number) => ["leave", "holidays", year] as const,
  settings: ["leave", "settings"] as const,
  gov: (from: string, to: string) => ["leave", "gov", from, to] as const,
};

export const typesQuery = queryOptions({
  queryKey: leaveKeys.types,
  queryFn: () => apiGet<{ items: LeaveTypeView[] }>("/api/v1/leave/types"),
  staleTime: 5 * 60_000,
});

export const balancesQuery = (employeeId?: string, year?: number) =>
  queryOptions({
    queryKey: leaveKeys.balances(employeeId, year),
    queryFn: () => apiGet<{ items: Balance[] }>(`/api/v1/leave/balances${qs({ employeeId, year })}`),
  });

export const requestsQuery = (q: { employeeId?: string; status?: string; from?: string; to?: string } = {}) =>
  queryOptions({
    queryKey: leaveKeys.requests(q),
    queryFn: () => apiGet<{ items: LeaveRequest[] }>(`/api/v1/leave/requests${qs(q)}`),
  });

export const requestQuery = (id: string) =>
  queryOptions({
    queryKey: leaveKeys.request(id),
    queryFn: () => apiGet<LeaveRequest>(`/api/v1/leave/requests/${id}`),
    retry: (count, err) => !(err instanceof ApiError && err.status === 404) && count < 1,
  });

export const calendarQuery = (from: string, to: string, view: "team" | "org") =>
  queryOptions({
    queryKey: leaveKeys.calendar(from, to, view),
    queryFn: () => apiGet<CalendarView>(`/api/v1/leave/calendar${qs({ from, to, view })}`),
  });

export const childrenQuery = (employeeId?: string) =>
  queryOptions({
    queryKey: leaveKeys.children(employeeId),
    queryFn: () => apiGet<{ items: Child[] }>(`/api/v1/leave/children${qs({ employeeId })}`),
  });

export const policiesQuery = queryOptions({
  queryKey: leaveKeys.policies,
  queryFn: () => apiGet<{ items: PolicyView[] }>("/api/v1/leave/policies"),
});

export const holidaysQuery = (year: number) =>
  queryOptions({
    queryKey: leaveKeys.holidays(year),
    queryFn: () => apiGet<{ items: Holiday[] }>(`/api/v1/leave/holidays${qs({ year })}`),
  });

export const settingsQuery = queryOptions({
  queryKey: leaveKeys.settings,
  queryFn: () => apiGet<LeaveSettings>("/api/v1/leave/settings"),
});

export const governmentPaidQuery = (from: string, to: string) =>
  queryOptions({
    queryKey: leaveKeys.gov(from, to),
    queryFn: () => apiGet<{ items: GovernmentPaidRow[] }>(`/api/v1/leave/reports/government-paid${qs({ from, to })}`),
  });

export const governmentPaidCsvHref = (from: string, to: string) =>
  `/api/v1/leave/reports/government-paid.csv${qs({ from, to })}`;

export const quote = (input: QuoteInput) => apiPost<Quote>("/api/v1/leave/quote", input);

/** Invalidates everything leave-related plus the approvals views a leave change shows up in. */
export function useLeaveInvalidate() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: leaveKeys.all });
    void qc.invalidateQueries({ queryKey: ["approvals"] });
    void qc.invalidateQueries({ queryKey: ["inbox"] });
  };
}

export function useRequestAction() {
  const invalidate = useLeaveInvalidate();
  return useMutation({
    mutationFn: (input: { id: string; action: "withdraw" | "cancel"; reason?: string | null; direct?: boolean }) =>
      apiPost<LeaveRequest>(
        `/api/v1/leave/requests/${input.id}/${input.action}`,
        input.action === "cancel" ? { reason: input.reason ?? null, direct: input.direct ?? false } : {},
      ),
    onSuccess: (r, input) => {
      invalidate();
      toast.success(
        input.action === "withdraw"
          ? "Request withdrawn."
          : r.status === "cancelled"
            ? "Leave cancelled. The days are back in the balance."
            : "Cancellation sent for approval. The leave stays booked until it is approved.",
      );
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "That didn't work. Try again."),
  });
}

export const saveSettings = (s: LeaveSettings) => apiPut<LeaveSettings>("/api/v1/leave/settings", s);

/** Reads a File as base64 (without the data: prefix). */
export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("The file couldn't be read. Try another file."));
    reader.onload = () => {
      const s = String(reader.result ?? "");
      resolve(s.slice(s.indexOf(",") + 1));
    };
    reader.readAsDataURL(file);
  });
}

export const MAX_FILE_BYTES = 5 * 1024 * 1024;
export const ACCEPTED_TYPES = ["application/pdf", "image/jpeg", "image/png", "image/webp", "image/heic"];
