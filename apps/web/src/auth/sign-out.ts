import { toast } from "@crowhr/ui";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { apiPost } from "../lib/api.ts";

/** Ends the session on the server, forgets cached data and opens the sign-in page. */
export function useSignOut(): () => Promise<void> {
  const navigate = useNavigate();
  const qc = useQueryClient();
  return async () => {
    try {
      await apiPost("/api/v1/auth/sign-out");
    } catch {
      toast.error("Couldn't reach the server, but you've been signed out on this device.");
    }
    qc.clear();
    await navigate({ to: "/sign-in", search: { reason: "signed_out" } });
  };
}
