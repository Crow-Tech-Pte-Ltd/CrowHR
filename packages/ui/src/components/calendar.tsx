import { ChevronLeft, ChevronRight } from "lucide-react";
import type * as React from "react";
import { DayPicker } from "react-day-picker";
import { cn } from "../lib/cn.ts";
import { buttonVariants } from "./button.tsx";

/** Ported from crow-tech-landing calendar.tsx, updated to react-day-picker v9. Weeks start Monday. */
function Chevron({ orientation }: { orientation?: "left" | "right" | "up" | "down" }) {
  return orientation === "left" ? <ChevronLeft className="size-4" /> : <ChevronRight className="size-4" />;
}

export type CalendarProps = React.ComponentProps<typeof DayPicker>;

export function Calendar({ className, classNames, showOutsideDays = true, ...props }: CalendarProps) {
  return (
    <DayPicker
      showOutsideDays={showOutsideDays}
      weekStartsOn={1}
      className={cn("p-1", className)}
      classNames={{
        months: "relative flex flex-col gap-4 sm:flex-row",
        month: "flex flex-col gap-3",
        month_caption: "flex h-8 items-center justify-center",
        caption_label: "font-azeret text-xs font-semibold",
        nav: "absolute inset-x-0 top-0 flex items-center justify-between",
        button_previous: cn(buttonVariants({ variant: "ghost", size: "icon-sm" }), "z-10"),
        button_next: cn(buttonVariants({ variant: "ghost", size: "icon-sm" }), "z-10"),
        month_grid: "w-full border-collapse",
        weekdays: "flex",
        weekday: "w-8 font-azeret text-2xs font-medium uppercase text-primary-200",
        week: "mt-1 flex w-full",
        day: "relative size-8 p-0 text-center",
        day_button:
          "focus-ring num inline-flex size-8 items-center justify-center rounded-sm text-xs hover:bg-ink/5 aria-selected:opacity-100",
        selected: "[&>button]:bg-ink [&>button]:text-surface-50 [&>button]:hover:bg-ink",
        today:
          "[&>button]:font-bold [&>button]:underline [&>button]:decoration-kuning-400 [&>button]:decoration-2 [&>button]:underline-offset-4",
        outside: "text-primary-100 aria-selected:text-primary-200",
        disabled: "text-primary-100 opacity-50",
        range_middle: "[&>button]:bg-kuning-100 [&>button]:text-ink",
        hidden: "invisible",
        ...classNames,
      }}
      components={{ Chevron }}
      {...props}
    />
  );
}
