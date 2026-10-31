import type { AppContext } from "../context.ts";
import { AppError } from "../errors.ts";
import type { AnyRoute, RouteGuard } from "../http/route.ts";
import { mfaPolicyStatus } from "./mfa-policy.ts";
import { MINUTE, settingsFor } from "./settings.ts";

export const REAUTH_WINDOW_MS = 10 * MINUTE;

/** Sensitive actions need authentication within the last 10 minutes (auth spec "Recent re-authentication"). */
export function requireRecentAuth(c: AppContext) {
  const auth = c.get("auth");
  if (!auth) return;
  const age = c.var.deps.clock.now().getTime() - auth.session.authenticatedAt.getTime();
  if (age > REAUTH_WINDOW_MS) {
    throw new AppError(
      "reauth_required",
      "For your security, confirm it's you before doing this. Enter your password again (and your authenticator code if you use one).",
    );
  }
}

/** Blocks everything except MFA enrolment and sign-out once the grace period is over. */
const mfaEnrolmentGuard: RouteGuard = async (c, route: AnyRoute) => {
  const auth = c.get("auth");
  if (!auth || route.access === "public" || route.allowDuringMfaEnrolment || auth.session.kind !== "browser") return;
  const status = await mfaPolicyStatus(c.var.deps.db, auth, await settingsFor(c, auth.orgId), c.var.deps.clock.now());
  if (status.blocked) {
    throw new AppError(
      "mfa_enrolment_required",
      "Your role requires two-step verification. Set up an authenticator app to continue.",
    );
  }
};

const recentAuthGuard: RouteGuard = (c, route) => {
  if (route.recentAuth) requireRecentAuth(c);
};

export const AUTH_ROUTE_GUARDS: readonly RouteGuard[] = [mfaEnrolmentGuard, recentAuthGuard];
