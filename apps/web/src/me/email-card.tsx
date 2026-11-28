import { Alert, AlertDescription, Button, FormField, formatDate, Input, toast } from "@crowhr/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Mail } from "lucide-react";
import * as React from "react";
import { useReauth } from "../auth/reauth.tsx";
import { useT } from "../i18n/index.ts";
import { ApiError, apiDelete, apiGet, apiPost } from "../lib/api.ts";

interface EmailChangeStatus {
  email: string;
  pending: { newEmail: string; expiresAt: string } | null;
  canChange: boolean;
}

export const emailChangeQuery = {
  queryKey: ["me", "email-change"] as const,
  queryFn: () => apiGet<EmailChangeStatus>("/api/v1/me/email-change"),
};

/**
 * My sign-in email. A change is confirmed from a link sent to the new address; until then the old
 * address keeps working. Servers without email can't verify an address, so they don't offer it.
 */
export function EmailCard() {
  const t = useT("settings-account");
  const qc = useQueryClient();
  const withReauth = useReauth();
  const q = useQuery(emailChangeQuery);
  const [editing, setEditing] = React.useState(false);
  const [next, setNext] = React.useState("");
  const [confirm, setConfirm] = React.useState("");
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [busy, setBusy] = React.useState(false);
  const refresh = () => qc.invalidateQueries({ queryKey: emailChangeQuery.queryKey });

  if (q.isPending) return <p className="px-4 py-3 text-ui text-primary-300">{t("Loading…")}</p>;
  if (q.isError)
    return (
      <p role="alert" className="px-4 py-3 text-ui text-danger-300">
        {q.error instanceof Error ? q.error.message : t("Couldn't load your sign-in email.")}
      </p>
    );
  const s = q.data;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (!next.includes("@")) errs.newEmail = t("Enter the full address, like name@company.sg.");
    else if (next.trim().toLowerCase() !== confirm.trim().toLowerCase())
      errs.confirm = t("The two addresses don't match. Type the same address twice.");
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setBusy(true);
    try {
      await withReauth(() => apiPost("/api/v1/me/email-change", { newEmail: next.trim() }));
      toast.success(t("We sent a confirmation link to {email}. It works for 24 hours.", { email: next.trim() }));
      setEditing(false);
      setNext("");
      setConfirm("");
      await refresh();
    } catch (err) {
      if (err instanceof ApiError && err.code === "validation_failed") setErrors(err.fieldErrors);
      else if (!(err instanceof ApiError && err.code === "reauth_required"))
        setErrors({ newEmail: err instanceof Error ? err.message : t("Couldn't start the change.") });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-3 px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex min-w-0 items-center gap-2 text-ui">
          <Mail className="size-4 shrink-0 text-primary-200" aria-hidden />
          <span className="truncate font-medium">{s.email}</span>
        </p>
        {s.canChange && !editing ? (
          <Button size="sm" onClick={() => setEditing(true)}>
            {t("Change email")}
          </Button>
        ) : null}
      </div>
      {s.pending ? (
        <Alert variant="info" data-testid="email-change-pending">
          <AlertDescription>
            {t("Awaiting confirmation from {newEmail} until {date}. In the meantime, sign in with {email}.", {
              newEmail: s.pending.newEmail,
              date: formatDate(s.pending.expiresAt.slice(0, 10)),
              email: s.email,
            })}{" "}
            <button
              type="button"
              className="focus-ring rounded-sm text-biru-400 underline"
              onClick={async () => {
                await apiDelete("/api/v1/me/email-change");
                toast(t("Email change cancelled"));
                await refresh();
              }}
            >
              {t("Cancel the change")}
            </button>
          </AlertDescription>
        </Alert>
      ) : null}
      {!s.canChange ? (
        <p className="text-2xs text-primary-300">
          {t(
            "This server can't send email, so a new address can't be verified and the sign-in email can't be changed here. Whoever runs Crow HR can set up email (SMTP).",
          )}
        </p>
      ) : null}
      {editing ? (
        <form onSubmit={submit} noValidate className="grid gap-3 sm:grid-cols-2">
          <FormField label={t("New email")} error={errors.newEmail}>
            <Input type="email" autoComplete="email" value={next} onChange={(e) => setNext(e.target.value)} />
          </FormField>
          <FormField label={t("New email again")} error={errors.confirm}>
            <Input type="email" autoComplete="email" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
          </FormField>
          <p className="text-2xs text-primary-300 sm:col-span-2">
            {t(
              "We email a link to the new address; the change happens when you open it. It's the address you sign in with in every organisation, and where security emails go. Your work email on your employee record doesn't change.",
            )}
          </p>
          <div className="flex gap-2 sm:col-span-2">
            <Button type="submit" variant="primary" size="sm" disabled={busy}>
              {busy ? t("Sending…") : t("Send confirmation link")}
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => setEditing(false)}>
              {t("Cancel")}
            </Button>
          </div>
        </form>
      ) : null}
    </div>
  );
}
