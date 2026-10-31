import type { z } from "zod";
import { AppError } from "../errors.ts";
import { friendlyIssueMessage, toValidationIssues } from "../http/validate.ts";

/** Parses service input with the same friendly messages and error envelope as `validate()`. */
export function parseInput<S extends z.ZodType>(schema: S, raw: unknown): z.output<S> {
  const result = schema.safeParse(raw, { error: friendlyIssueMessage });
  if (!result.success) {
    throw new AppError("validation_failed", "Some fields need attention.", {
      target: "json",
      issues: toValidationIssues(result.error),
    });
  }
  return result.data;
}

/** Fails with a single-field validation error. */
export function fieldError(path: string, message: string): AppError {
  return new AppError("validation_failed", message, { target: "json", issues: [{ path, message }] });
}

/** True for a Postgres unique violation (23505), optionally on a named constraint. */
export function isUniqueViolation(err: unknown, constraint?: string): boolean {
  const e = findPgError(err);
  return e?.code === "23505" && (!constraint || e.constraint === constraint);
}

export function isForeignKeyViolation(err: unknown): boolean {
  return findPgError(err)?.code === "23503";
}

function findPgError(err: unknown): { code?: string; constraint?: string } | null {
  let cur: unknown = err;
  for (let i = 0; i < 4 && cur && typeof cur === "object"; i++) {
    const o = cur as { code?: string; constraint?: string; cause?: unknown };
    if (typeof o.code === "string" && /^\d{5}$/.test(o.code)) return o;
    cur = o.cause;
  }
  return null;
}
