import { cva, type VariantProps } from "class-variance-authority";
import type * as React from "react";
import { cn } from "../lib/cn.ts";

/** Ported from crow-tech-landing badge.tsx: a neutral tag/chip. Use StatusPill for status. */
export const badgeVariants = cva(
  "inline-flex items-center gap-1 whitespace-nowrap rounded-sm border px-1.5 py-px font-azeret text-2xs font-medium",
  {
    variants: {
      variant: {
        default: "border-ink/15 bg-surface-50 text-ink",
        brand: "border-ink bg-kuning-200 text-ink",
        ink: "border-ink bg-ink text-surface-50",
        muted: "border-transparent bg-surface-200 text-primary-300",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}
