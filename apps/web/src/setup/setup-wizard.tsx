import { Alert, AlertDescription, AlertTitle, Button, FormField, Input, Skeleton } from "@crowhr/ui";
import { Link } from "@tanstack/react-router";
import { CircleAlert, CircleCheck, KeyRound, ShieldCheck } from "lucide-react";
import * as React from "react";
import { AssistantDisclosure } from "../assistant/settings.tsx";
import { AppearanceEditor } from "../branding/editor.tsx";
import { Wordmark } from "../components/wordmark.tsx";
import { useT } from "../i18n/index.ts";
import { LanguagePicker } from "../i18n/language-picker.tsx";
import { completeSetup, fetchSetupState, type SetupInput, type SetupState, verifySetupCode } from "./api.ts";

type Step = "code" | "organisation" | "owner" | "done";
const STEPS: { id: Exclude<Step, "done">; label: string }[] = [
  { id: "code", label: "Setup code" },
  { id: "organisation", label: "Company" },
  { id: "owner", label: "Owner account" },
];

/** Formats typed input as XXXX-XXXX-XXXX-XXXX (upper case, no look-alike fixing: the server tolerates it). */
function formatCode(raw: string): string {
  const clean = raw
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 16);
  return (clean.match(/.{1,4}/g) ?? []).join("-");
}

/**
 * First-run setup (self-hosting spec "First-run setup wizard"): the one-time code from the
 * container logs, the company's registered name, then the owner account. The server creates
 * both in one transaction and signs the owner in.
 */
export function SetupWizard() {
  const t = useT("settings-account");
  const [state, setState] = React.useState<SetupState | null>(null);
  const [step, setStep] = React.useState<Step>("code");
  const [code, setCode] = React.useState("");
  const [input, setInput] = React.useState<SetupInput>({
    organisationName: "",
    ownerName: "",
    ownerEmail: "",
    ownerPassword: "",
  });
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string>>({});
  const [formError, setFormError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [orgSlug, setOrgSlug] = React.useState<string | null>(null);

  React.useEffect(() => {
    void fetchSetupState().then(setState);
  }, []);

  const set = (key: keyof SetupInput) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setInput((v) => ({ ...v, [key]: e.target.value }));

  const onCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    if (code.replace(/-/g, "").length !== 16) {
      setFieldErrors({ code: t("The code has 16 letters and digits, like ACDE-FGHJ-KMNP-QRTU.") });
      return;
    }
    setBusy(true);
    const error = await verifySetupCode(code).catch(() => ({
      status: 0,
      code: "network",
      message: t("Cannot reach the server."),
      fields: {},
    }));
    setBusy(false);
    if (!error) {
      setFieldErrors({});
      setStep("organisation");
    } else if (error.status === 404) {
      setState({ kind: "done" });
    } else {
      setFieldErrors({ code: error.message });
    }
  };

  const onOrganisation = (e: React.FormEvent) => {
    e.preventDefault();
    if (input.organisationName.trim().length < 2) {
      setFieldErrors({ organisationName: t("Enter the company's registered name, as on ACRA BizFile.") });
      return;
    }
    setFieldErrors({});
    if (input.appearance?.accent && !/^#[\da-f]{6}$/i.test(input.appearance.accent)) {
      setFieldErrors({ "appearance.accent": t("Enter a hex colour like #165E85.") });
      return;
    }
    setStep("owner");
  };

  const onOwner = async (e: React.FormEvent) => {
    e.preventDefault();
    const local: Record<string, string> = {};
    if (!input.ownerName.trim()) local.ownerName = t("Enter your name.");
    if (!/^\S+@\S+\.\S+$/.test(input.ownerEmail.trim()))
      local.ownerEmail = t("Enter a valid email address, for example aisyah@acme.sg.");
    if ([...input.ownerPassword].length < 12)
      local.ownerPassword = t("Use at least 12 characters. A few random words work well.");
    setFieldErrors(local);
    if (Object.keys(local).length) return;
    setBusy(true);
    setFormError(null);
    const result = await completeSetup(code, input).catch(() => null);
    setBusy(false);
    if (!result) {
      setFormError(t("Cannot reach the server. Check that Crow HR is running, then try again."));
    } else if (result.ok) {
      setOrgSlug(result.organisationSlug);
      setStep("done");
    } else if (result.error.status === 401 || result.error.status === 429) {
      // The code changed (server restarted) or too many attempts: go back to the code step.
      setStep("code");
      setFieldErrors({ code: result.error.message });
    } else if (result.error.status === 404) {
      setState({ kind: "done" });
    } else if (Object.keys(result.error.fields).length) {
      setFieldErrors(result.error.fields);
      if (
        result.error.fields.organisationName ||
        Object.keys(result.error.fields).some((key) => key.startsWith("appearance."))
      )
        setStep("organisation");
    } else {
      setFormError(result.error.message);
    }
  };

  return (
    <div className="min-h-dvh bg-surface-50">
      <main className="mx-auto flex w-full max-w-[460px] flex-col px-5 py-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Wordmark />
          <LanguagePicker />
        </div>
        <div className="py-10">
          {state === null ? (
            <div className="flex flex-col gap-3" role="status" aria-busy="true" aria-label={t("Loading")}>
              <Skeleton className="h-8 w-2/3" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : state.kind === "error" ? (
            <Alert variant="danger" role="alert">
              <CircleAlert aria-hidden />
              <div>
                <AlertTitle>{t("Setup is not reachable")}</AlertTitle>
                <AlertDescription>{state.message}</AlertDescription>
              </div>
            </Alert>
          ) : state.kind === "done" && step !== "done" ? (
            <AlreadyDone />
          ) : step === "done" ? (
            <Done orgName={input.organisationName.trim()} slug={orgSlug} />
          ) : (
            <>
              <h1 className="mb-1 text-2xl font-semibold leading-8">{t("Set up Crow HR")}</h1>
              <p className="mb-6 text-ui text-primary-300">
                {t("Create your company and the owner account. This page disappears once you are done.")}
              </p>
              <ol className="mb-7 flex gap-2" aria-label={t("Setup steps")}>
                {STEPS.map((s, i) => {
                  const current = STEPS.findIndex((x) => x.id === step);
                  const status = i < current ? "done" : i === current ? "current" : "todo";
                  return (
                    <li
                      key={s.id}
                      aria-current={status === "current" ? "step" : undefined}
                      className={`flex-1 border-t-2 pt-2 font-azeret text-2xs font-medium ${
                        status === "todo" ? "border-ink/15 text-primary-200" : "border-ink text-ink"
                      }`}
                    >
                      <span className="num">{i + 1}</span> {t(s.label)}
                    </li>
                  );
                })}
              </ol>

              {formError ? (
                <Alert variant="danger" className="mb-5" role="alert">
                  <CircleAlert aria-hidden />
                  <AlertDescription>{formError}</AlertDescription>
                </Alert>
              ) : null}

              {step === "code" ? (
                <form noValidate onSubmit={onCode} className="flex flex-col gap-4" aria-label={t("Step 1 of 3")}>
                  <FormField
                    label={t("Setup code")}
                    hint={
                      <>
                        {t("Printed in the server log. Run")}{" "}
                        <code className="num rounded-sm bg-surface-100 px-1">docker compose logs app</code>{" "}
                        {t("and look for CROW HR SETUP CODE. A new code is printed each time the app restarts.")}
                      </>
                    }
                    error={fieldErrors.code}
                  >
                    <Input
                      className="num tracking-widest"
                      autoComplete="off"
                      autoCapitalize="characters"
                      spellCheck={false}
                      placeholder="XXXX-XXXX-XXXX-XXXX"
                      value={code}
                      onChange={(e) => setCode(formatCode(e.target.value))}
                      autoFocus
                    />
                  </FormField>
                  <Button type="submit" variant="primary" size="lg" disabled={busy}>
                    <KeyRound aria-hidden />
                    {busy ? t("Checking…") : t("Continue")}
                  </Button>
                </form>
              ) : step === "organisation" ? (
                <form
                  noValidate
                  onSubmit={onOrganisation}
                  className="flex flex-col gap-4"
                  aria-label={t("Step 2 of 3")}
                >
                  <FormField
                    label={t("Company's registered name")}
                    hint={t("As on ACRA BizFile, e.g. Kampong Kopi Pte. Ltd. You can add the UEN and address later.")}
                    error={fieldErrors.organisationName}
                  >
                    <Input
                      autoComplete="organization"
                      value={input.organisationName}
                      onChange={set("organisationName")}
                      autoFocus
                    />
                  </FormField>
                  <AppearanceEditor
                    name={input.organisationName || t("Company")}
                    value={input.appearance ?? { accent: null, useDocumentLogo: false }}
                    onChange={(appearance) => setInput((input) => ({ ...input, appearance }))}
                    error={fieldErrors["appearance.accent"]}
                  />
                  {state.kind === "required" && state.assistantAvailable ? (
                    <div className="flex flex-col gap-2">
                      <label className="flex items-center gap-2 text-ui font-medium">
                        <input
                          type="checkbox"
                          className="focus-ring size-4 accent-ink"
                          checked={input.enableAssistant ?? false}
                          onChange={(e) => setInput((input) => ({ ...input, enableAssistant: e.target.checked }))}
                        />
                        {t("Enable AI assistant connections")}
                      </label>
                      <AssistantDisclosure />
                    </div>
                  ) : null}
                  <div className="flex gap-2">
                    <Button type="button" variant="secondary" size="lg" onClick={() => setStep("code")}>
                      {t("Back")}
                    </Button>
                    <Button type="submit" variant="primary" size="lg" className="flex-1">
                      {t("Continue")}
                    </Button>
                  </div>
                </form>
              ) : (
                <form noValidate onSubmit={onOwner} className="flex flex-col gap-4" aria-label={t("Step 3 of 3")}>
                  <p className="text-ui text-primary-300">
                    {t(
                      "The owner can do everything, including payroll and security settings. You can add HR and payroll admins later.",
                    )}
                  </p>
                  <FormField label={t("Your name")} error={fieldErrors.ownerName}>
                    <Input autoComplete="name" value={input.ownerName} onChange={set("ownerName")} autoFocus />
                  </FormField>
                  <FormField label={t("Work email")} error={fieldErrors.ownerEmail}>
                    <Input
                      type="email"
                      inputMode="email"
                      autoComplete="username"
                      placeholder="name@company.sg"
                      value={input.ownerEmail}
                      onChange={set("ownerEmail")}
                    />
                  </FormField>
                  <FormField
                    label={t("Password")}
                    hint={t("At least 12 characters. A few random words are easy to remember and hard to guess.")}
                    error={fieldErrors.ownerPassword}
                  >
                    <Input
                      type="password"
                      autoComplete="new-password"
                      value={input.ownerPassword}
                      onChange={set("ownerPassword")}
                    />
                  </FormField>
                  <div className="flex gap-2">
                    <Button type="button" variant="secondary" size="lg" onClick={() => setStep("organisation")}>
                      {t("Back")}
                    </Button>
                    <Button type="submit" variant="primary" size="lg" className="flex-1" disabled={busy}>
                      {busy ? t("Creating…") : t("Create company and owner")}
                    </Button>
                  </div>
                </form>
              )}
            </>
          )}
        </div>
      </main>
    </div>
  );
}

function AlreadyDone() {
  const t = useT("settings-account");
  return (
    <div data-testid="setup-already-done">
      <h1 className="mb-1 text-2xl font-semibold leading-8">{t("Setup is complete")}</h1>
      <p className="mb-6 text-ui text-primary-300">
        {t("This Crow HR server already has an organisation and an owner.")}
      </p>
      <Button asChild variant="primary" size="lg">
        <Link to="/sign-in">{t("Go to sign-in")}</Link>
      </Button>
    </div>
  );
}

function Done({ orgName, slug }: { orgName: string; slug: string | null }) {
  const t = useT("settings-account");
  return (
    <div data-testid="setup-done">
      <Alert variant="success" className="mb-6" role="status">
        <CircleCheck aria-hidden />
        <div>
          <AlertTitle>{t("{orgName} is set up", { orgName })}</AlertTitle>
          <AlertDescription>
            {t("You are signed in as the owner.")}
            {slug ? <> {t("Staff sign in at {path}.", { path: `/sign-in/${slug}` })}</> : null}
          </AlertDescription>
        </div>
      </Alert>
      <h1 className="mb-1 text-2xl font-semibold leading-8">{t("Protect the owner account")}</h1>
      <p className="mb-5 text-ui text-primary-300">
        {t(
          "Turn on two-step verification with an authenticator app. Owners must set it up within 7 days; it stops anyone with only your password from running payroll or changing security settings.",
        )}
      </p>
      <div className="flex flex-col gap-2 sm:flex-row" data-testid="mfa-offer">
        <Button asChild variant="primary" size="lg">
          <Link to="/me/sessions" search={{ enrol: "1" }}>
            <ShieldCheck aria-hidden />
            {t("Set up two-step verification")}
          </Link>
        </Button>
        <Button asChild variant="secondary" size="lg">
          <Link to="/">{t("Later, go to Home")}</Link>
        </Button>
      </div>
      <p className="mt-6 text-2xs text-primary-200">
        {t("Next:")}{" "}
        <Link to="/settings/company" className="text-biru-400 underline underline-offset-2">
          {t("add the UEN and CPF details")}
        </Link>
        {t(", invite staff, and check that backups run in")}{" "}
        <Link to="/settings/system" className="text-biru-400 underline underline-offset-2">
          {t("Settings → System")}
        </Link>
        .
      </p>
    </div>
  );
}
