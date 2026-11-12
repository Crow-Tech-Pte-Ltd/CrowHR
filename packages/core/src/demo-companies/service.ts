import { and, asc, count, eq, gt, isNotNull, isNull, lte, min } from "drizzle-orm";
import { clientIp, recordAudit, systemAuditContext } from "../audit/audit.ts";
import { findOrgBySlug, onlyOrganisation } from "../auth/credentials.ts";
import { DAY, HOUR, MINUTE } from "../auth/settings.ts";
import { hitWindow } from "../auth/throttle.ts";
import type { AppContext } from "../context.ts";
import { type Organisation, organisations } from "../db/schema/organisations.ts";
import type { Db } from "../db/types.ts";
import type { AppDeps } from "../deps.ts";
import { AppError } from "../errors.ts";
import {
  DEMO_SLUG_PATTERN,
  type DemoCompaniesDeps,
  isLiveDemoCompany,
  networkKey,
  newDemoSlug,
  POOL_COPY_MAX_AGE_HOURS,
} from "./config.ts";
import { purgeDemoCompany } from "./purge.ts";

export { isLiveDemoCompany };

/**
 * The organisation behind a slug on the public sign-in surfaces (sign-in methods, password and
 * persona sign-in, native authorise, meta). A demo company counts only while live; otherwise it
 * is treated as if it did not exist.
 */
export async function findSignInOrg(deps: AppDeps, slug: string, now: Date): Promise<Organisation | null> {
  const org = await findOrgBySlug(deps.db, slug);
  if (!org) return null;
  if (org.demoExpiresAt && !isLiveDemoCompany(deps, org, now)) return null;
  return org;
}

/**
 * The organisation a sign-in page without a slug falls back to: the only (real) organisation of a
 * one-organisation install. A server with demo companies always asks, so a demo visitor never
 * lands on a real organisation's page by accident.
 */
export async function defaultSignInOrg(deps: AppDeps): Promise<Organisation | null> {
  if (deps.demoCompanies) return null;
  return onlyOrganisation(deps.db);
}

/** 404 for an unknown slug that looks like a demo company's, on a server that offers them. */
export function demoCompanyEnded(deps: AppDeps, slug: string): AppError | null {
  if (!deps.demoCompanies || !DEMO_SLUG_PATTERN.test(slug.trim().toLowerCase())) return null;
  return new AppError(
    "not_found",
    `This demo company has ended. Demo companies are deleted ${hoursPhrase(deps.demoCompanies.ttlHours)} after they start, with everything in them. Start a new one at /try.`,
    { demoCompanyEnded: true, tryPath: "/try" },
  );
}

export function hoursPhrase(hours: number): string {
  if (hours % 24 === 0) return hours === 24 ? "1 day" : `${hours / 24} days`;
  return hours === 1 ? "1 hour" : `${hours} hours`;
}

/** The demo company an organisation is, or null for a real organisation. */
export async function demoCompanyOf(db: Db, orgId: string): Promise<{ expiresAt: Date } | null> {
  const [row] = await db
    .select({ expiresAt: organisations.demoExpiresAt })
    .from(organisations)
    .where(eq(organisations.id, orgId));
  return row?.expiresAt ? { expiresAt: row.expiresAt } : null;
}

// --- Seeding, one at a time -------------------------------------------------------------------

/** Visitors who may wait for an inline seed at once; more get "busy, try again in a minute". */
export const MAX_WAITING_SEEDS = 3;

interface SeedQueue {
  tail: Promise<unknown>;
  busy: boolean;
  waiting: number;
}
const queues = new WeakMap<DemoCompaniesDeps, SeedQueue>();

function queueOf(config: DemoCompaniesDeps): SeedQueue {
  let q = queues.get(config);
  if (!q) {
    q = { tail: Promise.resolve(), busy: false, waiting: 0 };
    queues.set(config, q);
  }
  return q;
}

/** Runs `fn` after every seed queued before it (one seed at a time per server process). */
async function serialised<T>(config: DemoCompaniesDeps, fn: () => Promise<T>): Promise<T> {
  const q = queueOf(config);
  const run = q.tail.then(async () => {
    q.busy = true;
    try {
      return await fn();
    } finally {
      q.busy = false;
    }
  });
  q.tail = run.catch(() => undefined);
  return run;
}

/** True while a seed runs (the pool refill skips its turn instead of queueing). */
export function seedInProgress(config: DemoCompaniesDeps): boolean {
  const q = queueOf(config);
  return q.busy || q.waiting > 0;
}

// --- Pool -------------------------------------------------------------------------------------

/** Counts of live demo companies: handed out, and waiting in the pool. */
export async function liveCounts(db: Db, now: Date): Promise<{ claimed: number; pool: number }> {
  const rows = await db
    .select({ claimed: isNotNull(organisations.demoClaimedAt), n: count() })
    .from(organisations)
    .where(and(isNotNull(organisations.demoExpiresAt), gt(organisations.demoExpiresAt, now)))
    .groupBy(isNotNull(organisations.demoClaimedAt));
  const n = (claimed: boolean) => rows.find((r) => r.claimed === claimed)?.n ?? 0;
  return { claimed: n(true), pool: n(false) };
}

/**
 * Hands out the oldest pool copy, if any: the expiry clock starts now. A pool copy with less than
 * ten minutes of pool life left is left for the sweep.
 */
async function claimPooled(deps: AppDeps, now: Date): Promise<Organisation | null> {
  const config = deps.demoCompanies as DemoCompaniesDeps;
  return deps.db.transaction(async (tx) => {
    const [free] = await tx
      .select({ id: organisations.id })
      .from(organisations)
      .where(
        and(
          isNull(organisations.demoClaimedAt),
          isNotNull(organisations.demoExpiresAt),
          gt(organisations.demoExpiresAt, new Date(now.getTime() + 10 * MINUTE)),
        ),
      )
      .orderBy(asc(organisations.demoExpiresAt))
      .limit(1)
      .for("update", { skipLocked: true });
    if (!free) return null;
    const [claimed] = await tx
      .update(organisations)
      .set({
        demoClaimedAt: now,
        demoExpiresAt: new Date(now.getTime() + config.ttlHours * HOUR),
        updatedAt: now,
      })
      .where(and(eq(organisations.id, free.id), isNull(organisations.demoClaimedAt)))
      .returning();
    return claimed ?? null;
  });
}

async function loadOrg(db: Db, id: string): Promise<Organisation> {
  const [org] = await db.select().from(organisations).where(eq(organisations.id, id));
  if (!org) throw new Error(`Seeded demo company ${id} is missing`);
  return org;
}

/**
 * Pool refill (called on every scheduler tick): seeds one copy when the pool is short and the
 * server is below `maxLive`. Skips its turn while another seed runs. Returns the copies seeded.
 */
export async function refillPool(deps: AppDeps, now: Date): Promise<number> {
  const config = deps.demoCompanies;
  if (!config || config.poolSize <= 0 || seedInProgress(config)) return 0;
  const live = await liveCounts(deps.db, now);
  if (live.pool >= config.poolSize || live.claimed + live.pool >= config.maxLive) return 0;
  await serialised(config, () =>
    config.provision({
      slug: newDemoSlug(),
      expiresAt: new Date(now.getTime() + POOL_COPY_MAX_AGE_HOURS * HOUR),
      claimedAt: null,
      now,
    }),
  );
  return 1;
}

// --- Start a demo company ---------------------------------------------------------------------

export interface StartedDemoCompany {
  slug: string;
  name: string;
  server: string;
  connectUrl: string;
  signInUrl: string;
  expiresAt: string;
}

function tooMany(message: string, retryAt: Date, now: Date): AppError {
  const seconds = Math.max(1, Math.ceil((retryAt.getTime() - now.getTime()) / 1000));
  return new AppError(
    "rate_limited",
    message,
    { retryAt: retryAt.toISOString() },
    {
      headers: { "Retry-After": String(seconds) },
    },
  );
}

/**
 * `POST /api/v1/demo-companies` (design decisions 3 and 4): checks the caps, then hands out a pool
 * copy or seeds one while the visitor waits. The caller has checked that the mode is on.
 */
export async function startDemoCompany(c: AppContext): Promise<StartedDemoCompany> {
  const deps = c.var.deps;
  const config = deps.demoCompanies as DemoCompaniesDeps;
  const now = deps.clock.now();

  const live = await liveCounts(deps.db, now);
  if (live.claimed >= config.maxLive) {
    const [next] = await deps.db
      .select({ at: min(organisations.demoExpiresAt) })
      .from(organisations)
      .where(and(isNotNull(organisations.demoClaimedAt), gt(organisations.demoExpiresAt, now)));
    throw tooMany(
      "Every demo company on this server is in use right now. One ends soon: try again later.",
      next?.at ?? new Date(now.getTime() + HOUR),
      now,
    );
  }
  const net = networkKey(clientIp(c));
  const hour = await hitWindow(deps.db, `demo-companies:hour:${net}`, HOUR, now);
  const day = await hitWindow(deps.db, `demo-companies:day:${net}`, DAY, now);
  if (day.count > config.dailyLimitPerNetwork) {
    throw tooMany(
      `Your network has started ${config.dailyLimitPerNetwork} demo companies today, the most a network can start in a day. Keep using the ones you have, or try again after the time shown.`,
      day.resetsAt,
      now,
    );
  }
  if (hour.count > config.hourlyLimitPerNetwork) {
    throw tooMany(
      `Your network has started ${config.hourlyLimitPerNetwork} demo companies in the last hour, the most a network can start in an hour. Keep using the one you have, or try again after the time shown.`,
      hour.resetsAt,
      now,
    );
  }

  let org = await claimPooled(deps, now);
  if (!org) {
    const q = queueOf(config);
    if (q.waiting >= MAX_WAITING_SEEDS) {
      throw new AppError(
        "service_unavailable",
        "Demo companies are being prepared for other visitors right now. Try again in a minute.",
        undefined,
        { headers: { "Retry-After": "60" } },
      );
    }
    q.waiting++;
    try {
      org = await serialised(config, async () => {
        // A pool refill may have finished while this request waited.
        const at = deps.clock.now();
        const pooled = await claimPooled(deps, at);
        if (pooled) return pooled;
        const seeded = await config.provision({
          slug: newDemoSlug(),
          expiresAt: new Date(at.getTime() + config.ttlHours * HOUR),
          claimedAt: at,
          now: at,
        });
        return loadOrg(deps.db, seeded.orgId);
      });
    } finally {
      q.waiting--;
    }
  }
  await recordAudit(deps.db, deps, systemAuditContext(org.id, "system", "demo companies"), {
    action: "demo_company.started",
    targetType: "organisation",
    targetId: org.id,
    meta: { expiresAt: org.demoExpiresAt?.toISOString() ?? null },
  });
  const server = deps.publicUrl.replace(/\/+$/, "");
  const slug = org.slug as string;
  return {
    slug,
    name: org.name,
    server,
    connectUrl: `crowhr://connect?${new URLSearchParams({ server, org: slug })}`,
    signInUrl: `${server}/sign-in/${slug}`,
    expiresAt: (org.demoExpiresAt as Date).toISOString(),
  };
}

/** Expired demo companies, oldest first (the sweep deletes `limit` of them per tick). */
export async function expiredDemoCompanies(db: Db, now: Date, limit: number): Promise<string[]> {
  const rows = await db
    .select({ id: organisations.id })
    .from(organisations)
    .where(and(isNotNull(organisations.demoExpiresAt), lte(organisations.demoExpiresAt, now)))
    .orderBy(asc(organisations.demoExpiresAt))
    .limit(limit);
  return rows.map((r) => r.id);
}

/**
 * `crowhr demo-companies purge` (rollback, design "Migration Plan"): ends every demo company now,
 * live and pooled ones included, and deletes them all. Returns how many were deleted. Real
 * organisations are never touched (only rows with a demo expiry are changed or selected).
 */
export async function endAllDemoCompanies(deps: PurgeDeps, now: Date): Promise<number> {
  const past = new Date(now.getTime() - 1000);
  // Moving a demo company's expiry is allowed by the flag trigger; setting one is not.
  await deps.db
    .update(organisations)
    .set({ demoExpiresAt: past })
    .where(and(isNotNull(organisations.demoExpiresAt), gt(organisations.demoExpiresAt, past)));
  return purgeExpiredDemoCompanies(deps, now);
}

type PurgeDeps = Pick<AppDeps, "db" | "fileStore" | "logger">;

/** Deletes every expired demo company now (the sweep does `PURGE_BATCH` per tick). */
export async function purgeExpiredDemoCompanies(deps: PurgeDeps, now: Date): Promise<number> {
  let purged = 0;
  for (;;) {
    const ids = await expiredDemoCompanies(deps.db, now, 50);
    if (!ids.length) return purged;
    for (const id of ids) {
      if (!(await purgeDemoCompany(deps, id, now))) return purged;
      purged++;
    }
  }
}
