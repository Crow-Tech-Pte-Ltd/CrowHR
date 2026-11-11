import { Button, Card, CardHeader, CardTitle, EmptyState, formatDate, Skeleton, StatusPill } from "@crowhr/ui";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ArrowRight, CalendarPlus, CheckCircle2, ReceiptText } from "lucide-react";
import { greetingName } from "../auth/format.ts";
import { useMe } from "../auth/session.ts";
import { PageHeader } from "../components/page-header.tsx";
import { ErrorNote } from "../components/section.tsx";
import { inboxQuery, myRequestsQuery, STATUS_LABEL, STATUS_TONE } from "../workflows/api.ts";
import { DuePill } from "../workflows/decision-controls.tsx";
import { ageLabel, requestName } from "../workflows/format.ts";
import { weekday } from "./dates.ts";

/** Employee self-service Home: my to-dos and my requests, from the inbox and approvals APIs. */
export function EmployeeHome() {
  const me = useMe();
  const inbox = useQuery(inboxQuery);
  const mine = useQuery(myRequestsQuery);
  const name = greetingName(me.user);
  const todo = inbox.data?.items ?? [];
  const today = inbox.data?.today ?? "";
  return (
    <>
      <PageHeader
        kicker={
          inbox.data ? (
            <span className="num">
              {weekday(today)} · {formatDate(today)}
            </span>
          ) : null
        }
        title={`Hi, ${name}`}
        description={
          inbox.isPending ? (
            <Skeleton className="h-4 w-48" />
          ) : todo.length ? (
            `You have ${todo.length} ${todo.length === 1 ? "thing" : "things"} to do.`
          ) : (
            "Nothing waiting for you."
          )
        }
      />
      <div className="mb-6 grid grid-cols-2 gap-3 sm:max-w-md">
        <Button variant="primary" size="lg" asChild>
          <Link to="/leave">
            <CalendarPlus />
            Apply leave
          </Link>
        </Button>
        <Button variant="secondary" size="lg" asChild>
          <Link to="/claims">
            <ReceiptText />
            New claim
          </Link>
        </Button>
      </div>
      <div className="grid gap-6 md:grid-cols-2">
        <Card aria-labelledby="todo-title" data-testid="employee-todo">
          <CardHeader>
            <CardTitle id="todo-title">To do</CardTitle>
          </CardHeader>
          {inbox.isError ? (
            <ErrorNote error={inbox.error} retry={() => void inbox.refetch()} />
          ) : inbox.isPending ? (
            <div className="border-t border-border p-4">
              <Skeleton className="h-8 w-full" />
            </div>
          ) : todo.length === 0 ? (
            <div className="border-t border-border">
              <EmptyState
                variant="plain"
                icon={<CheckCircle2 />}
                title="Nothing waiting for you"
                description="When something needs you, such as a form to sign or a request to approve, it shows here."
                actions={
                  <div className="flex flex-wrap gap-3">
                    <Link
                      to="/leave"
                      className="focus-ring rounded-sm text-ui font-medium text-biru-400 hover:underline"
                    >
                      Apply for leave
                    </Link>
                    <Link
                      to="/claims"
                      className="focus-ring rounded-sm text-ui font-medium text-biru-400 hover:underline"
                    >
                      Submit a claim
                    </Link>
                  </div>
                }
              />
            </div>
          ) : (
            <ul className="divide-y divide-border border-t border-border">
              {todo.map((t) => (
                <li key={t.id} className="flex items-center justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <a
                      href={t.href}
                      className="focus-ring block truncate rounded-sm font-medium leading-5 hover:underline"
                    >
                      {t.task ? `${t.concerns}: ${t.title}` : t.title}
                    </a>
                    <p className="truncate text-2xs text-primary-300">{t.detail ?? t.actionLabel}</p>
                  </div>
                  <DuePill dueOn={t.dueOn} today={today} />
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card aria-labelledby="mine-title" data-testid="employee-requests">
          <CardHeader className="items-center">
            <CardTitle id="mine-title">Your requests</CardTitle>
            <Link
              to="/inbox"
              search={{ view: "mine" }}
              className="focus-ring inline-flex items-center gap-1 rounded-sm text-ui font-medium text-biru-400 hover:underline"
            >
              All <ArrowRight className="size-3.5" aria-hidden />
            </Link>
          </CardHeader>
          {mine.isError ? (
            <ErrorNote error={mine.error} retry={() => void mine.refetch()} />
          ) : mine.isPending ? (
            <div className="border-t border-border p-4">
              <Skeleton className="h-8 w-full" />
            </div>
          ) : mine.data.items.length === 0 ? (
            <p className="border-t border-border px-4 py-4 text-ui text-primary-300">
              You haven't sent any requests yet. Leave and claims you submit show here with their progress.
            </p>
          ) : (
            <ul className="divide-y divide-border border-t border-border">
              {/* Pending ones first, then the latest, five at most; "All" opens the full list in the Inbox. */}
              {[
                ...mine.data.items.filter((r) => r.status === "pending"),
                ...mine.data.items.filter((r) => r.status !== "pending"),
              ]
                .slice(0, 5)
                .map((r) => (
                  <li key={r.id} className="flex items-center justify-between gap-3 px-4 py-3" data-testid="my-request">
                    <div className="min-w-0">
                      <Link
                        to="/inbox"
                        search={{ request: r.id }}
                        className="focus-ring block truncate rounded-sm font-medium leading-5 hover:underline"
                      >
                        {requestName(r.subjectLabel, r.title)}
                      </Link>
                      <p className="truncate text-2xs text-primary-300">
                        {r.status === "pending" && r.waitingOn
                          ? `Waiting for ${r.waitingOn}`
                          : `Sent ${today ? ageLabel(r.submittedAt, today) : ""}`}
                      </p>
                    </div>
                    <StatusPill tone={STATUS_TONE[r.status]}>{STATUS_LABEL[r.status]}</StatusPill>
                  </li>
                ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
