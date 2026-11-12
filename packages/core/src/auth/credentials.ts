import { and, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { auditContext, recordAudit } from "../audit/audit.ts";
import type { AppContext } from "../context.ts";
import { SECRET_PURPOSES } from "../crypto/secret-box.ts";
import { newToken, randomBytes, sha256Hex } from "../crypto/tokens.ts";
import { membershipRoles, memberships } from "../db/schema/access.ts";
import { mfaChallenges, recoveryCodes } from "../db/schema/auth.ts";
import { organisations } from "../db/schema/organisations.ts";
import { users } from "../db/schema/users.ts";
import type { Db } from "../db/types.ts";
import type { AppDeps, PasswordHasher } from "../deps.ts";
import { AppError } from "../errors.ts";
import { sendSecurityNotice } from "./security-notices.ts";
import { MINUTE } from "./settings.ts";
import { mfaLockedUntil, recordMfaFailure } from "./throttle.ts";
import { verifyTotp } from "./totp.ts";

/** Shared pieces of password, MFA and re-authentication flows. */

export const INVALID_CREDENTIALS_MESSAGE =
  "That email and password don't match an account here. Check them and try again, or reset your password.";

export function invalidCredentials(): AppError {
  return new AppError("invalid_credentials", INVALID_CREDENTIALS_MESSAGE);
}

/** Email input that tolerates surrounding spaces (people paste them). */
export const emailInput = () => z.string().trim().max(254, "Use at most 254 characters.").pipe(z.email());

export function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}

const dummyHashes = new WeakMap<PasswordHasher, Promise<string>>();

/**
 * Runs a real verification even when there is no account, so response time does not reveal
 * membership (auth spec "Password sign-in").
 */
export async function verifyPasswordOrDummy(hasher: PasswordHasher, hash: string | null, password: string) {
  if (hash) return hasher.verify(hash, password);
  let dummy = dummyHashes.get(hasher);
  if (!dummy) {
    dummy = hasher.hash("crowhr-timing-equaliser-not-a-password");
    dummyHashes.set(hasher, dummy);
  }
  await hasher.verify(await dummy, password);
  return false;
}

export async function findOrgBySlug(db: Db, slug: string) {
  const [org] = await db.select().from(organisations).where(eq(organisations.slug, slug.trim().toLowerCase()));
  return org ?? null;
}

/** The single (real) organisation of a one-org install, or null. Demo companies don't count. */
export async function onlyOrganisation(db: Db) {
  const rows = await db.select().from(organisations).where(isNull(organisations.demoExpiresAt)).limit(2);
  return rows.length === 1 ? (rows[0] ?? null) : null;
}

export async function findMemberByEmail(db: Db, orgId: string, email: string) {
  const [row] = await db
    .select({ user: users, membership: memberships })
    .from(users)
    .innerJoin(memberships, and(eq(memberships.userId, users.id), eq(memberships.orgId, orgId)))
    .where(eq(users.email, normaliseEmail(email)));
  return row ?? null;
}

export async function rolesOf(db: Db, orgId: string, membershipId: string) {
  const rows = await db
    .select({ role: membershipRoles.role })
    .from(membershipRoles)
    .where(and(eq(membershipRoles.orgId, orgId), eq(membershipRoles.membershipId, membershipId)));
  return rows.map((r) => r.role);
}

/** Audit helper for routes: records against the caller's org, or `orgId` for anonymous events. */
export function audit(
  c: AppContext,
  input: Parameters<typeof recordAudit>[3],
  options: { orgId?: string; db?: Db } = {},
) {
  const deps = c.var.deps;
  return recordAudit(options.db ?? deps.db, deps, auditContext(c, options.orgId ?? input.orgId), input);
}

// --- MFA challenges --------------------------------------------------------------------------

export const MFA_CHALLENGE_TTL_MS = 5 * MINUTE;
export const MFA_MAX_ATTEMPTS = 5;

export async function createMfaChallenge(
  deps: AppDeps,
  input: {
    orgId: string;
    userId: string;
    membershipId: string;
    authMethod: string;
    identityId?: string | null;
    nativeRequestId?: string | null;
  },
): Promise<{ token: string; expiresAt: Date }> {
  const token = newToken();
  const now = deps.clock.now();
  const expiresAt = new Date(now.getTime() + MFA_CHALLENGE_TTL_MS);
  await deps.db.insert(mfaChallenges).values({
    id: await sha256Hex(token),
    orgId: input.orgId,
    userId: input.userId,
    membershipId: input.membershipId,
    authMethod: input.authMethod,
    identityId: input.identityId ?? null,
    nativeRequestId: input.nativeRequestId ?? null,
    expiresAt,
    createdAt: now,
  });
  return { token, expiresAt };
}

// --- Second factor ---------------------------------------------------------------------------

export type SecondFactorResult =
  | { ok: true; method: "totp" | "recovery_code"; remainingRecoveryCodes: number }
  | { ok: false; locked?: boolean };

/** Recovery codes: 10 characters from an alphabet without 0/O, 1/I/L, shown as XXXXX-XXXXX. */
export const RECOVERY_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
export const RECOVERY_CODE_COUNT = 10;

export function newRecoveryCode(): string {
  const bytes = randomBytes(10);
  const chars = Array.from(bytes, (b) => RECOVERY_ALPHABET[b % RECOVERY_ALPHABET.length]).join("");
  return `${chars.slice(0, 5)}-${chars.slice(5)}`;
}

function normaliseRecoveryCode(code: string): string {
  return code.toUpperCase().replace(/[^0-9A-Z]/g, "");
}

export function hashRecoveryCode(userId: string, code: string): Promise<string> {
  return sha256Hex(`${userId}:${normaliseRecoveryCode(code)}`);
}

export async function remainingRecoveryCodes(db: Db, userId: string): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(recoveryCodes)
    .where(and(eq(recoveryCodes.userId, userId), isNull(recoveryCodes.usedAt)));
  return row?.n ?? 0;
}

/** Replaces every recovery code of a user; returns the new plaintext codes (shown once). */
export async function regenerateRecoveryCodes(deps: AppDeps, db: Db, userId: string): Promise<string[]> {
  const now = deps.clock.now();
  await db.delete(recoveryCodes).where(eq(recoveryCodes.userId, userId));
  const codes = Array.from({ length: RECOVERY_CODE_COUNT }, newRecoveryCode);
  for (const code of codes) {
    await db
      .insert(recoveryCodes)
      .values({ id: deps.ids.newId(), userId, codeHash: await hashRecoveryCode(userId, code), createdAt: now });
  }
  return codes;
}

/**
 * Checks a TOTP code (each time step accepted once) or a recovery code (single use) for a
 * user with MFA enrolled.
 */
export async function verifySecondFactor(deps: AppDeps, userId: string, code: string): Promise<SecondFactorResult> {
  const { db, secretBox, clock } = deps;
  const [user] = await db.select().from(users).where(eq(users.id, userId));
  if (!user?.mfaTotpSecretEnc) return { ok: false };
  const clean = code.replace(/\s+/g, "");
  if (/^\d{6}$/.test(clean)) {
    const secret = await secretBox.decrypt(SECRET_PURPOSES.totp, user.mfaTotpSecretEnc);
    const step = await verifyTotp(secret, clean, clock.now(), user.mfaLastStep);
    if (step === null) return { ok: false };
    // Compare-and-set so two concurrent requests cannot both use the same step.
    const updated = await db
      .update(users)
      .set({ mfaLastStep: step })
      .where(and(eq(users.id, userId), sql`(${users.mfaLastStep} is null or ${users.mfaLastStep} < ${step})`))
      .returning({ id: users.id });
    if (!updated.length) return { ok: false };
    return { ok: true, method: "totp", remainingRecoveryCodes: await remainingRecoveryCodes(db, userId) };
  }
  const hash = await hashRecoveryCode(userId, clean);
  const used = await db
    .update(recoveryCodes)
    .set({ usedAt: clock.now() })
    .where(and(eq(recoveryCodes.userId, userId), eq(recoveryCodes.codeHash, hash), isNull(recoveryCodes.usedAt)))
    .returning({ id: recoveryCodes.id });
  if (!used.length) return { ok: false };
  return { ok: true, method: "recovery_code", remainingRecoveryCodes: await remainingRecoveryCodes(db, userId) };
}

export const MFA_LOCKED_MESSAGE =
  "Too many wrong codes, so two-step verification is paused for this account for 15 minutes. If this wasn't you, change your password now.";

/**
 * `verifySecondFactor` behind the account's MFA failure counter (`throttle.ts` rule 4), shared
 * by `/auth/mfa/verify`, `/auth/reauth` and invitation acceptance. `locked: true` means the
 * second factor is locked (before or because of this attempt): the code was not accepted.
 */
export async function checkSecondFactor(
  c: AppContext,
  input: { userId: string; orgId: string; membershipId: string; code: string },
): Promise<SecondFactorResult> {
  const deps = c.var.deps;
  const now = deps.clock.now();
  // Serialize guesses for the same account across every challenge and endpoint. The lock and
  // its audit event commit together, including when the caller subsequently returns 401.
  let causedLock = false;
  const result = await deps.db.transaction(async (tx): Promise<SecondFactorResult> => {
    await tx.select({ id: users.id }).from(users).where(eq(users.id, input.userId)).for("update");
    if (await mfaLockedUntil(tx, input.userId, now)) return { ok: false, locked: true };
    const checked = await verifySecondFactor({ ...deps, db: tx }, input.userId, input.code);
    if (checked.ok) return checked;
    const lockedNow = await recordMfaFailure(tx, input.userId, now);
    causedLock = lockedNow;
    if (lockedNow) {
      await audit(
        c,
        { action: "auth.mfa_locked", targetType: "membership", targetId: input.membershipId, meta: { minutes: 15 } },
        { orgId: input.orgId, db: tx },
      );
    }
    return { ok: false, locked: lockedNow };
  });
  if (causedLock) {
    await sendSecurityNotice(deps.db, deps, {
      orgId: input.orgId,
      to: { membershipIds: [input.membershipId] },
      title: "Two-step verification paused",
      body: "Several wrong two-step verification codes were entered for your Crow HR account, so codes are not accepted for 15 minutes. Whoever entered them knew your password or had a signed-in session. If this wasn't you, change your password now and tell your administrator.",
    });
  }
  return result;
}
