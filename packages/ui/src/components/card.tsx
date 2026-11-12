import * as React from "react";
import { cn } from "../lib/cn.ts";
import { textStyle } from "../lib/text-styles.ts";

/**
 * Ported from crow-tech-landing card.tsx. Default is a hairline panel; the
 * `emphasis` variant (2px ink + hard shadow) is reserved for the one surface
 * on a screen that matters most, e.g. the active payroll run.
 */
export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: "default" | "emphasis" | "flat";
}

export const Card = React.forwardRef<HTMLDivElement, CardProps>(({ className, variant = "default", ...props }, ref) => (
  <div
    ref={ref}
    className={cn(
      "relative rounded-lg bg-card text-card-foreground",
      variant === "default" && "border border-border",
      variant === "emphasis" && "border-2 border-ink shadow-brutal",
      variant === "flat" && "bg-surface-100",
      className,
    )}
    {...props}
  />
));
Card.displayName = "Card";

export const CardHeader = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("flex items-start justify-between gap-4 px-4 pt-4 pb-3", className)} {...props} />
  ),
);
CardHeader.displayName = "CardHeader";

/** A card's heading. It is an `h2`: cards sit directly under a page's `h1` (WCAG 1.3.1, heading order). */
export const CardTitle = React.forwardRef<HTMLHeadingElement, React.HTMLAttributes<HTMLHeadingElement>>(
  ({ className, ...props }, ref) => <h2 ref={ref} className={cn(textStyle.section, className)} {...props} />,
);
CardTitle.displayName = "CardTitle";

export const CardDescription = React.forwardRef<HTMLParagraphElement, React.HTMLAttributes<HTMLParagraphElement>>(
  ({ className, ...props }, ref) => (
    <p ref={ref} className={cn("text-ui text-muted-foreground", className)} {...props} />
  ),
);
CardDescription.displayName = "CardDescription";

export const CardContent = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => <div ref={ref} className={cn("px-4 pb-4", className)} {...props} />,
);
CardContent.displayName = "CardContent";

export const CardFooter = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("flex items-center gap-2 border-t border-border px-4 py-3", className)} {...props} />
  ),
);
CardFooter.displayName = "CardFooter";
