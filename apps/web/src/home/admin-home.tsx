import {
  Alert,
  AlertDescription,
  AlertTitle,
  Avatar,
  Badge,
  Button,
  Card,
  CardHeader,
  CardTitle,
  EmptyState,
  formatDate,
  Skeleton,
  StatusPill,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@crowhr/ui";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ArrowRight, CalendarClock, CheckCircle2, DatabaseBackup, IdCard, Wallet } from "lucide-react";
import * as React from "react";
import { useMe } from "../auth/session.ts";
import { PageHeader } from "../components/page-header.tsx";
import { ErrorNote } from "../components/section.tsx";
import { type Inbox, type InboxItem, inboxQuery, useDecide } from "../workflows/api.ts";
import { DecisionButtons, DuePill, OriginBadge, RejectDialog } from "../workflows/decision-controls.tsx";
import { ageLabel } from "../workflows/format.ts";
import { daysBetween, daysLeftLabel, weekday } from "./dates.ts";

const SECTION_SOURCES = new Set(["approvals", "work_passes", "probation", "setup", "backups", "payroll"]);

function plural(n: number, one: string, many = `${one}s`) {
  return `${n} ${n === 1 ? one : many}`;
}

/** Admin and manager Home: real work to do from GET /api/v1/inbox. */
export function AdminHome() {
  const me = useMe();
  const inbox = useQuery(inboxQuery);
  const data = inbox.data;
  const approvals = data?.items.filter((i) => i.source === "approvals") ?? [];
  const passes = data?.items.filter((i) => i.source === "work_passes") ?? [];
  const probation = data?.items.filter((i) => i.source === "probation") ?? [];
  const other = data?.items.filter((i) => !SECTION_SOURCES.has(i.source)) ?? [];
  const setup = data?.items.filter((i) => i.source === "setup") ?? [];
  // Usually one; with plaintext schedules disabled and an old last backup, both are shown.
  const backups = data?.items.filter((i) => i.source === "backups") ?? [];
  const payroll = data?.items.filter((i) => i.source === "payroll") ?? [];
  const sourceStatus = (id: string) => data?.sources.find((s) => s.id === id)?.status ?? "not_set_up";
  const isHr = me.roles.includes("owner") || me.roles.includes("hr_admin");
  const seesPayroll = me.roles.includes("owner") || me.roles.includes("payroll_admin");
  const total = data?.items.length ?? 0;

  const parts = [
    approvals.length ? plural(approvals.length, "approval") : null,
    other.length ? plural(other.length, "to-do") : null,
    setup.length ? plural(setup.length, "setup step") : null,
    backups.length ? "backups" : null,
    passes.length ? plural(passes.length, "work pass", "work passes") : null,
    probation.length ? plural(probation.length, "probation review") : null,
  ].filter(Boolean);

  return (
    <>
      <PageHeader
        kicker={
          data ? (
            <span className="num">
              {weekday(data.today)} · {formatDate(data.today)}
            </span>
          ) : (
            <span className="inline-block h-3" />
          )
        }
        title="Work to do"
        description={
          inbox.isPending ? (
            <Skeleton className="h-4 w-64" />
          ) : total === 0 ? (
            "Nothing waiting for you."
          ) : (
            <>
              {parts.join(", ")} {total === 1 ? "needs" : "need"} your attention.
            </>
          )
        }
      />

      {inbox.isError ? (
        <Card className="mb-6">
          <ErrorNote error={inbox.error} retry={() => void inbox.refetch()} />
        </Card>
      ) : null}

      {backups.length ? (
        <Alert variant="warning" className="mb-6" data-testid="home-backup-warning">
          <DatabaseBackup aria-hidden />
          <div className="flex flex-1 flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-col gap-2">
              {backups.map((b) => (
                <div key={b.id}>
                  <AlertTitle>{b.title}</AlertTitle>
                  <AlertDescription>{b.detail}</AlertDescription>
                </div>
              ))}
            </div>
            <Button asChild size="sm" variant="secondary">
              <Link to="/settings/system">{backups[0]?.actionLabel ?? "Check backups"}</Link>
            </Button>
          </div>
        </Alert>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex min-w-0 flex-col gap-6">
          {setup.length ? <SetupCard items={setup} /> : null}
          <ApprovalsCard items={approvals} today={data?.today ?? ""} loading={inbox.isPending} />
          {other.length ? <OtherCard items={other} today={data?.today ?? ""} /> : null}
          {seesPayroll ? (
            <PayrollCard items={payroll} status={sourceStatus("payroll")} today={data?.today ?? ""} />
          ) : null}
        </div>
        <div className="flex min-w-0 flex-col gap-6">
          {isHr ? (
            <ReminderCard
              id="passes"
              title="Work passes expiring"
              subtitle="Next 90 days"
              icon={<IdCard />}
              items={passes}
              today={data?.today ?? ""}
              loading={inbox.isPending}
              status={sourceStatus("work_passes")}
              empty="No work passes expire in the next 90 days."
              notSetUp="Work pass expiry dates come from employee records. They appear here once you add employees in People."
            />
          ) : null}
          {isHr || me.roles.includes("manager") ? (
            <ReminderCard
              id="probation"
              title="Probation ending"
              subtitle="Next 14 days"
              icon={<CalendarClock />}
              items={probation}
              today={data?.today ?? ""}
              loading={inbox.isPending}
              status={sourceStatus("probation")}
              empty="No probation periods end in the next 14 days."
              notSetUp="Probation end dates come from employee records. They appear here once you add employees in People."
            />
          ) : null}
        </div>
      </div>
    </>
  );
}

function ApprovalsCard({ items, today, loading }: { items: InboxItem[]; today: string; loading: boolean }) {
  const [rejecting, setRejecting] = React.useState<InboxItem | null>(null);
  const decide = useDecide({ onDone: () => setRejecting(null) });
  const approve = (item: InboxItem) => item.task && decide.mutate({ taskIds: [item.task.id], decision: "approve" });

  return (
    <Card aria-labelledby="approvals-title" data-testid="home-approvals">
      <CardHeader className="items-center">
        <div className="flex items-center gap-2">
          <CardTitle id="approvals-title">Approvals waiting</CardTitle>
          {items.length ? (
            <Badge variant="ink" className="num">
              {items.length}
            </Badge>
          ) : null}
        </div>
        <Link
          to="/inbox"
          className="focus-ring inline-flex items-center gap-1 rounded-sm text-ui font-medium text-biru-400 hover:underline"
        >
          Open inbox <ArrowRight className="size-3.5" aria-hidden />
        </Link>
      </CardHeader>
      {loading ? (
        <div className="flex flex-col gap-2 border-t border-border p-4" role="status" aria-label="Loading approvals">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
        </div>
      ) : items.length === 0 ? (
        <div className="border-t border-border">
          <EmptyState
            variant="plain"
            icon={<CheckCircle2 />}
            title="Nothing waiting for you"
            description="Leave, claims and other requests that need your decision appear here."
          />
        </div>
      ) : (
        <>
          <div className="hidden border-t border-border md:block">
            <Table aria-label="Approvals waiting" className="table-fixed">
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[12rem]">Requester</TableHead>
                  <TableHead>Request</TableHead>
                  <TableHead className="w-[8.5rem] text-right">Due</TableHead>
                  <TableHead className="w-[9.5rem]">
                    <span className="sr-only">Actions</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((item) => (
                  <TableRow key={item.id} data-testid="approval-row">
                    <TableCell>
                      <div className="flex min-w-0 items-center gap-2.5">
                        <Avatar name={item.concerns ?? "?"} size="sm" />
                        <p className="truncate font-medium leading-4">{item.concerns}</p>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex min-w-0 items-center gap-2">
                        <Link
                          to="/inbox"
                          search={{ task: item.task?.id }}
                          className="focus-ring truncate rounded-sm hover:underline"
                        >
                          {item.title}
                        </Link>
                      </div>
                      <p className="truncate text-2xs leading-4 text-primary-200">
                        {item.detail} · <span className="num">sent {ageLabel(item.createdAt, today)}</span>
                      </p>
                    </TableCell>
                    <TableCell className="text-right">
                      <DueOrOrigin item={item} today={today} />
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      <RowAction item={item} onApprove={approve} onReject={setRejecting} pending={decide.isPending} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <ul className="divide-y divide-border border-t border-border md:hidden">
            {items.map((item) => (
              <li key={item.id} className="flex flex-col gap-1.5 px-4 py-3" data-testid="approval-row-mobile">
                <div className="flex min-w-0 items-center gap-2.5">
                  <Avatar name={item.concerns ?? "?"} size="sm" />
                  <p className="truncate font-medium leading-4">{item.concerns}</p>
                </div>
                <p className="pl-[34px] text-ui leading-5">
                  <span className="text-primary-300">{item.detail} · </span>
                  {item.title}
                </p>
                <div className="flex items-center justify-between gap-2 pl-[34px]">
                  <span className="flex min-w-0 items-center gap-2">
                    <DueOrOrigin item={item} today={today} />
                    <span className="num truncate text-2xs text-primary-200">
                      sent {ageLabel(item.createdAt, today)}
                    </span>
                  </span>
                  <RowAction item={item} onApprove={approve} onReject={setRejecting} pending={decide.isPending} />
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
      <RejectDialog
        open={!!rejecting}
        onOpenChange={(o) => !o && setRejecting(null)}
        count={1}
        who={rejecting?.concerns ?? undefined}
        pending={decide.isPending}
        onConfirm={(comment) =>
          rejecting?.task && decide.mutate({ taskIds: [rejecting.task.id], decision: "reject", comment })
        }
      />
    </Card>
  );
}

function RowAction({
  item,
  onApprove,
  onReject,
  pending,
}: {
  item: InboxItem;
  onApprove: (i: InboxItem) => void;
  onReject: (i: InboxItem) => void;
  pending: boolean;
}) {
  if (item.task?.inline) {
    return (
      <DecisionButtons
        who={item.concerns ?? "this"}
        onApprove={() => onApprove(item)}
        onReject={() => onReject(item)}
        disabled={pending}
      />
    );
  }
  return (
    <Button size="sm" variant="secondary" asChild>
      <Link to="/inbox" search={{ task: item.task?.id }}>
        Review
      </Link>
    </Button>
  );
}

/** The due pill, plus "Escalated" / "Covering" in the same column (escalated tasks have no due date). */
function DueOrOrigin({ item, today }: { item: InboxItem; today: string }) {
  return (
    <span className="inline-flex flex-wrap items-center justify-end gap-1">
      {item.task && item.task.origin !== "resolved" ? (
        <OriginBadge origin={item.task.origin} onBehalfOf={item.task.onBehalfOf} />
      ) : null}
      <DuePill dueOn={item.dueOn} today={today} short />
    </span>
  );
}

function SetupCard({ items }: { items: InboxItem[] }) {
  return (
    <Card aria-labelledby="setup-title" data-testid="home-setup">
      <CardHeader>
        <div>
          <CardTitle id="setup-title">Finish setting up</CardTitle>
          <p className="mt-0.5 text-2xs text-primary-200">
            <span className="num">{items.length}</span> {items.length === 1 ? "step" : "steps"} left before your first
            payroll
          </p>
        </div>
      </CardHeader>
      <ol className="divide-y divide-border border-t border-border">
        {items.map((item) => (
          // On a phone the pill and button go under the title, which would otherwise be cut to a few letters.
          <li
            key={item.id}
            className="flex flex-col gap-2 px-4 py-2.5 sm:flex-row sm:items-center sm:justify-between sm:gap-3"
          >
            <div className="min-w-0">
              <p className="font-medium leading-5 sm:truncate">{item.title}</p>
              {item.detail ? <p className="truncate text-2xs text-primary-300">{item.detail}</p> : null}
            </div>
            <Button size="sm" variant="secondary" asChild>
              <a href={item.href}>{item.actionLabel}</a>
            </Button>
          </li>
        ))}
      </ol>
    </Card>
  );
}

function OtherCard({ items, today }: { items: InboxItem[]; today: string }) {
  return (
    <Card aria-labelledby="todo-title">
      <CardHeader>
        <CardTitle id="todo-title">Checklists and other to-dos</CardTitle>
      </CardHeader>
      <ul className="divide-y divide-border border-t border-border">
        {items.map((item) => (
          // On a phone the pill and button go under the title, which would otherwise be cut to a few letters.
          <li
            key={item.id}
            className="flex flex-col gap-2 px-4 py-2.5 sm:flex-row sm:items-center sm:justify-between sm:gap-3"
          >
            <div className="min-w-0">
              <p className="font-medium leading-5 sm:truncate">{item.title}</p>
              {item.concerns || item.detail ? (
                <p className="truncate text-2xs text-primary-300">
                  {[item.concerns, item.detail].filter(Boolean).join(" · ")}
                </p>
              ) : null}
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <DuePill dueOn={item.dueOn} today={today} />
              <Button size="sm" variant="secondary" asChild>
                <a href={item.href}>{item.actionLabel}</a>
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function PayrollCard({ items, status, today }: { items: InboxItem[]; status: string; today: string }) {
  return (
    <Card aria-labelledby="payroll-title" data-testid="home-payroll">
      <CardHeader>
        <CardTitle id="payroll-title">Payroll</CardTitle>
      </CardHeader>
      {items.length > 0 ? (
        <ul className="divide-y divide-border border-t border-border">
          {items.map((item) => (
            <li
              key={item.id}
              className="flex flex-col gap-2 px-4 py-2.5 sm:flex-row sm:items-center sm:justify-between sm:gap-3"
            >
              <div className="min-w-0">
                <p className="font-medium leading-5 sm:truncate">{item.title}</p>
                {item.detail ? <p className="truncate text-2xs text-primary-300">{item.detail}</p> : null}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <DuePill dueOn={item.dueOn} today={today} />
                <Button size="sm" variant="secondary" asChild>
                  <a href={item.href}>{item.actionLabel}</a>
                </Button>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <div className="border-t border-border">
          {status === "not_set_up" ? (
            <EmptyState
              variant="plain"
              icon={<Wallet />}
              title="Payroll isn't set up yet"
              description="Set the pay day and CPF details in Payroll settings. Monthly runs and their due dates then show here."
              note="Not set up yet"
            />
          ) : (
            <EmptyState
              variant="plain"
              icon={<Wallet />}
              title="No payroll due"
              description="This month's run is done. The next one shows here when it is due."
            />
          )}
        </div>
      )}
    </Card>
  );
}

function DaysLeft({ dueOn, today }: { dueOn: string; today: string }) {
  const days = daysBetween(today, dueOn);
  return (
    <div className="flex shrink-0 flex-col items-end gap-1">
      <StatusPill tone={days <= 30 ? "danger" : days <= 60 ? "warning" : "neutral"}>
        <span className="num normal-case">{daysLeftLabel(days)}</span>
      </StatusPill>
      <span className="num text-2xs text-primary-200">{formatDate(dueOn)}</span>
    </div>
  );
}

function ReminderCard({
  id,
  title,
  subtitle,
  icon,
  items,
  today,
  loading,
  status,
  empty,
  notSetUp,
}: {
  id: string;
  title: string;
  subtitle: string;
  icon: React.ReactNode;
  items: InboxItem[];
  today: string;
  loading: boolean;
  status: Inbox["sources"][number]["status"];
  empty: string;
  notSetUp: string;
}) {
  return (
    <Card aria-labelledby={`${id}-title`} data-testid={`home-${id}`}>
      <CardHeader>
        <div>
          <CardTitle id={`${id}-title`}>{title}</CardTitle>
          <p className="mt-0.5 text-2xs text-primary-200">{subtitle}</p>
        </div>
      </CardHeader>
      {loading ? (
        <div className="border-t border-border p-4">
          <Skeleton className="h-8 w-full" />
        </div>
      ) : status === "not_set_up" ? (
        <div className="flex gap-3 border-t border-border px-4 py-4">
          <span className="mt-0.5 text-primary-200 [&_svg]:size-4" aria-hidden>
            {icon}
          </span>
          <div className="flex flex-col gap-1">
            <p className="font-azeret text-2xs font-semibold uppercase tracking-wider text-primary-300">
              Not set up yet
            </p>
            <p className="text-ui text-primary-300">{notSetUp}</p>
          </div>
        </div>
      ) : items.length === 0 ? (
        <p className="border-t border-border px-4 py-4 text-ui text-primary-300">{empty}</p>
      ) : (
        <ul className="divide-y divide-border border-t border-border">
          {items.map((item) => (
            <li key={item.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
              <div className="min-w-0">
                <a
                  href={item.href}
                  className="focus-ring block truncate rounded-sm font-medium leading-5 hover:underline"
                >
                  {item.concerns}
                </a>
                <p className="truncate text-2xs text-primary-300">{item.detail ?? item.title}</p>
              </div>
              {item.dueOn ? <DaysLeft dueOn={item.dueOn} today={today} /> : null}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
