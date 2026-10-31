import { cn } from "@crowhr/ui";
import { Link } from "@tanstack/react-router";
import { can, useMe } from "../auth/session.ts";

type Tab = "clock" | "timesheet" | "team" | "summary";

/** Clock | My timesheet | Team | Summary, under the page header. */
export function AttendanceNav({ current }: { current: Tab }) {
  const me = useMe();
  const scopes = me.permissions["attendance:read"] ?? [];
  const items: {
    to: "/attendance" | "/attendance/timesheet" | "/attendance/team" | "/attendance/summary";
    tab: Tab;
    label: string;
    show: boolean;
  }[] = [
    { to: "/attendance", tab: "clock", label: "Clock", show: !!me.employeeId },
    { to: "/attendance/timesheet", tab: "timesheet", label: "My timesheet", show: !!me.employeeId },
    { to: "/attendance/team", tab: "team", label: "Team", show: scopes.includes("all") || scopes.includes("team") },
    { to: "/attendance/summary", tab: "summary", label: "Summary", show: can(me, "reports_attendance:read") },
  ];
  return (
    <nav aria-label="Attendance" className="mb-5 flex gap-5 overflow-x-auto border-b border-border">
      {items
        .filter((i) => i.show)
        .map((i) => (
          <Link
            key={i.tab}
            to={i.to}
            aria-current={current === i.tab ? "page" : undefined}
            className={cn(
              "focus-ring -mb-px whitespace-nowrap rounded-t-sm border-b-2 px-1 pb-2 font-azeret text-xs font-semibold",
              current === i.tab ? "border-ink text-ink" : "border-transparent text-primary-300 hover:text-ink",
            )}
          >
            {i.label}
          </Link>
        ))}
    </nav>
  );
}
