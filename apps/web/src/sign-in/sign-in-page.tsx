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
import { ApiError, apiPost } from "../lib/api.ts";
import { DemoPersonaPicker } from "./demo-personas.tsx";
import type { SignInNotice } from "./notices.ts";

const EMAIL_RE = /^\S+@\S+\.\S+$/;

export type { SignInNotice } from "./notices.ts";
export { noticeFor } from "./notices.ts";

export function SignInPage({
  methods,
  orgSlug,
  nativeRequestId,
  initialNotice,
}: {
  methods: SignInMethods;
  orgSlug: string;
  nativeRequestId?: string;
  initialNotice: SignInNotice | null;
}) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const orgName = methods.organisation?.name ?? orgSlug;
  const [notice, setNotice] = React.useState<SignInNotice | null>(initialNotice);
  const [showOwnerLogin, setShowOwnerLogin] = React.useState(false);
  const [step, setStep] = React.useState<{ kind: "credentials" } | { kind: "mfa"; token: string }>({
    kind: "credentials",
  });
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [code, setCode] = React.useState("");
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string>>({});
  const [busy, setBusy] = React.useState(false);
  const [resetOpen, setResetOpen] = React.useState(false);

  const providers = methods.providers;
  const passwordVisible = methods.password.enabled || showOwnerLogin;
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
    } finally {
      setBusy(false);
    }
  };

  const ssoHref = (id: string) => `/api/v1/auth/oidc/${id}/start${nativeRequestId ? `?native=${nativeRequestId}` : ""}`;

  return (
    <div className="grid min-h-dvh lg:grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)]">
      <main className="flex flex-col px-5 py-6 sm:px-10">
        <Wordmark />
        <div className="mx-auto flex w-full max-w-[380px] flex-1 flex-col justify-center py-10">
          <p
            className="mb-2 font-azeret text-2xs font-medium uppercase tracking-wider text-primary-200"
            data-testid="org-name"
          >
            {orgName}
          </p>
          <h1 className="mb-1 text-2xl font-semibold leading-8">
            {step.kind === "mfa" ? "Two-step verification" : "Sign in"}
          </h1>
          <p className="mb-7 text-ui text-primary-300">
            {step.kind === "mfa"
              ? "Enter the 6-digit code from your authenticator app. Lost your phone? Use one of your recovery codes."
              : nativeRequestId
                ? "Sign in to connect the Crow HR app. You'll return to the app afterwards."
                : providers.length
                  ? "Use the method your organisation has set up."
                  : "Sign in with your work email and password."}
          </p>

          {notice ? (
            <Alert variant={notice.tone} className="mb-6" data-testid="sign-in-notice">
              {notice.tone === "danger" ? <AlertTriangle aria-hidden /> : <Info aria-hidden />}
              <div>
                <AlertTitle>{notice.title}</AlertTitle>
                <AlertDescription>{notice.body}</AlertDescription>
              </div>
            </Alert>
          ) : null}

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
              {methods.demoMode && !nativeRequestId ? <DemoPersonaPicker /> : null}
              {providers.length ? (
                <div className="flex flex-col gap-3" data-testid="sso-methods">
                  {providers.map((p) =>
                    methods.demoMode ? (
                      <ProviderButton
                        key={p.id}
                        provider={p.kind === "entra" ? "microsoft" : p.kind}
                        oidcName={p.kind === "oidc" ? p.displayName : undefined}
                        disabled
                        title="Not available in the demo."
                      />
                    ) : (
                      <ProviderButton
                        key={p.id}
                        provider={p.kind === "entra" ? "microsoft" : p.kind}
                        oidcName={p.kind === "oidc" ? p.displayName : undefined}
                        onClick={() => window.location.assign(ssoHref(p.id))}
                      />
                    ),
                  )}
                  {methods.demoMode ? (
                    <p className="text-2xs text-primary-300">
                      Not available in the demo. Self-hosted installs can enable this in Settings → Security.
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
                  <span className="font-azeret text-[10px] uppercase tracking-[0.14em] text-primary-200">
                    or with email
                  </span>
                  <span className="h-px flex-1 bg-border" />
                </div>
              ) : null}

              {passwordVisible ? (
                <form noValidate onSubmit={onSubmit} className="flex flex-col gap-4" aria-label="Sign in with email">
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

              {!methods.password.enabled && !showOwnerLogin ? (
                <button
                  type="button"
                  onClick={() => setShowOwnerLogin(true)}
                  className="focus-ring mt-6 self-start rounded-sm text-2xs font-medium text-primary-300 underline-offset-4 hover:text-ink hover:underline"
                >
                  Organisation owner? Sign in with password
                </button>
              ) : null}

              {!providers.length && !methods.password.enabled && !showOwnerLogin ? (
                <p className="text-ui text-primary-300">No sign-in method is available. Ask your organisation owner.</p>
              ) : null}
            </>
          )}
        </div>
        <footer className="flex flex-wrap gap-x-4 gap-y-1 font-azeret text-[10px] uppercase tracking-wider text-primary-200">
          <span>Crow HR</span>
          <span>Self-hosted</span>
          <span>MIT licensed</span>
        </footer>
      </main>

      <aside
        aria-hidden
        className="relative hidden flex-col overflow-hidden border-l border-border bg-surface-100 p-10 lg:flex xl:p-14"
      >
        <p className="font-azeret text-2xs font-medium uppercase tracking-wider text-primary-300">
          HR and payroll for Singapore teams
        </p>
        {/* Copy and payslip read as one block, centred in the panel (no stretched gap between them). */}
        <div className="my-auto flex flex-col gap-10 pt-10">
          <div className="max-w-md">
            <p className="font-azeret text-[28px] font-semibold leading-[1.2] tracking-tight text-ink xl:text-[32px]">
              Payroll that shows its working.
            </p>
            <p className="mt-4 max-w-sm text-sm leading-6 text-primary-300">
              Built so every CPF, SDL and levy figure can be traced to the rule and the date it came from. Your data
              stays on your own server.
            </p>
          </div>
          <SamplePayslipStrip />
        </div>
      </aside>

      <ResetRequestDialog open={resetOpen} onOpenChange={setResetOpen} orgSlug={orgSlug} defaultEmail={email} />
    </div>
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
                : "Email isn't set up on this server, so no link can be sent. Ask your HR admin or an owner to create a reset link for you in Settings → Members and roles."}
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

/** Decorative: a fragment of a payslip breakdown in the brand style (no real numbers). */
function SamplePayslipStrip() {
  const rows = [
    ["Basic salary", "4,200.00"],
    ["Overtime, 6.5 h", "312.50"],
    ["Transport claim", "86.40"],
    ["Gross pay", "4,598.90"],
  ];
  return (
    <div className="w-full max-w-sm rounded-lg border-2 border-ink bg-surface-50 shadow-brutal">
      <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
        <span className="font-azeret text-2xs font-semibold uppercase tracking-wider">Payslip · Oct 2026</span>
        <span className="rounded-sm bg-kuning-200 px-1.5 py-px font-azeret text-[10px] font-bold">SAMPLE</span>
      </div>
      <dl className="px-4 py-2">
        {rows.map(([k, v], i) => (
          <div
            key={k}
            className={`flex justify-between py-1.5 text-ui ${i === rows.length - 1 ? "mt-1 border-t border-ink/20 pt-2.5 font-semibold" : ""}`}
          >
            <dt>{k}</dt>
            <dd className="num">S${v}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
