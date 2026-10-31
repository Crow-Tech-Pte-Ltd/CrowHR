import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { AppEnv } from "./context.ts";

/** Stable, machine-readable error codes. Clients switch on these, never on messages. */
export const ERROR_STATUS = {
  validation_failed: 400,
  unauthenticated: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  internal: 500,
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

  constructor(code: ErrorCode, message: string, details?: unknown) {
    super(message);
    this.code = code;
    this.details = details;
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

function codeForStatus(status: number): ErrorCode {
  const match = (Object.entries(ERROR_STATUS) as [ErrorCode, number][]).find(([, s]) => s === status);
  return match ? match[0] : status >= 500 ? "internal" : "validation_failed";
}

/** Hono `onError` handler: AppError → its envelope; anything else → opaque `internal`. */
export function handleError(err: Error, c: Context<AppEnv>): Response {
  if (err instanceof AppError) {
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
