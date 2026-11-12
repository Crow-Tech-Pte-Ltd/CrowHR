import { CalendarDays } from "lucide-react";
import * as React from "react";
import { cn } from "../lib/cn.ts";
import { formatDate, fromIsoDate, toIsoDate } from "../lib/format.ts";
import { Calendar } from "./calendar.tsx";
import { inputBase } from "./input.tsx";
import { Popover, PopoverContent, PopoverTrigger } from "./popover.tsx";

export interface DatePickerProps {
  /** ISO calendar date `YYYY-MM-DD`, or null. Dates are calendar days, never instants. */
  value: string | null;
  onChange: (value: string | null) => void;
  placeholder?: string;
  disabled?: boolean;
  /** Earliest date that can be picked (`YYYY-MM-DD`), e.g. an end date's start date. */
  min?: string | null;
  /** Latest date that can be picked (`YYYY-MM-DD`). */
  max?: string | null;
  /**
   * Month and year dropdowns in the calendar's caption, for dates far from today (a date of
   * birth, a share grant years ago). The year range runs from `min` (else 1930) to `max` (else
   * ten years from now).
   */
  yearPicker?: boolean;
  id?: string;
  className?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean;
  /** For a picker without a visible label (a toolbar's day picker). */
  "aria-label"?: string;
}

/** Button showing "31 Oct 2026" that opens a calendar. */
export const DatePicker = React.forwardRef<HTMLButtonElement, DatePickerProps>(
  ({ value, onChange, placeholder = "Pick a date", disabled, min, max, yearPicker, id, className, ...aria }, ref) => {
    const [open, setOpen] = React.useState(false);
    const selected = value ? fromIsoDate(value) : undefined;
    const outside = [...(min ? [{ before: fromIsoDate(min) }] : []), ...(max ? [{ after: fromIsoDate(max) }] : [])];
    return (
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            ref={ref}
            id={id}
            type="button"
            disabled={disabled}
            aria-describedby={aria["aria-describedby"]}
            aria-invalid={aria["aria-invalid"]}
            // The visible date stays part of the name (WCAG 2.5.3): "Day, 31 Oct 2026".
            aria-label={
              aria["aria-label"] ? `${aria["aria-label"]}, ${value ? formatDate(value) : placeholder}` : undefined
            }
            className={cn(
              inputBase,
              "items-center justify-between gap-2 text-left",
              !value && "text-primary-200",
              className,
            )}
          >
            <span className={cn(value && "num")}>{value ? formatDate(value) : placeholder}</span>
            <CalendarDays className="size-4 text-primary-200" aria-hidden />
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-2" align="start">
          <Calendar
            mode="single"
            selected={selected}
            defaultMonth={selected ?? (min ? fromIsoDate(min) : undefined)}
            disabled={outside.length ? outside : undefined}
            {...(yearPicker
              ? {
                  captionLayout: "dropdown" as const,
                  startMonth: min ? fromIsoDate(min) : new Date(1930, 0, 1),
                  endMonth: max ? fromIsoDate(max) : new Date(new Date().getFullYear() + 10, 11, 31),
                }
              : {})}
            onSelect={(date) => {
              onChange(date ? toIsoDate(date) : null);
              setOpen(false);
            }}
          />
        </PopoverContent>
      </Popover>
    );
  },
);
DatePicker.displayName = "DatePicker";
