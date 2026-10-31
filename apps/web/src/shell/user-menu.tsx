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
import { useNavigate } from "@tanstack/react-router";
import { KeyRound, LogOut, Settings } from "lucide-react";
import { SAMPLE_USER } from "../fixtures/session.ts";
import { useViewMode, type ViewMode } from "./view-mode.tsx";

export function UserMenu() {
  const navigate = useNavigate();
  const { mode, setMode } = useViewMode();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="Account menu"
        className="focus-ring flex items-center gap-2 rounded-md p-1 hover:bg-ink/[0.04] data-[state=open]:bg-ink/[0.05] lg:pr-2"
      >
        <Avatar name={SAMPLE_USER.name} size="sm" />
        <span className="hidden text-ui font-medium lg:inline">{SAMPLE_USER.name}</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <div className="flex items-center gap-2.5 px-2 py-2">
          <Avatar name={SAMPLE_USER.name} />
          <div className="min-w-0">
            <p className="truncate text-ui font-medium">{SAMPLE_USER.name}</p>
            <p className="truncate text-2xs text-primary-200">{SAMPLE_USER.email}</p>
          </div>
        </div>
        <div className="px-2 pb-2">
          <Badge variant="muted">Sample user · no sign-in yet</Badge>
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuLabel>Preview layout as</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={mode} onValueChange={(v) => setMode(v as ViewMode)}>
          <DropdownMenuRadioItem value="admin">HR admin</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="employee">Employee</DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => navigate({ to: "/settings" })}>
          <Settings />
          Settings
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => navigate({ to: "/settings/security/sign-in-methods" })}>
          <KeyRound />
          Sign-in methods
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => navigate({ to: "/sign-in" })}>
          <LogOut />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
