import { and, gte, isNull, lte } from "drizzle-orm";
import { singaporeDate } from "../access/scope.ts";
import { systemAuditContext } from "../audit/audit.ts";
import { delegations } from "../db/schema/workflows.ts";
import { type DemoCompaniesReport, sweepDemoCompanies } from "../demo-companies/sweep.ts";
import type { AppDeps } from "../deps.ts";
import { type OutboxReport, sweepNotificationRetention, sweepOutbox } from "../notifications/outbox.ts";
import { applyDelegationsToOpenTasks, closeEndedDelegations } from "../workflows/engine.ts";
import { sweepEscalations } from "../workflows/escalation.ts";
import { workflowRegistry } from "../workflows/registry.ts";
import { sweepReminders } from "../workflows/reminders.ts";

/**
 * The host-driven sweep (spec "Scheduled sweep"; design decision 6). Idempotent: run it as often
 * as you like. Every sweep claims its rows with a row lock (`FOR UPDATE SKIP LOCKED`, the outbox
 * with a lease) or de-duplicates with a unique key, so two replicas ticking at once never
 * double-process, and the first tick after downtime catches up on everything that fell due.
 *
 * Core has no timers: `apps/server` calls this every 60 s and on start; the browser demo on an
 * interval; tests call it with an injected time.
 */
export interface TickReport {
  at: string;
  escalations: number;
  delegations: { added: number; closed: number };
  reminders: number;
  emails: OutboxReport;
  notificationsDeleted: number;
  transitions: Record<string, number>;
  /** Expired demo companies deleted and pool copies seeded (demo-companies). */
  demoCompanies: DemoCompaniesReport;
  errors: string[];
}

export async function tick(deps: AppDeps, now: Date = deps.clock.now()): Promise<TickReport> {
  const report: TickReport = {
    at: now.toISOString(),
    escalations: 0,
    delegations: { added: 0, closed: 0 },
    reminders: 0,
    emails: { sent: 0, retried: 0, failed: 0, suppressed: 0 },
    notificationsDeleted: 0,
    transitions: {},
    demoCompanies: { purged: 0, seeded: 0 },
    errors: [],
  };
  const registry = workflowRegistry(deps);
  const run = async (name: string, fn: () => Promise<void>) => {
    try {
      await fn();
    } catch (err) {
      report.errors.push(`${name}: ${err instanceof Error ? err.message : String(err)}`);
      deps.logger.error("Scheduled sweep failed", { sweep: name, error: String(err) });
    }
  };
  // Pin "now" for every sweep in this tick, whatever the injected clock does meanwhile.
  const pinned: AppDeps = { ...deps, clock: { now: () => new Date(now.getTime()) } };

  await run("delegations", async () => {
    const today = singaporeDate(now);
    const active = await deps.db
      .selectDistinct({ orgId: delegations.orgId, from: delegations.fromMembershipId })
      .from(delegations)
      .where(and(isNull(delegations.revokedAt), lte(delegations.startsOn, today), gte(delegations.endsOn, today)));
    for (const d of active) {
      report.delegations.added += await deps.db.transaction((tx) =>
        applyDelegationsToOpenTasks(tx, pinned, systemAuditContext(d.orgId, "system", "delegation sweep"), {
          orgId: d.orgId,
          fromMembershipId: d.from,
        }),
      );
    }
    report.delegations.closed = await deps.db.transaction((tx) => closeEndedDelegations(tx, pinned));
  });
  await run("escalations", async () => {
    report.escalations = await sweepEscalations(pinned, now);
  });
  await run("reminders", async () => {
    report.reminders = await sweepReminders(pinned, registry.reminders, now);
  });
  for (const transition of registry.transitions) {
    await run(`transition:${transition.id}`, async () => {
      report.transitions[transition.id] = await transition.run(deps.db, {
        now,
        audit: (orgId) => systemAuditContext(orgId, "system", `transition ${transition.id}`),
      });
    });
  }
  await run("outbox", async () => {
    report.emails = await sweepOutbox(pinned, now);
  });
  await run("retention", async () => {
    report.notificationsDeleted = await sweepNotificationRetention(pinned, now);
  });
  // Last: refilling the demo-company pool seeds a whole company (seconds of work).
  await run("demo-companies", async () => {
    report.demoCompanies = await sweepDemoCompanies(pinned, now);
  });
  return report;
}
