import {
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  toast,
} from "@crowhr/ui";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Check, ChevronsUpDown, Loader2, Plus } from "lucide-react";
import * as React from "react";
import { useMe } from "../auth/session.ts";
import { ApiError, apiGet, apiPost } from "../lib/api.ts";

export interface MyOrganisation {
  id: string;
  name: string;
  slug: string;
  current: boolean;
  status: "active" | "former";
}

export const myOrganisationsQuery = {
  queryKey: ["me", "organisations"] as const,
  queryFn: () => apiGet<{ items: MyOrganisation[] }>("/api/v1/me/organisations"),
  staleTime: 60_000,
};

/** What to say when a switch is refused, and where to go instead. */
export function switchFailure(err: unknown, org: Pick<MyOrganisation, "name" | "slug">): string {
  if (err instanceof ApiError) {
    if (err.code === "password_sign_in_disabled")
      return `${org.name} uses single sign-on. Sign in from its sign-in page: /sign-in/${org.slug}.`;
    if (err.code === "reauth_required" || err.code === "not_found") return err.message;
  }
  return `Couldn't switch to ${org.name}. Try again, or sign in from /sign-in/${org.slug}.`;
}

/**
 * The organisations this person belongs to; choosing one moves this browser's session to it
 * (`POST /auth/switch-organisation`) and reloads the app, so nothing of the old organisation stays
 * in memory.
 */
export function OrgSwitcher({ className }: { className?: string }) {
  const me = useMe();
  const [open, setOpen] = React.useState(false);
  const list = useQuery({ ...myOrganisationsQuery, enabled: open });
  const switchTo = useMutation({
    mutationFn: (org: MyOrganisation) =>
      apiPost<{ orgSlug: string }>("/api/v1/auth/switch-organisation", { org: org.slug }),
    onSuccess: () => window.location.assign("/"),
    onError: (err, org) => toast.error(switchFailure(err, org)),
  });
  const current = { name: me.organisation.name, slug: me.organisation.slug ?? "" };
  const others = (list.data?.items ?? []).filter((o) => !o.current);
  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
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
          {current.name[0]}
        </span>
        <span className="flex min-w-0 flex-col">
          <span className="truncate text-ui font-medium leading-4">{current.name}</span>
          <span className="num truncate text-[10px] leading-3 text-primary-200">{current.slug}</span>
        </span>
        <span className="sr-only">Switch organisation</span>
        <ChevronsUpDown className="size-3.5 shrink-0 text-primary-200" aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-72">
        <DropdownMenuLabel>Organisations</DropdownMenuLabel>
        <DropdownMenuItem disabled className="data-[disabled]:opacity-100">
          <Check className="!text-ink" />
          <span className="truncate">{current.name}</span>
          <span className="ml-auto font-azeret text-[10px] uppercase tracking-wider text-primary-200">Current</span>
        </DropdownMenuItem>
        {list.isPending ? (
          <DropdownMenuItem disabled>
            <Loader2 className="animate-spin" />
            Loading your other organisations…
          </DropdownMenuItem>
        ) : list.isError ? (
          <DropdownMenuItem
            onSelect={(e) => {
              e.preventDefault();
              void list.refetch();
            }}
          >
            Couldn't load your other organisations. Try again
          </DropdownMenuItem>
        ) : (
          others.map((o) => (
            <DropdownMenuItem
              key={o.id}
              disabled={switchTo.isPending}
              onSelect={(e) => {
                e.preventDefault();
                switchTo.mutate(o);
              }}
            >
              <span aria-hidden className="size-4" />
              <span className="min-w-0 truncate">{o.name}</span>
              <span className="ml-auto font-azeret text-[10px] uppercase tracking-wider text-primary-200">
                {switchTo.isPending && switchTo.variables?.id === o.id
                  ? "Switching…"
                  : o.status === "former"
                    ? "Former"
                    : o.slug}
              </span>
            </DropdownMenuItem>
          ))
        )}
        {list.isSuccess && others.length === 0 ? (
          <p className="px-2 py-1.5 text-2xs text-primary-300">You belong to this organisation only.</p>
        ) : null}
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
