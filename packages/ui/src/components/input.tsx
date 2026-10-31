import * as React from "react";
import { cn } from "../lib/cn.ts";

/** Ported from crow-tech-landing input.tsx. Invalid state via `aria-invalid`. */
export const inputBase =
  "flex h-9 w-full rounded-md border border-input bg-surface-50 px-3 text-ui text-ink transition-colors placeholder:text-primary-200/80 hover:border-ink/40 focus-visible:border-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30 disabled:cursor-not-allowed disabled:bg-surface-200/50 disabled:opacity-60 aria-[invalid=true]:border-danger-200 aria-[invalid=true]:focus-visible:ring-danger-200/30";

export type InputProps = React.InputHTMLAttributes<HTMLInputElement>;

export const Input = React.forwardRef<HTMLInputElement, InputProps>(({ className, type = "text", ...props }, ref) => (
  <input
    ref={ref}
    type={type}
    className={cn(
      inputBase,
      "file:border-0 file:bg-transparent file:font-azeret file:text-xs file:font-medium",
      className,
    )}
    {...props}
  />
));
Input.displayName = "Input";
