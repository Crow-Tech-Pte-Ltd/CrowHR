/** Date helpers for document expiry (Asia/Singapore calendar dates, YYYY-MM-DD). */

export function addDaysIso(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function daysUntil(today: string, iso: string): number {
  return Math.round((Date.parse(`${iso}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
}

/**
 * The most urgent reminder threshold reached (30, 7 or 0 days before), or null when none is reached
 * yet or the date has passed. One reminder per threshold; a document added 20 days before expiry
 * gets the 30-day one only.
 */
export function expiryThreshold(today: string, expiresOn: string, thresholds: readonly number[]): number | null {
  const left = daysUntil(today, expiresOn);
  if (left < 0) return null;
  const reached = thresholds.filter((t) => left <= t);
  return reached.length ? Math.min(...reached) : null;
}
