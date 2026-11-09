/**
 * Preloaded with `node --import ./apps/server/src/instrument.ts` (Dockerfile CMD, `bun run dev`)
 * so error and performance monitoring starts before the app's modules load and Hono,
 * node-postgres and HTTP get instrumented. Does nothing, and loads no SDK, unless SENTRY_DSN
 * is set. Invalid values are left to `loadConfig`, which reports them and stops the app.
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
