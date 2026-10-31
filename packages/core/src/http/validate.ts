import type { ValidationTargets } from "hono";
import { validator } from "hono/validator";
import type { z } from "zod";
import { AppError } from "../errors.ts";

export interface ValidationIssue {
  /** Dotted path to the offending field, e.g. `address.postalCode` or `items.2.amountCents`. */
  path: string;
  message: string;
}

/**
 * Default messages that tell the user how to fix the input. Messages set on a
 * schema (`z.string().min(1, "Enter a name")`) take precedence over these.
 */
// biome-ignore lint/suspicious/noExplicitAny: zod's issue union is wide; we only read common fields.
export function friendlyIssueMessage(issue: any): string | undefined {
  switch (issue.code) {
    case "invalid_type":
      if (issue.input === undefined) return "This field is required.";
      return `Expected ${article(issue.expected)}, but got ${describe(issue.input)}.`;
    case "too_small":
      if (issue.origin === "string") {
        return Number(issue.minimum) <= 1
          ? "This field must not be empty."
          : `Use at least ${issue.minimum} characters.`;
      }
      if (issue.origin === "array")
        return `Add at least ${issue.minimum} item${Number(issue.minimum) === 1 ? "" : "s"}.`;
      return `Must be ${issue.inclusive ? "at least" : "more than"} ${issue.minimum}.`;
    case "too_big":
      if (issue.origin === "string") return `Use at most ${issue.maximum} characters.`;
      if (issue.origin === "array") return `Use at most ${issue.maximum} items.`;
      return `Must be ${issue.inclusive ? "at most" : "less than"} ${issue.maximum}.`;
    case "invalid_format":
      if (issue.format === "email") return "Enter a valid email address, like name@company.sg.";
      if (issue.format === "uuid") return "Must be a valid ID.";
      if (issue.format === "date") return "Use the date format YYYY-MM-DD, like 2026-10-31.";
      return `Must be a valid ${issue.format}.`;
    case "invalid_value":
      return `Choose one of: ${(issue.values as unknown[]).map(String).join(", ")}.`;
    case "unrecognized_keys":
      return `Remove the unknown field${issue.keys.length === 1 ? "" : "s"}: ${issue.keys.join(", ")}.`;
    default:
      return undefined;
  }
}

function article(type: string): string {
  return /^[aeiou]/.test(type) ? `an ${type}` : `a ${type}`;
}

function describe(input: unknown): string {
  if (input === null) return "null";
  if (Array.isArray(input)) return "a list";
  return article(typeof input);
}

export function toValidationIssues(error: z.ZodError): ValidationIssue[] {
  return error.issues.map((issue) => ({
    path: issue.path.map(String).join("."),
    message: issue.message,
  }));
}

/**
 * Validates one part of the request against a zod schema before the handler
 * runs; the parsed value is available, fully typed, via `c.req.valid(target)`.
 * Failure → 400 `validation_failed` with `details.issues`.
 *
 *   app.post("/", validate("json", createEmployeeBody), (c) => {
 *     const body = c.req.valid("json");
 *   });
 */
export function validate<Target extends keyof ValidationTargets, Schema extends z.ZodType>(
  target: Target,
  schema: Schema,
) {
  return validator(target, async (value): Promise<z.output<Schema>> => {
    const result = await schema.safeParseAsync(value, { error: friendlyIssueMessage });
    if (!result.success) {
      throw new AppError("validation_failed", "Some fields need attention.", {
        target,
        issues: toValidationIssues(result.error),
      });
    }
    return result.data;
  });
}
