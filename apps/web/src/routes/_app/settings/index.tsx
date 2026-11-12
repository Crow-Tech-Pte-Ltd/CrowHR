import { Card } from "@crowhr/ui";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ChevronRight } from "lucide-react";
import { can, canForAll, useMe } from "../../../auth/session.ts";
import { PageHeader } from "../../../components/page-header.tsx";

export const Route = createFileRoute("/_app/settings/")({
  component: SettingsPage,
});

type SettingsLink = {
  to:
    | "/settings/company"
    | "/settings/structure"
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
    | "/settings/documents"
    | "/payroll"
    | "/payroll/allowances";
  title: string;
  body: string;
  show: boolean;
};

/**
 * Settings as a grouped plain list, like the Reports index: the organisation itself, who can get
 * in, then each module's defaults. Only what the role may manage is listed.
 */
function SettingsPage() {
  const me = useMe();
  // Company and structure are for the people who maintain them; everyone else has nothing to set there.
  const maintainsOrg = canForAll(me, "org_structure:update");
  const groups: { id: string; title: string; links: SettingsLink[] }[] = [
    {
      id: "organisation",
      title: "Organisation",
      links: [
        {
          to: "/settings/company",
          title: "Company",
          body: "Legal name, UEN, CPF submission number, address.",
          show: maintainsOrg,
        },
        {
          to: "/settings/structure",
          title: "Structure",
          body: "Departments, teams, locations, cost centres, work schedules.",
          show: maintainsOrg,
        },
      ],
    },
    {
      id: "access",
      title: "Access",
      links: [
        {
          to: "/settings/security",
          title: "Security",
          body: "Sign-in methods (email, Google, Microsoft, Singpass, OIDC), two-step verification policy, session timeouts.",
          show: me.roles.includes("owner"),
        },
        {
          to: "/settings/members",
          title: "Members and roles",
          body: "Invite people, grant owner, HR admin and payroll admin roles, suspend access.",
          show: can(me, "members:read"),
        },
        {
          to: "/settings/audit",
          title: "Audit log",
          body: "Every sign-in, permission change and sensitive action.",
          show: can(me, "audit_log:read"),
        },
        {
          to: "/settings/system",
          title: "System",
          body: "Version, database, backups, disk space and reverse proxy diagnostics.",
          show: me.roles.includes("owner"),
        },
      ],
    },
    {
      id: "modules",
      title: "Modules",
      links: [
        {
          to: "/settings/approvals",
          title: "Approvals",
          body: "Who approves leave, claims and payroll, amount thresholds, escalation and out-of-office cover.",
          show: can(me, "policies:read"),
        },
        {
          to: "/settings/leave",
          title: "Leave",
          body: "Leave types and entitlements (statutory ones preconfigured), public holidays, and government-paid leave to claim.",
          show: can(me, "policies:read") || can(me, "leave_claims:read"),
        },
        {
          to: "/settings/attendance",
          title: "Attendance",
          body: "Clock-in location and network checks, PDPA notice, start time, lateness grace and overtime rounding.",
          show: can(me, "policies:read"),
        },
        {
          to: "/settings/shift-templates",
          title: "Shift templates",
          body: "The shifts managers pick from on the roster: times, unpaid break, location and marker.",
          show: can(me, "shift_templates:update"),
        },
        {
          to: "/settings/claim-types",
          title: "Claim types",
          body: "What staff can claim, receipt rules, monthly and yearly caps, and how claims are paid.",
          show: can(me, "claim_types:read"),
        },
        {
          // Payroll's settings live with the runs (Payroll → Settings); this opens that dialog.
          to: "/payroll",
          title: "Payroll",
          body: "Pay day, cutoff, payslip release, CPF advice code, FWL levy details and the bank account for salary files.",
          show: can(me, "payroll:read"),
        },
        {
          to: "/payroll/allowances",
          title: "Allowance treatment",
          body: "How each allowance counts for CPF, in incomplete months, and in the gross rate of pay for holiday pay and leave encashment.",
          show: can(me, "payroll:read"),
        },
        {
          to: "/settings/documents",
          title: "Documents",
          body: "Document categories and who sees them, letter templates (offer, KETs, confirmation, salary change, employment certificate).",
          show: can(me, "documents:update"),
        },
      ],
    },
    {
      id: "account",
      title: "Your account",
      links: [
        {
          to: "/settings/notifications",
          title: "Notifications",
          body: "What is emailed to you, and whether this server can send email.",
          show: true,
        },
      ],
    },
  ];
  const visible = groups.map((g) => ({ ...g, links: g.links.filter((l) => l.show) })).filter((g) => g.links.length > 0);
  return (
    <>
      <PageHeader title="Settings" description="Your organisation, who can sign in, and each module's defaults." />
      <div className="flex flex-col gap-8">
        {visible.map((group) => (
          <section key={group.id} aria-labelledby={`settings-${group.id}`}>
            <h2
              id={`settings-${group.id}`}
              className="mb-2 font-azeret text-xs font-semibold uppercase tracking-wider text-primary-300"
            >
              {group.title}
            </h2>
            <Card className="divide-y divide-ink/10">
              {group.links.map((l) => (
                <Link
                  key={l.to}
                  to={l.to}
                  search={l.to === "/payroll" ? { settings: "open" } : undefined}
                  className="focus-ring flex items-center gap-3 px-4 py-3 hover:bg-ink/[0.03]"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium">{l.title}</span>
                    <span className="block text-ui text-primary-300">{l.body}</span>
                  </span>
                  <ChevronRight className="size-4 shrink-0 text-primary-200" aria-hidden />
                </Link>
              ))}
            </Card>
          </section>
        ))}
      </div>
      {visible.every((g) => g.id === "account") ? (
        <p className="mt-6 text-ui text-primary-300">
          Your role doesn't manage the organisation's settings. Your profile, sign-in and devices are under your name,
          top right.
        </p>
      ) : null}
    </>
  );
}
