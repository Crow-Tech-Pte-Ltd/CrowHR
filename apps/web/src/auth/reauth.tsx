import {
  Alert,
  AlertDescription,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  FormField,
  Input,
} from "@crowhr/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import * as React from "react";
import { ApiError, apiPost } from "../lib/api.ts";
import { meQuery } from "./session.ts";

/**
 * Sensitive actions answer 403 `reauth_required` when the last sign-in is older than 10
 * minutes. `useReauth()` wraps such an action: on that error it asks for the password (and
 * authenticator code when MFA is on), refreshes the session's authentication time, and retries once.
 */
type Pending = { resolve: () => void; reject: (e: unknown) => void };
const Ctx = React.createContext<((run: () => Promise<unknown>) => Promise<unknown>) | null>(null);

export function ReauthProvider({ children }: { children: React.ReactNode }) {
  const [pending, setPending] = React.useState<Pending | null>(null);
  const withReauth = React.useCallback(async (run: () => Promise<unknown>) => {
    try {
      return await run();
    } catch (err) {
      if (!(err instanceof ApiError) || err.code !== "reauth_required") throw err;
      await new Promise<void>((resolve, reject) => setPending({ resolve, reject }));
      return run();
    }
  }, []);
  return (
    <Ctx.Provider value={withReauth}>
      {children}
      <ReauthDialog
        open={!!pending}
        onDone={() => {
          pending?.resolve();
          setPending(null);
        }}
        onCancel={() => {
          pending?.reject(
            new ApiError(403, { error: { code: "reauth_required", message: "Cancelled.", requestId: "" } }),
          );
          setPending(null);
        }}
      />
    </Ctx.Provider>
  );
}

export function useReauth() {
  const ctx = React.useContext(Ctx);
  if (!ctx) throw new Error("useReauth must be used inside ReauthProvider");
  return ctx as <T>(run: () => Promise<T>) => Promise<T>;
}

function ReauthDialog({ open, onDone, onCancel }: { open: boolean; onDone: () => void; onCancel: () => void }) {
  const { data: me } = useQuery(meQuery);
  const qc = useQueryClient();
  const [password, setPassword] = React.useState("");
  const [code, setCode] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const sso = me && me.authMethod !== "password";
  React.useEffect(() => {
    if (open) {
      setPassword("");
      setCode("");
      setError(null);
    }
  }, [open]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await apiPost("/api/v1/auth/reauth", { password, ...(code ? { code } : {}) });
      await qc.invalidateQueries({ queryKey: meQuery.queryKey });
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't confirm. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => (o ? null : onCancel())}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Confirm it's you</DialogTitle>
          <DialogDescription>
            This is a sensitive change, and your last sign-in was more than 10 minutes ago.
          </DialogDescription>
        </DialogHeader>
        {sso ? (
          <Alert variant="info">
            <AlertDescription>
              You signed in with single sign-on. Sign out and sign in again, then retry within 10 minutes.
            </AlertDescription>
          </Alert>
        ) : (
          <form id="reauth-form" onSubmit={submit} className="flex flex-col gap-4" noValidate>
            <FormField label="Password" error={error}>
              <Input
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoFocus
              />
            </FormField>
            {me?.mfa.enrolled ? (
              <FormField
                label="Authenticator code"
                hint="The 6-digit code from your authenticator app, or a recovery code."
              >
                <Input
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                />
              </FormField>
            ) : null}
          </form>
        )}
        <DialogFooter>
          <Button variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
          {sso ? null : (
            <Button variant="primary" type="submit" form="reauth-form" disabled={busy || !password}>
              {busy ? "Checking…" : "Confirm"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
