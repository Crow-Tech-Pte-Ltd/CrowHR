import { Alert, AlertDescription, Button } from "@crowhr/ui";
import { createFileRoute, Link } from "@tanstack/react-router";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import * as React from "react";
import { AuthLayout } from "../auth/auth-layout.tsx";
import { ApiError, apiPost } from "../lib/api.ts";

/**
 * `/email/<token>`: the link sent to a new sign-in address. Confirming takes a click, so mail
 * scanners that open links don't use the token up.
 */
export const Route = createFileRoute("/email/$token")({ component: ConfirmEmail });

function ConfirmEmail() {
  const { token } = Route.useParams();
  const [state, setState] = React.useState<
    { kind: "ready" } | { kind: "done"; email: string; orgSlug: string | null } | { kind: "failed"; message: string }
  >({ kind: "ready" });
  const [busy, setBusy] = React.useState(false);

  if (state.kind === "done")
    return (
      <AuthLayout title="Sign-in email changed">
        <Alert variant="success" data-testid="email-change-state">
          <CheckCircle2 aria-hidden />
          <AlertDescription>
            Sign in with <span className="font-medium">{state.email}</span> from now on.
          </AlertDescription>
        </Alert>
        <Button asChild variant="primary">
          {state.orgSlug ? (
            <Link to="/sign-in/$org" params={{ org: state.orgSlug }}>
              Go to sign in
            </Link>
          ) : (
            <Link to="/sign-in">Go to sign in</Link>
          )}
        </Button>
      </AuthLayout>
    );

  return (
    <AuthLayout title="Confirm your new sign-in email">
      {state.kind === "failed" ? (
        <Alert variant="warning" data-testid="email-change-state">
          <AlertTriangle aria-hidden />
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      ) : (
        <p className="text-ui text-primary-300">
          You asked to sign in to Crow HR with this address. Confirm it to make the change; your old address stops
          working for sign-in.
        </p>
      )}
      {state.kind === "ready" ? (
        <Button
          variant="primary"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              const r = await apiPost<{ email: string; orgSlug: string | null }>("/api/v1/auth/email-change/confirm", {
                token,
              });
              setState({ kind: "done", email: r.email, orgSlug: r.orgSlug });
            } catch (err) {
              setState({
                kind: "failed",
                message:
                  err instanceof ApiError
                    ? err.message
                    : "The server didn't answer. Check your connection and try again.",
              });
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? "Confirming…" : "Confirm new email"}
        </Button>
      ) : null}
    </AuthLayout>
  );
}
