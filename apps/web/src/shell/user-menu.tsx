import {
  Avatar,
  Badge,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@crowhr/ui";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { FileText, LogOut, MonitorSmartphone, Settings, UserRound } from "lucide-react";
import { useMe } from "../auth/session.ts";
import { useSignOut } from "../auth/sign-out.ts";
import { ROLE_LABEL } from "../auth/types.ts";
import { type ThemePreference, useThemePreference } from "./theme.ts";
import { useLayoutMode, type ViewMode } from "./view-mode.tsx";

export function UserMenu() {
  const navigate = useNavigate();
  const _qc = useQueryClient();
  const me = useMe();
  const { mode, setMode, canSwitch } = useLayoutMode(me.roles);
  const assigned = me.roles.filter((r) => r !== "employee");
  const signOut = useSignOut();
  const [theme, setTheme] = useThemePreference();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="focus-ring flex items-center gap-2 rounded-md p-1 hover:bg-ink/[0.04] data-[state=open]:bg-ink/[0.05] lg:pr-2">
        {/* The name is "Account menu" plus the visible name, so speech input users can say what they see. */}
        <span aria-hidden="true" className="contents">
          <Avatar name={me.user.displayName} size="sm" />
        </span>
        <span className="sr-only">Account menu</span>
        <span className="hidden text-ui font-medium lg:inline">
          <span className="sr-only">, </span>
          {me.user.displayName}
        </span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
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
                {ROLE_LABEL[r]}
              </Badge>
            ))}
          </div>
        ) : null}
        {canSwitch ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>Layout</DropdownMenuLabel>
            <DropdownMenuRadioGroup value={mode} onValueChange={(v) => setMode(v as ViewMode)}>
              <DropdownMenuRadioItem value="admin">Work to do</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="employee">Employee</DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
          </>
        ) : null}
        <DropdownMenuSeparator />
        {/* Kept in this browser; System follows the device's light or dark setting. */}
        <DropdownMenuLabel>Theme</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={theme} onValueChange={(v) => setTheme(v as ThemePreference)}>
          <DropdownMenuRadioItem value="system">System</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="light">Light</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="dark">Dark</DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => navigate({ to: "/me/profile" })}>
          <UserRound />
          My profile
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => navigate({ to: "/me/payslips" })}>
          <FileText />
          My payslips
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => navigate({ to: "/me/sessions" })}>
          <MonitorSmartphone />
          Sign-in and devices
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => navigate({ to: "/settings" })}>
          <Settings />
          Settings
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => void signOut()}>
          <LogOut />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
