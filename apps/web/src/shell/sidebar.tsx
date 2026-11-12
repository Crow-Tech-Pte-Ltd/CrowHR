import { cn, textStyle } from "@crowhr/ui";
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
        <div key={group.label ?? group.items.join()} className="flex flex-col gap-0.5">
          {group.label ? (
            collapsed ? (
              <div className="mx-auto mb-1 h-px w-5 bg-border" aria-hidden />
            ) : (
              <p className={cn("mb-1 px-2.5", textStyle.column)}>{group.label}</p>
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
    // The outer column stretches to the full page height, so the background and border never stop
    // at the first viewport on long pages; the inner panel stays pinned to the viewport.
    <aside
      aria-label="Main navigation"
      className={cn(
        "hidden shrink-0 self-stretch border-r border-border bg-surface-100/60 md:block",
        collapsed ? "w-[60px]" : "w-[232px]",
      )}
    >
      <div className="sticky top-0 flex h-dvh flex-col">
        <div className={cn("flex h-14 items-center border-b border-border", collapsed ? "justify-center" : "px-4")}>
          <Link to="/" className="focus-ring rounded-sm">
            <Wordmark compact={collapsed} />
            <span className="sr-only"> home</span>
          </Link>
        </div>
        <nav className={cn("flex-1 overflow-y-auto py-4", collapsed ? "px-3" : "px-3")}>
          <NavSections collapsed={collapsed} />
        </nav>
        <div
          className={cn("flex flex-col gap-3 border-t border-border py-3", collapsed ? "items-center px-3" : "px-3")}
        >
          <NavLink id="settings" collapsed={collapsed} />
          <div className={cn("flex items-center gap-2", collapsed ? "flex-col" : "justify-end pl-2.5")}>
            {/* Renders only when the server or its database can't be reached. */}
            <ApiStatus collapsed={collapsed} className={collapsed ? undefined : "min-w-0 flex-1"} />
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
      </div>
    </aside>
  );
}
