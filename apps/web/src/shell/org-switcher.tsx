import {
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@crowhr/ui";
import { Check, ChevronsUpDown, Plus } from "lucide-react";
import { useMe } from "../auth/session.ts";

/** NOT IMPLEMENTED: switching. Shows the current organisation; listing other memberships comes later. */
export function OrgSwitcher({ className }: { className?: string }) {
  const me = useMe();
  const org = { name: me.organisation.name, slug: me.organisation.slug ?? "" };
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={cn(
          "focus-ring flex h-9 min-w-0 items-center gap-2.5 rounded-md px-2 text-left hover:bg-ink/[0.04] data-[state=open]:bg-ink/[0.05]",
          className,
        )}
      >
        <span
          aria-hidden
          className="flex size-6 shrink-0 items-center justify-center rounded-[5px] bg-ink font-azeret text-[11px] font-bold text-surface-50"
        >
          {org.name[0]}
        </span>
        <span className="flex min-w-0 flex-col">
          <span className="truncate text-ui font-medium leading-4">{org.name}</span>
          <span className="num truncate text-[10px] leading-3 text-primary-200">{org.slug}</span>
        </span>
        <ChevronsUpDown className="size-3.5 shrink-0 text-primary-200" aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-72">
        <DropdownMenuLabel>Organisations</DropdownMenuLabel>
        <DropdownMenuItem>
          <Check className="!text-ink" />
          <span className="truncate">{org.name}</span>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled>
          <Plus />
          Add organisation
          <span className="ml-auto font-azeret text-[10px] uppercase tracking-wider">Not yet</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
