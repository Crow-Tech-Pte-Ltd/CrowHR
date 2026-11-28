import {
  Avatar,
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@crowhr/ui";
import { useNavigate } from "@tanstack/react-router";
import {
  Check,
  CircleHelp,
  Download,
  FileText,
  Languages,
  LogOut,
  MonitorSmartphone,
  Settings,
  UserRound,
} from "lucide-react";
import { useRef, useState } from "react";
import { useMe } from "../auth/session.ts";
import { useSignOut } from "../auth/sign-out.ts";
import { ROLE_LABEL } from "../auth/types.ts";
import { LANGUAGES, type Locale, setLocale, useLocale, useT } from "../i18n/index.ts";
import { type ThemePreference, useThemePreference } from "./theme.ts";
import { useLayoutMode, type ViewMode } from "./view-mode.tsx";

export function UserMenu() {
  const t = useT("common");
  const locale = useLocale();
  const [languageOpen, setLanguageOpen] = useState(false);
  const [pendingLanguage, setPendingLanguage] = useState<Locale | null>(null);
  const [languageFailed, setLanguageFailed] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const navigate = useNavigate();
  const me = useMe();
  const { mode, setMode, canSwitch } = useLayoutMode(me.roles);
  const assigned = me.roles.filter((r) => r !== "employee");
  const signOut = useSignOut();
  const [theme, setTheme] = useThemePreference();
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          ref={triggerRef}
          className="focus-ring flex items-center gap-2 rounded-md p-1 hover:bg-ink/[0.04] data-[state=open]:bg-ink/[0.05] lg:pr-2"
        >
          {/* The name is "Account menu" plus the visible name, so speech input users can say what they see. */}
          <span aria-hidden="true" className="contents">
            <Avatar name={me.user.displayName} size="sm" />
          </span>
          <span className="sr-only">{t("Account menu")}</span>
          <span className="hidden text-ui font-medium lg:inline">
            <span className="sr-only">, </span>
            {me.user.displayName}
          </span>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          className="max-h-[var(--radix-dropdown-menu-content-available-height)] w-64 overflow-y-auto"
        >
          <div className="flex items-center gap-2.5 px-2 py-2">
            <Avatar name={me.user.displayName} />
            <div className="min-w-0">
              <p className="truncate text-ui font-medium">{me.user.displayName}</p>
              <p className="truncate text-2xs text-primary-200">{me.user.email}</p>
            </div>
          </div>
          {assigned.length ? (
            <div className="flex flex-wrap gap-1 px-2 pb-2">
              {assigned.map((r) => (
                <Badge key={r} variant="muted">
                  {t(ROLE_LABEL[r] ?? r)}
                </Badge>
              ))}
            </div>
          ) : null}
          {canSwitch ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuLabel>{t("Layout")}</DropdownMenuLabel>
              <DropdownMenuRadioGroup value={mode} onValueChange={(v) => setMode(v as ViewMode)}>
                <DropdownMenuRadioItem value="admin">{t("Work to do")}</DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="employee">{t("Employee")}</DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
            </>
          ) : null}
          <DropdownMenuSeparator />
          {/* Kept in this browser; System follows the device's light or dark setting. */}
          <DropdownMenuLabel>{t("Theme")}</DropdownMenuLabel>
          <DropdownMenuRadioGroup value={theme} onValueChange={(v) => setTheme(v as ThemePreference)}>
            <DropdownMenuRadioItem value="system">{t("System")}</DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="light">{t("Light")}</DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="dark">{t("Dark")}</DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onSelect={() => {
              setLanguageFailed(false);
              setLanguageOpen(true);
            }}
          >
            <Languages className="size-4 shrink-0" aria-hidden />
            <span>{t("Language")}</span>
            <span className="ml-auto text-2xs text-primary-300" lang={locale}>
              {LANGUAGES[locale]}
            </span>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => navigate({ to: "/me/profile" })}>
            <UserRound />
            {t("My profile")}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => navigate({ to: "/me/payslips" })}>
            <FileText />
            {t("My payslips")}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => navigate({ to: "/export-data" })}>
            <Download />
            {t("Export data")}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => navigate({ to: "/me/sessions" })}>
            <MonitorSmartphone />
            {t("Sign-in and devices")}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => navigate({ to: "/help", search: {} })}>
            <CircleHelp />
            {t("Help")}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => navigate({ to: "/settings" })}>
            <Settings />
            {t("Settings")}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => void signOut()}>
            <LogOut />
            {t("Sign out")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Dialog open={languageOpen} onOpenChange={setLanguageOpen}>
        <DialogContent
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            triggerRef.current?.focus();
          }}
        >
          <DialogHeader>
            <DialogTitle>{t("Language")}</DialogTitle>
            <DialogDescription>{t("Choose the language used by Crow HR in this browser.")}</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            {languageFailed ? (
              <p role="alert" className="text-ui text-danger-300">
                {t("Couldn't load that language. Try again.")}
              </p>
            ) : null}
            {Object.entries(LANGUAGES).map(([value, label]) => (
              <Button
                key={value}
                type="button"
                variant={value === locale ? "secondary" : "ghost"}
                className="w-full justify-between"
                lang={value}
                aria-pressed={value === locale}
                aria-busy={pendingLanguage === value}
                disabled={pendingLanguage !== null}
                onClick={async () => {
                  setPendingLanguage(value as Locale);
                  setLanguageFailed(false);
                  const success = await setLocale(value as Locale);
                  setPendingLanguage(null);
                  if (success) setLanguageOpen(false);
                  else setLanguageFailed(true);
                }}
              >
                {label}
                {value === locale ? <Check aria-hidden /> : null}
              </Button>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
