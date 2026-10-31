import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "../lib/cn.ts";
import { Button } from "./button.tsx";

export interface PaginationProps {
  /** 1-based current page. */
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
  className?: string;
}

/** "1–25 of 132" + previous/next. */
export function Pagination({ page, pageSize, total, onPageChange, className }: PaginationProps) {
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  return (
    <nav aria-label="Pagination" className={cn("flex items-center justify-between gap-3 px-1 py-2", className)}>
      <p className="num text-2xs text-primary-200" aria-live="polite">
        {from.toLocaleString("en-SG")}–{to.toLocaleString("en-SG")} of {total.toLocaleString("en-SG")}
      </p>
      <div className="flex items-center gap-1">
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label="Previous page"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
        >
          <ChevronLeft />
        </Button>
        <span className="num min-w-[4.5rem] text-center text-2xs text-primary-300">
          {page} / {pageCount}
        </span>
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label="Next page"
          disabled={page >= pageCount}
          onClick={() => onPageChange(page + 1)}
        >
          <ChevronRight />
        </Button>
      </div>
    </nav>
  );
}
