import * as React from "react";
import { cn } from "../lib/cn.ts";
import { Label } from "./label.tsx";

export interface FormFieldProps {
  label: React.ReactNode;
  /** Explains the expected input. Shown under the control. */
  hint?: React.ReactNode;
  /** Says what is wrong and how to fix it. Replaces nothing; shown under the hint. */
  error?: React.ReactNode;
  required?: boolean;
  /** Right-aligned extra in the label row, e.g. a "Forgot password?" link. */
  labelAside?: React.ReactNode;
  className?: string;
  /** A single control element; it receives id, aria-describedby, aria-invalid and required. */
  children: React.ReactElement<Record<string, unknown>>;
  id?: string;
}

/** Label + control + hint + error, wired for screen readers. */
export function FormField({ label, hint, error, required, labelAside, className, children, id }: FormFieldProps) {
  const autoId = React.useId();
  const controlId = id ?? (children.props.id as string | undefined) ?? `field-${autoId}`;
  const hintId = hint ? `${controlId}-hint` : undefined;
  const errorId = error ? `${controlId}-error` : undefined;
  const describedBy = [children.props["aria-describedby"], hintId, errorId].filter(Boolean).join(" ") || undefined;

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <div className="flex items-baseline justify-between gap-2">
        <Label htmlFor={controlId}>
          {label}
          {required ? (
            <span className="ml-0.5 text-danger-300" aria-hidden>
              *
            </span>
          ) : null}
        </Label>
        {labelAside}
      </div>
      {React.cloneElement(children, {
        id: controlId,
        "aria-describedby": describedBy,
        "aria-invalid": error ? true : children.props["aria-invalid"],
        required: required ?? children.props.required,
      })}
      {hint ? (
        <p id={hintId} className="text-2xs leading-4 text-primary-200">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} className="text-2xs font-medium leading-4 text-danger-300">
          {error}
        </p>
      ) : null}
    </div>
  );
}
