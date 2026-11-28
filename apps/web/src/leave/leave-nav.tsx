import { cn } from "@crowhr/ui";
import { Link } from "@tanstack/react-router";
import { useT } from "../i18n/index.ts";

/** My leave | Team calendar, under the page header. */
export function LeaveNav({ current }: { current: "mine" | "team" }) {
  const tWorkflow = useT("workflows");
  const item = (to: "/leave" | "/leave/team", label: string, active: boolean) => (
    <Link
      to={to}
      aria-current={active ? "page" : undefined}
      className={cn(
        "focus-ring -mb-px rounded-t-sm border-b-2 px-1 pb-2 font-azeret text-xs font-semibold",
        active ? "border-ink text-ink" : "border-transparent text-primary-300 hover:text-ink",
      )}
    >
      {tWorkflow(label)}
    </Link>
  );
  return (
    <nav aria-label={tWorkflow("Leave")} className="mb-5 flex gap-5 border-b border-border">
      {item("/leave", "My leave", current === "mine")}
      {item("/leave/team", "Calendar", current === "team")}
    </nav>
  );
}
