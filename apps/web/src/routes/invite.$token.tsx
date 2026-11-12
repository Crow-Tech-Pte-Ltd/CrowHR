import { Alert, AlertDescription, AlertTitle, Button, FormField, Input, ProviderButton } from "@crowhr/ui";
import { useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { AlertTriangle, MailCheck } from "lucide-react";
import * as React from "react";
import { AuthLayout } from "../auth/auth-layout.tsx";
import { meQuery } from "../auth/session.ts";
import type { ProviderKind } from "../auth/types.ts";
import { RoutePending } from "../components/route-states.tsx";
import { ApiError, apiPost } from "../lib/api.ts";

interface Inspection {
  status: "valid" | "expired" | "used" | "revoked" | "unknown";
  organisation: { name: string; slug: string | null } | null;
  email: string | null;
  displayName: string | null;
  existingAccount: boolean;
  mfaRequired: boolean;
  passwordAllowed: boolean;
  providers: { id: string; kind: ProviderKind; displayName: string }[];
}

export const Route = createFileRoute("/invite/$token")({
  loader: ({ params }) => apiPost<Inspection>("/api/v1/auth/invitations/inspect", { token: params.token }),
  pendingComponent: () => (
    <div className="mx-auto max-w-sm p-10">
      <RoutePending />
    </div>
  ),
  errorComponent: () => (
    <AuthLayout title="Couldn't open this invitation">
      <Alert variant="danger">
        <AlertTriangle aria-hidden />
        <AlertDescription>The server didn't answer. Check your connection and reload the page.</AlertDescription>
      </Alert>
    </AuthLayout>
  ),
  component: AcceptInvitation,
});

const DEAD: Record<Exclude<Inspection["status"], "valid">, { title: string; body: string }> = {
  expired: { title: "This invitation has expired", body: "Invitations last 7 days. Ask your HR team to resend it." },
  used: { title: "Invitation already accepted", body: "This invitation was already used. Sign in instead." },
  revoked: {
    title: "Invitation withdrawn",
    body: "This invitation was replaced or withdrawn. Use the newest email or link from your HR team, or ask them to resend it.",
  },
  unknown: {
    title: "Invitation not found",
    body: "The link may be incomplete. Copy the whole link from your invitation, or ask your HR team to resend it.",
  },
};

function AcceptInvitation() {
  const info = Route.useLoaderData();
  const { token } = Route.useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [password, setPassword] = React.useState("");
  const [code, setCode] = React.useState("");
  const [confirm, setConfirm] = React.useState("");
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [failure, setFailure] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  if (info.status !== "valid") {
    const dead = DEAD[info.status];
    return (
      <AuthLayout
        title={dead.title}
        description={info.organisation?.name ? `Your invitation to ${info.organisation.name}.` : undefined}
      >
        <Alert variant="warning" data-testid="invite-state">
          <AlertTriangle aria-hidden />
          <AlertDescription>{dead.body}</AlertDescription>
        </Alert>
        {info.status === "used" && info.organisation?.slug ? (
          <Button
            variant="secondary"
            className="mt-4 self-start"
            onClick={() => navigate({ to: "/sign-in/$org", params: { org: info.organisation?.slug as string } })}
          >
            Go to sign in
          </Button>
        ) : null}
      </AuthLayout>
    );
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const next: Record<string, string> = {};
    if (!password) next.password = "Choose a password of at least 12 characters.";
    else if (!info.existingAccount && password.length < 12)
      next.password = "Use at least 12 characters. A short phrase of a few unrelated words works well.";
    if (!info.existingAccount && password !== confirm)
      next.confirm = "The two passwords don't match. Type the same password twice.";
    if (info.mfaRequired && !code.trim()) next.code = "Enter your authenticator code or a recovery code.";
    setErrors(next);
    if (Object.keys(next).length) return;
    setBusy(true);
    setFailure(null);
    try {
      await apiPost("/api/v1/auth/invitations/accept", {
        token,
        password,
        ...(code.trim() ? { code: code.trim() } : {}),
      });
      await qc.invalidateQueries({ queryKey: meQuery.queryKey });
      await navigate({ to: "/" });
    } catch (err) {
      if (err instanceof ApiError && err.code === "validation_failed") setErrors(err.fieldErrors);
      else setFailure(err instanceof ApiError ? err.message : "Couldn't accept the invitation. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthLayout
      title={`Join ${info.organisation?.name ?? "your organisation"}`}
      description={
        <>
          You've been invited as <span className="font-medium text-ink">{info.email}</span>.
          {info.existingAccount
            ? " You already use Crow HR elsewhere: confirm with your existing password."
            : " Choose how you'll sign in."}
        </>
      }
    >
      {failure ? (
        <Alert variant="danger" className="mb-5">
          <AlertTriangle aria-hidden />
          <div>
            <AlertTitle>Not accepted</AlertTitle>
            <AlertDescription>{failure}</AlertDescription>
          </div>
        </Alert>
      ) : null}
      {info.providers.length ? (
        <div className="mb-6 flex flex-col gap-3">
          {info.providers.map((p) => (
            <ProviderButton
              key={p.id}
              provider={p.kind === "entra" ? "microsoft" : p.kind}
              oidcName={p.kind === "oidc" ? p.displayName : undefined}
              onClick={() =>
                window.location.assign(`/api/v1/auth/oidc/${p.id}/start?invitation=${encodeURIComponent(token)}`)
              }
            />
          ))}
        </div>
      ) : null}
      {info.passwordAllowed ? (
        <form noValidate onSubmit={submit} className="flex flex-col gap-4" aria-label="Accept with a password">
          <FormField
            label={info.existingAccount ? "Your Crow HR password" : "Choose a password"}
            error={errors.password}
            hint={
              info.existingAccount
                ? undefined
                : "At least 12 characters. A few unrelated words work well; no symbols needed."
            }
          >
            <Input
              type="password"
              autoComplete={info.existingAccount ? "current-password" : "new-password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </FormField>
          {info.existingAccount ? null : (
            <FormField label="Type it again" error={errors.confirm}>
              <Input
                type="password"
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
              />
            </FormField>
          )}
          {info.mfaRequired ? (
            <FormField label="Authenticator or recovery code" error={errors.code}>
              <Input autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} />
            </FormField>
          ) : null}
          <Button type="submit" variant="primary" size="lg" disabled={busy}>
            {busy ? "Joining…" : "Accept and sign in"}
          </Button>
        </form>
      ) : (
        <Alert variant="info">
          <MailCheck aria-hidden />
          <AlertDescription>
            This organisation signs in with single sign-on. Use a button above to accept.
          </AlertDescription>
        </Alert>
      )}
    </AuthLayout>
  );
}
