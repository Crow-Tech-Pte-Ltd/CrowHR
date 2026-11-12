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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
  toast,
} from "@crowhr/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import * as React from "react";
import { useReauth } from "../../../../auth/reauth.tsx";
import { api, errorMessage, fieldErrors, settingsQuery } from "./api.ts";
import { groupKey, sectorLabel, tierSkillLabel, WORK_PERMIT_LEVY_GROUPS } from "./levy-options.ts";

const NONE = "none";

/** Payroll settings: pay and cutoff day, release, CPF advice code, levy estimate and the bank file's debit account. */
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
  const [cutoffDay, setCutoffDay] = React.useState(initial.cutoffDay ? String(initial.cutoffDay) : "");
  const [autoRelease, setAutoRelease] = React.useState(initial.autoRelease);
  const [advice, setAdvice] = React.useState(initial.cpfAdviceCode);
  const [bic, setBic] = React.useState(initial.debitBankBic ?? "");
  const [account, setAccount] = React.useState("");
  const [accountName, setAccountName] = React.useState(initial.debitAccountName ?? "");
  const [sector, setSector] = React.useState(initial.fwlSector ?? "");
  const [tier, setTier] = React.useState(initial.fwlTier ?? "");
  const [skill, setSkill] = React.useState(initial.fwlSkill ?? "");
  // Choices come from the levy table; a saved value the table doesn't know is still offered as is.
  const sectors = [...new Set([...WORK_PERMIT_LEVY_GROUPS.map((g) => g.sector), ...(sector ? [sector] : [])])];
  const tiers = WORK_PERMIT_LEVY_GROUPS.filter((g) => g.sector === sector);
  if (sector && tier && !tiers.some((g) => groupKey(g.tier, g.skill) === groupKey(tier, skill || null)))
    tiers.push({ sector, tier, skill: skill || null });
  const save = useMutation({
    mutationFn: () =>
      reauth(() =>
        api<PayrollSettingsDto>("PUT", "/payroll/settings", {
          payDay: payDay ? Number(payDay) : null,
          cutoffDay: cutoffDay ? Number(cutoffDay) : null,
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
      <FormField
        label="Cutoff day"
        hint="Day of the month inputs close. Payroll admins are reminded 3 days before; empty = before the pay day."
        error={errors.cutoffDay}
      >
        <Input
          inputMode="numeric"
          value={cutoffDay}
          onChange={(e) => setCutoffDay(e.target.value)}
          placeholder="Pay day"
        />
      </FormField>
      <FormField label="CPF advice code" hint="Two digits for the EZPay file, usually 01." error={errors.cpfAdviceCode}>
        <Input value={advice} onChange={(e) => setAdvice(e.target.value)} maxLength={2} />
      </FormField>
      <p className="text-2xs text-primary-300 sm:col-span-2">
        How each allowance counts for CPF, pro-ration and the gross rate of pay is set in{" "}
        <Link to="/payroll/allowances" className="focus-ring rounded-sm text-biru-400 hover:underline" onClick={onDone}>
          Allowance treatment
        </Link>
        .
      </p>
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
      <FormField label="Sector" hint="As on MOM's levy bill.">
        <Select
          value={sector || NONE}
          onValueChange={(v) => {
            const next = v === NONE ? "" : v;
            setSector(next);
            // Keep the tier only if the new sector has it.
            const first = WORK_PERMIT_LEVY_GROUPS.find((g) => g.sector === next);
            if (
              !WORK_PERMIT_LEVY_GROUPS.some(
                (g) => g.sector === next && groupKey(g.tier, g.skill) === groupKey(tier, skill || null),
              )
            ) {
              setTier(first?.tier ?? "");
              setSkill(first?.skill ?? "");
            }
          }}
        >
          <SelectTrigger aria-label="Sector">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE}>No Work Permit holders</SelectItem>
            {sectors.map((code) => (
              <SelectItem key={code} value={code}>
                {sectorLabel(code)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </FormField>
      <FormField label="Tier and skill">
        <Select
          value={sector ? groupKey(tier, skill || null) : NONE}
          disabled={!sector}
          onValueChange={(v) => {
            const [t, k] = v.split("|");
            setTier(t ?? "");
            setSkill(k ?? "");
          }}
        >
          <SelectTrigger aria-label="Tier and skill">
            <SelectValue placeholder="Choose a sector first" />
          </SelectTrigger>
          <SelectContent>
            {sector ? null : <SelectItem value={NONE}>Choose a sector first</SelectItem>}
            {tiers.map((g) => (
              <SelectItem key={groupKey(g.tier, g.skill)} value={groupKey(g.tier, g.skill)}>
                {tierSkillLabel(g.tier, g.skill)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
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
