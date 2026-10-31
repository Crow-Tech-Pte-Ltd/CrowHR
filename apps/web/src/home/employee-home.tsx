import { Button, Card, CardHeader, CardTitle, formatDate, StatusPill } from "@crowhr/ui";
import { Link } from "@tanstack/react-router";
import { ArrowRight, CalendarPlus, ReceiptText } from "lucide-react";
import { PageHeader } from "../components/page-header.tsx";
import { SampleDataNotice } from "../components/sample-data-notice.tsx";
import { FIXTURE_TODAY, sampleEmployeeRequests, sampleEmployeeTasks } from "../fixtures/home.ts";
import { SAMPLE_USER } from "../fixtures/session.ts";
import { daysBetween, relativeDays, weekday } from "./dates.ts";

/** Employee self-service home (preview layout). */
export function EmployeeHome() {
  return (
    <>
      <PageHeader
        kicker={
          <span className="num">
            {weekday(FIXTURE_TODAY)} · {formatDate(FIXTURE_TODAY)}
          </span>
        }
        title={`Hi, ${SAMPLE_USER.name}`}
        description={`You have ${sampleEmployeeTasks.length} things to do this week.`}
      />
      <div className="mb-6">
        <SampleDataNotice />
      </div>
      <div className="mb-6 grid grid-cols-2 gap-3">
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
        <Card>
          <CardHeader>
            <CardTitle>To do</CardTitle>
          </CardHeader>
          <ul className="divide-y divide-border border-t border-border">
            {sampleEmployeeTasks.map((t) => (
              <li key={t.id} className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="font-medium leading-5">{t.title}</p>
                  <p className="text-2xs text-primary-300">{t.detail}</p>
                </div>
                <span className="num shrink-0 text-2xs text-primary-200">
                  {relativeDays(daysBetween(FIXTURE_TODAY, t.due))}
                </span>
              </li>
            ))}
          </ul>
        </Card>
        <Card>
          <CardHeader className="items-center">
            <CardTitle>Your requests</CardTitle>
            <Link
              to="/leave"
              className="focus-ring inline-flex items-center gap-1 rounded-sm text-ui font-medium text-biru-400 hover:underline"
            >
              All <ArrowRight className="size-3.5" />
            </Link>
          </CardHeader>
          <ul className="divide-y divide-border border-t border-border">
            {sampleEmployeeRequests.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-3 px-4 py-3">
                <p className="min-w-0 truncate">{r.title}</p>
                <StatusPill tone={r.status === "approved" ? "success" : "warning"}>{r.status}</StatusPill>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </>
  );
}
