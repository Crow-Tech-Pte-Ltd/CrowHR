import * as AvatarPrimitive from "@radix-ui/react-avatar";
import * as React from "react";
import { cn } from "../lib/cn.ts";
import { initials } from "../lib/format.ts";

export interface AvatarProps extends React.ComponentPropsWithoutRef<typeof AvatarPrimitive.Root> {
  name: string;
  src?: string;
  size?: "sm" | "md" | "lg";
}

const SIZES = { sm: "size-6 text-[10px]", md: "size-8 text-2xs", lg: "size-10 text-xs" } as const;

/** Square-ish avatar with mono initials fallback. */
export const Avatar = React.forwardRef<React.ComponentRef<typeof AvatarPrimitive.Root>, AvatarProps>(
  ({ name, src, size = "md", className, ...props }, ref) => (
    <AvatarPrimitive.Root
      ref={ref}
      className={cn("relative flex shrink-0 overflow-hidden rounded-md border border-ink/15", SIZES[size], className)}
      {...props}
    >
      {src ? <AvatarPrimitive.Image src={src} alt="" className="aspect-square size-full object-cover" /> : null}
      <AvatarPrimitive.Fallback
        delayMs={src ? 300 : 0}
        className="flex size-full items-center justify-center bg-kuning-100 font-azeret font-semibold text-ink"
      >
        {initials(name)}
      </AvatarPrimitive.Fallback>
    </AvatarPrimitive.Root>
  ),
);
Avatar.displayName = "Avatar";
