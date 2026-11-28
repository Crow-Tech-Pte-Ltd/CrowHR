/**
 * Preloaded with `--import ./apps/server/src/instrument.ts` so monitoring starts before the app
 * loads. The Node SDK uses loader hooks. Bun uses explicit spans around requests and queries.
 * This loads no SDK unless SENTRY_DSN is set. Invalid settings are reported by `loadConfig`.
 *
 * Must not import `@crowhr/core` (it would load Hono before instrumentation).
 */
import { VERSION } from "../../../packages/core/src/version.ts";
import { readMonitoringConfig } from "./monitoring/config.ts";
import { startMonitoring } from "./monitoring/sentry.ts";

const { config, problems } = readMonitoringConfig(process.env, {
  version: VERSION,
  production: process.env.NODE_ENV === "production",
});
if (config?.dsn && problems.length === 0) await startMonitoring(config);
