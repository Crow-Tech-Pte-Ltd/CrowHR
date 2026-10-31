import * as React from "react";
import { cn } from "../lib/cn.ts";
import { formatMoney, type MoneyParseResult, parseMoneyToCents } from "../lib/format.ts";
import { inputBase } from "./input.tsx";

export interface MoneyInputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "defaultValue" | "type"> {
  /** Integer cents, or null when empty/invalid. */
  value: number | null;
  /** Called with integer cents (or null) and the raw parse result so callers can show a message. */
  onChange: (cents: number | null, result: MoneyParseResult) => void;
  allowNegative?: boolean;
}

const display = (cents: number | null) => (cents === null ? "" : formatMoney(cents, { symbol: false }));

/**
 * Money in, cents out. Shows "S$" and formats "1,234.56" on blur; never uses
 * floating point. Rejects more than two decimals instead of rounding.
 */
export const MoneyInput = React.forwardRef<HTMLInputElement, MoneyInputProps>(
  ({ value, onChange, allowNegative = false, className, onBlur, onFocus, ...props }, ref) => {
    const [text, setText] = React.useState(() => display(value));
    const [focused, setFocused] = React.useState(false);

    // Follow external value changes while not editing.
    React.useEffect(() => {
      if (!focused) setText(display(value));
    }, [value, focused]);

    return (
      <div className={cn("relative", className)}>
        <span
          aria-hidden
          className="pointer-events-none absolute inset-y-0 left-3 flex items-center font-azeret text-xs text-primary-200"
        >
          S$
        </span>
        <input
          ref={ref}
          type="text"
          inputMode="decimal"
          autoComplete="off"
          className={cn(inputBase, "num pl-9 text-right")}
          value={text}
          onFocus={(e) => {
            setFocused(true);
            onFocus?.(e);
          }}
          onChange={(e) => {
            setText(e.target.value);
            let result = parseMoneyToCents(e.target.value);
            if (result.ok && !allowNegative && result.cents < 0) result = { ok: false, reason: "invalid" };
            onChange(result.ok ? result.cents : null, result);
          }}
          onBlur={(e) => {
            setFocused(false);
            const result = parseMoneyToCents(text);
            if (result.ok && (allowNegative || result.cents >= 0)) setText(display(result.cents));
            onBlur?.(e);
          }}
          {...props}
        />
      </div>
    );
  },
);
MoneyInput.displayName = "MoneyInput";
