import { Button, FormField, Input, toast } from "@crowhr/ui";
import * as React from "react";
import { useReauth } from "../auth/reauth.tsx";
import { useMe } from "../auth/session.ts";
import { useT } from "../i18n/index.ts";
import { ApiError, apiPost } from "../lib/api.ts";

export function PasswordCard() {
  const t = useT("settings-account");
  const me = useMe();
  const withReauth = useReauth();
  const [current, setCurrent] = React.useState("");
  const [next, setNext] = React.useState("");
  const [confirm, setConfirm] = React.useState("");
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [busy, setBusy] = React.useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (me.hasPassword && !current) errs.currentPassword = "Enter your current password.";
    if (next.length < 12)
      errs.newPassword = "Use at least 12 characters. A short phrase of a few unrelated words works well.";
    if (next !== confirm) errs.confirm = "The two passwords don't match. Type the same password twice.";
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setBusy(true);
    try {
      await withReauth(() =>
        apiPost("/api/v1/me/password", { currentPassword: current || undefined, newPassword: next }),
      );
      setCurrent("");
      setNext("");
      setConfirm("");
      toast.success(t("Password changed. Your other sessions and devices were signed out."));
    } catch (err) {
      if (err instanceof ApiError && err.code === "validation_failed") setErrors(err.fieldErrors);
      else if (err instanceof ApiError && err.code === "invalid_credentials")
        setErrors({ currentPassword: err.message });
      else if (!(err instanceof ApiError && err.code === "reauth_required"))
        toast.error(err instanceof Error ? err.message : t("Couldn't change the password."));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form onSubmit={submit} noValidate className="grid gap-4 p-4 sm:grid-cols-3" aria-label={t("Change password")}>
      {me.hasPassword ? (
        <FormField label={t("Current password")} error={errors.currentPassword}>
          <Input
            type="password"
            autoComplete="current-password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
          />
        </FormField>
      ) : null}
      <FormField
        label={me.hasPassword ? t("New password") : t("Set a password")}
        error={errors.newPassword}
        hint={t("At least 12 characters.")}
      >
        <Input type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />
      </FormField>
      <FormField label={t("Type it again")} error={errors.confirm}>
        <Input
          type="password"
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
        />
      </FormField>
      <div className="sm:col-span-3">
        <Button type="submit" disabled={busy}>
          {busy ? t("Saving…") : t("Change password")}
        </Button>
      </div>
    </form>
  );
}
