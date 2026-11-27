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
  DialogTrigger,
  FormField,
  Input,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableEmptyRow,
  TableHead,
  TableHeader,
  TableRow,
  Textarea,
  toast,
} from "@crowhr/ui";
import { useMutation, useQuery } from "@tanstack/react-query";
import * as React from "react";
import { canForEmployee, useMe } from "../auth/session.ts";
import { ErrorNote } from "../components/section.tsx";
import { ApiError, apiPost } from "../lib/api.ts";
import { type Balance, balancesQuery, childrenQuery, typesQuery, useLeaveInvalidate } from "./api.ts";
import { todaySg } from "./format.ts";

export function EmployeeBalances({ employeeId }: { employeeId: string }) {
  const me = useMe();
  const canRead = canForEmployee(me, "leave:read", employeeId);
  const canAdjust = employeeId !== me.employeeId && canForEmployee(me, "leave:update", employeeId);
  const canReadChildren = canRead && canForEmployee(me, "personal_details:read", employeeId);
  const currentYear = todaySg().slice(0, 4);
  const [year, setYear] = React.useState(currentYear);
  const validYear = /^\d{4}$/.test(year) && Number(year) >= 2000 && Number(year) <= 2100;
  const balances = useQuery({
    ...balancesQuery(employeeId, currentYear === year ? undefined : Number(year)),
    enabled: canRead && validYear,
  });
  const types = useQuery({ ...typesQuery, enabled: canAdjust });
  const children = useQuery({ ...childrenQuery(employeeId), enabled: canReadChildren });
  const rows = balances.data?.items.filter((b) => b.tracked) ?? [];
  const error = balances.error ?? types.error ?? children.error;
  if (!canRead) return null;
  return (
    <Card>
      <CardHeader className="flex-wrap items-start">
        <CardTitle>Leave balances</CardTitle>
        <FormField label="Leave year" error={validYear ? undefined : "Enter a year from 2000 to 2100."}>
          <Input
            className="num w-28"
            type="number"
            min={2000}
            max={2100}
            value={year}
            onChange={(e) => setYear(e.target.value)}
          />
        </FormField>
      </CardHeader>
      {!validYear ? null : error ? (
        <ErrorNote
          error={error}
          retry={() => {
            void balances.refetch();
            if (canAdjust) void types.refetch();
            if (canReadChildren) void children.refetch();
          }}
        />
      ) : balances.isPending || (canAdjust && types.isPending) || (canReadChildren && children.isPending) ? (
        <div className="p-4">
          <Skeleton className="h-12 w-full" />
        </div>
      ) : (
        <Table aria-label="Leave balances">
          <TableHeader>
            <TableRow>
              <TableHead>Leave</TableHead>
              <TableHead className="text-right">Available</TableHead>
              <TableHead className="text-right">Pending</TableHead>
              {canAdjust ? (
                <TableHead>
                  <span className="sr-only">Actions</span>
                </TableHead>
              ) : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length ? (
              rows.map((balance) => {
                const childName = children.data?.items.find((c) => c.id === balance.childId)?.name;
                const perChild = types.data?.items.find((t) => t.id === balance.typeId)?.perChild;
                const label = childName ? `${balance.name} · ${childName}` : balance.name;
                return (
                  <TableRow key={`${balance.typeId}-${balance.childId}`}>
                    <TableCell>{label}</TableCell>
                    <TableCell className="num whitespace-nowrap text-right">
                      {balance.available ?? "—"} {balance.unit}
                    </TableCell>
                    <TableCell className="num text-right">{balance.pending}</TableCell>
                    {canAdjust ? (
                      <TableCell className="text-right">
                        {!perChild || balance.childId ? (
                          <BalanceAdjustment employeeId={employeeId} balance={balance} label={label} />
                        ) : null}
                      </TableCell>
                    ) : null}
                  </TableRow>
                );
              })
            ) : (
              <TableEmptyRow colSpan={canAdjust ? 4 : 3}>No tracked leave balances for this year.</TableEmptyRow>
            )}
          </TableBody>
        </Table>
      )}
    </Card>
  );
}

function BalanceAdjustment({ employeeId, balance, label }: { employeeId: string; balance: Balance; label: string }) {
  const invalidate = useLeaveInvalidate();
  const [open, setOpen] = React.useState(false);
  const [amount, setAmount] = React.useState("");
  const [reason, setReason] = React.useState("");
  const save = useMutation({
    mutationFn: () =>
      apiPost("/api/v1/leave/adjustments", {
        employeeId,
        leaveTypeId: balance.typeId,
        childId: balance.childId,
        year: balance.year,
        amount: Number(amount),
        reason: reason.trim(),
      }),
    onSuccess: () => {
      invalidate();
      setOpen(false);
      toast.success("Leave adjustment recorded.");
    },
  });
  const errors = save.error instanceof ApiError ? save.error.fieldErrors : {};
  const unit = balance.adjustmentUnit;
  const step = unit === "days" ? 0.5 : 0.1;
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (save.isPending) return;
        if (next) {
          setAmount("");
          setReason("");
          save.reset();
        }
        setOpen(next);
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm" variant="ghost" aria-label={`Adjust ${label}`}>
          Adjust
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Adjust leave balance</DialogTitle>
          <DialogDescription>
            {label} · <span className="num">{balance.year}</span>. This change and its reason are recorded in the audit
            log.
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (Number(amount) && reason.trim().length >= 3 && !save.isPending) save.mutate();
          }}
        >
          <FormField
            label={`Adjustment (${unit})`}
            hint={`Use a positive amount to add leave or a negative amount to subtract it. Enter multiples of ${step}.`}
            error={errors.amount}
            required
          >
            <Input
              className="num"
              type="number"
              step={step}
              min={-365}
              max={365}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </FormField>
          {unit !== balance.unit ? (
            <p className="text-2xs text-primary-300">
              The balance is shown in {balance.unit}. Adjustments for {balance.year} are recorded in {unit}, the unit in
              force at year end.
            </p>
          ) : null}
          <FormField label="Reason" error={errors.reason} required>
            <Textarea
              rows={2}
              minLength={3}
              maxLength={300}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </FormField>
          {save.error && !errors.amount && !errors.reason ? (
            <p className="text-ui text-danger-300" role="alert">
              {save.error.message}
            </p>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={save.isPending}>
              Cancel
            </Button>
            <Button
              type="submit"
              variant="primary"
              disabled={!Number(amount) || reason.trim().length < 3 || save.isPending}
            >
              Save adjustment
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
