import type * as React from "react";
import { cn } from "../lib/cn.ts";

export function Kbd({ className, ...props }: React.HTMLAttributes<HTMLElement>) {
  return (
    <kbd
      className={cn(
        "inline-flex h-5 min-w-5 items-center justify-center rounded-sm border border-ink/15 border-b-ink/30 bg-surface-50 px-1 font-azeret text-2xs font-medium text-primary-300",
        className,
      )}
      {...props}
    />
  );
}
