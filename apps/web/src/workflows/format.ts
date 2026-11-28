import { formatDate, formatMoney } from "@crowhr/ui";
import { daysBetween } from "../home/dates.ts";
import { type Locale, type Translate, translate } from "../i18n/index.ts";

const english: Translate = (message, values) => translate("en-SG", "workflows", message, values);

/** "Overdue 2 days", "Due today", "Due tomorrow", "Due 3 Dec 2026", or null. */
export function dueLabel(
  dueOn: string | null,
  today: string,
  options: { short?: boolean; t?: Translate } = {},
): { text: string; tone: "danger" | "warning" | "neutral" } | null {
  if (!dueOn) return null;
  const days = daysBetween(today, dueOn);
  const t = options.t ?? english;
  if (days < 0)
    return { text: t(days === -1 ? "Overdue {days} day" : "Overdue {days} days", { days: -days }), tone: "danger" };
  if (days === 0) return { text: t("Due today"), tone: "warning" };
  if (days === 1) return { text: t("Due tomorrow"), tone: "warning" };
  // Short form drops the year when it is this year ("Due 3 Dec").
  const date =
    options.short && dueOn.slice(0, 4) === today.slice(0, 4)
      ? formatDate(dueOn).replace(/ \d{4}$/, "")
      : formatDate(dueOn);
  return { text: t("Due {date}", { date }), tone: "neutral" };
}

/** Calendar date in Asia/Singapore (UTC+8, no DST) of an instant. */
export function sgDate(iso: string): string {
  return new Date(new Date(iso).getTime() + 8 * 3_600_000).toISOString().slice(0, 10);
}

/** "today", "yesterday", "3 days ago", or the date for older. */
export function ageLabel(iso: string, today: string, locale: Locale = "en-SG"): string {
  const day = sgDate(iso);
  const days = daysBetween(day, today);
  if (days < 7) return new Intl.RelativeTimeFormat(locale, { numeric: "auto" }).format(-Math.max(0, days), "day");
  if (locale === "en-SG") return formatDate(day);
  return new Intl.DateTimeFormat(locale, { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" }).format(
    new Date(day),
  );
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
export function requestName(subjectLabel: string, title: string, t: Translate = english): string {
  const words = subjectLabel
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length >= 4);
  const inTitle = title.toLowerCase().split(/[^\p{L}\p{N}]+/u);
  // Every word must be there: "Leave cancellation: Annual leave, 2 Nov" keeps its kind.
  return words.length > 0 && words.every((w) => inTitle.includes(w))
    ? title
    : t("{kind}: {title}", { kind: t(subjectLabel), title });
}
