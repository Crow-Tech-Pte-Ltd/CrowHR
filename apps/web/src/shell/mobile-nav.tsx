import { cn, Sheet, SheetContent, SheetDescription, SheetTitle } from "@crowhr/ui";
import { Link } from "@tanstack/react-router";
import { Wordmark } from "../components/wordmark.tsx";
import { ApiStatus } from "./api-status.tsx";
import { EMPLOYEE_TABS, MODULES } from "./nav.ts";
import { NavLink } from "./nav-link.tsx";
import { OrgSwitcher } from "./org-switcher.tsx";
import { NavSections } from "./sidebar.tsx";

/** Admin navigation drawer for < 768px. */
export function NavDrawer({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const close = () => onOpenChange(false);
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="left" className="bg-surface-100">
        <SheetTitle className="sr-only">Navigation</SheetTitle>
        <SheetDescription className="sr-only">Jump to a section of Crow HR.</SheetDescription>
        <div className="flex h-14 items-center border-b border-border px-4">
          <Wordmark />
        </div>
        <div className="border-b border-border p-2">
          <OrgSwitcher className="w-full" />
        </div>
        <nav aria-label="Main navigation" className="flex-1 overflow-y-auto px-3 py-4">
          <NavSections onNavigate={close} />
        </nav>
        <div className="flex flex-col gap-3 border-t border-border p-3">
          <NavLink id="settings" onNavigate={close} />
          <div className="pl-2.5">
            <ApiStatus />
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

/** Employee bottom tab bar for < 768px. */
export function BottomTabBar() {
  return (
    <nav
      aria-label="Employee navigation"
      className="fixed inset-x-0 bottom-0 z-30 border-t border-ink/15 bg-background pb-[env(safe-area-inset-bottom)] md:hidden"
    >
      <ul className="grid grid-cols-4">
        {EMPLOYEE_TABS.map((tab) => {
          const m = MODULES[tab.id];
          const Icon = m.icon;
          return (
            <li key={tab.id}>
              <Link
                to={m.to}
                activeOptions={{ exact: m.to === "/", includeSearch: false }}
                className={cn(
                  "focus-ring group relative flex h-14 flex-col items-center justify-center gap-1 font-azeret text-[10px] font-medium text-primary-200",
                  "data-[status=active]:text-ink",
                )}
              >
                <span
                  aria-hidden
                  className="absolute inset-x-5 top-0 h-[3px] rounded-b-sm bg-transparent group-data-[status=active]:bg-ink"
                />
                <span className="flex h-6 w-10 items-center justify-center rounded-full group-data-[status=active]:bg-kuning-200">
                  <Icon className="size-4" aria-hidden />
                </span>
                {tab.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
