import { ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import type * as React from "react";
import { DayPicker } from "react-day-picker";
import { appNowMs } from "../lib/clock.ts";
import { cn } from "../lib/cn.ts";
import { buttonVariants } from "./button.tsx";

/** Ported from crow-tech-landing calendar.tsx, updated to react-day-picker v9. Weeks start Monday. */
function Chevron({ orientation }: { orientation?: "left" | "right" | "up" | "down" }) {
  if (orientation === "down") return <ChevronDown className="size-3" aria-hidden />;
  return orientation === "left" ? <ChevronLeft className="size-4" /> : <ChevronRight className="size-4" />;
}

export type CalendarProps = React.ComponentProps<typeof DayPicker>;

/**
 * Today's date in Singapore, as a local-midnight Date (the form DayPicker compares against). The
 * browser's own date can differ: a laptop set to another time zone, or CI in UTC between
 * 00:00 and 08:00 Singapore time.
 */
export function singaporeToday(now = appNowMs()): Date {
  const [y, m, d] = new Date(now + 8 * 3_600_000).toISOString().slice(0, 10).split("-").map(Number);
  return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1);
}

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/**
 * A day button's name, "Tuesday 10 November 2026": it contains the visible "10" as a word (WCAG
 * 2.5.3; the library's "November 10th" does not) and reads in Singapore's day-month order.
 */
export function dayButtonLabel(date: Date, modifiers: { today?: boolean; selected?: boolean }): string {
  const name = `${WEEKDAY_NAMES[date.getDay()]} ${date.getDate()} ${MONTH_NAMES[date.getMonth()]} ${date.getFullYear()}`;
  return `${modifiers.today ? "Today, " : ""}${name}${modifiers.selected ? ", selected" : ""}`;
}

export function Calendar({ className, classNames, showOutsideDays = true, today, labels, ...props }: CalendarProps) {
  return (
    <DayPicker
      labels={{ labelDayButton: dayButtonLabel, ...labels }}
      today={today ?? singaporeToday()}
      showOutsideDays={showOutsideDays}
      weekStartsOn={1}
      className={cn("p-1", className)}
      classNames={{
        months: "relative flex flex-col gap-4 sm:flex-row",
        month: "flex flex-col gap-3",
        month_caption: "flex h-8 items-center justify-center",
        caption_label: "inline-flex items-center gap-0.5 font-azeret text-xs font-semibold",
        // captionLayout="dropdown": native selects laid over their labels, so the label shows the value.
        dropdowns: "z-20 flex items-center gap-1.5",
        dropdown_root:
          "relative inline-flex h-7 items-center rounded-sm border border-border px-1.5 focus-within:ring-2 focus-within:ring-ring",
        dropdown: "absolute inset-0 z-10 w-full cursor-pointer appearance-none opacity-0",
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
        // Outside days can be picked, so they keep readable contrast (primary-100 is decorative only).
        outside: "text-primary-200",
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
