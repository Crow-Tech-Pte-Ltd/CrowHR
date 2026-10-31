import { eq } from "drizzle-orm";
import { type AuditContext, recordAudit } from "../audit/audit.ts";
import { newToken, sha256Hex } from "../crypto/tokens.ts";
import { passwordResets, recoveryCodes } from "../db/schema/auth.ts";
import { users } from "../db/schema/users.ts";
import type { AppDeps } from "../deps.ts";
import { findMemberByEmail, rolesOf } from "./credentials.ts";
import { clearAccountThrottle } from "./throttle.ts";

const RESET_TTL_MS = 60 * 60_000;

/**
 * Server-CLI owner recovery (auth spec "Password reset": operators can reset an owner's
 * password). Issues a one-time reset link, clears the lockout and optionally MFA. Audited.
 */
export async function newResetLinkForCli(
  deps: Pick<AppDeps, "db" | "publicUrl" | "clock" | "ids">,
  input: { orgId: string; email: string; resetMfa: boolean; ctx: AuditContext },
): Promise<{ ok: true; url: string } | { ok: false; message: string }> {
  const { db, clock } = deps;
  const found = await findMemberByEmail(db, input.orgId, input.email);
  if (
    found?.membership.status !== "active" ||
    !(await rolesOf(db, input.orgId, found.membership.id)).includes("owner")
  ) {
    return { ok: false, message: `${input.email} is not an active owner of this organisation.` };
  }
  const now = clock.now();
  const token = newToken();
  await db.insert(passwordResets).values({
    tokenHash: await sha256Hex(token),
    orgId: input.orgId,
    userId: found.user.id,
    expiresAt: new Date(now.getTime() + RESET_TTL_MS),
    createdAt: now,
  });
  await clearAccountThrottle(db, found.user.id);
  if (input.resetMfa) {
    await db
      .update(users)
      .set({ mfaTotpSecretEnc: null, mfaPendingSecretEnc: null, mfaEnrolledAt: null, mfaLastStep: null })
      .where(eq(users.id, found.user.id));
    await db.delete(recoveryCodes).where(eq(recoveryCodes.userId, found.user.id));
  }
  await recordAudit(db, deps, input.ctx, {
    action: "auth.reset_link_generated",
    targetType: "membership",
    targetId: found.membership.id,
    meta: { for: found.user.email, via: "cli", mfaReset: input.resetMfa },
  });
  return { ok: true, url: `${deps.publicUrl.replace(/\/$/, "")}/reset/${token}` };
}
