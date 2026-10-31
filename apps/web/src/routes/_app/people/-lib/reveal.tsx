import { Button, toast } from "@crowhr/ui";
import { Eye, EyeOff } from "lucide-react";
import * as React from "react";
import { useReauth } from "../../../../auth/reauth.tsx";
import { ApiError } from "../../../../lib/api.ts";
import { api, errorMessage } from "./api.ts";

/** How long a revealed value stays on screen. */
const SHOW_FOR_MS = 60_000;

/**
 * Masked by default. "Show" calls the audited reveal endpoint (asking for the password again when
 * the sign-in is older than 10 minutes), shows the full value for a minute, and forgets it on
 * "Hide", on timeout and when the view unmounts. The value is never put in the query cache.
 */
export function RevealValue({
  masked,
  employeeId,
  kind,
}: {
  masked: string;
  employeeId: string;
  kind: "nric" | "bank";
}) {
  const withReauth = useReauth();
  const [value, setValue] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  React.useEffect(() => {
    if (!value) return;
    const id = setTimeout(() => setValue(null), SHOW_FOR_MS);
    return () => clearTimeout(id);
  }, [value]);
  const label = kind === "nric" ? "NRIC/FIN" : "account number";

  const reveal = async () => {
    setBusy(true);
    try {
      const res = await withReauth(() => api<{ value: string }>("POST", `/employees/${employeeId}/${kind}/reveal`));
      setValue(res.value);
    } catch (err) {
      if (!(err instanceof ApiError && err.code === "reauth_required")) {
        toast(`Couldn't show the ${label}`, { description: errorMessage(err) });
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <span className="num" data-testid={`${kind}-value`}>
        {value ?? masked}
      </span>
      {value ? (
        <Button size="sm" variant="ghost" className="h-6 px-1.5 text-2xs" onClick={() => setValue(null)}>
          <EyeOff aria-hidden /> Hide
        </Button>
      ) : (
        <Button
          size="sm"
          variant="ghost"
          className="h-6 px-1.5 text-2xs"
          disabled={busy}
          onClick={() => void reveal()}
          aria-label={`Show full ${label}`}
        >
          <Eye aria-hidden /> Show
        </Button>
      )}
    </span>
  );
}
