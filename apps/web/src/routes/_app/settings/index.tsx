import { createFileRoute, Link } from "@tanstack/react-router";
import { Building2, ChevronRight, KeyRound, type LucideIcon, Network, ScrollText, Users } from "lucide-react";
import { can, useMe } from "../../../auth/session.ts";
import { PageHeader } from "../../../components/page-header.tsx";

const SECTIONS = [
  { title: "Payroll defaults", body: "Pay dates, rounding, bank files." },
  { title: "Leave policies", body: "Leave types, entitlements, carry-forward." },
];

export const Route = createFileRoute("/_app/settings/")({
  component: SettingsPage,
});

function SettingsPage() {
  const me = useMe();
  const links: {
    to: "/settings/security" | "/settings/members" | "/settings/audit";
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
