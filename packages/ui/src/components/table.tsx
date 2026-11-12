import * as React from "react";
import { cn } from "../lib/cn.ts";
import { textStyle } from "../lib/text-styles.ts";

/**
 * Dense table primitives: 40px rows, sticky header, mono uppercase column
 * labels (`textStyle.column`), `numeric` cells right-aligned in tabular Azeret Mono.
 */
/** True while the element's content is wider than the element (it scrolls sideways). */
export function useScrollsSideways(ref: React.RefObject<HTMLElement | null>): boolean {
  const [scrolls, setScrolls] = React.useState(false);
  React.useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const check = () => setScrolls(el.scrollWidth > el.clientWidth + 1);
    check();
    const observer = new ResizeObserver(check);
    observer.observe(el);
    if (el.firstElementChild) observer.observe(el.firstElementChild);
    return () => observer.disconnect();
  }, [ref]);
  return scrolls;
}

export const Table = React.forwardRef<
  HTMLTableElement,
  React.HTMLAttributes<HTMLTableElement> & { containerClassName?: string }
>(({ className, containerClassName, ...props }, ref) => {
  const box = React.useRef<HTMLDivElement>(null);
  // A table wider than the screen can be scrolled with the keyboard too (WCAG 2.1.1).
  const scrolls = useScrollsSideways(box);
  const label = props["aria-label"];
  return (
    <div
      ref={box}
      className={cn("relative w-full overflow-auto", scrolls && "focus-ring", containerClassName)}
      {...(scrolls
        ? {
            tabIndex: 0,
            role: "region",
            "aria-label": label ? `${label} (scrolls sideways)` : "Table (scrolls sideways)",
          }
        : {})}
    >
      <table ref={ref} className={cn("w-full caption-bottom border-collapse text-ui", className)} {...props} />
    </div>
  );
});
Table.displayName = "Table";

export const TableHeader = React.forwardRef<HTMLTableSectionElement, React.HTMLAttributes<HTMLTableSectionElement>>(
  ({ className, ...props }, ref) => (
    <thead
      ref={ref}
      className={cn("sticky top-0 z-10 bg-surface-50 [&_tr]:border-b [&_tr]:border-border", className)}
      {...props}
    />
  ),
);
TableHeader.displayName = "TableHeader";

export const TableBody = React.forwardRef<HTMLTableSectionElement, React.HTMLAttributes<HTMLTableSectionElement>>(
  ({ className, ...props }, ref) => (
    <tbody ref={ref} className={cn("[&_tr:last-child]:border-0", className)} {...props} />
  ),
);
TableBody.displayName = "TableBody";

export const TableFooter = React.forwardRef<HTMLTableSectionElement, React.HTMLAttributes<HTMLTableSectionElement>>(
  ({ className, ...props }, ref) => (
    <tfoot ref={ref} className={cn("border-t border-ink/20 bg-surface-100 font-medium", className)} {...props} />
  ),
);
TableFooter.displayName = "TableFooter";

export const TableRow = React.forwardRef<HTMLTableRowElement, React.HTMLAttributes<HTMLTableRowElement>>(
  ({ className, ...props }, ref) => (
    <tr
      ref={ref}
      className={cn(
        "h-10 border-b border-border transition-colors hover:bg-surface-200/40 focus-visible:bg-kuning-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring data-[state=selected]:bg-kuning-50",
        className,
      )}
      {...props}
    />
  ),
);
TableRow.displayName = "TableRow";

export const TableHead = React.forwardRef<
  HTMLTableCellElement,
  React.ThHTMLAttributes<HTMLTableCellElement> & { numeric?: boolean }
>(({ className, numeric, ...props }, ref) => (
  <th
    ref={ref}
    className={cn(
      "h-9 whitespace-nowrap px-3 text-left align-middle",
      textStyle.column,
      numeric && "text-right",
      className,
    )}
    {...props}
  />
));
TableHead.displayName = "TableHead";

export const TableCell = React.forwardRef<
  HTMLTableCellElement,
  React.TdHTMLAttributes<HTMLTableCellElement> & { numeric?: boolean }
>(({ className, numeric, ...props }, ref) => (
  <td
    ref={ref}
    className={cn("px-3 py-2 align-middle", numeric && "num whitespace-nowrap text-right", className)}
    {...props}
  />
));
TableCell.displayName = "TableCell";

/**
 * The one row an empty table shows: left-aligned, inside the table, saying what is empty and what
 * fills it ("No claims in October. Snap a receipt with New claim."). Keeps the header in place.
 */
export function TableEmptyRow({
  colSpan,
  className,
  children,
  ...props
}: React.TdHTMLAttributes<HTMLTableCellElement> & { colSpan: number }) {
  return (
    <tr className="border-0">
      <td colSpan={colSpan} className={cn("px-3 py-5 text-ui text-primary-300", className)} {...props}>
        {children}
      </td>
    </tr>
  );
}

export const TableCaption = React.forwardRef<HTMLTableCaptionElement, React.HTMLAttributes<HTMLTableCaptionElement>>(
  ({ className, ...props }, ref) => (
    <caption ref={ref} className={cn("mt-3 text-left text-2xs text-primary-200", className)} {...props} />
  ),
);
TableCaption.displayName = "TableCaption";
