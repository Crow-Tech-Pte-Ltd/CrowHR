import type * as React from "react";
import { cn } from "../lib/cn.ts";

export interface EmptyStateProps extends Omit<React.HTMLAttributes<HTMLDivElement>, "title"> {
  icon?: React.ReactNode;
  title: React.ReactNode;
  description?: React.ReactNode;
  /** Buttons or links. */
  actions?: React.ReactNode;
  /** Small mono footnote, e.g. "Not available yet". */
  note?: React.ReactNode;
  /** `boxed` draws a dashed hairline frame; `plain` sits inside an existing panel. */
  variant?: "boxed" | "plain";
}

export function EmptyState({
  icon,
  title,
  description,
  actions,
  note,
  variant = "boxed",
  className,
  ...props
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-start gap-3 px-6 py-10 sm:items-center sm:px-10 sm:py-14 sm:text-center",
        variant === "boxed" && "rounded-lg border border-dashed border-ink/25 bg-surface-50",
        className,
      )}
      {...props}
    >
      {icon ? (
        <div className="flex size-10 items-center justify-center rounded-md border border-ink/15 bg-surface-100 text-ink [&_svg]:size-5">
          {icon}
        </div>
      ) : null}
      <div className="flex max-w-md flex-col gap-1.5">
        <h2 className="font-azeret text-sm font-semibold tracking-tight">{title}</h2>
        {description ? <div className="text-ui leading-relaxed text-primary-300">{description}</div> : null}
      </div>
      {actions ? <div className="mt-1 flex flex-wrap gap-2">{actions}</div> : null}
      {note ? <p className="font-azeret text-2xs uppercase tracking-wider text-primary-200">{note}</p> : null}
    </div>
  );
}
