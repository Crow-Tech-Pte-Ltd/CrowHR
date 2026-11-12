import { cn } from "@crowhr/ui";
import { useQuery } from "@tanstack/react-query";
import { healthQuery } from "../lib/api.ts";

/**
 * Polls GET /api/health and speaks up only when something is wrong: a permanent "connected" dot is
 * developer chrome, but people need to know when their changes aren't being saved.
 */
export function ApiStatus({ collapsed = false, className }: { collapsed?: boolean; className?: string }) {
  const { data, isError } = useQuery(healthQuery);
  const problem = isError
    ? "Can't reach the server. Changes are not saved."
    : data && data.status !== "ok"
      ? "The server can't reach its database. Changes are not saved."
      : null;
  if (!problem) return null;
  return (
    <p
      role="status"
      className={cn("flex items-start gap-2 text-2xs text-danger-300", collapsed && "justify-center", className)}
      title={collapsed ? problem : undefined}
      data-testid="api-status"
    >
      <span aria-hidden className="mt-1 size-1.5 shrink-0 rounded-full bg-danger-200" />
      <span className={cn(collapsed && "sr-only")}>{problem}</span>
    </p>
  );
}
