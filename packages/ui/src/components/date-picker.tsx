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
  id?: string;
  className?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean;
}

/** Button showing "31 Oct 2026" that opens a calendar. */
export const DatePicker = React.forwardRef<HTMLButtonElement, DatePickerProps>(
  ({ value, onChange, placeholder = "Pick a date", disabled, id, className, ...aria }, ref) => {
    const [open, setOpen] = React.useState(false);
    const selected = value ? fromIsoDate(value) : undefined;
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
            defaultMonth={selected}
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
