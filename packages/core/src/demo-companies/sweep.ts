import { sweepThrottle } from "../auth/throttle.ts";
import type { AppDeps } from "../deps.ts";
import { PURGE_BATCH } from "./config.ts";
import { purgeDemoCompany } from "./purge.ts";
import { expiredDemoCompanies, refillPool } from "./service.ts";

export interface DemoCompaniesReport {
  /** Expired demo companies deleted this tick. */
  purged: number;
  /** Pool copies seeded this tick (0 or 1). */
  seeded: number;
}

/**
 * The demo-company part of the scheduled sweep. Expired demo companies are deleted on every
 * server, whether or not it still offers demo companies, so a copy never outlives its expiry when
 * the mode is turned off. The pool is refilled only while the mode is on, one copy per tick.
 */
export async function sweepDemoCompanies(deps: AppDeps, now: Date): Promise<DemoCompaniesReport> {
  const report: DemoCompaniesReport = { purged: 0, seeded: 0 };
  for (const orgId of await expiredDemoCompanies(deps.db, now, PURGE_BATCH)) {
    try {
      if (await purgeDemoCompany(deps, orgId, now)) report.purged++;
    } catch (err) {
      // Logged and retried next tick; the other companies still go.
      deps.logger.error("Could not delete an expired demo company", { orgId, error: String(err) });
    }
  }
  if (!deps.demoCompanies) return report;
  // Network counts for the start limits are kept for a day at most.
  await sweepThrottle(deps.db, now);
  report.seeded = await refillPool(deps, now);
  return report;
}
