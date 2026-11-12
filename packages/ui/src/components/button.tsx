import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";
import { cn } from "../lib/cn.ts";

/**
 * Ported from crow-tech-landing/components/ui/button.tsx and restrained for an
 * app: only `primary` gets the 2px ink border + hard shadow; everything else
 * is hairline or flat.
 */
export const buttonVariants = cva(
  "focus-ring inline-flex shrink-0 select-none items-center justify-center gap-2 whitespace-nowrap rounded-md font-azeret font-semibold transition-[transform,box-shadow,background-color,border-color,color] duration-100 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        // Disabled, the primary button loses its yellow and hard shadow: the emphasis is for an
        // action that can be taken now.
        primary:
          "border-2 border-ink bg-kuning-200 text-accent-foreground shadow-brutal-sm hover:-translate-x-px hover:-translate-y-px hover:bg-kuning-300 hover:shadow-[3px_3px_0_0_hsl(var(--shadow))] active:translate-x-0.5 active:translate-y-0.5 active:shadow-none disabled:border disabled:border-ink/30 disabled:bg-surface-200 disabled:text-ink disabled:shadow-none",
        ink: "bg-ink text-surface-50 hover:bg-primary-300",
        secondary: "border border-ink/20 bg-surface-50 text-ink hover:border-ink/40 hover:bg-surface-200/50",
        ghost: "text-ink hover:bg-ink/[0.05]",
        destructive: "bg-danger-300 text-surface-50 hover:bg-danger-400",
        link: "h-auto px-0 font-sans font-medium text-biru-400 underline-offset-4 hover:underline",
      },
      size: {
        sm: "h-8 px-3 text-2xs",
        md: "h-9 px-4 text-xs",
        lg: "h-10 px-5 text-ui",
        icon: "h-9 w-9",
        "icon-sm": "h-8 w-8",
      },
    },
    compoundVariants: [{ variant: "link", className: "h-auto px-0" }],
    defaultVariants: { variant: "secondary", size: "md" },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, type, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        ref={ref}
        className={cn(buttonVariants({ variant, size }), className)}
        {...(asChild ? {} : { type: type ?? "button" })}
        {...props}
      />
    );
  },
);
Button.displayName = "Button";
