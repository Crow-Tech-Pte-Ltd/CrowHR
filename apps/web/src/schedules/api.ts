import { singaporeTodayIso } from "@crowhr/ui/clock";
import { queryOptions } from "@tanstack/react-query";
import { ApiError, apiGet } from "../lib/api.ts";

/** Wire shapes of `/api/v1/scheduling` (mirror packages/core/src/scheduling/routes.ts). */

export type ShiftColour = "plain" | "kuning" | "biru" | "oren" | "ink";
export const SHIFT_COLOURS: { value: ShiftColour; label: string }[] = [
  { value: "plain", label: "Plain" },
  { value: "kuning", label: "Yellow" },
  { value: "biru", label: "Blue" },
  { value: "oren", label: "Orange" },
  { value: "ink", label: "Ink" },
];

/** The thin marker a shift chip carries: never a filled cell. */
export const COLOUR_BAR: Record<ShiftColour, string> = {
  plain: "bg-primary-100",
  kuning: "bg-kuning-300",
  biru: "bg-biru-300",
  oren: "bg-oren-300",
  ink: "bg-ink",
};

export interface Template {
  id: string;
  name: string;
  code: string;
  startTime: string;
  endTime: string;
  breakMinutes: number;
  paidMinutes: number;
  overnight: boolean;
  locationId: string | null;
  locationName: string | null;
  colour: ShiftColour;
  archived: boolean;
  inUse: boolean;
}

export type TemplateInput = Pick<
  Template,
  "name" | "code" | "startTime" | "endTime" | "breakMinutes" | "locationId" | "colour"
>;

export type ConflictKind =
  | "overlap"
  | "on_leave"
  | "outside_employment"
  | "pending_leave"
  | "public_holiday"
  | "rest_day"
  | "daily_hours"
  | "overtime"
  | "weekly_hours"
  | "no_rest_day"
  | "ot_cap";

export interface Conflict {
  kind: ConflictKind;
  severity: "block" | "ack" | "warning" | "hint";
  label: string;
  message: string;
  source: string | null;
}

export interface Shift {
  id: string;
  employeeId: string | null;
  kind: "shift" | "rest";
  date: string;
  startsAt: string | null;
  endsAt: string | null;
  start: string | null;
  end: string | null;
  breakMinutes: number;
  paidMinutes: number;
  templateId: string | null;
  templateCode: string | null;
  colour: ShiftColour;
  note: string | null;
  updatedAt: string;
  conflicts: Conflict[];
  pendingSwap: boolean;
}

export interface RosterEmployee {
  id: string;
  name: string;
  employeeNumber: string;
  schedule: "fixed" | "shift" | null;
  editable: boolean;
  minutes: number;
  restDayAssumed: string | null;
  warnings: Conflict[];
}

export interface Roster {
  roster: {
    id: string | null;
    weekStart: string;
    locationId: string | null;
    departmentId: string | null;
    scopeLabel: string;
    status: "none" | "draft" | "published";
    version: number;
    hasChanges: boolean;
    publishedAt: string | null;
  };
  mode: "edit" | "published";
  canEdit: boolean;
  days: { date: string; holiday: string | null; minutes: number }[];
  employees: RosterEmployee[];
  shifts: Shift[];
  toAcknowledge: { shiftId: string; kind: string; employeeName: string; date: string; message: string }[];
}

export interface Scopes {
  locations: { id: string; name: string }[];
  departments: { id: string; name: string }[];
  mine: { locationId: string | null; departmentId: string | null };
  /**
   * Locations where people work rostered shifts: those with shifts on a roster first, then those
   * with staff on a shift work schedule.
   */
  rosteredLocationIds: string[];
  canEdit: boolean;
}

/**
 * The location Schedules opens on: your own. An editor whose own location has nobody on shifts
 * (an owner or HR at a head office of fixed-week staff) opens on the first location with a roster
 * instead of on an empty week.
 */
export function defaultLocation(scopes: Scopes | undefined): string | null {
  if (!scopes) return null;
  const mine = scopes.mine.locationId;
  const rostered = scopes.rosteredLocationIds;
  if (scopes.canEdit && rostered.length && !(mine && rostered.includes(mine))) return rostered[0] ?? null;
  return mine ?? scopes.locations[0]?.id ?? null;
}

export interface MyShift {
  id: string;
  rosterId: string;
  scopeLabel: string;
  date: string;
  kind: "shift" | "rest";
  start: string | null;
  end: string | null;
  breakMinutes: number;
  paidMinutes: number;
  templateCode: string | null;
  colour: ShiftColour;
  note: string | null;
  pendingSwap: boolean;
}

export interface Swap {
  id: string;
  kind: "swap" | "giveaway" | "pickup";
  status: "pending_peer" | "pending_approval" | "approved" | "rejected" | "declined" | "cancelled" | "expired";
  direction: "outgoing" | "incoming" | "other";
  requester: { id: string; name: string };
  peer: { id: string; name: string } | null;
  shift: { id: string; date: string; time: string };
  peerShift: { id: string; date: string; time: string } | null;
  note: string | null;
  reason: string | null;
  approvalRequestId: string | null;
  createdAt: string;
  expiresAt: string;
}

export interface MySchedule {
  employeeId: string | null;
  from: string;
  to: string;
  shifts: MyShift[];
  weeks: { weekStart: string; published: boolean }[];
  openShifts: MyShift[];
  swaps: Swap[];
}

export interface RosterRef {
  weekStart: string;
  locationId: string | null;
  departmentId: string | null;
}

const qs = (o: Record<string, string | null | undefined>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) if (v) p.set(k, v);
  const s = p.toString();
  return s ? `?${s}` : "";
};

export const schedKeys = {
  all: ["scheduling"] as const,
  templates: (archived: boolean) => ["scheduling", "templates", archived] as const,
  scopes: ["scheduling", "scopes"] as const,
  roster: (ref: RosterRef) => ["scheduling", "roster", ref.weekStart, ref.locationId, ref.departmentId] as const,
  rosterById: (id: string) => ["scheduling", "roster-id", id] as const,
  me: (from: string, to: string) => ["scheduling", "me", from, to] as const,
};

export const templatesQuery = (includeArchived = false) =>
  queryOptions({
    queryKey: schedKeys.templates(includeArchived),
    queryFn: () =>
      apiGet<{ items: Template[] }>(`/api/v1/scheduling/templates${includeArchived ? "?includeArchived=true" : ""}`),
  });

export const scopesQuery = queryOptions({
  queryKey: schedKeys.scopes,
  queryFn: () => apiGet<Scopes>("/api/v1/scheduling/scopes"),
});

export const rosterQuery = (ref: RosterRef) =>
  queryOptions({
    queryKey: schedKeys.roster(ref),
    queryFn: () =>
      apiGet<Roster>(
        `/api/v1/scheduling/rosters${qs({ weekStart: ref.weekStart, locationId: ref.locationId, departmentId: ref.departmentId })}`,
      ),
    enabled: !!(ref.locationId || ref.departmentId),
    retry: (n, err) => !(err instanceof ApiError && err.status < 500) && n < 1,
  });

export const rosterByIdQuery = (id: string) =>
  queryOptions({
    queryKey: schedKeys.rosterById(id),
    queryFn: () => apiGet<Roster>(`/api/v1/scheduling/rosters/${id}`),
  });

export const myScheduleQuery = (from: string, to: string) =>
  queryOptions({
    queryKey: schedKeys.me(from, to),
    queryFn: () => apiGet<MySchedule>(`/api/v1/scheduling/me${qs({ from, to })}`),
  });

// ---------------------------------------------------------------------------------------------
// Dates and labels (Asia/Singapore)
// ---------------------------------------------------------------------------------------------

export const todaySg = () => singaporeTodayIso();

export function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function mondayOf(date: string): string {
  const dow = new Date(`${date}T00:00:00Z`).getUTCDay();
  return addDays(date, -((dow + 6) % 7));
}

const WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const MO = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

export const weekday = (date: string) => WD[new Date(`${date}T00:00:00Z`).getUTCDay()] as string;
/** "2 Nov". */
export const dayMonth = (date: string) => {
  const d = new Date(`${date}T00:00:00Z`);
  return `${d.getUTCDate()} ${MO[d.getUTCMonth()]}`;
};
/** "Mon 2 Nov". */
export const shortDay = (date: string) => `${weekday(date)} ${dayMonth(date)}`;
/** "2–8 Nov 2026" or "30 Nov – 6 Dec 2026". */
export function weekLabel(weekStart: string): string {
  const end = addDays(weekStart, 6);
  const s = new Date(`${weekStart}T00:00:00Z`);
  const e = new Date(`${end}T00:00:00Z`);
  if (s.getUTCMonth() === e.getUTCMonth())
    return `${s.getUTCDate()}–${e.getUTCDate()} ${MO[e.getUTCMonth()]} ${e.getUTCFullYear()}`;
  return `${dayMonth(weekStart)} – ${dayMonth(end)} ${e.getUTCFullYear()}`;
}

/** "7h 30m", "8h", "45m". */
export function hm(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h ? (m ? `${h}h ${m}m` : `${h}h`) : `${m}m`;
}

/** Decimal hours for totals: "37.5". */
export function hours(minutes: number): string {
  const h = minutes / 60;
  return Number.isInteger(h) ? String(h) : h.toFixed(1).replace(/\.0$/, "");
}

export const SWAP_STATUS: Record<
  Swap["status"],
  { label: string; tone: "neutral" | "warning" | "success" | "danger" | "info" }
> = {
  pending_peer: { label: "Waiting for colleague", tone: "warning" },
  pending_approval: { label: "Waiting for approval", tone: "warning" },
  approved: { label: "Approved", tone: "success" },
  rejected: { label: "Not approved", tone: "danger" },
  declined: { label: "Declined", tone: "neutral" },
  cancelled: { label: "Cancelled", tone: "neutral" },
  expired: { label: "Expired", tone: "neutral" },
};
