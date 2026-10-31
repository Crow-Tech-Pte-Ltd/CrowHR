import { cn, Tooltip, TooltipContent, TooltipTrigger } from "@crowhr/ui";
import { Link } from "@tanstack/react-router";
import { MODULES, type ModuleId } from "./nav.ts";

export function NavLink({
  id,
  collapsed = false,
  onNavigate,
}: {
  id: ModuleId;
  collapsed?: boolean;
  onNavigate?: () => void;
}) {
  const m = MODULES[id];
  const Icon = m.icon;
  const link = (
    <Link
      to={m.to}
      onClick={onNavigate}
      activeOptions={{ exact: m.to === "/", includeSearch: false }}
      className={cn(
        "focus-ring group flex h-8 items-center gap-2.5 rounded-md px-2.5 font-azeret text-xs text-primary-300 transition-colors hover:bg-ink/[0.05] hover:text-ink",
        "data-[status=active]:bg-kuning-200 data-[status=active]:font-semibold data-[status=active]:text-ink",
        collapsed && "w-9 justify-center px-0",
      )}
    >
      <Icon className="size-4 shrink-0" aria-hidden />
      <span className={cn("truncate", collapsed && "sr-only")}>{m.label}</span>
    </Link>
  );
  if (!collapsed) return link;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{link}</TooltipTrigger>
      <TooltipContent side="right">{m.label}</TooltipContent>
    </Tooltip>
  );
}
