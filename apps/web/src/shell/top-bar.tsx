import { Button, Kbd } from "@crowhr/ui";
import { Link } from "@tanstack/react-router";
import { Menu, Search } from "lucide-react";
import { Wordmark } from "../components/wordmark.tsx";
import { useT } from "../i18n/index.ts";
import { NotificationBell } from "./notification-bell.tsx";
import { OrgSwitcher } from "./org-switcher.tsx";
import { UserMenu } from "./user-menu.tsx";

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

export function TopBar({ onOpenPalette, onOpenDrawer }: { onOpenPalette: () => void; onOpenDrawer: () => void }) {
  const t = useT("common");
  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-border bg-background/95 px-3 backdrop-blur-[2px] supports-[backdrop-filter]:bg-background/90 md:gap-4 md:px-5">
      {/* Both layouts: on phones the drawer is the way to Attendance, Documents and the rest. */}
      <Button
        variant="ghost"
        size="icon"
        className="md:hidden"
        aria-label={t("Open navigation")}
        onClick={onOpenDrawer}
      >
        <Menu />
      </Button>
      <Link to="/" className="focus-ring rounded-sm md:hidden">
        <Wordmark />
        <span className="sr-only"> {t("home")}</span>
      </Link>
      <OrgSwitcher className="hidden max-w-[16rem] md:flex" />

      <div className="ml-auto flex items-center gap-1 md:ml-0 md:flex-1 md:justify-center">
        <button
          type="button"
          onClick={onOpenPalette}
          className="focus-ring hidden h-9 w-full max-w-md items-center gap-2 rounded-md border border-input bg-surface-50 px-3 text-left text-ui text-primary-200 transition-colors hover:border-ink/40 md:flex"
        >
          <Search className="size-4" aria-hidden />
          <span className="flex-1">{t("Search people or jump to…")}</span>
          <span className="flex gap-0.5" aria-hidden>
            <Kbd>{isMac ? "⌘" : "Ctrl"}</Kbd>
            <Kbd>K</Kbd>
          </span>
          <span className="sr-only">{isMac ? t("(press Command K)") : t("(press Control K)")}</span>
        </button>
        <Button variant="ghost" size="icon" className="md:hidden" aria-label={t("Search")} onClick={onOpenPalette}>
          <Search />
        </Button>
      </div>

      <NotificationBell />
      <UserMenu />
    </header>
  );
}
