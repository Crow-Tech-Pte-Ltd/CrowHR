import { eq, like, lt, or, sql } from "drizzle-orm";
import { authThrottle } from "../db/schema/auth.ts";
import type { Db } from "../db/types.ts";
import { DAY, MINUTE } from "./settings.ts";

/**
 * Sign-in throttling in Postgres (design decision 10), so it survives restarts and works in the
 * browser demo. Constants are the spec values; tune here.
 *
 * Lockout design (security review, "account-lockout DoS"). A lock keyed only by account let
 * anyone lock anyone (an owner included) out for 15 minutes, again and again. Now:
 *
 * 1. **Per account and network** (`acct:<user>:<ip>`): after 10 wrong passwords within
 *    15 minutes, delays double from 1 second to a maximum of 30 seconds per failure.
 * 2. **Per account, all networks** (`acct:<user>`): the 50th wrong password in a 15-minute
 *    window pauses new browsers for at most 30 seconds. Further failures cannot extend or
 *    restart this pause until the next window. Known browsers retain access from other networks.
 * 3. **Per network** (`ip:<ip>`): 30 sign-in attempts per minute (any account).
 * 4. **Second factor** (`mfa:<user>`): 5 wrong TOTP/recovery codes within 15 minutes, counted
 *    across every challenge, `/auth/reauth` and invitation acceptance, lock the account's second
 *    factor for 15 minutes (and email the member). Only someone who knows the password or holds
 *    a session can get there, so this lock is account-wide. `/auth/mfa/verify` also has its own
 *    per-network limit (`ipmfa:<ip>`).
 *
 * Success clears rule 1 for that network only after the whole sign-in (including MFA) succeeds.
 * Rules 2 and 4 are never cleared by a success (an attack in progress keeps its budget spent);
 * they expire with their window, or an owner clears them (`POST /members/:id/unlock`).
 */
export const ACCOUNT_LOCK_THRESHOLD = 10;
export const ACCOUNT_SOFT_LOCK_THRESHOLD = 50;
export const ACCOUNT_WINDOW_MS = 15 * MINUTE;
export const ACCOUNT_LOCK_MS = 30_000;
export const MFA_LOCK_THRESHOLD = 5;
export const MFA_LOCK_MS = 15 * MINUTE;
export const IP_LIMIT_PER_MINUTE = 30;
export const REVEAL_LIMIT_PER_HOUR = 30;

/** Fixed-window counter. Returns the count after this hit and when the window resets. */
export async function hitWindow(
  db: Db,
  key: string,
  windowMs: number,
  now: Date,
): Promise<{ count: number; resetsAt: Date }> {
  const windowStart = new Date(Math.floor(now.getTime() / windowMs) * windowMs);
  const [row] = await db
    .insert(authThrottle)
    .values({ key, windowStart, count: 1 })
    .onConflictDoUpdate({
      target: authThrottle.key,
      set: {
        count: sql`case when ${authThrottle.windowStart} = ${windowStart.toISOString()}::timestamptz then ${authThrottle.count} + 1 else 1 end`,
        windowStart,
      },
    })
    .returning();
  return { count: row?.count ?? 1, resetsAt: new Date(windowStart.getTime() + windowMs) };
}

/** Per-IP rate: the 31st attempt in a minute is refused. `scope` separates sign-in from MFA. */
export async function checkIpRate(
  db: Db,
  ip: string,
  now: Date,
  scope: "sign_in" | "mfa" = "sign_in",
): Promise<{ allowed: boolean; retryAfterSeconds: number }> {
  const { count, resetsAt } = await hitWindow(db, `${scope === "mfa" ? "ipmfa" : "ip"}:${ip}`, MINUTE, now);
  return {
    allowed: count <= IP_LIMIT_PER_MINUTE,
    retryAfterSeconds: Math.max(1, Math.ceil((resetsAt.getTime() - now.getTime()) / 1000)),
  };
}

const accountKey = (userId: string) => `acct:${userId}`;
const pairKey = (userId: string, ip: string) => `acct:${userId}:${ip}`;
const mfaKey = (userId: string) => `mfa:${userId}`;

async function lockedUntil(db: Db, key: string, now: Date): Promise<Date | null> {
  const [row] = await db.select().from(authThrottle).where(eq(authThrottle.key, key));
  return row?.lockedUntil && row.lockedUntil > now ? row.lockedUntil : null;
}

/**
 * Records one failure against `key`. Failures inside a 15-minute window from the first failure
 * count; reaching `threshold` locks the key for `lockMs`. Returns true when this failure caused
 * the lock.
 */
async function recordFailure(
  db: Db,
  key: string,
  threshold: number,
  lockMs: number,
  now: Date,
  progressive = false,
): Promise<boolean> {
  // Atomic upsert: concurrent guesses cannot overwrite each other's failure counts. Expiry of
  // a short delay does not reset the budget; only expiry of the full counting window does.
  const reset = sql`${authThrottle.windowStart} <= ${new Date(now.getTime() - ACCOUNT_WINDOW_MS).toISOString()}::timestamptz`;
  const count = sql`case when ${reset} then 1 else ${authThrottle.count} + 1 end`;
  const delay = progressive ? sql`least(30000, 1000 * power(2, least(5, (${count}) - ${threshold})))` : sql`${lockMs}`;
  const trigger = progressive ? sql`(${count}) >= ${threshold}` : sql`(${count}) = ${threshold}`;
  const [row] = await db
    .insert(authThrottle)
    .values({ key, windowStart: now, count: 1, lockedUntil: null })
    .onConflictDoUpdate({
      target: authThrottle.key,
      set: {
        count,
        windowStart: sql`case when ${reset} then ${now.toISOString()}::timestamptz else ${authThrottle.windowStart} end`,
        lockedUntil: sql`case when ${trigger} then ${now.toISOString()}::timestamptz + (${delay}) * interval '1 millisecond' when ${reset} then null else ${authThrottle.lockedUntil} end`,
      },
    })
    .returning({ count: authThrottle.count });
  return progressive ? (row?.count ?? 0) >= threshold : row?.count === threshold;
}

export interface PasswordLockState {
  /** This network is locked out of the account (rule 1). */
  network: Date | null;
  /** The account is soft-locked for new devices (rule 2). */
  account: Date | null;
}

export async function passwordLockState(db: Db, userId: string, ip: string, now: Date): Promise<PasswordLockState> {
  return {
    network: await lockedUntil(db, pairKey(userId, ip), now),
    account: await lockedUntil(db, accountKey(userId), now),
  };
}

/** Whether a password attempt is refused, given the lock state and whether the browser is known. */
export function passwordLocked(state: PasswordLockState, knownDevice: boolean): boolean {
  return !!state.network || (!!state.account && !knownDevice);
}

/** Records a wrong password; reports which locks this failure triggered. */
export async function recordPasswordFailure(
  db: Db,
  userId: string,
  ip: string,
  now: Date,
): Promise<{ networkLocked: boolean; accountLocked: boolean }> {
  const networkLocked = await recordFailure(
    db,
    pairKey(userId, ip),
    ACCOUNT_LOCK_THRESHOLD,
    ACCOUNT_LOCK_MS,
    now,
    true,
  );
  const accountLocked = await recordFailure(db, accountKey(userId), ACCOUNT_SOFT_LOCK_THRESHOLD, ACCOUNT_LOCK_MS, now);
  return { networkLocked, accountLocked };
}

/** A completed sign-in (password and, when enrolled, MFA) clears this network's counter. */
export async function clearNetworkThrottle(db: Db, userId: string, ip: string) {
  await db.delete(authThrottle).where(eq(authThrottle.key, pairKey(userId, ip)));
}

/** When the account's second factor is locked, or null. */
export function mfaLockedUntil(db: Db, userId: string, now: Date): Promise<Date | null> {
  return lockedUntil(db, mfaKey(userId), now);
}

/** Records a wrong TOTP or recovery code; true when this failure locked the second factor. */
export function recordMfaFailure(db: Db, userId: string, now: Date): Promise<boolean> {
  return recordFailure(db, mfaKey(userId), MFA_LOCK_THRESHOLD, MFA_LOCK_MS, now);
}

/** The account-wide lock shown to owners: the new-device soft lock or the MFA lock, whichever ends later. */
export async function accountLockedUntil(db: Db, userId: string, now: Date): Promise<Date | null> {
  const a = await lockedUntil(db, accountKey(userId), now);
  const m = await lockedUntil(db, mfaKey(userId), now);
  if (!a) return m;
  if (!m) return a;
  return new Date(Math.max(a.getTime(), m.getTime()));
}

/** An owner clearing the lockout: every password, network and MFA counter of the account. */
export async function clearAccountThrottle(db: Db, userId: string) {
  await db
    .delete(authThrottle)
    .where(
      or(
        eq(authThrottle.key, accountKey(userId)),
        like(authThrottle.key, `${accountKey(userId)}:%`),
        eq(authThrottle.key, mfaKey(userId)),
      ),
    );
}

/** Removes throttle rows older than a day (called opportunistically on sign-in). */
export async function sweepThrottle(db: Db, now: Date) {
  await db.delete(authThrottle).where(lt(authThrottle.windowStart, new Date(now.getTime() - DAY)));
}
