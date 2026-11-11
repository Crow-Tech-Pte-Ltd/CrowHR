/**
 * "Now" for the web app. A real install uses the device clock. The browser demo's company lives on
 * a fixed date (31 Oct 2026, packages/demo/src/clock.ts), and its in-browser API runs on that
 * shifted clock; the demo calls `setAppClockOffset` before the app renders so that screens which
 * pick a default date (this week's roster, today's attendance, this month's claims) agree with it.
 */
let offsetMs = 0;

export function setAppClockOffset(ms: number): void {
  offsetMs = Number.isFinite(ms) ? ms : 0;
}

/** Epoch milliseconds, on the app's clock. */
export function appNowMs(): number {
  return Date.now() + offsetMs;
}

export function appNow(): Date {
  return new Date(appNowMs());
}

/** Today's date in Singapore as `YYYY-MM-DD`, on the app's clock. */
export function singaporeTodayIso(now = appNowMs()): string {
  return new Date(now + 8 * 3_600_000).toISOString().slice(0, 10);
}
