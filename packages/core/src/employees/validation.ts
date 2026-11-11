import type { z } from "zod";
import { AppError, postgresError } from "../errors.ts";
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

const findPgError = postgresError;
