import { cn, Toaster, TooltipProvider } from "@crowhr/ui";
import * as React from "react";
import { useMe } from "../auth/session.ts";
import { CommandPalette } from "./command-palette.tsx";
import { BottomTabBar, NavDrawer } from "./mobile-nav.tsx";
import { Sidebar } from "./sidebar.tsx";
import { TopBar } from "./top-bar.tsx";
import { useLayoutMode, usePersistentBoolean } from "./view-mode.tsx";

export function AppShell({ children }: { children: React.ReactNode }) {
  const [collapsed, setCollapsed] = usePersistentBoolean("crowhr.sidebarCollapsed", false);
  const [paletteOpen, setPaletteOpen] = React.useState(false);
  const [drawerOpen, setDrawerOpen] = React.useState(false);
  const { mode } = useLayoutMode(useMe().roles);

  return (
    <TooltipProvider delayDuration={300}>
      <a
        href="#main"
        className="focus-ring sr-only z-50 rounded-md bg-ink px-3 py-2 font-azeret text-xs text-surface-50 focus:not-sr-only focus:fixed focus:left-3 focus:top-3"
      >
        Skip to content
      </a>
      <div className="flex min-h-dvh">
        <Sidebar collapsed={collapsed} onToggle={() => setCollapsed(!collapsed)} />
        <div className="flex min-w-0 flex-1 flex-col">
          <TopBar onOpenPalette={() => setPaletteOpen(true)} onOpenDrawer={() => setDrawerOpen(true)} />
          <main
            id="main"
            className={cn(
              "mx-auto w-full max-w-[1240px] flex-1 px-4 pb-10 pt-6 md:px-8 md:pt-8",
              mode === "employee" && "pb-24 md:pb-10",
            )}
          >
            {children}
          </main>
        </div>
      </div>
      {mode === "employee" ? <BottomTabBar /> : null}
      <NavDrawer open={drawerOpen} onOpenChange={setDrawerOpen} />
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
      <Toaster />
    </TooltipProvider>
  );
}
