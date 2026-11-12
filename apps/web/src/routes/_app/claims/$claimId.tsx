import {
  Alert,
  AlertDescription,
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Button,
  Card,
  formatDate,
  formatMoney,
  Skeleton,
  singaporeTodayIso,
  toast,
} from "@crowhr/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { AlertTriangle, Copy, Lock, Pencil, Send, Trash2, Undo2 } from "lucide-react";
import * as React from "react";
import { isNotFound, NotFoundPage } from "../../../components/not-found.tsx";
import { PageHeader } from "../../../components/page-header.tsx";
import { ErrorNote } from "../../../components/section.tsx";
import { api, type ClaimDto, type ClaimFileDto, claimKeys, claimQuery, errorMessage } from "./-lib/api.ts";
import { ClaimSheet } from "./-lib/claim-sheet.tsx";
import { formatBasisPoints } from "./-lib/money.ts";
import { CATEGORY_LABEL, ClaimStatusPill, foreignAmount, ReceiptChip, ReceiptViewer } from "./-lib/ui.tsx";

export const Route = createFileRoute("/_app/claims/$claimId")({
  component: ClaimPage,
});

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="font-azeret text-[10px] font-medium uppercase tracking-wider text-primary-200">{label}</dt>
      <dd className="text-ui">{children}</dd>
    </div>
  );
}

function payoutText(c: ClaimDto): string {
  if (c.status === "paid")
    return `Paid ${c.paidOn ? formatDate(c.paidOn) : ""} ${c.paidVia === "payroll" ? "with payroll" : "by transfer"}${c.paidReference ? ` (${c.paidReference})` : ""}`;
  if (c.status === "approved")
    return c.payoutMethod === "payroll"
      ? c.reservedByPayrollRun
        ? "In the current payroll run"
        : "With the next payroll"
      : "By transfer, outside payroll";
  return "After approval";
}

function ClaimPage() {
  const { claimId } = Route.useParams();
  const q = useQuery(claimQuery(claimId));
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [editing, setEditing] = React.useState(false);
  const [viewer, setViewer] = React.useState<{ files: ClaimFileDto[]; index: number } | null>(null);
  const [confirmDelete, setConfirmDelete] = React.useState(false);

  const act = useMutation({
    mutationFn: async (action: "submit" | "withdraw" | "copy" | "delete") => {
      if (action === "delete") return api<undefined>("DELETE", `/claims/${claimId}`);
      return api<ClaimDto>("POST", `/claims/${claimId}/${action}`);
    },
    onSuccess: (res, action) => {
      void qc.invalidateQueries({ queryKey: claimKeys.all });
      if (action === "delete") {
        toast.success("Draft deleted");
        void navigate({ to: "/claims" });
      } else if (action === "copy" && res) {
        toast.success("Copied into a new draft");
        void navigate({ to: "/claims/$claimId", params: { claimId: res.id } });
      } else if (action === "submit") toast.success(`Claim ${res?.claimNumber ?? ""} sent for approval`);
      else if (action === "withdraw") toast.success("Claim withdrawn");
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  if (q.isPending)
    return (
      <div role="status" aria-busy="true" className="flex flex-col gap-3">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  if (q.isError)
    return isNotFound(q.error) ? (
      <NotFoundPage
        title="Claim not found"
        crumbs={[{ label: "Claims", to: "/claims" }]}
        back={{ to: "/claims", label: "Back to claims" }}
      />
    ) : (
      <ErrorNote error={q.error} retry={() => void q.refetch()} />
    );
  const c = q.data;
  const allReceipts = c.lines.flatMap((l) => l.receipts ?? []);

  return (
    <>
      <PageHeader
        crumbs={[{ label: "Claims", to: "/claims" }]}
        kicker={c.claimNumber ?? "Draft"}
        title={c.title ?? (c.lines.length === 1 ? (c.lines[0]?.typeName ?? "Claim") : `${c.lines.length} expenses`)}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <ClaimStatusPill status={c.status} />
            <span>
              {c.employee.name}
              {c.employee.departmentName ? ` · ${c.employee.departmentName}` : ""}
            </span>
          </span>
        }
        actions={
          <>
            {c.actions.edit ? (
              <Button onClick={() => setEditing(true)}>
                <Pencil aria-hidden /> Edit
              </Button>
            ) : null}
            {c.actions.delete ? (
              <Button variant="ghost" onClick={() => setConfirmDelete(true)}>
                <Trash2 aria-hidden /> Delete
              </Button>
            ) : null}
            {c.actions.withdraw ? (
              <Button onClick={() => act.mutate("withdraw")} disabled={act.isPending}>
                <Undo2 aria-hidden /> Withdraw
              </Button>
            ) : null}
            {c.actions.copy ? (
              <Button onClick={() => act.mutate("copy")} disabled={act.isPending}>
                <Copy aria-hidden /> Copy to new draft
              </Button>
            ) : null}
            {c.actions.submit ? (
              <Button variant="primary" onClick={() => act.mutate("submit")} disabled={act.isPending}>
                <Send aria-hidden /> Submit
              </Button>
            ) : null}
          </>
        }
      />

      {c.status === "rejected" && c.decisionComment ? (
        <Alert variant="danger" className="mb-4">
          <AlertDescription>
            <span className="font-medium">Not approved:</span> {c.decisionComment}
          </AlertDescription>
        </Alert>
      ) : null}
      {c.lines.some((l) => l.fxWarning) ? (
        <Alert variant="warning" className="mb-4" data-testid="fx-warning">
          <AlertTriangle aria-hidden />
          <AlertDescription>
            <span className="block font-medium">Check the exchange rate.</span>
            {c.lines.map((l, i) =>
              l.fxWarning ? (
                <span key={l.id} className="block">
                  {c.lines.length > 1 ? `Expense ${i + 1}: ` : ""}
                  <span className="num">
                    {l.currency} {l.rate}
                  </span>{" "}
                  is {formatBasisPoints(l.fxWarning.deviationBasisPoints)}{" "}
                  {l.fxWarning.deviationBasisPoints >= 0 ? "above" : "below"} the last {l.currency} rate used in your
                  organisation, <span className="num">{l.fxWarning.lastRate}</span> on{" "}
                  <span className="num">{formatDate(l.fxWarning.lastRateOn)}</span>. Compare it with the receipt or card
                  statement.
                </span>
              ) : null,
            )}
          </AlertDescription>
        </Alert>
      ) : null}
      {c.lines.some((l) => l.duplicates.length) ? (
        <Alert variant="warning" className="mb-4" data-testid="duplicate-warning">
          <AlertTriangle aria-hidden />
          <AlertDescription>
            {c.lines
              .flatMap((l) => l.duplicates)
              .map((d) => (
                <span key={`${d.fileId}-${d.claimId}`} className="block">
                  Possible duplicate of claim{" "}
                  <Link to="/claims/$claimId" params={{ claimId: d.claimId }} className="num font-medium underline">
                    {d.claimNumber ?? "draft"}
                  </Link>
                  : the same receipt image is attached there.
                </span>
              ))}
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[1fr_18rem]">
        <Card className="overflow-hidden">
          <ol className="divide-y divide-border">
            {c.lines.map((l) => (
              <li key={l.id} className="grid gap-3 p-4 sm:grid-cols-[1fr_auto]" data-testid="claim-line">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <span className="font-medium">{l.typeName}</span>
                    <span className="num text-2xs text-primary-200">{formatDate(l.expenseDate)}</span>
                  </div>
                  {l.redactedFields?.length ? (
                    <p className="mt-1 flex items-center gap-1 text-ui text-primary-200">
                      <Lock className="size-3.5" aria-hidden /> {CATEGORY_LABEL[l.category]} details are only shown to
                      HR, the employee and the current approver.
                    </p>
                  ) : (
                    <p className="mt-0.5 text-ui text-primary-300">
                      {l.merchant}
                      {l.description ? ` · ${l.description}` : ""}
                    </p>
                  )}
                  {l.receipts?.length ? (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {l.receipts.map((r) => (
                        <ReceiptChip
                          key={r.id}
                          file={r}
                          onOpen={() =>
                            setViewer({ files: allReceipts, index: allReceipts.findIndex((x) => x.id === r.id) })
                          }
                        />
                      ))}
                    </div>
                  ) : l.receiptRequired && !l.redactedFields?.length ? (
                    <p className="mt-2 text-2xs text-danger-300">A receipt is required for this expense.</p>
                  ) : null}
                </div>
                <div className="text-right">
                  <p className="num font-semibold">{formatMoney(l.sgdCents)}</p>
                  {l.currency !== "SGD" ? (
                    <p className="num text-2xs text-primary-200">
                      {foreignAmount(l.currency, l.amountMinor)} @ {l.rate}
                    </p>
                  ) : null}
                  {l.fxWarning ? (
                    <p
                      className="num mt-0.5 inline-flex items-center gap-1 text-2xs font-medium text-warning-400"
                      data-testid="fx-warning-line"
                    >
                      <AlertTriangle className="size-3" aria-hidden />
                      {formatBasisPoints(l.fxWarning.deviationBasisPoints)}{" "}
                      {l.fxWarning.deviationBasisPoints >= 0 ? "above" : "below"} last rate {l.fxWarning.lastRate}
                    </p>
                  ) : null}
                  {l.gstCents ? (
                    <p className="num text-2xs text-primary-200">incl. GST {formatMoney(l.gstCents)}</p>
                  ) : null}
                </div>
              </li>
            ))}
          </ol>
          <div className="flex items-center justify-between border-t border-border bg-surface-100/60 px-4 py-3">
            <span className="font-azeret text-2xs font-semibold uppercase tracking-wider">Total</span>
            <span className="num text-base font-semibold" data-testid="claim-detail-total">
              {formatMoney(c.totalCents)}
            </span>
          </div>
        </Card>

        <aside className="flex flex-col gap-4">
          <Card className="p-4">
            <dl className="grid gap-3">
              <Fact label="Payout">{payoutText(c)}</Fact>
              {c.submittedAt ? (
                <Fact label="Submitted">{formatDate(singaporeTodayIso(Date.parse(c.submittedAt)))}</Fact>
              ) : null}
              {c.approvedOn ? <Fact label="Approved">{formatDate(c.approvedOn)}</Fact> : null}
              {c.gstCents ? <Fact label="GST included">{formatMoney(c.gstCents)}</Fact> : null}
              {c.approvalRequestId && c.status === "submitted" ? (
                <Fact label="Approval">
                  <Link to="/inbox" search={{ request: c.approvalRequestId }} className="text-biru-400 hover:underline">
                    See who needs to approve
                  </Link>
                </Fact>
              ) : null}
            </dl>
          </Card>
          {c.capUsage.length ? (
            <Card className="p-4" data-testid="cap-usage">
              <p className="mb-2 font-azeret text-[10px] font-medium uppercase tracking-wider text-primary-200">Caps</p>
              <ul className="flex flex-col gap-2">
                {c.capUsage.map((u) => (
                  <li key={`${u.typeId}-${u.periodLabel}`} className="text-ui">
                    <span className="font-medium">{u.typeName}</span>{" "}
                    <span className="text-primary-200">({u.period === "per_claim" ? "per claim" : u.periodLabel})</span>
                    <span className="num block text-2xs text-primary-300">
                      {formatMoney(u.usedCents)} approved · {formatMoney(u.pendingCents)} pending · this claim{" "}
                      {formatMoney(u.claimCents)} of {formatMoney(u.capCents)}
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}
        </aside>
      </div>

      <ReceiptViewer
        files={viewer?.files ?? []}
        index={viewer?.index ?? null}
        onIndex={(index) => setViewer((v) => (v ? { ...v, index } : v))}
        onClose={() => setViewer(null)}
      />
      {editing ? <ClaimSheet open={editing} onOpenChange={setEditing} draft={c} /> : null}
      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this draft?</AlertDialogTitle>
            <AlertDialogDescription>
              The draft and its lines are removed. Its receipts are deleted once they are 7 days old, unless they are on
              another claim.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction onClick={() => act.mutate("delete")}>Delete draft</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
