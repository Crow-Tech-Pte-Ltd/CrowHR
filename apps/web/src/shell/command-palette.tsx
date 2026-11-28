import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@crowhr/ui";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { CircleHelp, LogOut, UserRound } from "lucide-react";
import * as React from "react";
import { useSignOut } from "../auth/sign-out.ts";
import { useT } from "../i18n/index.ts";
import { directoryQuery } from "../routes/_app/people/-lib/api.ts";
import { MODULES, type ModuleId } from "./nav.ts";

const ORDER: ModuleId[] = [
  "home",
  "inbox",
  "people",
  "payroll",
  "leave",
  "attendance",
  "schedules",
  "claims",
  "documents",
  "reports",
  "export-data",
  "settings",
];

/** ⌘K / Ctrl+K: jump to a module or find a person. */
export function CommandPalette({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const t = useT("common");
  const navigate = useNavigate();
  const signOut = useSignOut();
  // People search: the directory is visible to every member; fetched when the palette opens.
  const people = useQuery({ ...directoryQuery({ status: "active,leaving,not_started" }), enabled: open });
  const [search, setSearch] = React.useState("");
  // Enter pressed before the directory arrived (a quick "Okafor⏎"): open the first match when it does.
  const [enterPending, setEnterPending] = React.useState(false);
  React.useEffect(() => {
    if (!open) {
      setSearch("");
      setEnterPending(false);
    }
  }, [open]);
  React.useEffect(() => {
    if (!enterPending || !people.data) return;
    setEnterPending(false);
    const q = search.trim().toLowerCase();
    const match = q
      ? people.data.items.find((p) => `${p.name} ${p.legalName} ${p.employeeNumber}`.toLowerCase().includes(q))
      : undefined;
    if (match) {
      onOpenChange(false);
      void navigate({ to: "/people/$employeeId", params: { employeeId: match.id } });
    }
  }, [enterPending, people.data, search, navigate, onOpenChange]);

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
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t("Command palette")}
      description={t("Search for a page or a person and press Enter.")}
    >
      <CommandInput
        placeholder={t("Jump to a page or find a person…")}
        value={search}
        onValueChange={setSearch}
        onKeyDown={(e) => {
          if (e.key !== "Enter" || people.data || !search.trim()) return;
          // Nothing listed yet for this search: wait for the people instead of doing nothing.
          const listed = document.querySelector("[cmdk-item][data-selected=true]");
          if (!listed) setEnterPending(true);
        }}
      />
      <CommandList>
        <CommandEmpty>{t("No matches. Try a module name like “payroll” or a person’s name.")}</CommandEmpty>
        <CommandGroup heading={t("Go to")}>
          {ORDER.map((id) => {
            const m = MODULES[id];
            const Icon = m.icon;
            return (
              <CommandItem key={id} value={t(m.label)} keywords={[m.label, ...m.keywords]} onSelect={() => go(m.to)}>
                <Icon />
                <span>{t(m.label)}</span>
                <span className="truncate text-2xs text-primary-200">{t(m.summary)}</span>
              </CommandItem>
            );
          })}
        </CommandGroup>
        <CommandSeparator />
        <CommandGroup heading={t("People")}>
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
        <CommandGroup heading={t("Account")}>
          <CommandItem
            value={t("Help")}
            keywords={["Help", "support", "troubleshooting", "recovery"]}
            onSelect={() => go("/help")}
          >
            <CircleHelp />
            {t("Help")}
          </CommandItem>
          <CommandItem
            value={t("Sign out")}
            keywords={["Sign out"]}
            onSelect={() => {
              onOpenChange(false);
              void signOut();
            }}
          >
            <LogOut />
            {t("Sign out")}
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
