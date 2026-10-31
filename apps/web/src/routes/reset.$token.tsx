import { Alert, AlertDescription, AlertTitle, Button, FormField, Input } from "@crowhr/ui";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { AlertTriangle } from "lucide-react";
import * as React from "react";
import { AuthLayout } from "../auth/auth-layout.tsx";
import { RoutePending } from "../components/route-states.tsx";
import { ApiError, apiPost } from "../lib/api.ts";

export const Route = createFileRoute("/reset/$token")({
  loader: ({ params }) =>
    apiPost<{ status: "valid" | "expired_or_used"; orgSlug: string | null }>("/api/v1/auth/password-reset/inspect", {
      token: params.token,
    }),
  pendingComponent: () => (
    <div className="mx-auto max-w-sm p-10">
      <RoutePending />
    </div>
  ),
  errorComponent: () => (
    <AuthLayout title="Couldn't open this link">
      <Alert variant="danger">
        <AlertTriangle aria-hidden />
        <AlertDescription>The server didn't answer. Check your connection and reload the page.</AlertDescription>
      </Alert>
    </AuthLayout>
  ),
  component: ResetPassword,
});

function ResetPassword() {
  const info = Route.useLoaderData();
  const { token } = Route.useParams();
  const navigate = useNavigate();
  const [password, setPassword] = React.useState("");
  const [confirm, setConfirm] = React.useState("");
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [failure, setFailure] = React.useState<string | null>(info.status === "valid" ? null : "expired");
  const [busy, setBusy] = React.useState(false);

  if (failure === "expired") {
    return (
      <AuthLayout title="This link has expired or was already used">
        <Alert variant="warning" data-testid="reset-state">
          <AlertTriangle aria-hidden />
          <AlertDescription>
            Reset links work once, for 60 minutes. Request a new one from the sign-in page with "Forgot password?".
          </AlertDescription>
        </Alert>
        <Button
          variant="secondary"
          className="mt-4 self-start"
          onClick={() =>
            info.orgSlug
              ? navigate({ to: "/sign-in/$org", params: { org: info.orgSlug } })
              : navigate({ to: "/sign-in" })
          }
        >
          Request a new link
        </Button>
      </AuthLayout>
    );
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const next: Record<string, string> = {};
    if (password.length < 12)
      next.password = "Use at least 12 characters. A short phrase of a few unrelated words works well.";
    if (password !== confirm) next.confirm = "The two passwords don't match. Type the same password twice.";
    setErrors(next);
    if (Object.keys(next).length) return;
    setBusy(true);
    try {
      const { orgSlug } = await apiPost<{ orgSlug: string | null }>("/api/v1/auth/password-reset/complete", {
        token,
        password,
      });
      await navigate(
        orgSlug ? { to: "/sign-in/$org", params: { org: orgSlug }, search: { reset: "done" } } : { to: "/sign-in" },
      );
    } catch (err) {
      if (err instanceof ApiError && err.code === "validation_failed") setErrors(err.fieldErrors);
      else if (err instanceof ApiError && err.code === "conflict") setFailure("expired");
      else setFailure(err instanceof ApiError ? err.message : "Couldn't change the password. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthLayout
      title="Choose a new password"
      description="You'll be signed out on every device and can then sign in with the new password."
    >
      {failure ? (
        <Alert variant="danger" className="mb-5">
          <AlertTriangle aria-hidden />
          <div>
            <AlertTitle>Not changed</AlertTitle>
            <AlertDescription>{failure}</AlertDescription>
          </div>
        </Alert>
      ) : null}
      <form noValidate onSubmit={submit} className="flex flex-col gap-4">
        <FormField
          label="New password"
          error={errors.password}
          hint="At least 12 characters. Avoid common passwords and your email address."
        >
          <Input
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoFocus
          />
        </FormField>
        <FormField label="Type it again" error={errors.confirm}>
          <Input
            type="password"
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />
        </FormField>
        <Button type="submit" variant="primary" size="lg" disabled={busy}>
          {busy ? "Saving…" : "Change password"}
        </Button>
      </form>
    </AuthLayout>
  );
}
