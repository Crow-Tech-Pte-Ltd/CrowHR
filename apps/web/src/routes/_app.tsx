import { Alert, AlertDescription, AlertTitle, Button, formatDate } from "@crowhr/ui";
import { createFileRoute, isRedirect, Link, Outlet, redirect } from "@tanstack/react-router";
import { ShieldAlert } from "lucide-react";
import { ReauthProvider } from "../auth/reauth.tsx";
import { meQuery, reasonFor, rememberOrg, useMe } from "../auth/session.ts";
import { ApiError } from "../lib/api.ts";
import { AppShell } from "../shell/app-shell.tsx";

// Pathless layout: every signed-in screen renders inside the shell. The guard is a convenience
// for navigation; the server enforces authentication and permissions on every request.
export const Route = createFileRoute("/_app")({
  beforeLoad: async ({ context, location }) => {
    try {
      const me = await context.queryClient.ensureQueryData(meQuery);
      rememberOrg(me.organisation.slug);
      if (me.mfa.blocked && location.pathname !== "/me/sessions") {
        throw redirect({ to: "/me/sessions", search: { enrol: "1" } });
      }
      return { me };
    } catch (err) {
      if (isRedirect(err)) throw err;
      if (err instanceof ApiError && err.status === 401) {
        const reason = reasonFor(err);
        throw redirect({ to: "/sign-in", search: reason ? { reason } : {} });
      }
      throw err;
    }
  },
  component: SignedInLayout,
});

function SignedInLayout() {
  return (
    <ReauthProvider>
      <AppShell>
        <MfaBanner />
        <Outlet />
      </AppShell>
    </ReauthProvider>
  );
}

/** Privileged roles must enrol in MFA; during the 7-day grace period every page shows this. */
function MfaBanner() {
  const me = useMe();
  if (!me.mfa.required || me.mfa.enrolled || me.mfa.blocked || !me.mfa.graceEndsAt) return null;
  return (
    <Alert variant="warning" className="mb-6" data-testid="mfa-banner">
      <ShieldAlert aria-hidden />
      <div className="flex flex-1 flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <AlertTitle>Set up two-step verification by {formatDate(me.mfa.graceEndsAt.slice(0, 10))}</AlertTitle>
          {/* The full reason on wider screens; on a phone the banner would push each page down a third. */}
          <AlertDescription className="hidden sm:block">
            Your role requires an authenticator app. After that date you won't be able to use Crow HR until it's set up.
          </AlertDescription>
        </div>
        <Button asChild size="sm" variant="primary" className="self-start sm:self-auto">
          <Link to="/me/sessions" search={{ enrol: "1" }}>
            Set up now
          </Link>
        </Button>
      </div>
    </Alert>
  );
}
