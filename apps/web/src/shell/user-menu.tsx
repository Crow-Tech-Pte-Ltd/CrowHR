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
  toast,
} from "@crowhr/ui";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { LogOut, MonitorSmartphone, Settings, UserRound } from "lucide-react";
import { useMe } from "../auth/session.ts";
import { ROLE_LABEL } from "../auth/types.ts";
import { apiPost } from "../lib/api.ts";
import { useViewMode, type ViewMode } from "./view-mode.tsx";

export function UserMenu() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const me = useMe();
  const { mode, setMode } = useViewMode();
  const assigned = me.roles.filter((r) => r !== "employee");
  const signOut = async () => {
    try {
      await apiPost("/api/v1/auth/sign-out");
    } catch {
      toast.error("Couldn't reach the server, but you've been signed out on this device.");
    }
    qc.clear();
    await navigate({ to: "/sign-in", search: { reason: "signed_out" } });
  };
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="Account menu"
        className="focus-ring flex items-center gap-2 rounded-md p-1 hover:bg-ink/[0.04] data-[state=open]:bg-ink/[0.05] lg:pr-2"
      >
        <Avatar name={me.user.displayName} size="sm" />
        <span className="hidden text-ui font-medium lg:inline">{me.user.displayName}</span>
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
        <DropdownMenuSeparator />
        <DropdownMenuLabel>Preview layout as</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={mode} onValueChange={(v) => setMode(v as ViewMode)}>
          <DropdownMenuRadioItem value="admin">HR admin</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="employee">Employee</DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => navigate({ to: "/me/profile" })}>
          <UserRound />
          My profile
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
