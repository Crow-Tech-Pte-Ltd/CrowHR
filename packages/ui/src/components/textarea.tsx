import * as React from "react";
import { cn } from "../lib/cn.ts";
import { inputBase } from "./input.tsx";

/** Ported from crow-tech-landing textarea.tsx. */
export type TextareaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement>;

export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(({ className, ...props }, ref) => (
  <textarea ref={ref} className={cn(inputBase, "h-auto min-h-[72px] py-2 leading-5", className)} {...props} />
));
Textarea.displayName = "Textarea";
