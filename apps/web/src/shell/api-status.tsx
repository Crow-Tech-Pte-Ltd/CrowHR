import { cn } from "@crowhr/ui";
import { useQuery } from "@tanstack/react-query";
import { healthQuery } from "../lib/api.ts";

/** Real data: polls GET /api/health. */
export function ApiStatus({ collapsed = false }: { collapsed?: boolean }) {
  const { data, isPending, isError } = useQuery(healthQuery);
  const ok = data?.status === "ok";
  const label = isPending
    ? "Checking API…"
    : ok
      ? "API connected"
      : isError
        ? "API unreachable"
        : "Database unreachable";
  return (
    <p
      className={cn("flex items-center gap-2 font-azeret text-2xs text-primary-200", collapsed && "justify-center")}
      title={data ? `v${data.version}` : undefined}
    >
      <span
        aria-hidden
        className={cn(
          "size-1.5 shrink-0 rounded-full",
          isPending ? "bg-primary-100" : ok ? "bg-success-300" : "bg-danger-200",
        )}
      />
      <span className={cn(collapsed && "sr-only")}>{label}</span>
    </p>
  );
}
