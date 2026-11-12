import { formatDate } from "@crowhr/ui";

/**
 * A phone number as people read it: Singapore numbers in two groups of four after the country
 * code ("+65 9113 9289", "6123 4567" without it). Anything else is shown as stored, because other
 * countries group digits differently.
 */
export function formatPhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  const compact = trimmed.replace(/[\s-]/g, "");
  const sg = /^(\+65)?([3689]\d{3})(\d{4})$/.exec(compact);
  if (!sg) return trimmed;
  return `${sg[1] ? "+65 " : ""}${sg[2]} ${sg[3]}`;
}

/** Whole days from `from` to `to` (calendar dates `YYYY-MM-DD`); negative when `to` is earlier. */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/**
 * One wording for a work pass's state, used wherever a pass is shown: "Expired 20 Oct 2026",
 * "Expires 19 Dec 2026 (49 days)" (the count only while it is close), "Cancelled 1 Oct 2026".
 */
export function passExpiry(
  pass: { expiresOn: string; cancelledOn: string | null; state: "valid" | "expiring" | "expired" | "cancelled" },
  today: string,
): string {
  if (pass.state === "cancelled") return pass.cancelledOn ? `Cancelled ${formatDate(pass.cancelledOn)}` : "Cancelled";
  if (pass.state === "expired") return `Expired ${formatDate(pass.expiresOn)}`;
  const days = daysBetween(today, pass.expiresOn);
  const count = pass.state === "expiring" ? ` (${days === 0 ? "today" : days === 1 ? "1 day" : `${days} days`})` : "";
  return `Expires ${formatDate(pass.expiresOn)}${count}`;
}
