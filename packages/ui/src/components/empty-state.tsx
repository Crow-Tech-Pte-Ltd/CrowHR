import type * as React from "react";
import { cn } from "../lib/cn.ts";

export interface EmptyStateProps extends Omit<React.HTMLAttributes<HTMLDivElement>, "title"> {
  /** What is empty, said plainly for this screen ("No claims in October."). */
  title: React.ReactNode;
  /** What fills it, or what to do next. Name the page's own button rather than repeating it. */
  description?: React.ReactNode;
  /** An action only this state offers (not a copy of the page header's button). */
  actions?: React.ReactNode;
  /** `boxed` draws a hairline frame, for a page with nothing else on it; `plain` sits inside a panel. */
  variant?: "boxed" | "plain";
}

/**
 * A plain, left-aligned empty state: a sentence saying what is empty and one saying what fills it.
 * No icon, no centred card. Empty tables use `TableEmptyRow` instead, so the table keeps its shape.
 */
export function EmptyState({ title, description, actions, variant = "boxed", className, ...props }: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-start gap-1",
        variant === "boxed" ? "rounded-lg border border-border bg-card px-4 py-4" : "px-4 py-5",
        className,
      )}
      {...props}
    >
      <p className="text-ui font-medium text-ink">{title}</p>
      {description ? <div className="max-w-2xl text-ui leading-relaxed text-primary-300">{description}</div> : null}
      {actions ? <div className="mt-2 flex flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}
