import { createFileRoute, Link } from "@tanstack/react-router";
import {
  Bell,
  Building2,
  CalendarClock,
  CalendarDays,
  ChevronRight,
  Clock,
  FileText,
  GitBranch,
  KeyRound,
  type LucideIcon,
  Network,
  ReceiptText,
  ScrollText,
  Server,
  Users,
} from "lucide-react";
import { can, useMe } from "../../../auth/session.ts";
import { PageHeader } from "../../../components/page-header.tsx";

const SECTIONS = [{ title: "Payroll defaults", body: "Pay dates, rounding, bank files." }];

export const Route = createFileRoute("/_app/settings/")({
  component: SettingsPage,
});

function SettingsPage() {
  const me = useMe();
  const links: {
    to:
      | "/settings/security"
      | "/settings/members"
      | "/settings/audit"
      | "/settings/system"
      | "/settings/approvals"
      | "/settings/notifications"
      | "/settings/claim-types"
      | "/settings/leave"
      | "/settings/attendance"
      | "/settings/shift-templates"
      | "/settings/documents";
    title: string;
    body: string;
    icon: LucideIcon;
    show: boolean;
  }[] = [
    {
      to: "/settings/security",
      title: "Security",
      body: "Sign-in methods (email, Google, Microsoft, Singpass, OIDC), two-step verification policy, session timeouts.",
      icon: KeyRound,
      show: me.roles.includes("owner"),
    },
    {
      to: "/settings/members",
      title: "Members and roles",
      body: "Invite people, grant owner, HR admin and payroll admin roles, suspend access.",
      icon: Users,
      show: can(me, "members:read"),
    },
    {
      to: "/settings/audit",
      title: "Audit log",
      body: "Every sign-in, permission change and sensitive action.",
      icon: ScrollText,
      show: can(me, "audit_log:read"),
    },
    {
      to: "/settings/system",
      title: "System",
      body: "Version, database, backups, disk space and reverse proxy diagnostics.",
      icon: Server,
      show: me.roles.includes("owner"),
    },
    {
      to: "/settings/approvals",
      title: "Approvals",
      body: "Who approves leave, claims and payroll, amount thresholds, escalation and out-of-office cover.",
      icon: GitBranch,
      show: can(me, "policies:read"),
    },
    {
      to: "/settings/claim-types",
      title: "Claim types",
      body: "What staff can claim, receipt rules, monthly and yearly caps, and how claims are paid.",
      icon: ReceiptText,
      show: can(me, "claim_types:read"),
    },
    {
      to: "/settings/leave",
      title: "Leave",
      body: "Leave types and entitlements (statutory ones preconfigured), public holidays, and government-paid leave to claim.",
      icon: CalendarDays,
      show: can(me, "policies:read") || can(me, "leave_claims:read"),
    },
    {
      to: "/settings/attendance",
      title: "Attendance",
      body: "Clock-in location and network checks, PDPA notice, start time, lateness grace and overtime rounding.",
      icon: Clock,
      show: can(me, "policies:read"),
    },
    {
      to: "/settings/shift-templates",
      title: "Shift templates",
      body: "The shifts managers pick from on the roster: times, unpaid break, location and marker.",
      icon: CalendarClock,
      show: can(me, "shift_templates:update"),
    },
    {
      to: "/settings/documents",
      title: "Documents",
      body: "Document categories and who sees them, letter templates (offer, KETs, confirmation, salary change, employment certificate).",
      icon: FileText,
      show: can(me, "documents:update"),
    },
    {
      to: "/settings/notifications",
      title: "Notifications",
      body: "What is emailed to you, and whether this server can send email.",
      icon: Bell,
      show: true,
    },
  ];
  return (
    <>
      <PageHeader title="Settings" description="Organisation, security and module defaults." />
      <section aria-labelledby="org-heading" className="mb-8">
        <h2
          id="org-heading"
          className="mb-2 font-azeret text-2xs font-medium uppercase tracking-wider text-primary-200"
        >
          Organisation
        </h2>
        <div className="grid gap-2 sm:grid-cols-2">
          {[
            {
              to: "/settings/company",
              title: "Company",
              body: "Legal name, UEN, CPF submission number, address.",
              Icon: Building2,
            },
            {
              to: "/settings/structure",
              title: "Structure",
              body: "Departments, teams, locations, cost centres, work schedules.",
              Icon: Network,
            },
          ].map(({ to, title, body, Icon }) => (
            <Link
              key={to}
              to={to}
              className="focus-ring group flex items-center gap-3 rounded-lg border border-border bg-surface-50 px-4 py-3 hover:border-ink/40"
            >
              <span className="flex size-8 items-center justify-center rounded-md border border-ink/15 bg-surface-100">
                <Icon className="size-4" aria-hidden />
              </span>
              <span className="flex-1">
                <span className="block font-azeret text-xs font-semibold">{title}</span>
                <span className="block text-ui text-primary-300">{body}</span>
              </span>
              <ChevronRight className="size-4 text-primary-200 group-hover:text-ink" aria-hidden />
            </Link>
          ))}
        </div>
      </section>
      <section aria-labelledby="security-heading" className="mb-8">
        <h2
          id="security-heading"
          className="mb-2 font-azeret text-2xs font-medium uppercase tracking-wider text-primary-200"
        >
          Access and security
        </h2>
        <div className="flex flex-col gap-2">
          {links
            .filter((l) => l.show)
            .map((l) => (
              <Link
                key={l.to}
                to={l.to}
                className="focus-ring group flex items-center gap-3 rounded-lg border border-border bg-surface-50 px-4 py-3 hover:border-ink/40"
              >
                <span className="flex size-8 items-center justify-center rounded-md border border-ink/15 bg-surface-100">
                  <l.icon className="size-4" aria-hidden />
                </span>
                <span className="flex-1">
                  <span className="block font-azeret text-xs font-semibold">{l.title}</span>
                  <span className="block text-ui text-primary-300">{l.body}</span>
                </span>
                <ChevronRight className="size-4 text-primary-200 group-hover:text-ink" aria-hidden />
              </Link>
            ))}
          {links.every((l) => !l.show) ? (
            <p className="text-ui text-primary-300">
              Your role doesn't manage access. Your own sign-in settings are under your name, top right.
            </p>
          ) : null}
        </div>
      </section>
      <section aria-labelledby="other-heading">
        <h2
          id="other-heading"
          className="mb-2 font-azeret text-2xs font-medium uppercase tracking-wider text-primary-200"
        >
          Coming later
        </h2>
        <ul className="divide-y divide-border rounded-lg border border-border">
          {SECTIONS.map((s) => (
            <li
              key={s.title}
              className="flex flex-col gap-0.5 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
            >
              <span>
                <span className="block font-azeret text-xs font-semibold text-primary-300">{s.title}</span>
                <span className="block text-ui text-primary-200">{s.body}</span>
              </span>
              <span className="font-azeret text-[10px] uppercase tracking-wider text-primary-200">
                Not available yet
              </span>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
