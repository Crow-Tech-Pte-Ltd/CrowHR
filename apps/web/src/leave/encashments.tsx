import {
  Button,
  Card,
  CardHeader,
  CardTitle,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  FormField,
  formatMoney,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  StatusPill,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  toast,
} from "@crowhr/ui";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import * as React from "react";
import { can, useMe } from "../auth/session.ts";
import { ErrorNote } from "../components/section.tsx";
import { useT } from "../i18n/index.ts";
import { apiGet, apiPost } from "../lib/api.ts";
import { balancesQuery, leaveKeys, typesQuery, useLeaveInvalidate } from "./api.ts";

type Candidate = {
  ledgerEntryId: string;
  leaveTypeId: string;
  leaveYear: number;
  unit: "days" | "hours";
  quantity: number;
};
type Encashment = {
  id: string;
  leaveTypeId: string;
  leaveYear: number;
  unit: "days" | "hours";
  quantity: number;
  amountCents: number;
  rateText: string;
  status: "pending" | "approved" | "rejected" | "withdrawn" | "reserved" | "paid";
};
const LABEL = {
  pending: "Awaiting approval",
  approved: "Awaiting payroll",
  rejected: "Rejected",
  withdrawn: "Withdrawn",
  reserved: "In payroll",
  paid: "Paid",
};

/** Used by employee self-service and HR's employee leave tab; all access is checked again by core. */
export function Encashments({ employeeId }: { employeeId?: string }) {
  const tWorkflow = useT("workflows");
  const me = useMe();
  const isHr = me.roles.includes("owner") || me.roles.includes("hr_admin");
  const own = !employeeId || employeeId === me.employeeId;
  const allowed = own || isHr || me.roles.includes("payroll_admin");
  const invalidate = useLeaveInvalidate();
  const types = useQuery(typesQuery);
  const balances = useQuery({ ...balancesQuery(employeeId), enabled: allowed });
  const q = useQuery({
    queryKey: [...leaveKeys.all, "encashments", employeeId ?? "me"],
    queryFn: () =>
      apiGet<{ items: Encashment[]; candidates: Candidate[] }>(
        `/api/v1/leave/encashments${employeeId ? `?employeeId=${employeeId}` : ""}`,
      ),
    enabled: allowed,
  });
  const [open, setOpen] = React.useState(false);
  const [typeId, setTypeId] = React.useState("");
  const [quantity, setQuantity] = React.useState("");
  const [workdays, setWorkdays] = React.useState("");
  const [candidate, setCandidate] = React.useState<Candidate | null>(null);
  const eligible = (types.data?.items ?? []).filter(
    (t) => t.encashable && !t.archived && t.paid && !t.unlimited && (isHr || (own && t.employeeEncashmentRequests)),
  );
  const balance = balances.data?.items.find((b) => b.typeId === typeId);
  const submit = useMutation({
    mutationFn: () =>
      apiPost<Encashment>("/api/v1/leave/encashments", {
        employeeId,
        leaveTypeId: typeId,
        days: Number(quantity),
        ...(workdays ? { workingDaysPerWeek: Number(workdays) } : {}),
        ...(candidate ? { ledgerEntryId: candidate.ledgerEntryId } : {}),
      }),
    onSuccess: () => {
      invalidate();
      setOpen(false);
      toast.success(tWorkflow("Encashment sent for approval. You can follow its status here."));
    },
  });
  const withdraw = useMutation({
    mutationFn: (id: string) => apiPost(`/api/v1/leave/encashments/${id}/withdraw`, {}),
    onSuccess: () => {
      invalidate();
      toast.success(tWorkflow("Encashment withdrawn. The leave is available again."));
    },
    onError: (err) =>
      toast.error(err instanceof Error ? err.message : tWorkflow("Couldn't withdraw. Refresh and try again.")),
  });
  function start(c: Candidate | null = null) {
    setWorkdays("");
    setCandidate(c);
    setTypeId(c?.leaveTypeId ?? eligible[0]?.id ?? "");
    setQuantity(c ? String(c.quantity) : "");
    submit.reset();
    setOpen(true);
  }
  if (!allowed)
    return (
      <p className="text-ui text-primary-300">
        {tWorkflow("Leave encashment details are available to the employee, HR and payroll.")}
      </p>
    );
  if (q.isError || types.isError || balances.isError)
    return (
      <ErrorNote
        error={q.error ?? types.error ?? balances.error}
        retry={() => {
          void q.refetch();
          void types.refetch();
          void balances.refetch();
        }}
      />
    );
  // Self-service (no employeeId): most staff can't encash anything, so the card would only explain a
  // feature they don't have. Show it once their leave policy allows a request or they have one.
  const selfService = !employeeId;
  if (q.isPending || types.isPending || balances.isPending)
    return selfService ? null : <Skeleton className="h-32 w-full" />;
  if (selfService && !q.data.items.length && !q.data.candidates.length && !eligible.length) return null;
  return (
    <>
      <Card>
        <CardHeader className="flex-row items-center justify-between gap-3">
          <CardTitle>{tWorkflow("Leave encashment")}</CardTitle>
          {eligible.length && can(me, "leave:create") ? (
            <Button size="sm" onClick={() => start()}>
              {tWorkflow("Encash leave")}
            </Button>
          ) : null}
        </CardHeader>
        <p className="border-t border-border px-4 py-3 text-ui text-primary-300">
          {tWorkflow(
            "Approved requests are paid through regular payroll or final pay. Pending requests reserve leave until decided.",
          )}
        </p>
        {q.data.items.length ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{tWorkflow("Leave")}</TableHead>
                <TableHead className="text-right">{tWorkflow("Quantity")}</TableHead>
                <TableHead className="text-right">{tWorkflow("Payout")}</TableHead>
                <TableHead>{tWorkflow("Status")}</TableHead>
                <TableHead>
                  <span className="sr-only">{tWorkflow("Actions")}</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {q.data.items.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>
                    <span>{types.data.items.find((t) => t.id === r.leaveTypeId)?.name ?? tWorkflow("Leave")}</span>
                    <div className="num text-2xs text-primary-300">{r.leaveYear}</div>
                    <details className="mt-1 max-w-64 text-2xs text-primary-300">
                      <summary className="focus-ring cursor-pointer">{tWorkflow("Rate working")}</summary>
                      {r.rateText}
                    </details>
                  </TableCell>
                  <TableCell className="num text-right">
                    {r.quantity} {r.unit}
                  </TableCell>
                  <TableCell className="num text-right">{formatMoney(r.amountCents)}</TableCell>
                  <TableCell>
                    <StatusPill
                      tone={
                        r.status === "paid" || r.status === "approved"
                          ? "success"
                          : r.status === "rejected"
                            ? "danger"
                            : "neutral"
                      }
                    >
                      {tWorkflow(LABEL[r.status])}
                    </StatusPill>
                  </TableCell>
                  <TableCell>
                    {r.status === "pending" && can(me, "leave:create") ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={withdraw.isPending}
                        onClick={() => withdraw.mutate(r.id)}
                      >
                        {tWorkflow("Withdraw")}
                      </Button>
                    ) : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <p className="border-t border-border px-4 py-6 text-ui text-primary-300">
            {tWorkflow("No encashment requests yet.")}
            {!eligible.length
              ? ` ${tWorkflow("HR can review whether your leave policy allows encashment.")}`
              : ` ${tWorkflow("Choose Encash leave to submit a request.")}`}
          </p>
        )}
        {isHr && q.data.candidates.length ? (
          <div className="border-t border-border p-4">
            <h3 className="mb-2 font-azeret text-xs">{tWorkflow("Year-end leave awaiting a payout request")}</h3>
            {q.data.candidates.map((c) => (
              <div key={c.ledgerEntryId} className="flex items-center justify-between gap-2 py-2 text-ui">
                <span>
                  {types.data.items.find((t) => t.id === c.leaveTypeId)?.name}:{" "}
                  <span className="num">
                    {c.quantity} {c.unit} ({c.leaveYear})
                  </span>
                </span>
                <Button size="sm" onClick={() => start(c)}>
                  {tWorkflow("Request payout")}
                </Button>
              </div>
            ))}
          </div>
        ) : null}
      </Card>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{tWorkflow("Encash leave")}</DialogTitle>
            <DialogDescription>
              {tWorkflow(
                "Request a payout at the gross rate, including eligible fixed allowances. HR or payroll must approve it before payroll includes it. CPF applies as Additional Wages, including final pay.",
              )}
            </DialogDescription>
          </DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              submit.mutate();
            }}
            className="flex flex-col gap-4"
          >
            <FormField label={tWorkflow("Leave type")}>
              <Select value={typeId} onValueChange={setTypeId} disabled={!!candidate}>
                <SelectTrigger aria-label={tWorkflow("Leave type")}>
                  <SelectValue placeholder={tWorkflow("Choose leave")} />
                </SelectTrigger>
                <SelectContent>
                  {(candidate ? types.data.items.filter((t) => t.id === candidate.leaveTypeId) : eligible).map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
            <FormField
              label={tWorkflow("Quantity ({arg1})", { arg1: candidate?.unit ?? balance?.unit ?? "days" })}
              hint={
                candidate
                  ? tWorkflow("Already deducted at year end; approval won't deduct it again.")
                  : tWorkflow(
                      "{arg1} {arg2} available. Uses basic salary plus included fixed allowances and the effective work schedule; rounded once to cents.",
                      { arg1: balance?.available ?? 0, arg2: balance?.unit ?? "days" },
                    )
              }
            >
              <Input
                className="num"
                type="number"
                min="0.5"
                step="0.5"
                max={candidate ? undefined : (balance?.available ?? 0)}
                required
                value={quantity}
                disabled={!!candidate}
                onChange={(e) => setQuantity(e.target.value)}
              />
            </FormField>
            <FormField
              label={tWorkflow("Average workdays per week (shift staff)")}
              hint={tWorkflow(
                "Leave blank for a fixed week. For shift staff, enter the contractual average for the approver to verify.",
              )}
            >
              <Input
                className="num"
                type="number"
                min="0.5"
                max="7"
                step="0.5"
                value={workdays}
                onChange={(e) => setWorkdays(e.target.value)}
              />
            </FormField>
            {submit.isError ? (
              <p role="alert" className="text-ui text-danger">
                {submit.error.message}
                {/Allowance treatment/.test(submit.error.message) && can(me, "payroll:read") ? (
                  <>
                    {" "}
                    <Link to="/payroll/allowances" className="focus-ring rounded-sm text-biru-400 underline">
                      {tWorkflow("Open Allowance treatment")}
                    </Link>
                  </>
                ) : null}
              </p>
            ) : null}
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
                {tWorkflow("Cancel")}
              </Button>
              <Button type="submit" variant="primary" disabled={submit.isPending || !typeId}>
                {submit.isPending ? tWorkflow("Submitting…") : tWorkflow("Send for approval")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
