import { type Db, isSetupRequired } from "@crowhr/core";
import { createMiddleware } from "hono/factory";

/**
 * Setup mode (spec "First-run setup wizard"): while no organisation exists, every page
 * redirects to /setup and API calls other than setup, health and the API description answer
 * 409 `setup_required`. Once setup is done the answer is cached for the life of the process.
 */
export function createSetupGate(db: Db) {
  let done = false;
  return {
    async required(): Promise<boolean> {
      if (done) return false;
      const required = await isSetupRequired(db);
      if (!required) done = true;
      return required;
    },
  };
}

export type SetupGate = ReturnType<typeof createSetupGate>;

const API_ALLOWED = [
  /^\/api\/health\/?$/,
  /^\/api\/v1\/setup(\/|$)/,
  /^\/api\/v1\/openapi\.json$/,
  /^\/api\/v1\/meta(\/|$)/,
];
/** Static assets the setup page itself needs (Vite output, fonts, icons). */
const PAGE_ALLOWED = [/^\/setup\/?$/, /^\/assets\//, /\.[a-z0-9]{2,5}$/i];

export function setupGateMiddleware(gate: SetupGate) {
  return createMiddleware(async (c, next) => {
    const path = c.req.path;
    const isApi = path === "/api" || path.startsWith("/api/");
    if (isApi ? API_ALLOWED.some((r) => r.test(path)) : PAGE_ALLOWED.some((r) => r.test(path))) return next();
    if (!(await gate.required())) return next();
    if (isApi) {
      return c.json(
        {
          error: {
            code: "setup_required",
            message:
              "Crow HR is not set up yet. Open /setup in a browser and enter the setup code from the server logs.",
            requestId: c.res.headers.get("x-request-id") ?? "unknown",
          },
        },
        409,
      );
    }
    if (c.req.method !== "GET" && c.req.method !== "HEAD") return c.text("Finish setup at /setup first.", 409);
    return c.redirect("/setup", 302);
  });
}
