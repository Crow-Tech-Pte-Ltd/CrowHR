import { Button, cn, Popover, PopoverContent, PopoverTrigger, Skeleton } from "@crowhr/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useRouter } from "@tanstack/react-router";
import { Bell } from "lucide-react";
import * as React from "react";
import { apiPost } from "../lib/api.ts";
import { type NotificationItem, notificationsQuery, unreadQuery } from "../workflows/api.ts";
import { ageLabel, sgDate } from "../workflows/format.ts";

/** Top-bar bell with the unread count (workflows "In-app notifications"). */
export function NotificationBell() {
  const qc = useQueryClient();
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const unread = useQuery(unreadQuery);
  const list = useQuery({ ...notificationsQuery, enabled: open });
  const count = unread.data?.unread ?? 0;
  const today = sgDate(new Date().toISOString());
  const refresh = () => void qc.invalidateQueries({ queryKey: ["notifications"] });
  const markAll = useMutation({ mutationFn: () => apiPost("/api/v1/notifications/read-all"), onSuccess: refresh });
  const openOne = async (n: NotificationItem) => {
    setOpen(false);
    if (!n.readAt) {
      try {
        await apiPost(`/api/v1/notifications/${n.id}/read`);
      } finally {
        refresh();
      }
    }
    router.history.push(n.link);
  };
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative"
          aria-label={count ? `Notifications, ${count} unread` : "Notifications"}
          data-testid="notification-bell"
        >
          <Bell />
          {count ? (
            <span
              className="num absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full border border-ink bg-kuning-200 px-1 text-[10px] font-semibold leading-none text-ink"
              data-testid="unread-count"
            >
              {count > 99 ? "99+" : count}
            </span>
          ) : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(92vw,380px)] p-0">
        <div className="flex items-center justify-between border-b border-border px-3 py-2">
          <p className="font-azeret text-2xs font-semibold uppercase tracking-wider">Notifications</p>
          {count ? (
            <button
              type="button"
              className="focus-ring rounded-sm text-2xs font-medium text-biru-400 hover:underline"
              onClick={() => markAll.mutate()}
            >
              Mark all read
            </button>
          ) : null}
        </div>
        {list.isPending ? (
          <div className="flex flex-col gap-2 p-3">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </div>
        ) : list.isError ? (
          <p className="p-3 text-ui text-danger-300">Notifications didn't load. Close this and try again.</p>
        ) : list.data.items.length === 0 ? (
          <p className="p-4 text-ui text-primary-300">
            No notifications yet. Decisions on your requests and tasks for you appear here.
          </p>
        ) : (
          <ul className="max-h-[60vh] divide-y divide-border overflow-y-auto" aria-label="Notifications">
            {list.data.items.map((n) => (
              <li key={n.id}>
                <button
                  type="button"
                  onClick={() => void openOne(n)}
                  className="focus-ring flex w-full gap-2.5 px-3 py-2.5 text-left hover:bg-ink/[0.03]"
                >
                  <span
                    aria-hidden
                    className={cn("mt-1.5 size-1.5 shrink-0 rounded-full", n.readAt ? "bg-transparent" : "bg-biru-400")}
                  />
                  <span className="min-w-0">
                    <span className={cn("block text-ui leading-5", !n.readAt && "font-medium")}>{n.title}</span>
                    {n.body ? <span className="block truncate text-2xs text-primary-300">{n.body}</span> : null}
                    <span className="num block text-2xs text-primary-200">
                      {ageLabel(n.createdAt, today)}
                      {n.readAt ? "" : <span className="sr-only"> (unread)</span>}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="border-t border-border px-3 py-2">
          <Link
            to="/settings/notifications"
            onClick={() => setOpen(false)}
            className="focus-ring rounded-sm text-2xs font-medium text-biru-400 hover:underline"
          >
            Notification settings
          </Link>
        </div>
      </PopoverContent>
    </Popover>
  );
}
