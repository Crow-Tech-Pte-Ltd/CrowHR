import type { PayrollSettingsDto } from "@crowhr/core";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  FormField,
  Input,
  Switch,
  toast,
} from "@crowhr/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as React from "react";
import { useReauth } from "../../../../auth/reauth.tsx";
import { api, errorMessage, fieldErrors, settingsQuery } from "./api.ts";

/** Payroll settings: pay day, release, CPF advice code, levy estimate and the bank file's debit account. */
export function PayrollSettingsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const q = useQuery({ ...settingsQuery, enabled: open });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Payroll settings</DialogTitle>
          <DialogDescription>Defaults for new runs and the files payroll produces.</DialogDescription>
        </DialogHeader>
        {q.data ? (
          <SettingsForm initial={q.data} onDone={() => onOpenChange(false)} />
        ) : (
          <p className="text-ui text-primary-300">Loading…</p>
        )}
      </DialogContent>
    </Dialog>
  );
}

function SettingsForm({ initial, onDone }: { initial: PayrollSettingsDto; onDone: () => void }) {
  const qc = useQueryClient();
  const reauth = useReauth();
  const [payDay, setPayDay] = React.useState(initial.payDay ? String(initial.payDay) : "");
  const [autoRelease, setAutoRelease] = React.useState(initial.autoRelease);
  const [advice, setAdvice] = React.useState(initial.cpfAdviceCode);
  const [bic, setBic] = React.useState(initial.debitBankBic ?? "");
  const [account, setAccount] = React.useState("");
  const [accountName, setAccountName] = React.useState(initial.debitAccountName ?? "");
  const [sector, setSector] = React.useState(initial.fwlSector ?? "");
  const [tier, setTier] = React.useState(initial.fwlTier ?? "");
  const [skill, setSkill] = React.useState(initial.fwlSkill ?? "");
  const save = useMutation({
    mutationFn: () =>
      reauth(() =>
        api<PayrollSettingsDto>("PUT", "/payroll/settings", {
          payDay: payDay ? Number(payDay) : null,
          autoRelease,
          cpfAdviceCode: advice,
          debitBankBic: bic ? bic.toUpperCase() : null,
          ...(account ? { debitAccountNumber: account } : {}),
          debitAccountName: accountName || null,
          fwlSector: sector || null,
          fwlTier: tier || null,
          fwlSkill: skill || null,
        }),
      ),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: settingsQuery.queryKey });
      toast.success("Payroll settings saved");
      onDone();
    },
  });
  const errors = fieldErrors(save.error);
  return (
    <form
      className="grid grid-cols-1 gap-3 sm:grid-cols-2"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      <FormField
        label="Pay day"
        hint="Day of the month; empty = last day. MOM: within 7 days after the period."
        error={errors.payDay}
      >
        <Input inputMode="numeric" value={payDay} onChange={(e) => setPayDay(e.target.value)} placeholder="Last day" />
      </FormField>
      <FormField label="CPF advice code" hint="Two digits for the EZPay file, usually 01." error={errors.cpfAdviceCode}>
        <Input value={advice} onChange={(e) => setAdvice(e.target.value)} maxLength={2} />
      </FormField>
      <div className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2 sm:col-span-2">
        <span className="text-ui">
          Release payslips as soon as a run is approved
          <span className="block text-2xs text-primary-300">
            Off: release them yourself after checking the approved run.
          </span>
        </span>
        <Switch checked={autoRelease} onCheckedChange={setAutoRelease} aria-label="Release payslips on approval" />
      </div>
      <p className="mt-1 font-azeret text-[10px] font-semibold uppercase tracking-wider text-primary-300 sm:col-span-2">
        Bank file debit account
      </p>
      <FormField label="Bank SWIFT/BIC" error={errors.debitBankBic}>
        <Input value={bic} onChange={(e) => setBic(e.target.value)} placeholder="DBSSSGSG" />
      </FormField>
      <FormField
        label="Account number"
        hint={initial.debitAccountMasked ? `Saved: ${initial.debitAccountMasked}` : "Stored encrypted."}
        error={errors.debitAccountNumber}
      >
        <Input inputMode="numeric" value={account} onChange={(e) => setAccount(e.target.value)} autoComplete="off" />
      </FormField>
      <FormField label="Account name" className="sm:col-span-2" error={errors.debitAccountName}>
        <Input value={accountName} onChange={(e) => setAccountName(e.target.value)} />
      </FormField>
      <p className="mt-1 font-azeret text-[10px] font-semibold uppercase tracking-wider text-primary-300 sm:col-span-2">
        Work Permit levy estimate (MOM's bill is authoritative)
      </p>
      <FormField label="Sector">
        <Input value={sector} onChange={(e) => setSector(e.target.value)} placeholder="SERVICES" />
      </FormField>
      <FormField label="Tier and skill">
        <Input
          value={tier && skill ? `${tier} ${skill}` : tier}
          onChange={(e) => {
            const [t, ...rest] = e.target.value.split(" ");
            setTier(t ?? "");
            setSkill(rest.join(" "));
          }}
          placeholder="TIER_1 BASIC_SKILLED"
        />
      </FormField>
      {save.isError && !Object.keys(errors).length ? (
        <p role="alert" className="text-ui text-danger-300 sm:col-span-2">
          {errorMessage(save.error)}
        </p>
      ) : null}
      <DialogFooter className="sm:col-span-2">
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" disabled={save.isPending}>
          Save settings
        </Button>
      </DialogFooter>
    </form>
  );
}
