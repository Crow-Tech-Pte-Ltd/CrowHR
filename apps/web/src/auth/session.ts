import { queryOptions, useQuery } from "@tanstack/react-query";
import { ApiError, apiGet } from "../lib/api.ts";
import type { Me } from "./types.ts";

export const meQuery = queryOptions({
  queryKey: ["me"] as const,
  queryFn: () => apiGet<Me>("/api/v1/me"),
  staleTime: 30_000,
  retry: (count, err) => !(err instanceof ApiError && err.status < 500) && count < 1,
});

/** The signed-in member. Only use inside the signed-in shell (`_app`), where it is guaranteed loaded. */
export function useMe(): Me {
  const { data } = useQuery(meQuery);
  if (!data) throw new Error("useMe used outside the signed-in shell");
  return data;
}

export function can(me: Me, permission: string): boolean {
  return (me.permissions[permission]?.length ?? 0) > 0;
}

/**
 * Whether `permission` reaches this employee's record: scope "all", or "own" on the member's own
 * record. Team scope needs the reporting line, which only the server knows, so it is left out here:
 * use it to hide controls, never to grant anything (the server checks every request).
 */
export function canForEmployee(me: Me, permission: string, employeeId: string): boolean {
  const scopes = me.permissions[permission] ?? [];
  return scopes.includes("all") || (scopes.includes("own") && me.employeeId === employeeId);
}

/** Organisation-wide permission (scope "all"), e.g. adding employees. */
export function canForAll(me: Me, permission: string): boolean {
  return me.permissions[permission]?.includes("all") ?? false;
}

/** Why the user lands on the sign-in page, for the notice shown there. */
export type SignedOutReason = "expired" | "revoked" | "signed_out";

export function reasonFor(err: unknown): SignedOutReason | undefined {
  if (!(err instanceof ApiError)) return undefined;
  if (err.code === "session_expired") return "expired";
  if (err.code === "session_revoked") return "revoked";
  return undefined;
}

const LAST_ORG_KEY = "crowhr.lastOrg";

/** Remembers the organisation last signed in to, so `/sign-in` on a multi-org install goes straight there. */
export function rememberOrg(slug: string | null | undefined) {
  if (!slug) return;
  try {
    localStorage.setItem(LAST_ORG_KEY, slug);
  } catch {
    // storage unavailable: the chooser still works
  }
}

export function rememberedOrg(): string | null {
  try {
    return localStorage.getItem(LAST_ORG_KEY);
  } catch {
    return null;
  }
}
