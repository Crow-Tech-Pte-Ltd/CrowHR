import { Button, cn, formatDate, Skeleton, StatusPill, Textarea, textStyle, toast } from "@crowhr/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ArrowUpRight, Check, CircleDashed, CircleSlash, Clock, MessageSquare, Undo2, X } from "lucide-react";
import * as React from "react";
import { NumText } from "../components/num-text.tsx";
import { ErrorNote } from "../components/section.tsx";
import { ApiError, apiPost } from "../lib/api.ts";
import { type RequestDetail, requestQuery, STATUS_LABEL, STATUS_TONE } from "./api.ts";
import { OriginBadge } from "./decision-controls.tsx";
import { sgDate } from "./format.ts";

const STEP_ICON = {
  waiting: CircleDashed,
  active: Clock,
  approved: Check,
  rejected: X,
  skipped: CircleSlash,
} as const;

function when(iso: string) {
  return formatDate(sgDate(iso));
}

/** Full view of one request: summary, the module's context, the chain with progress, comments. */
export function RequestPanel({
  requestId,
  actions,
  className,
}: {
  requestId: string;
  /** Approve / reject controls for the viewer's task, rendered by the inbox. */
  actions?: (detail: RequestDetail) => React.ReactNode;
  className?: string;
}) {
  const q = useQuery(requestQuery(requestId));
  if (q.isPending) {
    return (
      <div className={cn("flex flex-col gap-3 p-5", className)} role="status" aria-label="Loading request">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-6 w-64" />
        <Skeleton className="mt-2 h-24 w-full" />
      </div>
    );
  }
  if (q.isError) {
    return (
      <div className={className}>
        {q.error instanceof ApiError && q.error.status === 404 ? (
          <p className="p-5 text-ui text-primary-300">
            This request no longer needs you, or you can no longer see it (for example, cover for someone has ended).
          </p>
        ) : (
          <ErrorNote error={q.error} retry={() => void q.refetch()} />
        )}
      </div>
    );
  }
  const d = q.data;
  return (
    <article className={cn("flex flex-col", className)} aria-labelledby={`req-${d.id}`} data-testid="request-panel">
      <header className="flex flex-col gap-2 border-b border-border p-5">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <h2 id={`req-${d.id}`} className="text-lg font-semibold leading-6">
            {d.summary?.title ?? d.title}
          </h2>
          <StatusPill tone={STATUS_TONE[d.status]}>{STATUS_LABEL[d.status]}</StatusPill>
        </div>
        <p className="text-2xs text-primary-200">
          {d.subjectLabel} from <span className="text-primary-300">{d.requester.name}</span> · sent{" "}
          <span className="num">{when(d.submittedAt)}</span>
          {d.decidedAt ? (
            <>
              {" "}
              · closed <span className="num">{when(d.decidedAt)}</span>
            </>
          ) : null}{" "}
          · {d.policyName} policy
        </p>
        {d.link && !d.link.startsWith("/inbox") ? (
          <Link
            to={d.link}
            className="focus-ring inline-flex w-fit items-center gap-1 rounded-sm text-ui font-medium text-biru-400 hover:underline"
            data-testid="request-subject-link"
          >
            Open the {d.subjectLabel.toLowerCase()} <ArrowUpRight className="size-3.5" aria-hidden />
          </Link>
        ) : null}
        {actions ? <div className="pt-2">{actions(d)}</div> : null}
      </header>

      {d.summary && (d.summary.lines.length || d.summary.context.length) ? (
        <section className="grid gap-4 border-b border-border p-5 sm:grid-cols-2" aria-label="Details">
          {d.summary.lines.length ? <Facts items={d.summary.lines} /> : null}
          {d.summary.context.length ? (
            <div className="rounded-md border border-border bg-surface-100/60 p-3">
              <p className={cn("mb-2", textStyle.group)}>Context for your decision</p>
              <Facts items={d.summary.context} />
            </div>
          ) : null}
        </section>
      ) : null}

      <section className="border-b border-border p-5" aria-labelledby={`chain-${d.id}`}>
        <h3 id={`chain-${d.id}`} className={cn("mb-3", textStyle.group)}>
          Approval chain
        </h3>
        <ol className="flex flex-col gap-3">
          {d.steps.map((s) => {
            const Icon = STEP_ICON[s.status];
            return (
              <li key={s.position} className="grid grid-cols-[1.5rem_1fr] gap-2" data-testid="chain-step">
                <span
                  className={cn(
                    "mt-0.5 flex size-5 items-center justify-center rounded-full border [&_svg]:size-3",
                    s.status === "approved" && "border-success-300 bg-success-50 text-success-400",
                    s.status === "rejected" && "border-danger-200 bg-danger-50 text-danger-300",
                    s.status === "active" && "border-ink bg-kuning-200 text-accent-foreground",
                    (s.status === "waiting" || s.status === "skipped") && "border-ink/20 text-primary-200",
                  )}
                  aria-hidden
                >
                  <Icon />
                </span>
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2 text-ui font-medium">
                    <span className="num text-primary-200">{s.position}.</span> {s.label}
                    {s.escalated ? <StatusPill tone="warning">Escalated</StatusPill> : null}
                  </p>
                  {s.skipReason ? <p className="text-2xs text-primary-300">{s.skipReason}</p> : null}
                  {s.tasks.length ? (
                    <ul className="mt-1 flex flex-col gap-1">
                      {s.tasks.map((t) => (
                        <li
                          key={t.id}
                          className="flex flex-wrap items-center gap-x-2 gap-y-1 text-2xs text-primary-300"
                        >
                          <span className="text-ink">
                            {t.assignee}
                            {t.onBehalfOf ? (
                              <span className="text-primary-300"> on behalf of {t.onBehalfOf}</span>
                            ) : null}
                          </span>
                          {t.origin !== "resolved" && t.origin !== "delegated" ? (
                            <OriginBadge origin={t.origin} />
                          ) : null}
                          <span>
                            {t.status === "pending"
                              ? "waiting"
                              : t.status === "superseded"
                                ? "moved to someone else"
                                : `${t.status}${t.decidedAt ? ` ${when(t.decidedAt)}` : ""}`}
                            {t.selfApproved ? " (self-approved: no one else could decide)" : ""}
                          </span>
                          {t.comment ? <q className="basis-full text-ink">{t.comment}</q> : null}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ol>
      </section>

      <Comments detail={d} />
    </article>
  );
}

function Facts({ items }: { items: { label: string; value: string }[] }) {
  return (
    <dl className="grid grid-cols-[minmax(0,8rem)_1fr] gap-x-3 gap-y-1.5 text-ui">
      {items.map((i) => (
        <React.Fragment key={i.label}>
          <dt className="text-primary-300">{i.label}</dt>
          <dd className="font-medium">
            <NumText>{i.value}</NumText>
          </dd>
        </React.Fragment>
      ))}
    </dl>
  );
}

function Comments({ detail }: { detail: RequestDetail }) {
  const qc = useQueryClient();
  const [body, setBody] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const post = useMutation({
    mutationFn: () => apiPost(`/api/v1/approvals/requests/${detail.id}/comments`, { body }),
    onSuccess: () => {
      setBody("");
      void qc.invalidateQueries({ queryKey: ["approvals", "request", detail.id] });
    },
    onError: (err) => setError(err instanceof Error ? err.message : "The comment wasn't saved. Try again."),
  });
  const withdraw = useMutation({
    mutationFn: () => apiPost(`/api/v1/approvals/requests/${detail.id}/withdraw`),
    onSuccess: () => {
      toast.success("Request withdrawn", { description: "Approvers were told it no longer needs them." });
      void qc.invalidateQueries({ queryKey: ["approvals"] });
      void qc.invalidateQueries({ queryKey: ["inbox"] });
    },
    onError: (err) => toast.error("Not withdrawn", { description: err instanceof Error ? err.message : undefined }),
  });
  return (
    <section className="flex flex-col gap-3 p-5" aria-labelledby={`comments-${detail.id}`}>
      <div className="flex items-center justify-between">
        <h3 id={`comments-${detail.id}`} className={cn("flex items-center gap-1.5", textStyle.group)}>
          <MessageSquare className="size-3.5" aria-hidden /> Comments
        </h3>
        {detail.viewer.canWithdraw ? (
          <Button size="sm" variant="ghost" onClick={() => withdraw.mutate()} disabled={withdraw.isPending}>
            <Undo2 /> Withdraw request
          </Button>
        ) : null}
      </div>
      {detail.comments.length ? (
        <ul className="flex flex-col gap-2">
          {detail.comments.map((c) => (
            <li key={c.id} className="rounded-md border border-border px-3 py-2">
              <p className="text-2xs text-primary-200">
                <span className="font-medium text-ink">{c.author}</span> ·{" "}
                <span className="num">{when(c.createdAt)}</span>
              </p>
              <p className="text-ui">{c.body}</p>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-ui text-primary-300">No comments yet.</p>
      )}
      {detail.viewer.canComment ? (
        <form
          className="flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!body.trim()) return setError("Write something first.");
            post.mutate();
          }}
        >
          <Textarea
            aria-label="Add a comment"
            rows={2}
            value={body}
            maxLength={500}
            placeholder="Ask a question or add context"
            onChange={(e) => {
              setBody(e.target.value);
              setError(null);
            }}
          />
          {error ? (
            <p role="alert" className="text-2xs text-danger-300">
              {error}
            </p>
          ) : null}
          <div>
            <Button size="sm" type="submit" disabled={post.isPending}>
              Comment
            </Button>
          </div>
        </form>
      ) : null}
    </section>
  );
}
