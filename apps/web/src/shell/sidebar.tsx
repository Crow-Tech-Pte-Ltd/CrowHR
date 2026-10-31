import { cn } from "@crowhr/ui";
import { Link } from "@tanstack/react-router";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { Wordmark } from "../components/wordmark.tsx";
import { ApiStatus } from "./api-status.tsx";
import { NAV_GROUPS } from "./nav.ts";
import { NavLink } from "./nav-link.tsx";

export function NavSections({ collapsed = false, onNavigate }: { collapsed?: boolean; onNavigate?: () => void }) {
  return (
    <div className="flex flex-col gap-5">
      {NAV_GROUPS.map((group) => (
        <div key={group.label ?? "top"} className="flex flex-col gap-0.5">
          {group.label ? (
            collapsed ? (
              <div className="mx-auto mb-1 h-px w-5 bg-border" aria-hidden />
            ) : (
              <p className="mb-1 px-2.5 font-azeret text-[10px] font-medium uppercase tracking-[0.12em] text-primary-200">
                {group.label}
              </p>
            )
          ) : null}
          {group.items.map((id) => (
            <NavLink key={id} id={id} collapsed={collapsed} onNavigate={onNavigate} />
          ))}
        </div>
      ))}
    </div>
  );
}

export function Sidebar({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  return (
    <aside
      aria-label="Main navigation"
      className={cn(
        "sticky top-0 hidden h-dvh shrink-0 flex-col border-r border-border bg-surface-100/60 md:flex",
        collapsed ? "w-[60px]" : "w-[232px]",
      )}
    >
      <div className={cn("flex h-14 items-center border-b border-border", collapsed ? "justify-center" : "px-4")}>
        <Link to="/" className="focus-ring rounded-sm" aria-label="Crow HR home">
          <Wordmark compact={collapsed} />
        </Link>
      </div>
      <nav className={cn("flex-1 overflow-y-auto py-4", collapsed ? "px-3" : "px-3")}>
        <NavSections collapsed={collapsed} />
      </nav>
      <div className={cn("flex flex-col gap-3 border-t border-border py-3", collapsed ? "items-center px-3" : "px-3")}>
        <NavLink id="settings" collapsed={collapsed} />
        <div className={cn("flex items-center gap-2", collapsed ? "flex-col" : "justify-between pl-2.5")}>
          <ApiStatus collapsed={collapsed} />
          <button
            type="button"
            onClick={onToggle}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            aria-expanded={!collapsed}
            className="focus-ring rounded-sm p-1 text-primary-200 hover:bg-ink/5 hover:text-ink"
          >
            {collapsed ? <PanelLeftOpen className="size-4" /> : <PanelLeftClose className="size-4" />}
          </button>
        </div>
      </div>
    </aside>
  );
}
