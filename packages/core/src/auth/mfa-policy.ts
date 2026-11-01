import { and, eq, inArray, min } from "drizzle-orm";
import type { AuthContext } from "../context.ts";
import { membershipRoles } from "../db/schema/access.ts";
import { users } from "../db/schema/users.ts";
import type { Db } from "../db/types.ts";
import { DAY, type SecuritySettings } from "./settings.ts";

export const MFA_GRACE_DAYS = 7;

export interface MfaPolicyStatus {
  /** The member holds a role the organisation's MFA policy covers (password sign-in only). */
  required: boolean;
  enrolled: boolean;
  /** End of the 7-day grace period, counted from the earliest grant of a covered role. */
  graceEndsAt: Date | null;
  /** Grace over and not enrolled: only MFA enrolment and sign-out are allowed. */
  blocked: boolean;
}

/**
 * MFA policy for privileged roles (auth spec): default owner, hr_admin, payroll_admin; 7-day
 * grace from the role grant.
 *
 * SSO (security review finding 1): an SSO session is exempt only when the identity provider
 * asserted multi-factor authentication in the ID token (`amr`, see `oidc/mfa.ts`), recorded as
 * the session's `mfaSatisfied`. Otherwise the policy applies exactly as for passwords: the member
 * enrols a Crow HR authenticator, and from then on every SSO sign-in without an IdP MFA assertion
 * also asks for the TOTP. Owners who trust their IdP's MFA can take roles out of the policy.
 * Applies to browser and device (native-app) sessions alike.
 */
export async function mfaPolicyStatus(
  db: Db,
  auth: Pick<AuthContext, "membershipId" | "orgId" | "roles" | "authMethod"> & {
    user: Pick<AuthContext["user"], "id">;
    session: Pick<AuthContext["session"], "mfaSatisfied">;
  },
  settings: SecuritySettings,
  now: Date,
): Promise<MfaPolicyStatus> {
  const [user] = await db.select({ enrolledAt: users.mfaEnrolledAt }).from(users).where(eq(users.id, auth.user.id));
  const enrolled = !!user?.enrolledAt;
  const covered = auth.roles.filter((r) => settings.mfaRequiredRoles.includes(r));
  const idpAssertedMfa = auth.authMethod !== "password" && auth.session.mfaSatisfied && !enrolled;
  if (covered.length === 0 || idpAssertedMfa) {
    return { required: false, enrolled, graceEndsAt: null, blocked: false };
  }
  const [row] = await db
    .select({ first: min(membershipRoles.grantedAt) })
    .from(membershipRoles)
    .where(
      and(
        eq(membershipRoles.membershipId, auth.membershipId),
        eq(membershipRoles.orgId, auth.orgId),
        inArray(membershipRoles.role, covered),
      ),
    );
  const start = row?.first ?? now;
  const graceEndsAt = new Date(new Date(start).getTime() + MFA_GRACE_DAYS * DAY);
  return { required: true, enrolled, graceEndsAt, blocked: !enrolled && now >= graceEndsAt };
}
