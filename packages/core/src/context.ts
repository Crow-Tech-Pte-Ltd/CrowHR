import type { Context } from "hono";
import type { AssignedRole } from "./access/matrix.ts";
import type { AppDeps } from "./deps.ts";
import { AppError } from "./errors.ts";
import type { Logger } from "./logger.ts";

export type { AssignedRole, Role } from "./access/matrix.ts";

/**
 * How the session was established. Mirrors the per-organisation sign-in
 * methods in AGENTS.md ("Authentication"): one OIDC implementation with
 * provider presets for Google, Microsoft Entra ID, Singpass and generic OIDC.
 */
export type AuthMethod = "password" | "google" | "entra" | "singpass" | "oidc";

/** The external identity behind an SSO session. */
export interface IdentityProviderInfo {
  /** Org-scoped identity provider configuration id. */
  providerId: string;
  /** OIDC `iss` of the provider, e.g. https://accounts.google.com. */
  issuer: string;
  /** OIDC `sub` (for Singpass, the stored Singpass UUID). */
  subject: string;
}

export interface SessionInfo {
  id: string;
  /** `browser` = cookie session; `device` = native-app bearer token (api-platform). */
  kind: "browser" | "device";
  /** Last time the user proved who they are (sign-in, MFA, re-auth). Drives `requireRecentAuth`. */
  authenticatedAt: Date;
  mfaSatisfied: boolean;
}

/** Who is making the request, in which organisation, with which roles, and how they signed in. */
export interface AuthContext {
  user: { id: string; email: string; displayName: string };
  /** The organisation every tenant query in this request is scoped to. */
  orgId: string;
  membershipId: string;
  /** `former` members keep read-only access to their own payslips and documents. */
  membershipStatus: "active" | "former";
  /** The employee record linked to this membership, if any. Grants the implicit `employee` role. */
  employeeId: string | null;
  /**
   * Assigned roles only. Derived roles (`employee`, `manager`) are resolved per request by
   * `authorize()`; use `effectiveRoles(c)` when you need them.
   */
  roles: readonly AssignedRole[];
  authMethod: AuthMethod;
  /** Present for SSO sessions; null for email + password. */
  identity: IdentityProviderInfo | null;
  session: SessionInfo;
}

/**
 * Who is on the other end of the connection, computed once per request by the host (the
 * server applies `TRUSTED_PROXIES` to `X-Forwarded-*`). Core never reads forwarding headers.
 */
export interface ClientInfo {
  /** Client IP for rate limits and audit; null when the host cannot tell (tests, browser demo). */
  ip: string | null;
  /** Direct TCP peer (the reverse proxy when there is one). */
  peerIp: string | null;
  scheme: "http" | "https";
  host: string | null;
  /** True when the peer is a trusted proxy and forwarded headers were honoured. */
  viaTrustedProxy: boolean;
}

/** Request-scoped values available as `c.var.*` in every handler. */
export interface AppVariables {
  deps: AppDeps;
  requestId: string;
  /** Logger with `requestId` bound. */
  logger: Logger;
  /** Null until the session middleware resolves a valid session or bearer token. */
  auth: AuthContext | null;
  /** Client IP and scheme as resolved by the host (see `AppDeps.resolveClient`). */
  client: ClientInfo;
  /** Per-request memo (e.g. the manager's team). Never shared across requests. */
  memo: Map<string, unknown>;
  /** Why a presented credential was not accepted; `requireAuth` answers with this code. */
  authFailure: "session_expired" | "session_revoked" | null;
}

export interface AppEnv {
  Variables: AppVariables;
}

export type AppContext = Context<AppEnv>;

/** Returns the caller's auth context or fails with 401. Fail-closed. */
export function requireAuth(c: AppContext): AuthContext {
  const auth = c.get("auth");
  if (auth) return auth;
  const failure = c.get("authFailure");
  if (failure === "session_expired") {
    throw new AppError("session_expired", "You were signed out after a period of inactivity. Sign in again.");
  }
  if (failure === "session_revoked") {
    throw new AppError("session_revoked", "This session was signed out. Sign in again.");
  }
  throw new AppError("unauthenticated", "Sign in to continue.");
}
