import { isNull, sql } from "drizzle-orm";
import { type AuditContext, recordAudit } from "../audit/audit.ts";
import { normaliseEmail } from "../auth/credentials.ts";
import { passwordProblem } from "../auth/password-policy.ts";
import { membershipRoles, memberships } from "../db/schema/access.ts";
import { orgSecuritySettings } from "../db/schema/auth.ts";
import { organisations } from "../db/schema/organisations.ts";
import { users } from "../db/schema/users.ts";
import type { Db } from "../db/types.ts";
import type { AppDeps } from "../deps.ts";
import { AppError } from "../errors.ts";
import { deleteSystemSetting, getSystemSetting, SYSTEM_KEYS, setSystemSetting } from "../system/settings.ts";
import { hashSetupCode, timingSafeEqualHex } from "./code.ts";

/** Wrong codes allowed per IP before it is blocked (spec: five wrong codes → 15 minutes). */
export const SETUP_MAX_FAILURES = 5;
export const SETUP_BLOCK_MINUTES = 15;

/** True while the install has no organisation (first run). */
export async function isSetupRequired(db: Db): Promise<boolean> {
  // Demo companies (seeded by the scheduler on a DEMO_COMPANIES server) don't count: the
  // first real organisation still has to be created by the setup wizard.
  const rows = await db
    .select({ id: organisations.id })
    .from(organisations)
    .where(isNull(organisations.demoExpiresAt))
    .limit(1);
  return rows.length === 0;
}

/** Stores the hash of a freshly generated code, replacing any earlier one. */
export async function storeSetupCode(db: Db, code: string, now: Date): Promise<void> {
  await setSystemSetting(
    db,
    SYSTEM_KEYS.setupCode,
    { hash: await hashSetupCode(code), createdAt: now.toISOString() },
    now,
  );
}

async function codeMatches(db: Db, code: string): Promise<boolean> {
  const stored = await getSystemSetting<{ hash: string }>(db, SYSTEM_KEYS.setupCode);
  if (!stored?.hash) return false;
  return timingSafeEqualHex(await hashSetupCode(code), stored.hash);
}

interface Attempts {
  failures: number;
  blockedUntil: number;
}

/** Per-app in-memory limiter. One app instance per server process (no replicas in v1). */
const limiters = new WeakMap<AppDeps, Map<string, Attempts>>();

function limiterFor(deps: AppDeps) {
  let map = limiters.get(deps);
  if (!map) {
    map = new Map();
    limiters.set(deps, map);
  }
  return map;
}

/**
 * Checks the one-time code for a client. Five wrong codes from one IP block it for 15 minutes
 * (blocked attempts are refused without checking the code). Requests whose IP the host
 * cannot determine share one bucket.
 */
export async function checkSetupCode(deps: AppDeps, ip: string | null, code: string | undefined): Promise<void> {
  const map = limiterFor(deps);
  const key = ip ?? "unknown";
  const now = deps.clock.now().getTime();
  const entry = map.get(key) ?? { failures: 0, blockedUntil: 0 };
  if (entry.blockedUntil > now) {
    const retry = Math.ceil((entry.blockedUntil - now) / 1000);
    throw new AppError(
      "rate_limited",
      `Too many wrong setup codes from this address. Wait ${Math.ceil(retry / 60)} minutes and try again.`,
      { retryAfterSeconds: retry },
      { headers: { "Retry-After": String(retry) } },
    );
  }
  if (code && (await codeMatches(deps.db, code))) {
    map.delete(key);
    return;
  }
  entry.failures += 1;
  if (entry.failures >= SETUP_MAX_FAILURES) {
    entry.failures = 0;
    entry.blockedUntil = now + SETUP_BLOCK_MINUTES * 60_000;
  }
  map.set(key, entry);
  throw new AppError(
    "invalid_setup_code",
    "That setup code is not right. Find the current code in the server logs: docker compose logs app | grep -A3 'SETUP CODE'. A new code is printed every time the app starts.",
    { attemptsLeft: entry.blockedUntil > now ? 0 : SETUP_MAX_FAILURES - entry.failures },
  );
}

export interface CompleteSetupInput {
  organisationName: string;
  ownerName: string;
  ownerEmail: string;
  ownerPassword: string;
}

/** `Kampong Kopi Pte. Ltd.` → `kampong-kopi`: the org's sign-in slug (`/sign-in/<slug>`). */
export function slugForOrganisation(name: string): string {
  const slug = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\b(pte|ltd|limited|private|llp|inc|co)\b\.?/g, " ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
  return slug || "org";
}

/**
 * Creates the organisation and its owner in one transaction, through the identity module's
 * model: `organisations` + default `org_security_settings`, the `users` row with an argon2id
 * hash (identity password policy), an active `memberships` row and the `owner` role. Then
 * invalidates the setup code and records `setup.completed` in the audit log. Serialised with
 * an advisory lock so two browsers cannot both create a first organisation.
 */
export async function completeSetup(
  deps: AppDeps,
  input: CompleteSetupInput,
  auditFor: (orgId: string) => AuditContext,
) {
  const email = normaliseEmail(input.ownerEmail);
  const name = input.ownerName.trim();
  const problem = passwordProblem(input.ownerPassword, email);
  if (problem) {
    throw new AppError("validation_failed", "Some fields need attention.", {
      target: "json",
      issues: [{ path: "ownerPassword", message: problem }],
    });
  }
  // Hash outside the transaction: argon2id is deliberately slow.
  const passwordHash = await deps.passwordHasher.hash(input.ownerPassword);
  const now = deps.clock.now();
  const organisationId = deps.ids.newId();
  const userId = deps.ids.newId();
  const membershipId = deps.ids.newId();
  const slug = slugForOrganisation(input.organisationName);
  await deps.db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('crowhr:setup'))`);
    if (!(await isSetupRequired(tx))) {
      throw new AppError("not_found", "Setup is already complete. Sign in instead.");
    }
    await tx
      .insert(organisations)
      .values({ id: organisationId, name: input.organisationName.trim(), slug, createdAt: now, updatedAt: now });
    await tx.insert(orgSecuritySettings).values({ orgId: organisationId });
    await tx.insert(users).values({ id: userId, email, displayName: name, passwordHash, passwordChangedAt: now });
    await tx.insert(memberships).values({ id: membershipId, orgId: organisationId, userId, status: "active" });
    await tx.insert(membershipRoles).values({ orgId: organisationId, membershipId, role: "owner", grantedAt: now });
    await deleteSystemSetting(tx, SYSTEM_KEYS.setupCode);
    await recordAudit(tx, deps, auditFor(organisationId), {
      action: "setup.completed",
      targetType: "organisation",
      targetId: organisationId,
      meta: { ownerMembershipId: membershipId },
    });
  });
  deps.logger.info("First-run setup complete: organisation and owner created", { organisationId, userId });
  return { organisationId, organisationSlug: slug, ownerUserId: userId, ownerMembershipId: membershipId };
}
