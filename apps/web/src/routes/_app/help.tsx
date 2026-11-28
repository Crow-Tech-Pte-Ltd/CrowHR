import { Button, Card, cn, textStyle } from "@crowhr/ui";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, linkOptions } from "@tanstack/react-router";
import { ChevronRight, Clipboard, Mail } from "lucide-react";
import { useState } from "react";
import { can, useMe } from "../../auth/session.ts";
import { PageHeader } from "../../components/page-header.tsx";
import { diagnostics, requestReference, supportEmail, systemChecks } from "../../help/diagnostics.ts";
import { systemStatusQuery } from "../../help/system-status.ts";
import { DOCS, helpTopic, TOPICS, type Topic } from "../../help/topics.ts";
import { healthQuery } from "../../lib/api.ts";

export const Route = createFileRoute("/_app/help")({
  validateSearch: (s: Record<string, unknown>): { topic?: Topic; reference?: string } => ({
    topic: helpTopic(s.topic),
    reference: requestReference(s.reference),
  }),
  component: HelpPage,
});

const SHORTCUTS = linkOptions([
  { topic: "access", to: "/settings/members", label: "Members and roles", permission: "members:read" },
  { topic: "access", to: "/settings/notifications", label: "Email delivery", permission: null },
  { topic: "permissions", to: "/settings/members", label: "Members and roles", permission: "members:read" },
  { topic: "approvals", to: "/inbox", label: "My requests", permission: null, search: { view: "mine" } },
  { topic: "approvals", to: "/settings/approvals", label: "Approval settings", permission: "policies:read" },
  { topic: "payroll", to: "/me/payslips", label: "My payslips", permission: "payslips:read", employee: true },
  { topic: "payroll", to: "/payroll", label: "Open payroll runs", permission: "payroll:read" },
  {
    topic: "attendance",
    to: "/attendance/timesheet",
    label: "My timesheet",
    permission: "attendance:read",
    employee: true,
  },
  { topic: "attendance", to: "/leave", label: "Open leave", permission: "leave:read", employee: true },
  { topic: "service", to: "/settings/system", label: "System status", permission: null, owner: true },
]);

const topicList = Object.entries(TOPICS) as [Topic, (typeof TOPICS)[Topic]][];

function HelpPage() {
  const me = useMe();
  const { topic = "access", reference } = Route.useSearch();
  const current = TOPICS[topic];
  const health = useQuery({ ...healthQuery, retry: false });
  const owner = me.roles.includes("owner");
  const canContactSupport = owner && !me.demoMode && !me.demoCompany;
  const system = useQuery({ ...systemStatusQuery, enabled: owner && topic === "service" });
  const status = owner && topic === "service" ? system.data : undefined;
  const checks = status ? systemChecks(status) : [];
  const links = SHORTCUTS.filter(
    (link) =>
      link.topic === topic &&
      (link.permission === null || can(me, link.permission)) &&
      (!("employee" in link) || Boolean(me.employeeId)) &&
      (!("owner" in link) || owner),
  );
  const summary = diagnostics({
    topic: current.title,
    version: status?.version ?? health.data?.version,
    time: status?.time ?? health.data?.time,
    reference,
    system: status,
  });
  const [copyStatus, setCopyStatus] = useState<{ text: string; message: string } | null>(null);

  async function copySummary() {
    try {
      await navigator.clipboard.writeText(summary);
      setCopyStatus({ text: summary, message: "Technical summary copied." });
    } catch {
      setCopyStatus({ text: summary, message: "Select the technical summary and copy it manually." });
    }
  }

  return (
    <>
      <PageHeader title="Help" description="Find the steps to fix an issue or see who at your company can help." />
      <div className="grid gap-6 md:grid-cols-[16rem_minmax(0,1fr)]">
        <nav aria-label="Help topics">
          <Card className="overflow-hidden divide-y divide-border">
            {topicList.map(([id, info]) => (
              <Link
                key={id}
                to="/help"
                search={{ topic: id, reference }}
                aria-current={id === topic ? "page" : undefined}
                className={cn(
                  "focus-ring relative flex items-center justify-between gap-2 px-4 py-2.5 text-ui hover:bg-ink/[0.04] focus-visible:z-10",
                  id === topic && "bg-kuning-200 font-semibold text-accent-foreground hover:bg-kuning-300",
                )}
              >
                {info.title}
                <ChevronRight className="size-4 shrink-0" aria-hidden />
              </Link>
            ))}
          </Card>
        </nav>
        <div className="min-w-0 space-y-4">
          <Card className="space-y-4 p-4" aria-labelledby="help-topic-title">
            <h2 id="help-topic-title" className={textStyle.section}>
              {current.title}
            </h2>
            <ol className="list-decimal space-y-2 pl-5 text-ui">
              {current.steps.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
            <div className="flex flex-wrap gap-2">
              {links.map((link) => (
                <Button asChild size="sm" key={link.to}>
                  <Link to={link.to} search={"search" in link ? link.search : {}}>
                    {link.label}
                  </Link>
                </Button>
              ))}
              <Button asChild size="sm" variant="ghost">
                <a href={DOCS + current.guide}>Read the guide</a>
              </Button>
            </div>
          </Card>
          {topic === "access" || topic === "permissions" ? (
            <Card className="space-y-2 p-4" aria-labelledby="account-checks-title">
              <h2 id="account-checks-title" className={textStyle.section}>
                Your account
              </h2>
              <p className="text-ui">
                {me.employeeId
                  ? "Your sign-in is linked to an employee record."
                  : "Your sign-in has no employee record. Ask an owner to link it if you need employee self-service."}
              </p>
              {topic === "access" && can(me, "members:read") ? (
                <p className="text-ui">
                  {me.mailerConfigured
                    ? "This server has email delivery configured."
                    : "This server has no email delivery configured. Copy invitations from Members and roles to share them."}
                </p>
              ) : null}
            </Card>
          ) : null}
          {owner && topic === "service" ? (
            <Card className="space-y-2 p-4" aria-labelledby="server-checks-title">
              <h2 id="server-checks-title" className={textStyle.section}>
                Server checks
              </h2>
              {system.isPending ? (
                <p role="status" className="text-ui">
                  Checking the server…
                </p>
              ) : null}
              {system.isError ? (
                <p className="text-ui">
                  Server checks are unavailable. Try System status or run <code>crowhr doctor</code>.
                </p>
              ) : null}
              {checks.length ? (
                <ul className="space-y-1 text-ui">
                  {checks.map((check) => (
                    <li key={check}>{check}</li>
                  ))}
                </ul>
              ) : null}
            </Card>
          ) : null}
          <Card className="space-y-3 p-4" aria-labelledby="share-title">
            <h2 id="share-title" className={textStyle.section}>
              {canContactSupport ? "Report a problem" : "Share a technical summary"}
            </h2>
            <p className="text-ui text-primary-300">
              {canContactSupport
                ? "Review this summary before sharing. Describe the steps without including staff records, payslips or credentials."
                : "Give this summary to your company administrator if the steps above did not resolve the issue."}
            </p>
            <pre className="whitespace-pre-wrap break-words rounded-md border border-border px-3 py-2 font-azeret text-xs">
              {summary}
            </pre>
            <div className="flex flex-wrap gap-2">
              <Button type="button" size="sm" onClick={() => void copySummary()}>
                <Clipboard aria-hidden /> Copy summary
              </Button>
              {canContactSupport ? (
                <Button asChild size="sm" variant="ghost">
                  <a href={supportEmail(summary)}>
                    <Mail aria-hidden /> Draft support email
                  </a>
                </Button>
              ) : null}
            </div>
            <p role="status" className="text-ui">
              {copyStatus?.text === summary ? copyStatus.message : ""}
            </p>
          </Card>
        </div>
      </div>
    </>
  );
}
