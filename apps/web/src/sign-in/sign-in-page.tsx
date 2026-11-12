import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  FormField,
  Input,
  ProviderButton,
} from "@crowhr/ui";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { AlertTriangle, Info, KeyRound } from "lucide-react";
import * as React from "react";
import { meQuery } from "../auth/session.ts";
import type { SignInMethods, SignInResult } from "../auth/types.ts";
import { Wordmark } from "../components/wordmark.tsx";
import { DemoCompanyNotice } from "../demo-company/notices.tsx";
import { ApiError, apiPost } from "../lib/api.ts";
import { shellExtensions } from "../shell/extensions.ts";
import { DEMO_SINGPASS_PERSONAS, DemoPersonaPicker } from "./demo-personas.tsx";
import type { SignInNotice } from "./notices.ts";

const EMAIL_RE = /^\S+@\S+\.\S+$/;

export type { SignInNotice } from "./notices.ts";
export { noticeFor } from "./notices.ts";

export function SignInPage({
  methods,
  orgSlug,
  nativeRequestId,
  initialNotice,
  ssoMfaPending = false,
  demoSingpassOk = false,
}: {
  methods: SignInMethods;
  orgSlug: string;
  nativeRequestId?: string;
  initialNotice: SignInNotice | null;
  ssoMfaPending?: boolean;
  /** Demo only: back from a real Singpass login, so offer HR admin or Employee. */
  demoSingpassOk?: boolean;
}) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const orgName = methods.organisation?.name ?? orgSlug;
  const [notice, setNotice] = React.useState<SignInNotice | null>(initialNotice);
  // A failed email sign-in shows its message in the form, beside the fields: at the top of the page
  // it would be off screen on a phone, above the demo personas or single sign-on buttons.
  const [noticeAtForm, setNoticeAtForm] = React.useState(false);
  const [showOwnerLogin, setShowOwnerLogin] = React.useState(false);
  const [step, setStep] = React.useState<{ kind: "credentials" } | { kind: "mfa"; token?: string }>({
    kind: ssoMfaPending ? "mfa" : "credentials",
  });
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [code, setCode] = React.useState("");
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string>>({});
  const [busy, setBusy] = React.useState(false);
  const [resetOpen, setResetOpen] = React.useState(false);

  const providers = methods.providers;
  const demoSingpassStartUrl = methods.demoMode ? shellExtensions.demoSingpassStartUrl : undefined;
  // A demo company's people have no passwords: they are picked (demo-companies decision 5).
  const demoCompany = methods.demoCompany;
  const passwordVisible = !demoCompany && (methods.password.enabled || showOwnerLogin);
  const googleDomains = providers.find((p) => p.kind === "google")?.allowedDomains ?? [];

  const finish = async (result: SignInResult) => {
    if (result.redirectTo) {
      window.location.assign(result.redirectTo);
      return;
    }
    if (result.mfaRequired && result.mfaToken) {
      setStep({ kind: "mfa", token: result.mfaToken });
      setNotice(null);
      return;
    }
    await qc.invalidateQueries({ queryKey: meQuery.queryKey });
    await navigate({ to: "/" });
  };

  const handleError = (err: unknown) => {
    if (!(err instanceof ApiError)) {
      setNotice({ tone: "danger", title: "Couldn't reach the server", body: "Check your connection and try again." });
      return;
    }
    if (err.code === "validation_failed") {
      setFieldErrors(err.fieldErrors);
      return;
    }
    const restart = (err.envelope?.error.details as { restart?: boolean } | undefined)?.restart;
    if (restart) setStep({ kind: "credentials" });
    setNotice({
      tone: err.code === "password_sign_in_disabled" ? "info" : "danger",
      title:
        err.code === "invalid_mfa_code"
          ? "Code not accepted"
          : err.code === "rate_limited"
            ? "Too many attempts"
            : err.code === "password_sign_in_disabled"
              ? "Use single sign-on"
              : "Sign-in failed",
      body: err.message,
    });
  };

  const onSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const errors: Record<string, string> = {};
    if (!EMAIL_RE.test(email.trim())) errors.email = "Enter your work email address, like name@company.sg.";
    if (!password) errors.password = "Enter your password.";
    setFieldErrors(errors);
    if (Object.keys(errors).length) return;
    setBusy(true);
    try {
      await finish(
        await apiPost<SignInResult>("/api/v1/auth/sign-in", {
          org: orgSlug,
          email: email.trim(),
          password,
          ...(nativeRequestId ? { nativeRequestId } : {}),
        }),
      );
    } catch (err) {
      handleError(err);
      setNoticeAtForm(true);
    } finally {
      setBusy(false);
    }
  };

  const onMfa = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (step.kind !== "mfa") return;
    if (code.trim().length < 6) {
      setFieldErrors({ code: "Enter the 6-digit code from your authenticator app, or a recovery code." });
      return;
    }
    setBusy(true);
    try {
      await finish(await apiPost<SignInResult>("/api/v1/auth/mfa/verify", { mfaToken: step.token, code: code.trim() }));
    } catch (err) {
      setCode("");
      handleError(err);
      setNoticeAtForm(false);
    } finally {
      setBusy(false);
    }
  };

  const ssoHref = (id: string) => `/api/v1/auth/oidc/${id}/start${nativeRequestId ? `?native=${nativeRequestId}` : ""}`;

  return (
    // One calm column, like the other sign-in screens (auth-layout.tsx): the organisation's name, then
    // only the methods it has enabled. Every member of staff sees this page, so it carries no product pitch.
    <main className="flex min-h-dvh flex-col px-5 py-6 sm:px-10">
      <Wordmark />
      <div className="mx-auto flex w-full max-w-[400px] flex-1 flex-col justify-center py-10">
        <h1 className="mb-1 text-2xl font-semibold leading-8" data-testid="org-name">
          {orgName}
        </h1>
        {step.kind === "mfa" ? (
          <h2 className="mt-3 mb-1 font-azeret text-base font-semibold">Two-step verification</h2>
        ) : null}
        <p className="mb-7 text-ui text-primary-300">
          {step.kind === "mfa"
            ? "Enter the 6-digit code from your authenticator app. Lost your phone? Use one of your recovery codes."
            : demoCompany
              ? nativeRequestId
                ? "Pick who the Crow HR app signs in as. You'll return to the app afterwards."
                : "Pick who to be. No password: everyone here is fictional."
              : nativeRequestId
                ? "Sign in to connect the Crow HR app. You'll return to the app afterwards."
                : methods.demoMode
                  ? "Sign in as one of the fictional staff below, or with email."
                  : providers.length
                    ? "Sign in with the method your organisation has set up."
                    : "Sign in with your work email and password."}
        </p>
        {demoCompany && step.kind !== "mfa" ? <DemoCompanyNotice expiresAt={demoCompany.expiresAt} /> : null}

        {notice && !(noticeAtForm && step.kind === "credentials" && passwordVisible)
          ? noticeAlert(notice, "mb-6")
          : null}

        {step.kind === "mfa" ? (
          <form noValidate onSubmit={onMfa} className="flex flex-col gap-4" aria-label="Two-step verification">
            <FormField
              label="Authenticator code"
              error={fieldErrors.code}
              hint="Codes change every 30 seconds. Recovery codes look like ABCDE-23456."
            >
              <Input
                autoFocus
                autoComplete="one-time-code"
                inputMode="text"
                className="num tracking-[0.2em]"
                value={code}
                onChange={(e) => setCode(e.target.value)}
              />
            </FormField>
            <Button type="submit" variant="primary" size="lg" className="mt-1 w-full" disabled={busy}>
              {busy ? "Checking…" : "Verify and sign in"}
            </Button>
            <button
              type="button"
              className="focus-ring self-start rounded-sm text-2xs font-medium text-primary-300 hover:text-ink hover:underline"
              onClick={() => {
                setStep({ kind: "credentials" });
                setCode("");
              }}
            >
              Start again with a different account
            </button>
          </form>
        ) : (
          <>
            {demoCompany ? (
              <DemoPersonaPicker
                demoCompany={{ orgSlug, nativeRequestId }}
                title="Sign in as"
                intro={
                  nativeRequestId
                    ? "One tap signs the app in as this person of your demo company."
                    : "One tap signs you in as this person of your demo company. Each sees what their role allows."
                }
              />
            ) : methods.demoMode && !nativeRequestId && demoSingpassOk ? (
              <DemoPersonaPicker
                only={DEMO_SINGPASS_PERSONAS}
                title="Logged in with Singpass"
                intro="The demo doesn't keep who you are. Choose how you want to look around:"
              />
            ) : methods.demoMode && !nativeRequestId ? (
              <DemoPersonaPicker />
            ) : null}
            {providers.length ? (
              <div className="flex flex-col gap-3" data-testid="sso-methods">
                {providers.map((p) => {
                  const common = {
                    provider: p.kind === "entra" ? ("microsoft" as const) : p.kind,
                    oidcName: p.kind === "oidc" ? p.displayName : undefined,
                    singpassLogoSrc: p.kind === "singpass" ? (methods.singpassLogoUrl ?? undefined) : undefined,
                  };
                  if (!methods.demoMode)
                    return (
                      <ProviderButton key={p.id} {...common} onClick={() => window.location.assign(ssoHref(p.id))} />
                    );
                  // Demo: only Singpass can work, through a real Crow HR server (see demoSingpassStartUrl).
                  const startUrl = p.kind === "singpass" ? demoSingpassStartUrl : undefined;
                  return startUrl ? (
                    <ProviderButton key={p.id} {...common} onClick={() => window.location.assign(startUrl)} />
                  ) : (
                    <ProviderButton key={p.id} {...common} disabled title="Not available in the demo." />
                  );
                })}
                {methods.demoMode ? (
                  <p className="text-2xs text-primary-300">
                    {demoSingpassStartUrl && providers.some((p) => p.kind === "singpass")
                      ? "Singpass works in the demo: log in for real, then choose HR admin or Employee. The demo doesn't keep who you are. The other methods are not available in the demo."
                      : "Not available in the demo. Self-hosted installs can enable this in Settings → Security."}
                  </p>
                ) : null}
                {googleDomains.length ? (
                  <p className="text-2xs text-primary-200">
                    Google sign-in accepts <span className="num">{googleDomains.map((d) => `@${d}`).join(", ")}</span>{" "}
                    accounts only.
                  </p>
                ) : null}
              </div>
            ) : null}

            {providers.length && passwordVisible ? (
              <div className="my-6 flex items-center gap-3" aria-hidden>
                <span className="h-px flex-1 bg-border" />
                <span className="text-2xs text-primary-300">or with email</span>
                <span className="h-px flex-1 bg-border" />
              </div>
            ) : null}

            {passwordVisible ? (
              <form noValidate onSubmit={onSubmit} className="flex flex-col gap-4" aria-label="Sign in with email">
                {notice && noticeAtForm ? noticeAlert(notice) : null}
                <FormField label="Work email" error={fieldErrors.email}>
                  <Input
                    type="email"
                    autoComplete="username"
                    inputMode="email"
                    placeholder="name@company.sg"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </FormField>
                <FormField
                  label="Password"
                  error={fieldErrors.password}
                  labelAside={
                    <button
                      type="button"
                      className="focus-ring rounded-sm text-2xs font-medium text-biru-400 hover:underline"
                      onClick={() => setResetOpen(true)}
                    >
                      Forgot password?
                    </button>
                  }
                >
                  <Input
                    type="password"
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </FormField>
                <Button type="submit" variant="primary" size="lg" className="mt-1 w-full" disabled={busy}>
                  {busy ? "Signing in…" : "Sign in"}
                </Button>
              </form>
            ) : null}

            {!demoCompany && !methods.password.enabled && !showOwnerLogin ? (
              <button
                type="button"
                onClick={() => setShowOwnerLogin(true)}
                className="focus-ring mt-6 self-start rounded-sm text-2xs font-medium text-primary-300 underline-offset-4 hover:text-ink hover:underline"
              >
                Organisation owner? Sign in with password
              </button>
            ) : null}

            {!demoCompany && !providers.length && !methods.password.enabled && !showOwnerLogin ? (
              <p className="text-ui text-primary-300">No sign-in method is available. Ask your organisation owner.</p>
            ) : null}
          </>
        )}
      </div>
      <ResetRequestDialog open={resetOpen} onOpenChange={setResetOpen} orgSlug={orgSlug} defaultEmail={email} />
    </main>
  );
}

function ResetRequestDialog({
  open,
  onOpenChange,
  orgSlug,
  defaultEmail,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  orgSlug: string;
  defaultEmail: string;
}) {
  const [email, setEmail] = React.useState(defaultEmail);
  const [error, setError] = React.useState<string | null>(null);
  const [result, setResult] = React.useState<{ emailConfigured: boolean } | null>(null);
  const [busy, setBusy] = React.useState(false);
  React.useEffect(() => {
    if (open) {
      setEmail(defaultEmail);
      setResult(null);
      setError(null);
    }
  }, [open, defaultEmail]);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!EMAIL_RE.test(email.trim())) {
      setError("Enter your work email address, like name@company.sg.");
      return;
    }
    setBusy(true);
    try {
      setResult(
        await apiPost<{ emailConfigured: boolean }>("/api/v1/auth/password-reset/request", {
          org: orgSlug,
          email: email.trim(),
        }),
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't send the request. Try again.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Reset your password</DialogTitle>
          <DialogDescription>
            We'll send a link that lets you choose a new password. It works once, for 60 minutes.
          </DialogDescription>
        </DialogHeader>
        {result ? (
          <Alert variant={result.emailConfigured ? "success" : "info"} data-testid="reset-requested">
            <KeyRound aria-hidden />
            <AlertDescription>
              {result.emailConfigured
                ? "If that email belongs to an account here, a reset link is on its way. Check your inbox and spam folder."
                : "Email isn't set up on this server, so no link can be sent. Ask an owner to create a reset link for you in Settings → Members and roles."}
            </AlertDescription>
          </Alert>
        ) : (
          <form id="reset-request" onSubmit={submit} noValidate>
            <FormField label="Work email" error={error}>
              <Input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} />
            </FormField>
          </form>
        )}
        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            {result ? "Close" : "Cancel"}
          </Button>
          {result ? null : (
            <Button variant="primary" type="submit" form="reset-request" disabled={busy}>
              {busy ? "Sending…" : "Send reset link"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function noticeAlert(notice: SignInNotice, className?: string) {
  return (
    <Alert variant={notice.tone} className={className} data-testid="sign-in-notice">
      {notice.tone === "danger" ? <AlertTriangle aria-hidden /> : <Info aria-hidden />}
      <div>
        <AlertTitle>{notice.title}</AlertTitle>
        <AlertDescription>{notice.body}</AlertDescription>
      </div>
    </Alert>
  );
}
