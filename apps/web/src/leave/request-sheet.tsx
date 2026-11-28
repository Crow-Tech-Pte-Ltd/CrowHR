import {
  Button,
  FormField,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
  Skeleton,
  StatusPill,
  Textarea,
} from "@crowhr/ui";
import { useQuery } from "@tanstack/react-query";
import { FileText, Undo2, XCircle } from "lucide-react";
import * as React from "react";
import { useMe } from "../auth/session.ts";
import { ErrorNote } from "../components/section.tsx";
import { useLocale, useT } from "../i18n/index.ts";
import { ApiError } from "../lib/api.ts";
import { RequestPanel } from "../workflows/request-panel.tsx";
import { requestQuery, useRequestAction } from "./api.ts";
import { shortDate } from "./apply-sheet.tsx";
import { SwitchRow } from "./choice.tsx";
import { dateRange, qty, STATUS_LABEL, STATUS_TONE, weekdayOf } from "./format.ts";

/** One leave request: what, when, how much, attachments, the approval chain, withdraw / cancel. */
export function RequestSheet({ id, onClose }: { id: string | undefined; onClose: () => void }) {
  return (
    <Sheet open={!!id} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-[min(34rem,100vw)] overflow-y-auto" aria-describedby={undefined}>
        {id ? <RequestBody id={id} onClose={onClose} /> : null}
      </SheetContent>
    </Sheet>
  );
}

function RequestBody({ id, onClose }: { id: string; onClose: () => void }) {
  const locale = useLocale();
  const tWorkflow = useT("workflows");
  const me = useMe();
  const q = useQuery(requestQuery(id));
  const action = useRequestAction();
  const [cancelling, setCancelling] = React.useState(false);
  const [reason, setReason] = React.useState("");
  const [direct, setDirect] = React.useState(false);
  if (q.isPending) {
    return (
      <div className="flex flex-col gap-3 p-5" role="status" aria-label={tWorkflow("Loading leave request")}>
        <SheetTitle className="sr-only">{tWorkflow("Leave request")}</SheetTitle>
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-6 w-64" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }
  if (q.isError) {
    return (
      <div className="p-5">
        <SheetTitle className="mb-2 font-azeret text-sm font-semibold">{tWorkflow("Leave request")}</SheetTitle>
        {q.error instanceof ApiError && q.error.status === 404 ? (
          <p className="text-ui text-primary-300">
            {tWorkflow("This leave request doesn't exist, or you can't see it.")}
          </p>
        ) : (
          <ErrorNote error={q.error} retry={() => void q.refetch()} />
        )}
      </div>
    );
  }
  const r = q.data;
  const own = r.employee.id === me.employeeId;
  const admin = me.roles.includes("owner") || me.roles.includes("hr_admin");
  const mayAct = own || admin;
  const chainId =
    r.status === "cancellation_pending" || r.status === "cancelled"
      ? (r.cancellationRequestId ?? r.approvalRequestId)
      : r.approvalRequestId;
  return (
    <article data-testid="leave-request" className="flex flex-col">
      <header className="flex flex-col gap-2 border-b border-border p-5 pr-12">
        <div className="flex flex-wrap items-center gap-2">
          <StatusPill tone={STATUS_TONE[r.status]}>{tWorkflow(STATUS_LABEL[r.status])}</StatusPill>
          {r.onBehalf ? <span className="text-2xs text-primary-200">{tWorkflow("Entered by HR")}</span> : null}
        </div>
        <SheetTitle className="text-lg font-semibold leading-6">
          {r.type.name}
          {own ? null : <span className="text-primary-300"> · {r.employee.name}</span>}
        </SheetTitle>
        <SheetDescription className="num text-ui text-primary-300">
          {dateRange(r.startDate, r.endDate, r.startSession, r.endSession, locale)} ·{" "}
          {qty(r.quantity, r.unit, tWorkflow)}
        </SheetDescription>
      </header>
      <dl className="grid grid-cols-[8rem_1fr] gap-x-3 gap-y-2 border-b border-border p-5 text-ui">
        {r.reason ? (
          <>
            <dt className="text-primary-200">{tWorkflow("Reason")}</dt>
            <dd>{r.reason}</dd>
          </>
        ) : null}
        {r.child ? (
          <>
            <dt className="text-primary-200">{tWorkflow("Child")}</dt>
            <dd>{r.child.name}</dd>
          </>
        ) : null}
        {r.cancelReason ? (
          <>
            <dt className="text-primary-200">{tWorkflow("Why cancel")}</dt>
            <dd>{r.cancelReason}</dd>
          </>
        ) : null}
        <dt className="text-primary-200">{tWorkflow("Attachments")}</dt>
        <dd>
          {r.attachments.length ? (
            <ul className="flex flex-col gap-1">
              {r.attachments.map((a) => (
                <li key={a.id}>
                  <a
                    href={`/api/v1/leave/requests/${r.id}/attachments/${a.id}`}
                    target="_blank"
                    rel="noreferrer"
                    className="focus-ring inline-flex items-center gap-1 rounded-sm text-biru-400 hover:underline"
                  >
                    <FileText className="size-3.5" aria-hidden />
                    {a.filename}
                  </a>
                  <span className="num ml-1 text-2xs text-primary-200">{Math.ceil(a.sizeBytes / 1024)} KB</span>
                </li>
              ))}
            </ul>
          ) : (
            <span className="text-primary-200">{tWorkflow("None")}</span>
          )}
        </dd>
        {r.days?.length ? (
          <>
            <dt className="text-primary-200">{tWorkflow("Days counted")}</dt>
            <dd>
              <ul className="num flex flex-wrap gap-x-3 gap-y-1">
                {r.days.map((d) => (
                  <li key={d.date} className="whitespace-nowrap">
                    <span className="text-primary-200">{tWorkflow(weekdayOf(d.date))}</span> {shortDate(d.date)}
                    {d.session !== "full" ? ` ${d.session.toUpperCase()}` : ""}
                  </li>
                ))}
              </ul>
            </dd>
          </>
        ) : null}
      </dl>
      {mayAct && (r.status === "pending" || r.status === "approved" || r.status === "cancellation_pending") ? (
        <div className="flex flex-col gap-3 border-b border-border p-5">
          {r.status === "pending" ? (
            <div className="flex items-center justify-between gap-3">
              <p className="text-ui text-primary-300">
                {tWorkflow("Not decided yet. Withdraw it if your plans change.")}
              </p>
              <Button
                size="sm"
                disabled={action.isPending}
                onClick={() => action.mutate({ id: r.id, action: "withdraw" }, { onSuccess: onClose })}
              >
                <Undo2 /> {tWorkflow("Withdraw")}
              </Button>
            </div>
          ) : r.status === "cancellation_pending" && !admin ? (
            <p className="text-ui text-primary-300">
              {tWorkflow("Cancellation sent for approval. The leave stays booked until then.")}
            </p>
          ) : !cancelling ? (
            <div className="flex items-center justify-between gap-3">
              <p className="text-ui text-primary-300">
                {r.status === "cancellation_pending"
                  ? tWorkflow("A cancellation is waiting for approval.")
                  : tWorkflow("Cancelling approved leave needs approval; the days come back once it's approved.")}
              </p>
              <Button size="sm" onClick={() => setCancelling(true)}>
                <XCircle /> {tWorkflow("Cancel leave")}
              </Button>
            </div>
          ) : (
            <form
              className="flex flex-col gap-3"
              onSubmit={(e) => {
                e.preventDefault();
                action.mutate(
                  { id: r.id, action: "cancel", reason: reason.trim() || null, direct: admin && !own && direct },
                  { onSuccess: () => setCancelling(false) },
                );
              }}
            >
              <FormField label={tWorkflow("Why cancel?")} hint={tWorkflow("Optional. Your approver sees it.")}>
                <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} />
              </FormField>
              {admin && !own ? (
                <SwitchRow checked={direct} onChange={setDirect}>
                  {tWorkflow("Cancel now without approval (recorded in the audit log)")}
                </SwitchRow>
              ) : null}
              <div className="flex justify-end gap-2">
                <Button type="button" variant="ghost" size="sm" onClick={() => setCancelling(false)}>
                  {tWorkflow("Keep the leave")}
                </Button>
                <Button type="submit" variant="ink" size="sm" disabled={action.isPending}>
                  {direct && admin && !own ? tWorkflow("Cancel leave now") : tWorkflow("Ask to cancel")}
                </Button>
              </div>
            </form>
          )}
        </div>
      ) : null}
      {chainId ? <RequestPanel requestId={chainId} /> : null}
    </article>
  );
}
