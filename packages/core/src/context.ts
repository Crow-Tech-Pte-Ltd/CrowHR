import type { Context } from "hono";
import type { AppDeps } from "./deps.ts";
import { AppError } from "./errors.ts";
import type { Logger } from "./logger.ts";

/**
 * Role names. NOT IMPLEMENTED: the RBAC workstream will replace this with a
 * closed union and a permission matrix enforced in core.
 */
export type Role = string;

/**
 * How the session was established. Mirrors the per-organisation sign-in
 * methods in AGENTS.md ("Authentication"). NOT IMPLEMENTED: no method works
 * yet; the auth workstream fills these in (one OIDC implementation with
 * provider presets for Google, Microsoft and Singpass).
 */
export type AuthMethod = "password" | "google" | "microsoft" | "singpass" | "oidc";

/** The external identity behind an SSO session. */
export interface IdentityProviderInfo {
  /** Org-scoped identity provider configuration id. */
  providerId: string;
  /** OIDC `iss` of the provider, e.g. https://accounts.google.com. */
  issuer: string;
  /** OIDC `sub` (for Singpass, the stored Singpass UUID). */
  subject: string;
}

/** Who is making the request, in which organisation, with which roles, and how they signed in. */
export interface AuthContext {
  user: { id: string; email: string; displayName: string };
  /** The organisation every tenant query in this request is scoped to. */
  orgId: string;
  roles: readonly Role[];
  authMethod: AuthMethod;
  /** Present for SSO sessions; null for email + password. */
  identity: IdentityProviderInfo | null;
}

/** Request-scoped values available as `c.var.*` in every handler. */
export interface AppVariables {
  deps: AppDeps;
  requestId: string;
  /** Logger with `requestId` bound. */
  logger: Logger;
  /**
   * Null until an authentication middleware resolves a session.
   * NOT IMPLEMENTED: no auth middleware exists yet, so this is always null.
   */
  auth: AuthContext | null;
}

export interface AppEnv {
  Variables: AppVariables;
}

export type AppContext = Context<AppEnv>;

/**
 * Returns the caller's auth context or fails with 401. Fail-closed: while auth
 * is not implemented every protected route answers 401.
 */
export function requireAuth(c: AppContext): AuthContext {
  const auth = c.get("auth");
  if (!auth) throw new AppError("unauthenticated", "Sign in to continue.");
  return auth;
}
