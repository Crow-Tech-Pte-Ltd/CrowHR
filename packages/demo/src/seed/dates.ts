/** `YYYY-MM-DD` in Asia/Singapore (UTC+8, no DST). */
export function singaporeDate(at: Date): string {
  return new Date(at.getTime() + 8 * 3600_000).toISOString().slice(0, 10);
}
