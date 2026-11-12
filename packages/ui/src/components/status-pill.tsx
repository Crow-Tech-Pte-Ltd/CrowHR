import { cva, type VariantProps } from "class-variance-authority";
import type * as React from "react";
import { cn } from "../lib/cn.ts";

/**
 * A status chip. Status uses success / warning / danger only (plus neutral and info).
 *
 * Show a chip only when the status carries information: an exception, something that needs
 * someone, or a row that differs from its neighbours. The normal state (an active member, a
 * statutory leave type, a paid run) is plain text or nothing, and a list filtered to one status
 * doesn't repeat it on every row. Sentence case; the colour plus the word is enough, so there is
 * no dot unless `dot` is set.
 */
export const statusPillVariants = cva(
  "inline-flex h-5 items-center gap-1.5 whitespace-nowrap rounded-sm border px-1.5 font-azeret text-2xs font-medium",
  {
    variants: {
      tone: {
        neutral: "border-ink/15 bg-surface-200/60 text-primary-300",
        info: "border-biru-300/50 bg-surface-50 text-biru-400",
        success: "border-success-300/40 bg-success-50 text-success-400",
        warning: "border-warning-300/50 bg-warning-50 text-warning-400",
        danger: "border-danger-200/40 bg-danger-50 text-danger-300",
      },
    },
    defaultVariants: { tone: "neutral" },
  },
);

const DOT: Record<NonNullable<StatusPillProps["tone"]>, string> = {
  neutral: "bg-primary-200",
  info: "bg-biru-400",
  success: "bg-success-300",
  warning: "bg-warning-300",
  danger: "bg-danger-200",
};

export interface StatusPillProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof statusPillVariants> {
  dot?: boolean;
}

export function StatusPill({ className, tone, dot = false, children, ...props }: StatusPillProps) {
  return (
    <span className={cn(statusPillVariants({ tone }), className)} {...props}>
      {dot ? <span aria-hidden className={cn("size-1.5 rounded-full", DOT[tone ?? "neutral"])} /> : null}
      {children}
    </span>
  );
}
