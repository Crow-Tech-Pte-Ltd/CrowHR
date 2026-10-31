import { eq, lt, sql } from "drizzle-orm";
import { authThrottle } from "../db/schema/auth.ts";
import type { Db } from "../db/types.ts";
import { DAY, MINUTE } from "./settings.ts";

/**
 * Sign-in throttling in Postgres (design decision 10), so it survives restarts and works in the
 * browser demo. Constants are the spec values; tune here.
 */
export const ACCOUNT_LOCK_THRESHOLD = 10;
export const ACCOUNT_WINDOW_MS = 15 * MINUTE;
export const ACCOUNT_LOCK_MS = 15 * MINUTE;
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

/** Per-IP sign-in rate: the 31st attempt in a minute is refused. */
export async function checkIpRate(
  db: Db,
  ip: string,
  now: Date,
): Promise<{ allowed: boolean; retryAfterSeconds: number }> {
  const { count, resetsAt } = await hitWindow(db, `ip:${ip}`, MINUTE, now);
  return {
    allowed: count <= IP_LIMIT_PER_MINUTE,
    retryAfterSeconds: Math.max(1, Math.ceil((resetsAt.getTime() - now.getTime()) / 1000)),
  };
}

export async function accountLockedUntil(db: Db, userId: string, now: Date): Promise<Date | null> {
  const [row] = await db
    .select()
    .from(authThrottle)
    .where(eq(authThrottle.key, `acct:${userId}`));
  return row?.lockedUntil && row.lockedUntil > now ? row.lockedUntil : null;
}

/**
 * Records a failed password for an account. Consecutive failures inside a sliding 15-minute
 * window from the first failure count; the 10th locks the account for 15 minutes.
 * Returns true when this failure caused the lock.
 */
export async function recordAccountFailure(db: Db, userId: string, now: Date): Promise<boolean> {
  const key = `acct:${userId}`;
  const [row] = await db.select().from(authThrottle).where(eq(authThrottle.key, key));
  if (
    !row ||
    now.getTime() - row.windowStart.getTime() > ACCOUNT_WINDOW_MS ||
    (row.lockedUntil && row.lockedUntil <= now)
  ) {
    await db
      .insert(authThrottle)
      .values({ key, windowStart: now, count: 1, lockedUntil: null })
      .onConflictDoUpdate({ target: authThrottle.key, set: { windowStart: now, count: 1, lockedUntil: null } });
    return false;
  }
  const count = row.count + 1;
  const lock = count >= ACCOUNT_LOCK_THRESHOLD && !row.lockedUntil;
  await db
    .update(authThrottle)
    .set({ count, ...(lock ? { lockedUntil: new Date(now.getTime() + ACCOUNT_LOCK_MS) } : {}) })
    .where(eq(authThrottle.key, key));
  return lock;
}

/** Successful sign-in or an owner clearing the lockout. */
export async function clearAccountThrottle(db: Db, userId: string) {
  await db.delete(authThrottle).where(eq(authThrottle.key, `acct:${userId}`));
}

/** Removes throttle rows older than a day (called opportunistically on sign-in). */
export async function sweepThrottle(db: Db, now: Date) {
  await db.delete(authThrottle).where(lt(authThrottle.windowStart, new Date(now.getTime() - DAY)));
}
