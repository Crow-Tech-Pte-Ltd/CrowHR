import type { PayrollOverviewDto, PayrollRowDto } from "@crowhr/core";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Card,
  cn,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  FormField,
  formatDate,
  formatMoney,
  Input,
  Kbd,
  Skeleton,
  Textarea,
  textStyle,
  toast,
} from "@crowhr/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { AlertOctagon, CheckCircle2, Download, FileText, RotateCcw, Search, Send, Undo2 } from "lucide-react";
import * as React from "react";
import { useReauth } from "../../../auth/reauth.tsx";
import { can, useMe } from "../../../auth/session.ts";
import { isNotFound, NotFoundPage } from "../../../components/not-found.tsx";
import { PageHeader } from "../../../components/page-header.tsx";
import { ErrorNote } from "../../../components/section.tsx";
import { useLocale, useT } from "../../../i18n/index.ts";
import {
  decide,
  downloadFile,
  type Excluded,
  errorMessage,
  invalidateRun,
  monthName,
  myRunTaskQuery,
  reopen,
  returnToDraft,
  runAction,
  runQuery,
  runTitle,
} from "./-lib/api.ts";
import { EmployeeDrawer } from "./-lib/drawer.tsx";
import { type DrawerTask, fixesFor, type IssueFix } from "./-lib/fixes.ts";
import { Flags, IssueList, Money, RunStatusPill } from "./-lib/ui.tsx";

export const Route = createFileRoute("/_app/payroll/runs/$runId")({
  validateSearch: (s: Record<string, unknown>): { employee?: string } =>
    typeof s.employee === "string" ? { employee: s.employee } : {},
  component: RunPage,
});

function RunPage() {
  const t = useT("people-payroll");
  const { runId } = Route.useParams();
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const q = useQuery(runQuery(runId));
  // A fix opened from an issue: the drawer starts with that item form (cleared when it closes).
  const [task, setTask] = React.useState<DrawerTask | null>(null);
  const openEmployee = (employeeId: string | undefined, next: DrawerTask | null = null) => {
    setTask(next);
    void navigate({ search: (s) => ({ ...s, employee: employeeId }), replace: true });
  };

  if (q.isPending) {
    return (
      <div role="status" aria-label={t("Loading payroll run")} className="flex flex-col gap-4">
        <Skeleton className="h-6 w-64" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-80 w-full" />
      </div>
    );
  }
  if (q.isError) {
    return isNotFound(q.error) ? (
      <NotFoundPage
        title={t("Payroll run not found")}
        crumbs={[{ label: t("Payroll"), to: "/payroll" }]}
        back={{ to: "/payroll", label: t("Back to payroll") }}
      />
    ) : (
      <Card>
        <ErrorNote error={q.error} retry={() => void q.refetch()} />
      </Card>
    );
  }
  const o = q.data;
  return (
    <>
      <RunHeader o={o} />
      <TotalsCard o={o} />
      <div
        className={cn(
          "grid items-start gap-4",
          o.run.computedAt && "min-[1360px]:grid-cols-[minmax(0,1fr)_17rem] 2xl:grid-cols-[minmax(0,1fr)_19rem]",
        )}
      >
        <ReviewTable o={o} onOpen={openEmployee} />
        <div className="min-w-0 space-y-4">
          <IssuesPanel
            o={o}
            onEmployee={openEmployee}
            onFix={(fix) => {
              if (fix.kind === "drawer")
                openEmployee(fix.employeeId, o.run.status === "draft" ? (fix.task ?? null) : null);
            }}
          />
          <ChangesPanel o={o} onEmployee={openEmployee} />
        </div>
      </div>
      <EmployeeDrawer
        runId={runId}
        run={o.run}
        rows={o.rows}
        employeeId={search.employee ?? null}
        onNavigate={openEmployee}
        task={task}
        onTask={setTask}
      />
    </>
  );
}

function RunHeader({ o }: { o: PayrollOverviewDto }) {
  const locale = useLocale();
  const translate = useT("people-payroll");
  const { run } = o;
  const me = useMe();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const reauth = useReauth();
  const [dialog, setDialog] = React.useState<null | "reject" | "reopen" | "draft">(null);
  const act = useMutation({
    mutationFn: (fn: () => Promise<unknown>) => fn(),
    onSuccess: () => invalidateRun(qc, run.id),
    onError: (e) => toast.error(errorMessage(e)),
  });
  const myTask = useQuery(myRunTaskQuery(run.status === "in_review" ? run.approvalRequestId : null));
  const taskId = myTask.data?.taskId ?? null;
  const blocking = o.issues.filter((i) => i.severity === "blocking").length;
  const computed = !!run.computedAt;
  const busy = act.isPending;
  const actions: React.ReactNode[] = [];
  if (run.status === "draft") {
    actions.push(
      <Button
        key="compute"
        size="sm"
        disabled={busy}
        onClick={() =>
          act.mutate(() =>
            runAction(run.id, "compute").then(() => toast.success(translate("Computed from the current records"))),
          )
        }
      >
        <RotateCcw aria-hidden /> {computed ? translate("Recompute") : translate("Compute")}
      </Button>,
      <Button
        key="submit"
        variant="primary"
        size="sm"
        disabled={busy || !computed || blocking > 0}
        title={
          !computed
            ? translate("Compute the run first")
            : blocking
              ? translate("Resolve the blocking issues first")
              : undefined
        }
        onClick={() =>
          act.mutate(() => runAction(run.id, "submit").then(() => toast.success(translate("Submitted for approval"))))
        }
      >
        <Send aria-hidden /> {translate("Submit for approval")}
      </Button>,
    );
  }
  if (run.status === "in_review") {
    actions.push(
      <Button
        key="withdraw"
        variant="ghost"
        size="sm"
        disabled={busy}
        onClick={() => act.mutate(() => runAction(run.id, "withdraw"))}
      >
        {translate("Withdraw")}
      </Button>,
      ...(taskId
        ? [
            <Button key="reject" size="sm" disabled={busy} onClick={() => setDialog("reject")}>
              {translate("Reject")}
            </Button>,
            <Button
              key="approve"
              variant="primary"
              size="sm"
              disabled={busy}
              onClick={() =>
                act.mutate(() =>
                  decide(taskId, "approved").then(async () => {
                    await qc.invalidateQueries({ queryKey: ["approvals"] });
                    toast.success(translate("Run approved"));
                  }),
                )
              }
            >
              <CheckCircle2 aria-hidden /> {translate("Approve")}
            </Button>,
          ]
        : [
            <span key="waiting" className="self-center text-2xs text-primary-300">
              {translate("Waiting for the approver (an owner by default). It is in their Inbox.")}
            </span>,
          ]),
    );
  }
  if (run.status === "approved" || run.status === "paid") {
    if (!run.supersededByRunId) {
      actions.push(
        <Button key="reopen" variant="ghost" size="sm" disabled={busy} onClick={() => setDialog("reopen")}>
          {translate("Reopen")}
        </Button>,
      );
      if (run.status === "approved") {
        actions.push(
          <Button key="draft" variant="ghost" size="sm" disabled={busy} onClick={() => setDialog("draft")}>
            <Undo2 aria-hidden /> {translate("Return to draft")}
          </Button>,
        );
      }
    }
    if (run.status === "approved") {
      actions.push(
        <Button
          key="paid"
          size="sm"
          disabled={busy}
          onClick={() =>
            act.mutate(() => runAction(run.id, "mark-paid").then(() => toast.success(translate("Marked paid"))))
          }
        >
          {translate("Mark paid")}
        </Button>,
      );
    }
    if (!run.releasedAt) {
      actions.push(
        <Button
          key="release"
          variant="primary"
          size="sm"
          disabled={busy}
          onClick={() =>
            act.mutate(() =>
              runAction(run.id, "release").then(() => toast.success(translate("Payslips released to employees"))),
            )
          }
        >
          <FileText aria-hidden /> {translate("Release payslips")}
        </Button>,
      );
    }
  }
  if (computed && can(me, "reports_payroll_cost:read")) {
    actions.unshift(
      <Button asChild key="register" size="sm">
        <Link
          to="/reports/$reportId"
          params={{ reportId: "payroll.register" }}
          search={{ from: run.month, to: run.month, state: "all", runId: run.id }}
        >
          <Download aria-hidden /> {translate("Payroll register")}
        </Link>
      </Button>,
    );
  }
  const kindNote =
    run.kind === "adjustment"
      ? `Adjustment of ${o.adjustment ? monthName(o.adjustment.ofMonth, locale) : "an earlier run"}: ${run.reopenReason ?? ""}`
      : run.kind === "off_cycle"
        ? run.offCycleReason === "final_pay"
          ? "Off-cycle final pay"
          : "Off-cycle bonus run: one-off items only"
        : null;
  return (
    <>
      <PageHeader
        crumbs={[{ label: translate("Payroll"), to: "/payroll" }]}
        title={runTitle(run, locale)}
        trailing={
          <span className="flex flex-wrap items-center gap-2.5">
            <RunStatusPill status={run.status} superseded={!!run.supersededByRunId} />
            {run.releasedAt ? <span className="text-ui text-primary-300">{translate("Payslips released")}</span> : null}
          </span>
        }
        description={
          <>
            {translate("Pay date")} <span className="num">{formatDate(run.payDate)}</span> · period{" "}
            <span className="num">
              {formatDate(run.periodStart)} – {formatDate(run.periodEnd)}
            </span>
            {kindNote ? <span className="block">{kindNote}</span> : null}
            {run.decisionComment && run.status === "draft" ? (
              <span className="block text-danger-300">
                {run.decisionComment.startsWith("Returned to draft: ")
                  ? `${run.decisionComment}. Recompute, then submit it for approval again.`
                  : `Returned by the approver: “${run.decisionComment}”`}
              </span>
            ) : null}
            {run.supersededByRunId ? (
              <span className="block">
                Corrected by{" "}
                <Link
                  to="/payroll/runs/$runId"
                  params={{ runId: run.supersededByRunId }}
                  className="text-biru-400 hover:underline"
                >
                  a later adjustment
                </Link>
                ; these figures are kept as they were paid.
              </span>
            ) : null}
          </>
        }
        actions={actions.length ? actions : undefined}
      />
      <ReasonDialog
        open={dialog === "reject"}
        title={translate("Reject this run")}
        description={translate("It goes back to draft with your comment, so the preparer knows what to fix.")}
        label={translate("What needs fixing")}
        confirm="Reject run"
        onClose={() => setDialog(null)}
        onConfirm={(reason) =>
          act
            .mutateAsync(() => decide(taskId as string, "rejected", reason))
            .then(async () => {
              await qc.invalidateQueries({ queryKey: ["approvals"] });
              setDialog(null);
            })
        }
      />
      <ReasonDialog
        open={dialog === "draft"}
        title={translate("Return to draft")}
        description={`For a change that must not be paid as an adjustment, such as an employee's new bank account. The run becomes a draft to recompute and approve again${run.releasedAt ? "; employees can't see its payslips until they are released again" : ""}. If a later month already used this run's CPF figures, reopen it as an adjustment instead.`}
        label={translate("Reason (kept in the audit log)")}
        confirm="Return to draft"
        onClose={() => setDialog(null)}
        onConfirm={(reason) =>
          reauth(() => returnToDraft(run.id, reason))
            .then(async () => {
              await invalidateRun(qc, run.id);
              setDialog(null);
              toast.success(translate("Returned to draft. Recompute it, then submit it for approval again."));
            })
            .catch((e) => {
              toast.error(errorMessage(e));
            })
        }
      />
      <ReasonDialog
        open={dialog === "reopen"}
        title={translate("Reopen as an adjustment")}
        description={translate(
          "A new adjustment run starts from this run's items. This run's figures, payslips and files never change; employees get a revised payslip showing what is still payable.",
        )}
        label={translate("Reason (kept in the audit log)")}
        confirm="Create adjustment"
        onClose={() => setDialog(null)}
        onConfirm={(reason) =>
          reopen(run.id, reason)
            .then(async (adj) => {
              await invalidateRun(qc, run.id);
              setDialog(null);
              void navigate({ to: "/payroll/runs/$runId", params: { runId: adj.id } });
            })
            .catch((e) => {
              toast.error(errorMessage(e));
            })
        }
      />
    </>
  );
}

function ReasonDialog(props: {
  open: boolean;
  title: string;
  description: string;
  label: string;
  confirm: string;
  onClose: () => void;
  onConfirm: (reason: string) => Promise<unknown>;
}) {
  const t = useT("people-payroll");
  const [text, setText] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  return (
    <Dialog open={props.open} onOpenChange={(o) => !o && props.onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{props.title}</DialogTitle>
          <DialogDescription>{props.description}</DialogDescription>
        </DialogHeader>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            try {
              await props.onConfirm(text);
              setText("");
            } finally {
              setBusy(false);
            }
          }}
          className="flex flex-col gap-3"
        >
          <FormField label={props.label} required>
            <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} />
          </FormField>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={props.onClose}>
              {t("Cancel")}
            </Button>
            <Button type="submit" variant="primary" disabled={busy || !text.trim()}>
              {props.confirm}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function IssuesPanel({
  o,
  onEmployee,
  onFix,
}: {
  o: PayrollOverviewDto;
  onEmployee: (id: string) => void;
  onFix: (fix: IssueFix) => void;
}) {
  const t = useT("people-payroll");
  if (!o.run.computedAt) {
    return (
      <Alert>
        <AlertOctagon aria-hidden />
        <div>
          <AlertTitle>{t("Not computed yet")}</AlertTitle>
          <AlertDescription>
            {t("Compute the run to read basic pay, allowances and CPF details from People and apply this run's items.")}
          </AlertDescription>
        </div>
      </Alert>
    );
  }
  const blocking = o.issues.filter((i) => i.severity === "blocking");
  const warnings = o.issues.filter((i) => i.severity === "warning");
  // Counted like the payroll list: one per employee and issue. A warning many people share is one
  // line below ("24 employees: …"), so the heading can be larger than the number of lines.
  const blockingCount = o.run.totals?.blocking ?? blocking.length;
  const warningCount = o.run.totals?.warnings ?? warnings.length;
  const stale = o.run.inputsChangedSinceCompute ? (
    <Alert variant="warning" className="mb-3">
      <RotateCcw aria-hidden />
      <div>
        <AlertTitle>{t("Items changed since the last computation")}</AlertTitle>
        <AlertDescription>{t("The figures below are from before the change. Recompute to apply it.")}</AlertDescription>
      </div>
    </Alert>
  ) : null;
  if (!blocking.length && !warnings.length) {
    return (
      <>
        {stale}
        <p className="flex items-start gap-2 text-ui text-success-400">
          <CheckCircle2 className="size-4" aria-hidden /> {t("No issues. Every employee computed without warnings.")}
        </p>
      </>
    );
  }
  return (
    <section aria-labelledby="issues-title">
      {stale}
      <h2 id="issues-title" className={cn("mb-2", textStyle.section)}>
        {blocking.length ? (
          <span className="text-danger-300">
            {t("Blocking issues")} <span className="num">({blockingCount})</span>
          </span>
        ) : null}
        {blocking.length && warnings.length ? <span className="text-primary-200"> · </span> : null}
        {warnings.length ? (
          <span className="text-warning-400">
            {t("Warnings")} <span className="num">({warningCount})</span>
          </span>
        ) : null}
      </h2>
      <Card className={cn(blocking.length && "border-danger-200/50")}>
        <IssueList
          issues={[...blocking, ...warnings]}
          onEmployee={onEmployee}
          limit={blocking.length ? Math.max(blocking.length, 4) : 4}
          fixes={(i) => fixesFor(i, i.employeeId ?? null)}
          onFix={onFix}
        />
      </Card>
      <Link
        to="/help"
        search={{ topic: "payroll" }}
        className="focus-ring mt-2 inline-block rounded-sm text-ui text-biru-400 underline"
      >
        {t("Help with payroll issues")}
      </Link>
    </section>
  );
}

/**
 * The run's payables by who receives them: employees (net pay, the bank file), CPF Board (the CPF
 * EZPay file: CPF, SHG and SDL) and MOM (the levy estimate). The employee table's TOTAL row has the
 * column sums (gross, CPF, claims), so the strip doesn't repeat them.
 */
function TotalsCard({ o }: { o: PayrollOverviewDto }) {
  const translate = useT("people-payroll");
  const t = o.run.totals;
  if (!t) return null;
  const shgCharged = Object.values(t.shgChargedByFund).reduce((s, v) => s + v, 0);
  const cpfBoard = t.cpfTotalChargedCents + shgCharged + t.sdlChargedCents;
  const editable = o.run.status === "draft" || o.run.status === "in_review";
  return (
    <Card variant={editable && !o.run.supersededByRunId ? "emphasis" : "default"} className="mb-5">
      {/* Wrapping flex, not a fixed grid: amounts of any size fit, and a full row never leaves gaps. */}
      <dl className="flex flex-wrap gap-px overflow-hidden rounded-[inherit] bg-border">
        <div className="flex-[1.4_1_10rem] bg-kuning-50 px-3 py-2.5">
          <dt className={textStyle.field}>
            {o.run.kind === "adjustment" ? translate("Net to pay now") : translate("Net pay")}
          </dt>
          <dd className="num mt-0.5 whitespace-nowrap text-base font-semibold">{formatMoney(t.netPayableCents)}</dd>
        </div>
        <div className="flex-[1.4_1_14rem] bg-card px-3 py-2.5">
          <dt className={textStyle.field}>{translate("To CPF Board (the CPF EZPay file)")}</dt>
          <dd className="num mt-0.5 whitespace-nowrap text-base">{formatMoney(cpfBoard)}</dd>
          <dd className="mt-0.5 text-2xs text-primary-300">
            CPF <span className="num">{formatMoney(t.cpfTotalChargedCents)}</span> · SHG{" "}
            <span className="num">{formatMoney(shgCharged)}</span> ·{" "}
            <span title={translate("Rounded down to the dollar for the month")}>
              SDL <span className="num">{formatMoney(t.sdlChargedCents)}</span>
            </span>
          </dd>
        </div>
        <div className="flex-[1_1_9rem] bg-card px-3 py-2.5" title={translate("MOM's levy bill is authoritative")}>
          <dt className={textStyle.field}>{translate("Foreign worker levy, estimate")}</dt>
          <dd className="num mt-0.5 whitespace-nowrap text-base">{formatMoney(t.fwlCents)}</dd>
        </div>
      </dl>
    </Card>
  );
}

/** "Changes since September (12)": the server's headline sentence, as a heading with a count. */
function changesTitle(o: PayrollOverviewDto, locale: ReturnType<typeof useLocale>): string {
  const { comparedWith, headline, items } = o.changes;
  if (!comparedWith || !items.length) return headline.replace(/\.$/, "");
  const against = o.run.kind === "adjustment" ? "the original run" : monthName(comparedWith.month, locale, true);
  return `Changes since ${against} (${items.length})`;
}

function ChangesPanel({ o, onEmployee }: { o: PayrollOverviewDto; onEmployee: (id: string) => void }) {
  const locale = useLocale();
  const translate = useT("people-payroll");
  if (!o.run.computedAt) return null;
  const { items } = o.changes;
  // Identical lines (three separate 1 h overtime items for one person) show once with a count;
  // they also shared a React key, which can mis-render the list when it updates.
  const grouped = [
    ...items
      .reduce((m, c) => {
        const key = `${c.employeeId}-${c.kind}-${c.text}`;
        const g = m.get(key);
        if (g) g.count += 1;
        else m.set(key, { key, c, count: 1 });
        return m;
      }, new Map<string, { key: string; c: (typeof items)[number]; count: number }>())
      .values(),
  ];
  return (
    <section aria-labelledby="changes-title">
      <h2 id="changes-title" className={cn("mb-2", textStyle.section)}>
        {changesTitle(o, locale)}
      </h2>
      {items.length ? (
        <Card>
          <ul className="max-h-80 divide-y divide-border overflow-y-auto px-3">
            {grouped.map(({ key, c, count }) => (
              <li key={key} className="py-2 text-ui">
                <p className="text-2xs text-primary-300">{translate(CHANGE[c.kind])}</p>
                <p className="break-words">
                  <button
                    type="button"
                    className="focus-ring rounded-sm font-medium hover:underline"
                    onClick={() => onEmployee(c.employeeId)}
                  >
                    {c.name}
                  </button>{" "}
                  <span className="text-primary-300">{c.text}</span>
                  {count > 1 ? <span className="num text-primary-200"> ×{count}</span> : null}
                </p>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </section>
  );
}

function FilesPanel({ runId }: { runId: string }) {
  const translate = useT("people-payroll");
  const reauth = useReauth();
  const [excluded, setExcluded] = React.useState<{ file: string; list: Excluded[] } | null>(null);
  const get = (path: string) =>
    reauth(() => downloadFile(path))
      .then((r) => {
        const out = r as Awaited<ReturnType<typeof downloadFile>>;
        setExcluded(out.excluded.length ? { file: out.fileName, list: out.excluded } : null);
        toast.success(`Downloaded ${out.fileName}`);
      })
      .catch((e) => toast.error(errorMessage(e)));
  return (
    <section aria-labelledby="files-title" className="mt-6">
      <h2 id="files-title" className={cn("mb-2", textStyle.section)}>
        {translate("Files")}
      </h2>
      <Card>
        <ul className="divide-y divide-border">
          <li className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-ui font-medium">{translate("CPF EZPay submission file")}</p>
              <p className="text-2xs text-primary-300">
                {translate(
                  "CPF Board's fixed-width FTP format (spec of 16 Jan 2025). Upload it in CPF EZPay; it holds the CPF, SHG and SDL this run charged.",
                )}
              </p>
            </div>
            <Button size="sm" onClick={() => void get(`/payroll/runs/${runId}/files/cpf-ezpay`)}>
              <Download aria-hidden /> .DTL
            </Button>
          </li>
          <li className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-ui font-medium">{translate("Bank payment file (ISO 20022 pain.001)")}</p>
              <p className="text-2xs text-primary-300">
                {translate(
                  "Generic ISO 20022 file. Each bank has its own rules for this format (FAST or GIRO, fees, BIC length), and none is applied yet. Test it with your bank before the first payroll.",
                )}
              </p>
            </div>
            <Button size="sm" onClick={() => void get(`/payroll/runs/${runId}/files/bank`)}>
              <Download aria-hidden /> XML
            </Button>
          </li>
        </ul>
        {excluded ? (
          <div className="border-t border-border px-4 py-3 text-ui">
            <p className="font-medium text-warning-400">Left out of {excluded.file}:</p>
            <ul className="mt-1 list-disc pl-5">
              {excluded.list.map((x) => (
                <li key={`${x.employeeName}-${x.reason}`}>
                  {x.employeeName}: {x.reason}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </Card>
    </section>
  );
}

const CHANGE: Record<PayrollOverviewDto["changes"]["items"][number]["kind"], string> = {
  joined: "Joined",
  left: "Leaving",
  basic_changed: "Pay change",
  new_item: "Pay item",
  net_changed: "Net change",
  not_in_run: "Missing",
  residency: "Residency",
};

// Reveal breakdown columns according to the employee table's own width, including when the
// sidebar or review rail takes space. Every amount remains available in the employee drawer.
const COLS: { key: keyof PayrollRowDto; label: string; className?: string }[] = [
  { key: "basicCents", label: "Basic", className: "hidden [@container(min-width:34rem)]:table-cell" },
  { key: "allowancesCents", label: "Allow.", className: "hidden [@container(min-width:58rem)]:table-cell" },
  { key: "overtimeCents", label: "OT", className: "hidden [@container(min-width:58rem)]:table-cell" },
  { key: "additionalCents", label: "Bonus/other", className: "hidden [@container(min-width:69rem)]:table-cell" },
  { key: "nplCents", label: "No-pay", className: "hidden [@container(min-width:80rem)]:table-cell" },
  { key: "grossCents", label: "Gross", className: "hidden [@container(min-width:32rem)]:table-cell" },
  { key: "cpfEmployeeCents", label: "CPF ee", className: "hidden [@container(min-width:41rem)]:table-cell" },
  { key: "shgCents", label: "SHG", className: "hidden [@container(min-width:80rem)]:table-cell" },
  { key: "otherDeductionsCents", label: "Deduct.", className: "hidden [@container(min-width:80rem)]:table-cell" },
  { key: "reimbursementsCents", label: "Claims", className: "hidden [@container(min-width:46rem)]:table-cell" },
  { key: "netPayableCents", label: "Net" },
  { key: "cpfEmployerCents", label: "CPF er", className: "hidden [@container(min-width:49rem)]:table-cell" },
];

function ReviewTable({ o, onOpen }: { o: PayrollOverviewDto; onOpen: (id: string) => void }) {
  const translate = useT("people-payroll");
  const [filter, setFilter] = React.useState("");
  const [onlyIssues, setOnlyIssues] = React.useState(false);
  const filterRef = React.useRef<HTMLInputElement>(null);
  const bodyRef = React.useRef<HTMLTableSectionElement>(null);
  const rows = o.rows.filter(
    (r) =>
      (!onlyIssues || r.blocking + r.warnings > 0) &&
      (!filter || `${r.name} ${r.employeeNumber} ${r.department ?? ""}`.toLowerCase().includes(filter.toLowerCase())),
  );
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (
        e.key === "/" &&
        !(t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement) &&
        !document.querySelector("[role=dialog]")
      ) {
        e.preventDefault();
        filterRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const move = (e: React.KeyboardEvent<HTMLTableRowElement>, employeeId: string) => {
    const list = Array.from(bodyRef.current?.querySelectorAll<HTMLTableRowElement>("tr[data-row]") ?? []);
    const i = list.indexOf(e.currentTarget);
    if (e.key === "ArrowDown" || e.key === "j") {
      e.preventDefault();
      list[i + 1]?.focus();
    } else if (e.key === "ArrowUp" || e.key === "k") {
      e.preventDefault();
      list[i - 1]?.focus();
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onOpen(employeeId);
    }
  };
  if (!o.run.computedAt) return null;
  const sum = (k: keyof PayrollRowDto) => rows.reduce((s, r) => s + (r[k] as number), 0);
  return (
    <section aria-labelledby="employees-title" className="min-w-0 [container-type:inline-size]">
      <div className="mb-2 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <h2 id="employees-title" className={textStyle.section}>
          {translate("Employees")}{" "}
          <span className="num text-primary-200">
            ({rows.length === o.rows.length ? rows.length : `${rows.length} of ${o.rows.length}`})
          </span>
        </h2>
        <div className="flex items-center gap-2">
          <label htmlFor="only-issues" className="flex items-center gap-1.5 text-2xs text-primary-300">
            <input
              id="only-issues"
              type="checkbox"
              className="focus-ring accent-ink"
              checked={onlyIssues}
              onChange={(e) => setOnlyIssues(e.target.checked)}
            />
            {translate("With issues only")}
          </label>
          <div className="relative">
            <Search
              className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-primary-200"
              aria-hidden
            />
            <Input
              ref={filterRef}
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder={translate("Filter")}
              aria-label={translate("Filter employees")}
              className="h-8 w-44 pl-8 text-ui"
              onKeyDown={(e) => {
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  bodyRef.current?.querySelector<HTMLTableRowElement>("tr[data-row]")?.focus();
                }
              }}
            />
          </div>
        </div>
      </div>
      <div className="max-h-[70vh] overflow-auto rounded-lg border border-border bg-card">
        <table className="w-full border-collapse text-ui" aria-label={translate("Pay per employee")}>
          <thead className="sticky top-0 z-10 bg-surface-100">
            <tr className="h-9 border-b border-border">
              <th className={cn("sticky left-0 z-10 bg-surface-100 px-2.5 text-left", textStyle.column)}>
                {translate("Employee")}
              </th>
              {COLS.map((c) => (
                <th key={c.key} className={cn("px-2.5 text-right", textStyle.column, c.className)}>
                  {translate(c.label)}
                </th>
              ))}
              <th className="w-10 px-2">
                <span className="sr-only">{translate("Issues")}</span>
              </th>
            </tr>
          </thead>
          <tbody ref={bodyRef}>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={COLS.length + 2} className="px-2.5 py-5 text-primary-300">
                  {o.rows.length
                    ? onlyIssues && !filter
                      ? translate("No one in this run has an issue.")
                      : translate("No one matches the filter. Clear it to see everyone.")
                    : translate("Nobody is in this run. Check hire dates and the off-cycle employee list.")}
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr
                  key={r.employeeId}
                  data-row
                  tabIndex={0}
                  onKeyDown={(e) => move(e, r.employeeId)}
                  onClick={() => onOpen(r.employeeId)}
                  className="group h-10 cursor-pointer border-b border-border last:border-b-0 hover:bg-surface-200/40 focus-visible:bg-kuning-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                >
                  <td className="sticky left-0 bg-card px-2.5 py-1.5 group-hover:bg-surface-100 group-focus-visible:bg-kuning-50">
                    <span className="flex min-w-0 flex-col gap-0.5 sm:flex-row sm:items-center sm:gap-2">
                      <span className="max-w-[12rem] truncate font-medium" title={r.name}>
                        {r.name}
                      </span>
                      <span className="num text-2xs text-primary-200">{r.employeeNumber}</span>
                      <span className="hidden 2xl:inline-flex">
                        <Flags flags={r.flags} />
                      </span>
                    </span>
                  </td>
                  {COLS.map((c) => (
                    <td
                      key={c.key}
                      className={cn(
                        "px-2.5 py-1.5 text-right",
                        c.className,
                        c.key === "netPayableCents" && "font-semibold",
                      )}
                    >
                      <Money cents={r[c.key] as number} dashZero />
                    </td>
                  ))}
                  <td className="px-2 text-center">
                    {r.blocking ? (
                      <AlertOctagon
                        className="inline size-4 text-danger-300"
                        aria-label={translate("{count} blocking", { count: r.blocking })}
                      />
                    ) : r.warnings ? (
                      <span className="inline-flex items-center">
                        <span aria-hidden className="inline-block size-2 rounded-full bg-warning-300" />
                        <span className="sr-only">{`${r.warnings} warnings`}</span>
                      </span>
                    ) : null}
                  </td>
                </tr>
              ))
            )}
          </tbody>
          {rows.length ? (
            <tfoot className="sticky bottom-0 bg-surface-100">
              <tr className="h-9 border-t border-ink/30">
                <th scope="row" className="sticky left-0 bg-surface-100 px-2.5 text-left font-medium">
                  {rows.length === o.rows.length ? translate("Total") : `Total of ${rows.length} shown`}
                </th>
                {COLS.map((c) => (
                  <td key={c.key} className={cn("px-2.5 text-right font-semibold", c.className)}>
                    <Money cents={sum(c.key)} />
                  </td>
                ))}
                <td />
              </tr>
            </tfoot>
          ) : null}
        </table>
      </div>
      <p className="mt-2 hidden text-2xs text-primary-200 sm:block">
        <Kbd>j</Kbd> <Kbd>k</Kbd> or arrows to move · <Kbd>Enter</Kbd> to open the working · <Kbd>[</Kbd> <Kbd>]</Kbd>{" "}
        previous and next in the drawer · <Kbd>/</Kbd> to filter
      </p>
      {o.run.status === "approved" || o.run.status === "paid" ? <FilesPanel runId={o.run.id} /> : null}
    </section>
  );
}
