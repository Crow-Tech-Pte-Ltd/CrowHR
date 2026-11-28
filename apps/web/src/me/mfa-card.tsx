import { Alert, AlertDescription, AlertTitle, Button, FormField, Input, StatusPill, toast } from "@crowhr/ui";
import { useQueryClient } from "@tanstack/react-query";
import { KeyRound, ShieldCheck } from "lucide-react";
import QRCode from "qrcode";
import * as React from "react";
import { useReauth } from "../auth/reauth.tsx";
import { meQuery, useMe } from "../auth/session.ts";
import { useT } from "../i18n/index.ts";
import { ApiError, apiDelete, apiPost } from "../lib/api.ts";

/** Authenticator-app enrolment, recovery codes, and turning MFA off. */
export function MfaCard({ autoStart }: { autoStart: boolean }) {
  const t = useT("settings-account");
  const me = useMe();
  const qc = useQueryClient();
  const withReauth = useReauth();
  const [setup, setSetup] = React.useState<{ secret: string; otpauthUri: string; qr: string } | null>(null);
  const [code, setCode] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [codes, setCodes] = React.useState<string[] | null>(null);
  const [busy, setBusy] = React.useState(false);
  const started = React.useRef(false);

  const start = React.useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await apiPost<{ secret: string; otpauthUri: string }>("/api/v1/me/mfa/totp/setup");
      setSetup({ ...res, qr: await QRCode.toDataURL(res.otpauthUri, { margin: 1, width: 168 }) });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("Couldn't start setup. Try again."));
    } finally {
      setBusy(false);
    }
  }, [t]);

  React.useEffect(() => {
    if (autoStart && !me.mfa.enrolled && !started.current) {
      started.current = true;
      void start();
    }
  }, [autoStart, me.mfa.enrolled, start]);

  const confirm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!/^\d{6}$/.test(code.trim())) {
      setError(t("Enter the 6-digit code shown in your authenticator app."));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await apiPost<{ recoveryCodes: string[] }>("/api/v1/me/mfa/totp/confirm", { code: code.trim() });
      setCodes(res.recoveryCodes);
      setSetup(null);
      setCode("");
      await qc.invalidateQueries({ queryKey: meQuery.queryKey });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("Couldn't confirm. Try again."));
    } finally {
      setBusy(false);
    }
  };

  const regenerate = async () => {
    try {
      const res = await withReauth(() => apiPost<{ recoveryCodes: string[] }>("/api/v1/me/mfa/recovery-codes"));
      setCodes(res.recoveryCodes);
      await qc.invalidateQueries({ queryKey: meQuery.queryKey });
    } catch (err) {
      if (!(err instanceof ApiError && err.code === "reauth_required"))
        toast.error(err instanceof Error ? err.message : t("Couldn't create new codes."));
    }
  };

  const turnOff = async () => {
    try {
      await withReauth(() => apiDelete("/api/v1/me/mfa"));
      setCodes(null);
      await qc.invalidateQueries({ queryKey: meQuery.queryKey });
      toast.success(t("Two-step verification is off."));
    } catch (err) {
      if (!(err instanceof ApiError && err.code === "reauth_required"))
        toast.error(err instanceof Error ? err.message : t("Couldn't turn it off."));
    }
  };

  return (
    <div className="flex flex-col gap-4 p-4" data-testid="mfa-card">
      {me.mfa.blocked ? (
        <Alert variant="danger">
          <KeyRound aria-hidden />
          <div>
            <AlertTitle>{t("Set up two-step verification to continue")}</AlertTitle>
            <AlertDescription>
              {t(
                "Your role requires it and the 7-day grace period has ended. Everything else unlocks as soon as you finish.",
              )}
            </AlertDescription>
          </div>
        </Alert>
      ) : null}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <ShieldCheck className="size-4 shrink-0" aria-hidden />
          <div>
            <p className="font-azeret text-xs font-semibold">{t("Authenticator app")}</p>
            <p className="text-ui text-primary-300">
              {me.mfa.enrolled
                ? t("On. {remainingRecoveryCodes} of 10 recovery codes left.", {
                    remainingRecoveryCodes: me.mfa.remainingRecoveryCodes,
                  })
                : me.authMethod !== "password"
                  ? t(
                      "You sign in with single sign-on; your identity provider handles two-step verification. You can still add an authenticator for password sign-in.",
                    )
                  : t(
                      "Adds a 6-digit code from an app like Google Authenticator, Microsoft Authenticator or 1Password when you sign in with a password.",
                    )}
            </p>
          </div>
        </div>
        <StatusPill tone={me.mfa.enrolled ? "success" : me.mfa.required ? "warning" : "neutral"}>
          {me.mfa.enrolled ? t("On") : me.mfa.required ? t("Required for your role") : t("Off")}
        </StatusPill>
      </div>

      {codes ? (
        <Alert variant="success" data-testid="recovery-codes">
          <KeyRound aria-hidden />
          <div className="flex flex-col gap-3">
            <AlertTitle>{t("Save your recovery codes now")}</AlertTitle>
            <AlertDescription>
              {t(
                "Each code works once if you lose your phone. They won't be shown again; any older codes no longer work.",
              )}
            </AlertDescription>
            <ol className="grid grid-cols-2 gap-x-6 gap-y-1 font-azeret text-xs tabular-nums sm:grid-cols-5">
              {codes.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ol>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="secondary"
                onClick={() =>
                  void navigator.clipboard?.writeText(codes.join("\n")).then(() => toast.success(t("Copied.")))
                }
              >
                {t("Copy codes")}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setCodes(null)}>
                {t("I've saved them")}
              </Button>
            </div>
          </div>
        </Alert>
      ) : null}

      {setup ? (
        <form
          onSubmit={confirm}
          noValidate
          className="flex flex-col gap-4 rounded-md border border-border p-4 sm:flex-row"
          aria-label={t("Set up authenticator")}
        >
          {/* QR code generated locally from the otpauth URI; nothing leaves the browser. */}
          <img
            src={setup.qr}
            width={168}
            height={168}
            alt={t("QR code to scan with your authenticator app")}
            className="shrink-0 self-start rounded-md border border-border bg-white p-1"
          />
          <div className="flex flex-1 flex-col gap-3">
            <ol className="list-decimal pl-4 text-ui text-primary-300">
              <li>{t("Scan the QR code with your authenticator app, or enter the key below.")}</li>
              <li>{t("Enter the 6-digit code the app shows.")}</li>
            </ol>
            <p className="font-azeret text-2xs text-primary-300">
              {t("Setup key:")}{" "}
              <span className="num select-all text-ink" data-testid="totp-secret">
                {setup.secret.match(/.{1,4}/g)?.join(" ")}
              </span>
            </p>
            <FormField label={t("Code from the app")} error={error}>
              <Input
                inputMode="numeric"
                autoComplete="one-time-code"
                className="num max-w-[10rem] tracking-[0.2em]"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                autoFocus
              />
            </FormField>
            <div className="flex gap-2">
              <Button type="submit" variant="primary" disabled={busy}>
                {busy ? t("Checking…") : t("Turn on")}
              </Button>
              <Button type="button" variant="ghost" onClick={() => setSetup(null)}>
                {t("Cancel")}
              </Button>
            </div>
          </div>
        </form>
      ) : (
        <div className="flex flex-wrap gap-2">
          {me.mfa.enrolled ? (
            <>
              <Button size="sm" variant="secondary" onClick={() => void regenerate()}>
                {t("New recovery codes")}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => void turnOff()}>
                {t("Turn off")}
              </Button>
            </>
          ) : (
            <Button size="sm" variant="primary" onClick={() => void start()} disabled={busy}>
              {t("Set up authenticator app")}
            </Button>
          )}
          {error && !setup ? <p className="text-2xs text-danger-300">{error}</p> : null}
        </div>
      )}
    </div>
  );
}
