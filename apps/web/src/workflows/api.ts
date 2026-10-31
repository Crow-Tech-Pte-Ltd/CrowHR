import { toast } from "@crowhr/ui";
import { queryOptions, useMutation, useQueryClient } from "@tanstack/react-query";
import { ApiError, apiGet, apiPost } from "../lib/api.ts";

/** Wire shapes of the approvals, inbox and notifications endpoints (mirror packages/core schemas). */
export type TaskOrigin = "resolved" | "delegated" | "escalated" | "reassigned";
export type RequestStatus = "pending" | "approved" | "rejected" | "withdrawn";

export interface InboxItem {
  id: string;
  source: string;
  kind: string;
  title: string;
  concerns: string | null;
  detail: string | null;
  dueOn: string | null;
  overdueDays: number;
  createdAt: string;
  href: string;
  actionLabel: string;
  task: {
    id: string;
    requestId: string;
    subjectType: string;
    inline: boolean;
    origin: TaskOrigin;
    onBehalfOf: string | null;
  } | null;
}

export interface Inbox {
  today: string;
  items: InboxItem[];
  sources: { id: string; label: string; status: "ready" | "not_set_up" }[];
}

export interface TaskItem {
  taskId: string;
  requestId: string;
  subjectType: string;
  subjectLabel: string;
  title: string;
  requester: { name: string };
  submittedAt: string;
  dueOn: string | null;
  overdueDays: number;
  origin: TaskOrigin;
  onBehalfOf: string | null;
  inline: boolean;
  step: { position: number; of: number; label: string };
}

export interface RequestDetail {
  id: string;
  subjectType: string;
  subjectLabel: string;
  title: string;
  status: RequestStatus;
  policyName: string;
  submittedAt: string;
  decidedAt: string | null;
  requester: { name: string };
  summary: {
    title: string;
    lines: { label: string; value: string }[];
    context: { label: string; value: string }[];
  } | null;
  link: string;
  steps: {
    position: number;
    label: string;
    status: "waiting" | "active" | "approved" | "rejected" | "skipped";
    skipReason: string | null;
    fallback: boolean;
    escalated: boolean;
    tasks: {
      id: string;
      assignee: string;
      onBehalfOf: string | null;
      origin: TaskOrigin;
      status: "pending" | "approved" | "rejected" | "superseded";
      decidedAt: string | null;
      comment: string | null;
      selfApproved: boolean;
    }[];
  }[];
  comments: { id: string; author: string; body: string; createdAt: string }[];
  viewer: { myTaskId: string | null; canWithdraw: boolean; canComment: boolean };
}

export interface MyRequest {
  id: string;
  subjectType: string;
  subjectLabel: string;
  title: string;
  status: RequestStatus;
  submittedAt: string;
  decidedAt: string | null;
  waitingOn: string | null;
}

export interface PolicyStep {
  approverRule: string;
  label: string;
  escalateAfterDays: number;
}

export interface Policy {
  id: string | null;
  name: string;
  condition: { amountGte?: number; typeCodes?: string[] } | null;
  priority: number;
  isDefault: boolean;
  builtIn: boolean;
  steps: PolicyStep[];
}

export interface PolicyType {
  subjectType: string;
  label: string;
  installed: boolean;
  ownerOnly: boolean;
  canEdit: boolean;
  policies: Policy[];
}

export interface Delegation {
  id: string;
  from: { membershipId: string; name: string };
  to: { membershipId: string; name: string };
  startsOn: string;
  endsOn: string;
  subjectTypes: string[] | null;
  active: boolean;
  createdAt: string;
}

export interface NotificationItem {
  id: string;
  kind: string;
  category: string;
  title: string;
  body: string | null;
  link: string;
  createdAt: string;
  readAt: string | null;
}

export const inboxQuery = queryOptions({
  queryKey: ["inbox"] as const,
  queryFn: () => apiGet<Inbox>("/api/v1/inbox"),
  refetchInterval: 60_000,
});

export const tasksQuery = queryOptions({
  queryKey: ["approvals", "tasks"] as const,
  queryFn: () => apiGet<{ items: TaskItem[] }>("/api/v1/approvals/tasks"),
  refetchInterval: 60_000,
});

export const requestQuery = (id: string) =>
  queryOptions({
    queryKey: ["approvals", "request", id] as const,
    queryFn: () => apiGet<RequestDetail>(`/api/v1/approvals/requests/${id}`),
    retry: (count, err) => !(err instanceof ApiError && err.status === 404) && count < 1,
  });

export const myRequestsQuery = queryOptions({
  queryKey: ["approvals", "mine"] as const,
  queryFn: () => apiGet<{ items: MyRequest[] }>("/api/v1/approvals/requests?limit=8"),
});

export const allMyRequestsQuery = queryOptions({
  queryKey: ["approvals", "mine", "all"] as const,
  queryFn: () => apiGet<{ items: MyRequest[] }>("/api/v1/approvals/requests?limit=50"),
});

export const policiesQuery = queryOptions({
  queryKey: ["approvals", "policies"] as const,
  queryFn: () => apiGet<{ types: PolicyType[] }>("/api/v1/approvals/policies"),
});

export const peopleQuery = queryOptions({
  queryKey: ["approvals", "people"] as const,
  queryFn: () => apiGet<{ items: { membershipId: string; name: string }[] }>("/api/v1/approvals/people"),
  staleTime: 5 * 60_000,
});

export const delegationsQuery = (all: boolean) =>
  queryOptions({
    queryKey: ["approvals", "delegations", all] as const,
    queryFn: () => apiGet<{ items: Delegation[] }>(`/api/v1/approvals/delegations?all=${all}`),
  });

export const unreadQuery = queryOptions({
  queryKey: ["notifications", "count"] as const,
  queryFn: () => apiGet<{ unread: number }>("/api/v1/notifications/unread-count"),
  refetchInterval: 30_000,
});

export const notificationsQuery = queryOptions({
  queryKey: ["notifications", "list"] as const,
  queryFn: () =>
    apiGet<{ items: NotificationItem[]; unread: number; total: number }>("/api/v1/notifications?pageSize=20"),
});

export type Decision = "approve" | "reject";

interface DecideVars {
  taskIds: string[];
  decision: Decision;
  comment?: string | null;
}

/**
 * Approve/reject with optimistic updates: the tasks leave Home and the inbox at once and come
 * back (with an error toast) if the server refuses. A task someone else already decided is
 * dropped for good and the toast says who decided it.
 */
export function useDecide(options: { onDone?: (taskIds: string[]) => void } = {}) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ taskIds, decision, comment }: DecideVars) => {
      if (taskIds.length === 1) {
        const r = await apiPost<{ requestStatus: RequestStatus }>(`/api/v1/approvals/tasks/${taskIds[0]}/decision`, {
          decision,
          comment: comment ?? null,
        });
        return [{ taskId: taskIds[0] as string, ok: true, requestStatus: r.requestStatus, code: null, message: null }];
      }
      const r = await apiPost<{
        results: {
          taskId: string;
          ok: boolean;
          requestStatus: RequestStatus | null;
          code: string | null;
          message: string | null;
        }[];
      }>("/api/v1/approvals/tasks/decisions", { taskIds, decision, comment: comment ?? null });
      return r.results;
    },
    onMutate: async ({ taskIds }) => {
      await qc.cancelQueries({ queryKey: ["inbox"] });
      await qc.cancelQueries({ queryKey: ["approvals", "tasks"] });
      const inbox = qc.getQueryData<Inbox>(inboxQuery.queryKey);
      const tasks = qc.getQueryData<{ items: TaskItem[] }>(tasksQuery.queryKey);
      const gone = new Set(taskIds);
      if (inbox)
        qc.setQueryData(inboxQuery.queryKey, {
          ...inbox,
          items: inbox.items.filter((i) => !i.task || !gone.has(i.task.id)),
        });
      if (tasks) qc.setQueryData(tasksQuery.queryKey, { items: tasks.items.filter((t) => !gone.has(t.taskId)) });
      return { inbox, tasks };
    },
    onError: (err, vars, context) => {
      const conflict = err instanceof ApiError && (err.code === "already_decided" || err.status === 404);
      if (!conflict) {
        if (context?.inbox) qc.setQueryData(inboxQuery.queryKey, context.inbox);
        if (context?.tasks) qc.setQueryData(tasksQuery.queryKey, context.tasks);
      }
      toast.error(conflict ? "Already handled" : "Nothing was changed", {
        description: err instanceof Error ? err.message : "The server didn't respond. Try again.",
      });
      options.onDone?.(vars.taskIds);
    },
    onSuccess: (results, vars) => {
      const ok = results.filter((r) => r.ok);
      const failed = results.filter((r) => !r.ok);
      const verb = vars.decision === "approve" ? "Approved" : "Rejected";
      if (ok.length) {
        const finished = ok.filter((r) => r.requestStatus !== "pending").length;
        toast.success(ok.length === 1 ? verb : `${verb} ${ok.length} requests`, {
          description:
            vars.decision === "reject"
              ? "The requester has been told why."
              : finished === ok.length
                ? "The requester has been notified."
                : "Sent on to the next approver.",
        });
      }
      if (failed.length) {
        toast.error(`${failed.length} not changed`, { description: failed[0]?.message ?? "Try again." });
      }
      options.onDone?.(vars.taskIds);
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ["inbox"] });
      void qc.invalidateQueries({ queryKey: ["approvals"] });
      void qc.invalidateQueries({ queryKey: ["notifications"] });
    },
  });
}

export const ORIGIN_LABEL: Record<TaskOrigin, string | null> = {
  resolved: null,
  delegated: "Covering",
  escalated: "Escalated",
  reassigned: "Reassigned",
};

export const STATUS_TONE = {
  pending: "warning",
  approved: "success",
  rejected: "danger",
  withdrawn: "neutral",
} as const;

export const STATUS_LABEL: Record<RequestStatus, string> = {
  pending: "Pending",
  approved: "Approved",
  rejected: "Not approved",
  withdrawn: "Withdrawn",
};
