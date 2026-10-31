import { formatDate } from "@crowhr/ui";
import type { LeaveStatus, Policy, PolicyView, Session, Unit } from "./api.ts";

/** "1 day", "0.5 day", "2.5 days", "4 hours". */
export function qty(n: number, unit: Unit): string {
  if (unit === "hours") return `${fmt(n)} ${n === 1 ? "hour" : "hours"}`;
  return `${fmt(n)} ${n === 1 || n === 0.5 ? "day" : "days"}`;
}

/** Numbers without trailing zeros: 2, 2.5, 25.5. */
export function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100);
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "4–6 Nov 2026", "30 Dec 2026 – 2 Jan 2027", "4 Nov 2026 (AM)". */
export function dateRange(start: string, end: string, startSession: Session = "full", endSession: Session = "full") {
  const half = (s: Session) => (s === "am" ? " (AM)" : s === "pm" ? " (PM)" : "");
  if (start === end) return `${formatDate(start)}${half(startSession)}`;
  const [ys, ms, ds] = start.split("-").map(Number) as [number, number, number];
  const [ye, me, de] = end.split("-").map(Number) as [number, number, number];
  const s = startSession === "pm" ? " PM" : "";
  const e = endSession === "am" ? " AM" : "";
  if (ys === ye && ms === me) return `${ds}${s}–${de}${e} ${MONTHS[me - 1]} ${ye}`;
  if (ys === ye) return `${ds} ${MONTHS[ms - 1]}${s} – ${de} ${MONTHS[me - 1]}${e} ${ye}`;
  return `${formatDate(start)}${s} – ${formatDate(end)}${e}`;
}

export const STATUS_LABEL: Record<LeaveStatus, string> = {
  pending: "Pending",
  approved: "Approved",
  rejected: "Not approved",
  withdrawn: "Withdrawn",
  cancellation_pending: "Cancelling",
  cancelled: "Cancelled",
};

export const STATUS_TONE: Record<LeaveStatus, "neutral" | "info" | "success" | "warning" | "danger"> = {
  pending: "warning",
  approved: "success",
  rejected: "danger",
  withdrawn: "neutral",
  cancellation_pending: "warning",
  cancelled: "neutral",
};

/** Plain-English summary of a policy, e.g. "Statutory: 7 to 14 days by service". */
export function entitlementText(p: PolicyView): string {
  const e = p.policy.entitlement;
  if (e.basis === "unlimited") return "No fixed allowance";
  if (e.basis === "fixed") return `${fmt(e.days)} days a year`;
  if (e.basis === "by_service") {
    const steps = [...e.steps].sort((a, b) => a.fromServiceYear - b.fromServiceYear);
    const first = steps[0];
    const last = steps.at(-1);
    return first && last && first !== last
      ? `${fmt(first.days)} rising to ${fmt(last.days)} days by service`
      : `${fmt(first?.days ?? 0)} days a year`;
  }
  return STATUTORY_TEXT[p.statutoryCode ?? ""] ?? "Statutory";
}

const STATUTORY_TEXT: Record<string, string> = {
  annual: "Employment Act: 7 days rising to 14 by year 8",
  sick_outpatient: "14 days after 6 months (5 at 3 months)",
  hospitalisation: "60 days incl. outpatient (15 at 3 months)",
  maternity: "16 weeks (GPML) or 12 weeks per child",
  paternity: "4 weeks per child (2 if stillborn)",
  shared_parental: "10 weeks per child, shared by parents",
  childcare: "6 days a year (child under 7)",
  extended_childcare: "2 days a year (child aged 7–12)",
  infant_care: "12 unpaid days a year (child under 2)",
  adoption: "12 weeks per child",
};

export function carryText(p: Policy): string {
  const c = p.carryForward;
  if (!c) return p.encashable ? "Unused days encashed" : "None";
  const amount = c.maxDays === null ? "All unused" : `Up to ${fmt(c.maxDays)} days`;
  return `${amount}${c.expiresAfterMonths ? `, use within ${c.expiresAfterMonths} months` : ""}`;
}

/** Monday of the week containing `iso`. */
export function mondayOf(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  const dow = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - dow);
  return d.toISOString().slice(0, 10);
}

export function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export const WEEKDAY = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
export const weekdayOf = (iso: string) => WEEKDAY[(new Date(`${iso}T00:00:00Z`).getUTCDay() + 6) % 7] as string;

/** Today in Singapore. */
export function todaySg(): string {
  return new Date(Date.now() + 8 * 3_600_000).toISOString().slice(0, 10);
}
