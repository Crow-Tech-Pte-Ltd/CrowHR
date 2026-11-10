/**
 * Replaces apps/web's `monitoring-sdk.ts` in the demo build (see vite.config.ts), so the Sentry
 * SDK is not even shipped with the public demo. The demo never reports: its pages carry no
 * monitoring settings, so `startMonitoring` is never called; if it were, this throws and
 * apps/web carries on without monitoring.
 */
export function initSdk(): never {
  throw new Error("Error monitoring is not available in the demo.");
}
