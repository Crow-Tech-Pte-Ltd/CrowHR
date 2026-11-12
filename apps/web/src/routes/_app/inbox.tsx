import {
  Avatar,
  Button,
  Card,
  Checkbox,
  cn,
  EmptyState,
  Kbd,
  Skeleton,
  StatusPill,
  singaporeTodayIso,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@crowhr/ui";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Plane } from "lucide-react";
import * as React from "react";
import { useMe } from "../../auth/session.ts";
import { PageHeader } from "../../components/page-header.tsx";
import { ErrorNote } from "../../components/section.tsx";
import { canUseAdminLayout } from "../../shell/view-mode.tsx";
import {
  allMyRequestsQuery,
  inboxQuery,
  type MyRequest,
  STATUS_LABEL,
  STATUS_TONE,
  type TaskItem,
  tasksQuery,
  useDecide,
} from "../../workflows/api.ts";
import { DecisionButtons, DuePill, OriginBadge, RejectDialog } from "../../workflows/decision-controls.tsx";
import { ageLabel, requestName } from "../../workflows/format.ts";
import { OutOfOfficeDialog } from "../../workflows/out-of-office.tsx";
import { RequestPanel } from "../../workflows/request-panel.tsx";

interface InboxSearch {
  task?: string;
  request?: string;
  view?: InboxView;
}

type InboxView = "decide" | "mine";

export const Route = createFileRoute("/_app/inbox")({
  validateSearch: (s: Record<string, unknown>): InboxSearch => ({
    ...(typeof s.task === "string" ? { task: s.task } : {}),
    ...(typeof s.request === "string" ? { request: s.request } : {}),
    ...(s.view === "mine" || s.view === "decide" ? { view: s.view } : {}),
  }),
  component: InboxPage,
});

function isTyping(target: EventTarget | null) {
  const el = target as HTMLElement | null;
  if (!el) return false;
  return el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName) || !!el.closest("[role=dialog]");
}

function InboxPage() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: "/inbox" });
  const me = useMe();
  const [oooOpen, setOooOpen] = React.useState(false);
  const tasks = useQuery(tasksQuery);
  const count = tasks.data?.items.length ?? 0;
  // Staff who approve nothing land on their own requests; approvers on what waits for them. A named
  // approver or cover holder may have no approver role, so having tasks counts too.
  const approver = canUseAdminLayout(me.roles) || count > 0;
  const defaultView = approver ? "decide" : "mine";
  const view = search.view ?? (search.request ? "mine" : search.task ? "decide" : defaultView);
  return (
    <>
      <PageHeader
        title="Inbox"
        description={
          approver ? (
            <>
              Requests waiting for your decision.
              <span className="hidden md:inline">
                {" "}
                Keys: <Kbd>j</Kbd> <Kbd>k</Kbd> move, <Kbd>a</Kbd> approve, <Kbd>r</Kbd> reject, <Kbd>x</Kbd> select.
              </span>
            </>
          ) : (
            "Your requests and where they are. Anything you're asked to decide, such as a shift swap, shows under To decide."
          )
        }
        actions={
          approver ? (
            <Button variant="secondary" onClick={() => setOooOpen(true)}>
              <Plane /> Out of office
            </Button>
          ) : undefined
        }
      />
      <Tabs
        value={view}
        onValueChange={(v) => void navigate({ search: v === defaultView ? {} : { view: v as InboxView } })}
      >
        <TabsList className="mb-4">
          <TabsTrigger value="decide">
            To decide{count ? <span className="num ml-1.5 text-primary-300">{count}</span> : null}
          </TabsTrigger>
          <TabsTrigger value="mine">My requests</TabsTrigger>
        </TabsList>
        <TabsContent value="decide" className="pt-0">
          <DecideView selectedTaskId={search.task} />
        </TabsContent>
        <TabsContent value="mine" className="pt-0">
          <MineView selectedId={search.request} />
        </TabsContent>
      </Tabs>
      <OutOfOfficeDialog open={oooOpen} onOpenChange={setOooOpen} />
    </>
  );
}

function DecideView({ selectedTaskId }: { selectedTaskId?: string }) {
  const navigate = useNavigate({ from: "/inbox" });
  const tasks = useQuery(tasksQuery);
  const inbox = useQuery(inboxQuery);
  const today = inbox.data?.today ?? singaporeTodayIso();
  const items = tasks.data?.items ?? [];
  const [cursor, setCursor] = React.useState(0);
  const [checked, setChecked] = React.useState<Set<string>>(new Set());
  const [rejecting, setRejecting] = React.useState<string[] | null>(null);
  const listRef = React.useRef<HTMLUListElement>(null);
  const decide = useDecide({
    onDone: (ids) => {
      setRejecting(null);
      setChecked((prev) => new Set([...prev].filter((id) => !ids.includes(id))));
    },
  });

  // Follow ?task= (from Home, notifications and emails).
  React.useEffect(() => {
    if (!selectedTaskId) return;
    const idx = items.findIndex((t) => t.taskId === selectedTaskId);
    if (idx >= 0) setCursor(idx);
  }, [selectedTaskId, items]);
  const safeCursor = Math.min(cursor, Math.max(0, items.length - 1));
  const current: TaskItem | undefined = items[safeCursor];

  const approve = React.useCallback(
    (ids: string[]) => ids.length && decide.mutate({ taskIds: ids, decision: "approve" }),
    [decide],
  );

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target)) return;
      if (!items.length) return;
      const k = e.key.toLowerCase();
      if (k === "j" || e.key === "ArrowDown") {
        e.preventDefault();
        setCursor((c) => Math.min(items.length - 1, c + 1));
      } else if (k === "k" || e.key === "ArrowUp") {
        e.preventDefault();
        setCursor((c) => Math.max(0, c - 1));
      } else if (k === "x" && current) {
        e.preventDefault();
        if (!current.inline) return;
        setChecked((prev) => {
          const next = new Set(prev);
          if (next.has(current.taskId)) next.delete(current.taskId);
          else next.add(current.taskId);
          return next;
        });
      } else if (k === "a" && current) {
        e.preventDefault();
        approve(checked.size ? [...checked] : [current.taskId]);
      } else if (k === "r" && current) {
        e.preventDefault();
        setRejecting(checked.size ? [...checked] : [current.taskId]);
      } else if (e.key === "Escape") {
        setChecked(new Set());
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [items, current, checked, approve]);

  React.useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-index="${safeCursor}"]`)?.scrollIntoView({ block: "nearest" });
  }, [safeCursor]);

  if (tasks.isPending) {
    return (
      <Card className="p-4" role="status" aria-label="Loading tasks">
        <Skeleton className="mb-2 h-10 w-full" />
        <Skeleton className="h-10 w-full" />
      </Card>
    );
  }
  if (tasks.isError) {
    return (
      <Card>
        <ErrorNote error={tasks.error} retry={() => void tasks.refetch()} />
      </Card>
    );
  }
  if (!items.length) {
    return (
      <EmptyState
        title="Nothing is waiting for your decision."
        description="When someone needs your approval, or you're covering for a colleague, their request shows here."
      />
    );
  }
  const inlineIds = items.filter((t) => t.inline).map((t) => t.taskId);
  const allChecked = inlineIds.length > 0 && inlineIds.every((id) => checked.has(id));
  const whoOf = (ids: string[]) => items.find((t) => t.taskId === ids[0])?.requester.name;

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,420px)_minmax(0,1fr)]">
      <Card className="flex min-w-0 flex-col self-start">
        <div className="flex min-h-12 items-center justify-between gap-2 border-b border-border px-3 py-2">
          <div className="flex items-center gap-2 text-2xs text-primary-300">
            <Checkbox
              checked={allChecked}
              onCheckedChange={(c) => setChecked(c ? new Set(inlineIds) : new Set())}
              aria-label="Select all that can be approved in bulk"
              disabled={!inlineIds.length}
            />
            {checked.size ? <span className="num">{checked.size} selected</span> : "Select"}
          </div>
          {checked.size ? (
            <div className="flex gap-1" data-testid="bulk-actions">
              <Button size="sm" variant="ghost" onClick={() => setRejecting([...checked])} disabled={decide.isPending}>
                Reject…
              </Button>
              <Button size="sm" variant="secondary" onClick={() => approve([...checked])} disabled={decide.isPending}>
                Approve {checked.size}
              </Button>
            </div>
          ) : null}
        </div>
        <ul ref={listRef} className="max-h-[70vh] divide-y divide-border overflow-y-auto" aria-label="Tasks to decide">
          {items.map((t, i) => (
            <li
              key={t.taskId}
              data-index={i}
              data-testid="inbox-task"
              className={cn(
                "flex items-start gap-2.5 px-3 py-2.5 hover:bg-ink/[0.03]",
                i === safeCursor && "bg-kuning-50 shadow-[inset_3px_0_0_0_hsl(var(--ink))]",
              )}
            >
              <Checkbox
                className="mt-1"
                checked={checked.has(t.taskId)}
                disabled={!t.inline}
                aria-label={t.inline ? `Select ${t.requester.name}'s request` : "Review this one on its own"}
                onCheckedChange={(c) =>
                  setChecked((prev) => {
                    const next = new Set(prev);
                    if (c) next.add(t.taskId);
                    else next.delete(t.taskId);
                    return next;
                  })
                }
              />
              <button
                type="button"
                aria-current={i === safeCursor ? "true" : undefined}
                className="focus-ring flex min-w-0 flex-1 items-start gap-2.5 rounded-sm text-left"
                onClick={() => {
                  setCursor(i);
                  void navigate({ search: { task: t.taskId }, replace: true });
                }}
              >
                <Avatar name={t.requester.name} size="sm" />
                <span className="min-w-0 flex-1">
                  <span className="flex items-start justify-between gap-2">
                    <span className="truncate font-medium leading-5">{t.requester.name}</span>
                    <DuePill dueOn={t.dueOn} today={today} short />
                  </span>
                  <span className="block truncate text-ui text-primary-300">
                    {t.subjectLabel} · {t.title}
                  </span>
                  <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-2xs text-primary-200">
                    <span className="num">
                      Step {t.step.position} of {t.step.of}
                    </span>
                    <span aria-hidden>·</span>
                    <span className="num">{ageLabel(t.submittedAt, today)}</span>
                    <OriginBadge origin={t.origin} onBehalfOf={t.onBehalfOf} />
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </Card>
      {current ? (
        <Card className="min-w-0 self-start">
          <RequestPanel
            requestId={current.requestId}
            actions={() => (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-2xs text-primary-300">
                  {current.onBehalfOf ? `You're covering for ${current.onBehalfOf}. ` : ""}
                  {current.origin === "escalated" ? "Escalated to you from step " : "Your step: "}
                  <span className="font-medium text-ink">
                    {current.origin === "escalated"
                      ? `${current.step.position} (${current.step.label})`
                      : current.step.label}
                  </span>
                </p>
                <DecisionButtons
                  who={current.requester.name}
                  disabled={decide.isPending}
                  onApprove={() => approve([current.taskId])}
                  onReject={() => setRejecting([current.taskId])}
                />
              </div>
            )}
          />
        </Card>
      ) : null}
      <RejectDialog
        open={!!rejecting}
        onOpenChange={(o) => !o && setRejecting(null)}
        count={rejecting?.length ?? 1}
        who={rejecting ? whoOf(rejecting) : undefined}
        pending={decide.isPending}
        onConfirm={(comment) => rejecting && decide.mutate({ taskIds: rejecting, decision: "reject", comment })}
      />
    </div>
  );
}

function MineView({ selectedId }: { selectedId?: string }) {
  const navigate = useNavigate({ from: "/inbox" });
  const mine = useQuery(allMyRequestsQuery);
  const items: MyRequest[] = mine.data?.items ?? [];
  const selected = selectedId ?? items[0]?.id;
  const today = singaporeTodayIso();
  if (mine.isPending) {
    return (
      <Card className="p-4">
        <Skeleton className="h-10 w-full" />
      </Card>
    );
  }
  if (mine.isError) {
    return (
      <Card>
        <ErrorNote error={mine.error} retry={() => void mine.refetch()} />
      </Card>
    );
  }
  if (!items.length && !selectedId) {
    return (
      <EmptyState
        title="You haven't sent any requests."
        description="Leave, claims and other requests you submit show here with who they're waiting on."
      />
    );
  }
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,420px)_minmax(0,1fr)]">
      <Card className="self-start">
        <ul className="divide-y divide-border" aria-label="My requests">
          {items.map((r) => (
            <li key={r.id}>
              <button
                type="button"
                onClick={() => void navigate({ search: { view: "mine", request: r.id }, replace: true })}
                aria-current={r.id === selected ? "true" : undefined}
                className={cn(
                  "focus-ring flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left hover:bg-ink/[0.03]",
                  r.id === selected && "bg-kuning-50 shadow-[inset_3px_0_0_0_hsl(var(--ink))]",
                )}
              >
                <span className="min-w-0">
                  <span className="block truncate font-medium leading-5">{requestName(r.subjectLabel, r.title)}</span>
                  <span className="block truncate text-2xs text-primary-300">
                    {r.status === "pending" && r.waitingOn
                      ? `Waiting for ${r.waitingOn}`
                      : `Sent ${ageLabel(r.submittedAt, today)}`}
                  </span>
                </span>
                {/* "Waiting for …" already says a pending request is pending. */}
                {r.status === "pending" && r.waitingOn ? null : (
                  <StatusPill tone={STATUS_TONE[r.status]}>{STATUS_LABEL[r.status]}</StatusPill>
                )}
              </button>
            </li>
          ))}
        </ul>
      </Card>
      {selected ? (
        <Card className="min-w-0 self-start">
          <RequestPanel requestId={selected} />
        </Card>
      ) : null}
    </div>
  );
}
