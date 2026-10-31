import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Checkbox,
  FormField,
  Input,
  Label,
  ProviderButton,
} from "@crowhr/ui";
import { Info } from "lucide-react";
import * as React from "react";
import { Wordmark } from "../components/wordmark.tsx";
import { SAMPLE_ORG } from "../fixtures/session.ts";
import type { SignInMethod } from "./methods.ts";

const PROVIDER_NAME = {
  google: "Google",
  microsoft: "Microsoft",
  singpass: "Singpass",
  oidc: "Single sign-on",
} as const;

export function SignInPage({ methods, orgName = SAMPLE_ORG.name }: { methods: SignInMethod[]; orgName?: string }) {
  const [notice, setNotice] = React.useState<string | null>(null);
  const [showOwnerLogin, setShowOwnerLogin] = React.useState(false);
  const [email, setEmail] = React.useState("");
  const [emailError, setEmailError] = React.useState<string | null>(null);

  const password = methods.find((m) => m.type === "password");
  const providers = methods.filter((m) => m.type !== "password");
  const googleDomain = methods.find((m) => m.type === "google")?.hostedDomain;
  const passwordVisible = password ? password.staffEnabled || showOwnerLogin : false;

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) {
      setEmailError("Enter your work email address, like name@company.sg.");
      return;
    }
    setEmailError(null);
    // NOT IMPLEMENTED: authentication. Nothing is sent anywhere.
    setNotice("Sign-in isn't available yet. Authentication is still being built, so this form doesn't send anything.");
  };

  const onProvider = (type: keyof typeof PROVIDER_NAME) => {
    // NOT IMPLEMENTED: OIDC flows (openid-client) belong to the auth workstream.
    setNotice(
      type === "singpass"
        ? "Singpass isn't set up yet. Your company must first be onboarded as a Singpass relying party, then an owner connects it in Settings → Security."
        : `${PROVIDER_NAME[type]} sign-in isn't available yet. An owner will be able to connect it in Settings → Security.`,
    );
  };

  return (
    <div className="grid min-h-dvh lg:grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)]">
      <main className="flex flex-col px-5 py-6 sm:px-10">
        <Wordmark />
        <div className="mx-auto flex w-full max-w-[380px] flex-1 flex-col justify-center py-10">
          <p className="mb-2 font-azeret text-2xs font-medium uppercase tracking-wider text-primary-200">{orgName}</p>
          <h1 className="mb-1 text-2xl font-semibold leading-8">Sign in</h1>
          <p className="mb-7 text-ui text-primary-300">Use the method your organisation has set up.</p>

          {notice ? (
            <Alert variant="info" className="mb-6" role="status" data-testid="sign-in-notice">
              <Info aria-hidden />
              <div>
                <AlertTitle>Not available yet</AlertTitle>
                <AlertDescription>{notice}</AlertDescription>
              </div>
            </Alert>
          ) : null}

          {providers.length ? (
            <div className="flex flex-col gap-3" data-testid="sso-methods">
              {providers.map((m) => (
                <ProviderButton
                  key={m.type}
                  provider={m.type}
                  oidcName={m.type === "oidc" ? m.displayName : undefined}
                  onClick={() => onProvider(m.type)}
                />
              ))}
              {googleDomain ? (
                <p className="text-2xs text-primary-200">
                  Google sign-in accepts <span className="num">@{googleDomain}</span> accounts only.
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
              <FormField label="Work email" error={emailError}>
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
                labelAside={
                  <button
                    type="button"
                    className="focus-ring rounded-sm text-2xs font-medium text-biru-400 hover:underline"
                    onClick={() =>
                      setNotice("Password reset isn't available yet. Ask your HR administrator for help signing in.")
                    }
                  >
                    Forgot password?
                  </button>
                }
              >
                <Input type="password" autoComplete="current-password" />
              </FormField>
              <div className="flex items-center gap-2">
                <Checkbox id="remember" />
                <Label htmlFor="remember" className="font-sans text-ui font-normal">
                  Keep me signed in on this device
                </Label>
              </div>
              <Button type="submit" variant="primary" size="lg" className="mt-1 w-full">
                Sign in
              </Button>
            </form>
          ) : null}

          {password && !password.staffEnabled && !showOwnerLogin ? (
            <button
              type="button"
              onClick={() => setShowOwnerLogin(true)}
              className="focus-ring mt-6 self-start rounded-sm text-2xs font-medium text-primary-300 underline-offset-4 hover:text-ink hover:underline"
            >
              Organisation owner? Sign in with password
            </button>
          ) : null}
        </div>
        <footer className="flex flex-wrap gap-x-4 gap-y-1 font-azeret text-[10px] uppercase tracking-wider text-primary-200">
          <span>Crow HR</span>
          <span>Self-hosted</span>
          <span>MIT licensed</span>
        </footer>
      </main>

      <aside
        aria-hidden
        className="relative hidden flex-col justify-between overflow-hidden border-l border-border bg-surface-100 p-10 lg:flex xl:p-14"
      >
        <p className="font-azeret text-2xs font-medium uppercase tracking-wider text-primary-300">
          HR and payroll for Singapore teams
        </p>
        <div className="max-w-md">
          <p className="font-azeret text-[28px] font-semibold leading-[1.2] tracking-tight text-ink xl:text-[32px]">
            Payroll that shows its working.
          </p>
          <p className="mt-4 max-w-sm text-sm leading-6 text-primary-300">
            Built so every CPF, SDL and levy figure can be traced to the rule and the date it came from. Your data stays
            on your own server.
          </p>
        </div>
        <SamplePayslipStrip />
      </aside>
    </div>
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
