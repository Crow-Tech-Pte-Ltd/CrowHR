import type { AppContext } from "../context.ts";
import { NOT_IN_DEMO_COMPANY } from "../demo-companies/config.ts";
import { AppError } from "../errors.ts";
import type { AnyRoute, RouteGuard } from "../http/route.ts";
import { mfaPolicyStatus } from "./mfa-policy.ts";
import { MINUTE, settingsFor } from "./settings.ts";

export const REAUTH_WINDOW_MS = 10 * MINUTE;

/**
 * Sensitive actions need authentication within the last 10 minutes (auth spec "Recent re-authentication").
 * Not in a demo company: anyone there signs in again with one tap, so asking for a password (its
 * people have none) would protect nothing and only block the demo.
 */
export function requireRecentAuth(c: AppContext) {
  const auth = c.get("auth");
  if (!auth || auth.demoCompany) return;
  const age = c.var.deps.clock.now().getTime() - auth.session.authenticatedAt.getTime();
  if (age > REAUTH_WINDOW_MS) {
    throw new AppError(
      "reauth_required",
      "For your security, confirm it's you before doing this. Enter your password again (and your authenticator code if you use one).",
    );
  }
}

/**
 * Blocks everything except MFA enrolment and sign-out once the grace period is over, for browser
 * and device (native-app) sessions alike (security review finding 11).
 */
const mfaEnrolmentGuard: RouteGuard = async (c, route: AnyRoute) => {
  const auth = c.get("auth");
  if (!auth || route.access === "public" || route.allowDuringMfaEnrolment) return;
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

/**
 * Demo companies (design decision 7): the routes marked `refusedInDemoCompany` answer 403, and
 * nothing a demo company does sends email (its requests run without the mailer, so invitations
 * and notices stay in-app; the outbox also suppresses anything queued for a demo company).
 */
const demoCompanyGuard: RouteGuard = (c, route) => {
  const auth = c.get("auth");
  if (!auth?.demoCompany) return;
  if (route.refusedInDemoCompany) throw new AppError("disabled_in_demo", NOT_IN_DEMO_COMPANY);
  if (c.var.deps.mailer) c.set("deps", { ...c.var.deps, mailer: undefined });
};

export const AUTH_ROUTE_GUARDS: readonly RouteGuard[] = [demoCompanyGuard, mfaEnrolmentGuard, recentAuthGuard];
