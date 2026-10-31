import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";
import { cn } from "../lib/cn.ts";

/** Ported from crow-tech-landing alert.tsx; the hard shadow is dropped (alerts are not emphasis surfaces). */
const alertVariants = cva(
  "relative flex w-full gap-3 rounded-md border px-3.5 py-3 text-ui [&>svg]:mt-0.5 [&>svg]:size-4 [&>svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "border-border bg-surface-50 text-ink",
        info: "border-biru-300/40 bg-biru-50/30 text-ink [&>svg]:text-biru-400",
        warning: "border-warning-300/50 bg-warning-50 text-ink [&>svg]:text-warning-400",
        danger: "border-danger-200/40 bg-danger-50 text-ink [&>svg]:text-danger-300",
        success: "border-success-300/40 bg-success-50 text-ink [&>svg]:text-success-400",
        sample: "border-dashed border-ink/40 bg-surface-100 text-ink",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

export const Alert = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & VariantProps<typeof alertVariants>
>(({ className, variant, role, ...props }, ref) => (
  <div
    ref={ref}
    role={role ?? (variant === "danger" ? "alert" : "status")}
    className={cn(alertVariants({ variant }), className)}
    {...props}
  />
));
Alert.displayName = "Alert";

export const AlertTitle = React.forwardRef<HTMLParagraphElement, React.HTMLAttributes<HTMLHeadingElement>>(
  ({ className, ...props }, ref) => (
    <h5 ref={ref} className={cn("font-azeret text-xs font-semibold leading-5", className)} {...props} />
  ),
);
AlertTitle.displayName = "AlertTitle";

export const AlertDescription = React.forwardRef<HTMLParagraphElement, React.HTMLAttributes<HTMLParagraphElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("text-ui leading-5 text-primary-300", className)} {...props} />
  ),
);
AlertDescription.displayName = "AlertDescription";
