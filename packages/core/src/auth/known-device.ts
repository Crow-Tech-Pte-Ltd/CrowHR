import { getCookie, setCookie } from "hono/cookie";
import type { AppContext } from "../context.ts";
import { DAY, sessionCookie } from "./settings.ts";

/**
 * Known-device cookie (lockout design rule 2 in `throttle.ts`): after a complete sign-in, the
 * browser gets a signed, HttpOnly cookie naming the account. While the account is soft-locked
 * because of wrong passwords from many networks, a browser holding it may still try its password
 * (still subject to the per-network lock). It grants nothing else: no session, no MFA skip.
 *
 * Value: `<userId>.<issuedAtMs>.<HMAC(secret key, purpose "known-device")>`. One account per
 * browser (the last one that signed in); valid 180 days.
 */
export const KNOWN_DEVICE_TTL_MS = 180 * DAY;
const PURPOSE = "known-device";

function cookieName(publicUrl: string): { name: string; secure: boolean } {
  const { secure } = sessionCookie(publicUrl);
  return { name: secure ? "__Host-crowhr_device" : "crowhr_device", secure };
}

export async function rememberDevice(c: AppContext, userId: string): Promise<void> {
  const { secretBox, clock, publicUrl } = c.var.deps;
  const issued = String(clock.now().getTime());
  const mac = await secretBox.blindIndex(PURPOSE, `${userId}.${issued}`);
  const { name, secure } = cookieName(publicUrl);
  setCookie(c, name, `${userId}.${issued}.${mac}`, {
    httpOnly: true,
    secure,
    sameSite: "Lax",
    path: "/",
    maxAge: KNOWN_DEVICE_TTL_MS / 1000,
  });
}

/** True when the request carries a valid known-device cookie for `userId`. */
export async function isKnownDevice(c: AppContext, userId: string): Promise<boolean> {
  const { secretBox, clock, publicUrl } = c.var.deps;
  const raw = getCookie(c, cookieName(publicUrl).name);
  if (!raw) return false;
  const [id, issued, mac, extra] = raw.split(".");
  if (!id || !issued || !mac || extra !== undefined || id !== userId || !/^\d{1,15}$/.test(issued)) return false;
  const age = clock.now().getTime() - Number(issued);
  if (age < 0 || age > KNOWN_DEVICE_TTL_MS) return false;
  const expected = await secretBox.blindIndex(PURPOSE, `${id}.${issued}`);
  return timingSafeEqual(expected, mac);
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
