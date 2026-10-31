import type * as React from "react";
import { cn } from "../lib/cn.ts";

export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div aria-hidden className={cn("rounded-sm bg-surface-200 motion-safe:animate-pulse", className)} {...props} />
  );
}
