import { cn, textStyle } from "@crowhr/ui";
import { Link } from "@tanstack/react-router";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { Wordmark } from "../components/wordmark.tsx";
import { useT } from "../i18n/index.ts";
import { ApiStatus } from "./api-status.tsx";
import { NAV_GROUPS } from "./nav.ts";
import { NavLink } from "./nav-link.tsx";

export function NavSections({ collapsed = false, onNavigate }: { collapsed?: boolean; onNavigate?: () => void }) {
  const t = useT("common");
  return (
    <div className="flex flex-col gap-3.5">
      {NAV_GROUPS.map((group) => (
        <div key={group.label ?? group.items.join()} className="flex flex-col gap-0.5">
          {group.label ? (
            collapsed ? (
              <div className="mx-auto mb-1 h-px w-5 bg-border" aria-hidden />
            ) : (
              <p className={cn("mb-1 px-2.5", textStyle.column)}>{t(group.label)}</p>
            )
          ) : null}
          <ul aria-label={group.label ? t(group.label) : undefined} className="flex flex-col gap-0.5">
            {group.items.map((id) => (
              <li key={id}>
                <NavLink id={id} collapsed={collapsed} onNavigate={onNavigate} />
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

export function Sidebar({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  const t = useT("common");
  return (
    // The outer column stretches to the full page height, so the background and border never stop
    // at the first viewport on long pages; the inner panel stays pinned to the viewport.
    <aside
      aria-label={t("Main navigation")}
      className={cn(
        "hidden shrink-0 self-stretch border-r border-border bg-surface-100/60 md:block",
        collapsed ? "w-[60px]" : "w-[232px]",
      )}
    >
      <div className="sticky top-0 flex h-dvh flex-col">
        <div
          className={cn(
            "flex h-14 shrink-0 items-center border-b border-border",
            collapsed ? "justify-center gap-0.5 px-0.5" : "justify-between gap-2 px-3",
          )}
        >
          <Link to="/" className="focus-ring block min-w-0 rounded-sm">
            <Wordmark compact={collapsed} className={collapsed ? "max-w-6" : undefined} />
            <span className="sr-only"> {t("home")}</span>
          </Link>
          <button
            type="button"
            onClick={onToggle}
            aria-label={collapsed ? t("Expand sidebar") : t("Collapse sidebar")}
            aria-expanded={!collapsed}
            className="focus-ring grid size-7 shrink-0 place-items-center rounded-sm text-primary-200 hover:bg-ink/5 hover:text-ink"
          >
            {collapsed ? (
              <PanelLeftOpen aria-hidden className="size-4" />
            ) : (
              <PanelLeftClose aria-hidden className="size-4" />
            )}
          </button>
        </div>
        <nav className="flex-1 overflow-y-auto px-3 py-3">
          <NavSections collapsed={collapsed} />
        </nav>
        <div className={cn("flex flex-col gap-2 border-t border-border px-3 py-2", collapsed && "items-center")}>
          <NavLink id="settings" collapsed={collapsed} />
          <ApiStatus collapsed={collapsed} className={collapsed ? undefined : "min-w-0 px-2.5"} />
        </div>
      </div>
    </aside>
  );
}
