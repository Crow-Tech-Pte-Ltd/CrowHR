import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { AppEnv } from "./context.ts";

/** Stable, machine-readable error codes. Clients switch on these, never on messages. */
export const ERROR_STATUS = {
  validation_failed: 400,
  /** Both a session cookie and a bearer token were sent; send exactly one. */
  ambiguous_credentials: 400,
  /** Native token endpoint: bad, expired or replayed code / refresh token (RFC 6749 §5.2). */
  invalid_grant: 400,
  unauthenticated: 401,
  /** Sign-in failed. Deliberately identical for unknown email, wrong password, locked and suspended. */
  invalid_credentials: 401,
  invalid_mfa_code: 401,
  /** First-run setup: the one-time setup code from the container logs is wrong. */
  invalid_setup_code: 401,
  session_expired: 401,
  session_revoked: 401,
  forbidden: 403,
  csrf_rejected: 403,
  reauth_required: 403,
  mfa_enrolment_required: 403,
  password_sign_in_disabled: 403,
  self_change_requires_approval: 403,
  disabled_in_demo: 403,
  not_found: 404,
  conflict: 409,
  /** The NRIC/FIN already belongs to another employee of the organisation (including former ones): rehire them instead. */
  duplicate_id_number: 409,
  /** A structure entry (department, team, location, cost centre) is used by current employees and can't be archived. */
  in_use: 409,
  /** The chosen manager reports, directly or indirectly, to this employee. */
  reporting_cycle: 409,
  /** Approval task already decided (or superseded); details say who decided and when. */
  already_decided: 409,
  last_owner: 409,
  /** No organisation exists yet: finish the setup wizard at /setup first. */
  setup_required: 409,
  /** Upload larger than the endpoint allows (claim receipts: 10 MB). */
  file_too_large: 413,
  /** Upload content is not one of the accepted file types (checked by signature, not extension). */
  unsupported_file_type: 415,
  /** A claim line would take the employee past the claim type's cap; details give cap, used, pending, remaining. */
  cap_exceeded: 422,
  /** The employee may not use this claim type (employment type, probation or archived). */
  not_eligible: 422,
  rate_limited: 429,
  internal: 500,
  /** The feature exists in the API contract but its implementation has not landed yet. */
  not_implemented: 501,
  /** Maintenance (restore in progress) or still starting. */
  service_unavailable: 503,
} as const satisfies Record<string, ContentfulStatusCode>;

export type ErrorCode = keyof typeof ERROR_STATUS;

/** Wire shape of every API error response. */
export interface ErrorEnvelope {
  error: {
    code: ErrorCode;
    /** Human-readable; says what went wrong and how to fix it. */
    message: string;
    requestId: string;
    details?: unknown;
  };
}

/** Throw this from handlers and services for any expected failure. */
export class AppError extends Error {
  override name = "AppError";
  readonly code: ErrorCode;
  readonly details: unknown;
  /** Extra response headers, e.g. `Retry-After` for `rate_limited`. */
  readonly headers: Readonly<Record<string, string>>;

  constructor(code: ErrorCode, message: string, details?: unknown, options: { headers?: Record<string, string> } = {}) {
    super(message);
    this.code = code;
    this.details = details;
    this.headers = options.headers ?? {};
  }

  get status(): ContentfulStatusCode {
    return ERROR_STATUS[this.code];
  }
}

export function errorResponse(c: Context<AppEnv>, code: ErrorCode, message: string, details?: unknown): Response {
  const body: ErrorEnvelope = {
    error: { code, message, requestId: c.get("requestId") ?? "unknown", ...(details === undefined ? {} : { details }) },
  };
  return c.json(body, ERROR_STATUS[code]);
}

const CODE_FOR_STATUS: Partial<Record<number, ErrorCode>> = {
  400: "validation_failed",
  401: "unauthenticated",
  403: "forbidden",
  404: "not_found",
  409: "conflict",
  429: "rate_limited",
};

function codeForStatus(status: number): ErrorCode {
  return CODE_FOR_STATUS[status] ?? (status >= 500 ? "internal" : "validation_failed");
}

/** Hono `onError` handler: AppError → its envelope; anything else → opaque `internal`. */
export function handleError(err: Error, c: Context<AppEnv>): Response {
  if (err instanceof AppError) {
    for (const [name, value] of Object.entries(err.headers)) c.header(name, value);
    return errorResponse(c, err.code, err.message, err.details);
  }
  if (err instanceof HTTPException && err.status < 500) {
    // Raised by Hono itself, e.g. malformed JSON body.
    return errorResponse(c, codeForStatus(err.status), err.message || "The request could not be processed.");
  }
  const logger = c.get("logger") ?? c.get("deps")?.logger;
  logger?.error("Unhandled error", { err, path: c.req.path, method: c.req.method });
  return errorResponse(
    c,
    "internal",
    "Something went wrong on our side. Try again; if it keeps happening, contact your administrator with the request ID.",
  );
}
