import { formatDate, formatMoney } from "@crowhr/ui";
import { daysBetween } from "../home/dates.ts";

/** "Overdue 2 days", "Due today", "Due tomorrow", "Due 3 Dec 2026", or null. */
export function dueLabel(
  dueOn: string | null,
  today: string,
  options: { short?: boolean } = {},
): { text: string; tone: "danger" | "warning" | "neutral" } | null {
  if (!dueOn) return null;
  const days = daysBetween(today, dueOn);
  if (days < 0) return { text: `Overdue ${-days} ${-days === 1 ? "day" : "days"}`, tone: "danger" };
  if (days === 0) return { text: "Due today", tone: "warning" };
  if (days === 1) return { text: "Due tomorrow", tone: "warning" };
  // Short form drops the year when it is this year ("Due 3 Dec").
  const date =
    options.short && dueOn.slice(0, 4) === today.slice(0, 4)
      ? formatDate(dueOn).replace(/ \d{4}$/, "")
      : formatDate(dueOn);
  return { text: `Due ${date}`, tone: "neutral" };
}

/** Calendar date in Asia/Singapore (UTC+8, no DST) of an instant. */
export function sgDate(iso: string): string {
  return new Date(new Date(iso).getTime() + 8 * 3_600_000).toISOString().slice(0, 10);
}

/** "today", "yesterday", "3 days ago", or the date for older. */
export function ageLabel(iso: string, today: string): string {
  const day = sgDate(iso);
  const days = daysBetween(day, today);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days ago`;
  return formatDate(day);
}

/** "S$500.00 or more" for an amount threshold. */
export function thresholdLabel(cents: number): string {
  return `${formatMoney(cents)} or more`;
}

/**
 * A request's name in lists: "Transport claim" rather than "Claim: Transport claim", and
 * "Overtime, 23 Oct 2026" rather than "Overtime: Overtime, 23 Oct 2026". The kind is kept when the
 * title doesn't already say all of it ("Profile change: Personal details change", "Leave
 * cancellation: Annual leave, 2 Nov 2026").
 */
export function requestName(subjectLabel: string, title: string): string {
  const words = subjectLabel
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length >= 4);
  const inTitle = title.toLowerCase().split(/[^\p{L}\p{N}]+/u);
  // Every word must be there: "Leave cancellation: Annual leave, 2 Nov" keeps its kind.
  return words.length > 0 && words.every((w) => inTitle.includes(w)) ? title : `${subjectLabel}: ${title}`;
}
