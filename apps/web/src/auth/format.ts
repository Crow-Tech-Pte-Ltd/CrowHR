import { appNowMs } from "@crowhr/ui/clock";
import { type Locale, translate } from "../i18n/index.ts";

/** `31 Oct 2026, 09:05` in Singapore time (AGENTS.md conventions). */
export function formatDateTime(iso: string | null | undefined, locale: Locale = "en-SG"): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return new Intl.DateTimeFormat(locale, {
    timeZone: "Asia/Singapore",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  })
    .format(d)
    .replace(" at ", ", ");
}

/**
 * The name to greet someone by: the preferred name they gave, else their full name. Never the
 * first word of a name: "Goh Jun Jie" is surname-first, and "Muhammad Hafiz bin Ismail" may go by
 * Hafiz.
 */
export function greetingName(user: { preferredName?: string | null; fullName?: string; displayName: string }): string {
  return user.preferredName?.trim() || user.fullName?.trim() || user.displayName;
}

/** "3 min ago", "2 h ago", or the date. */
export function relativeTime(iso: string | null | undefined, now = appNowMs(), locale: Locale = "en-SG"): string {
  if (!iso) return translate(locale, "settings-account", "Never");
  const diff = Math.max(0, now - new Date(iso).getTime());
  if (diff < 60_000) return translate(locale, "settings-account", "Just now");
  if (locale !== "en-SG" && diff < 86_400_000) {
    const formatter = new Intl.RelativeTimeFormat(locale, { numeric: "always", style: "short" });
    return diff < 3_600_000
      ? formatter.format(-Math.floor(diff / 60_000), "minute")
      : formatter.format(-Math.floor(diff / 3_600_000), "hour");
  }
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} min ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} h ago`;
  return formatDateTime(iso, locale);
}
