import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "@crowhr/ui";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { LogOut, UserRound } from "lucide-react";
import * as React from "react";
import { directoryQuery } from "../routes/_app/people/-lib/api.ts";
import { MODULES, type ModuleId } from "./nav.ts";

const ORDER: ModuleId[] = [
  "home",
  "people",
  "payroll",
  "leave",
  "attendance",
  "schedules",
  "claims",
  "documents",
  "reports",
  "settings",
];

/** ⌘K / Ctrl+K: jump to a module or find a person. */
export function CommandPalette({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const navigate = useNavigate();
  // People search: the directory is visible to every member; fetched when the palette opens.
  const people = useQuery({ ...directoryQuery({ status: "active,leaving,not_started" }), enabled: open });

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        onOpenChange(!open);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onOpenChange]);

  const go = (to: string) => {
    onOpenChange(false);
    void navigate({ to });
  };

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput placeholder="Jump to a page or find a person…" />
      <CommandList>
        <CommandEmpty>No matches. Try a module name like “payroll” or a person’s name.</CommandEmpty>
        <CommandGroup heading="Go to">
          {ORDER.map((id) => {
            const m = MODULES[id];
            const Icon = m.icon;
            return (
              <CommandItem key={id} value={m.label} keywords={m.keywords} onSelect={() => go(m.to)}>
                <Icon />
                <span>{m.label}</span>
                <span className="truncate text-2xs text-primary-200">{m.summary}</span>
              </CommandItem>
            );
          })}
        </CommandGroup>
        <CommandSeparator />
        <CommandGroup heading="People">
          {(people.data?.items ?? []).map((p) => (
            <CommandItem
              key={p.id}
              value={`person ${p.name} ${p.legalName} ${p.employeeNumber}`}
              onSelect={() => {
                onOpenChange(false);
                void navigate({ to: "/people/$employeeId", params: { employeeId: p.id } });
              }}
            >
              <UserRound />
              {p.name}
              <span className="num truncate text-2xs text-primary-200">
                {p.employeeNumber} · {p.jobTitle ?? ""}
              </span>
            </CommandItem>
          ))}
        </CommandGroup>
        <CommandSeparator />
        <CommandGroup heading="Account">
          <CommandItem value="Sign out" onSelect={() => go("/sign-in")}>
            <LogOut />
            Sign out
            <CommandShortcut>preview</CommandShortcut>
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
