import { eq } from "drizzle-orm";
import type { AssignedRole } from "../access/matrix.ts";
import type { AppContext } from "../context.ts";
import { orgSecuritySettings } from "../db/schema/auth.ts";
import type { Db } from "../db/types.ts";

export interface SecuritySettings {
  passwordEnabled: boolean;
  mfaRequiredRoles: AssignedRole[];
  idleTimeoutMin: number;
  absoluteTimeoutH: number;
  deviceIdleDays: number;
}

export const DEFAULT_SECURITY_SETTINGS: SecuritySettings = {
  passwordEnabled: true,
  mfaRequiredRoles: ["owner", "hr_admin", "payroll_admin"],
  idleTimeoutMin: 30,
  absoluteTimeoutH: 12,
  deviceIdleDays: 30,
};

/** An organisation's security settings, creating the default row on first read. */
export async function loadSecuritySettings(db: Db, orgId: string): Promise<SecuritySettings> {
  const [row] = await db.select().from(orgSecuritySettings).where(eq(orgSecuritySettings.orgId, orgId));
  if (!row) {
    await db.insert(orgSecuritySettings).values({ orgId }).onConflictDoNothing();
    return { ...DEFAULT_SECURITY_SETTINGS };
  }
  return {
    passwordEnabled: row.passwordEnabled,
    mfaRequiredRoles: row.mfaRequiredRoles as AssignedRole[],
    idleTimeoutMin: row.idleTimeoutMin,
    absoluteTimeoutH: row.absoluteTimeoutH,
    deviceIdleDays: row.deviceIdleDays,
  };
}

/** Request-memoised settings for the caller's organisation. */
export async function settingsFor(c: AppContext, orgId: string): Promise<SecuritySettings> {
  const key = `auth.settings:${orgId}`;
  const memo = c.get("memo");
  const hit = memo.get(key) as SecuritySettings | undefined;
  if (hit) return hit;
  const settings = await loadSecuritySettings(c.var.deps.db, orgId);
  memo.set(key, settings);
  return settings;
}

/** Session cookie name: `__Host-` only when PUBLIC_URL is https (browsers drop Secure cookies over http). */
export function sessionCookie(publicUrl: string): { name: string; secure: boolean } {
  const secure = new URL(publicUrl).protocol === "https:";
  return { name: secure ? "__Host-crowhr_session" : "crowhr_session", secure };
}

export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;
