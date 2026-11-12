import { cn } from "@crowhr/ui";

/** "crow HR" wordmark: mono lowercase name + the yellow brand chip. */
export function Wordmark({ className, compact = false }: { className?: string; compact?: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 font-azeret text-ink", className)}>
      <span className="sr-only">Crow HR</span>
      {compact ? null : (
        <span aria-hidden="true" className="text-[15px] font-bold leading-none tracking-tight">
          crow
        </span>
      )}
      <span
        aria-hidden="true"
        className="rounded-[4px] border-2 border-ink bg-kuning-200 px-1 py-px text-[11px] font-bold leading-none text-accent-foreground"
      >
        HR
      </span>
    </span>
  );
}
