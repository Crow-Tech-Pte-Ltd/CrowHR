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
 * grace from the role grant; SSO sign-ins exempt because the IdP owns MFA there.
 */
export async function mfaPolicyStatus(
  db: Db,
  auth: Pick<AuthContext, "user" | "membershipId" | "orgId" | "roles" | "authMethod">,
  settings: SecuritySettings,
  now: Date,
): Promise<MfaPolicyStatus> {
  const [user] = await db.select({ enrolledAt: users.mfaEnrolledAt }).from(users).where(eq(users.id, auth.user.id));
  const enrolled = !!user?.enrolledAt;
  const covered = auth.roles.filter((r) => settings.mfaRequiredRoles.includes(r));
  if (auth.authMethod !== "password" || covered.length === 0) {
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
