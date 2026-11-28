import {
  Alert,
  AlertDescription,
  Button,
  Checkbox,
  type ColumnDef,
  DataTable,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  FormField,
  formatMoney,
  Input,
  Label,
  MoneyInput,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  StatusPill,
  Switch,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  textStyle,
  toast,
} from "@crowhr/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Archive, Pencil, Plus, RotateCcw, ShieldOff } from "lucide-react";
import * as React from "react";
import { can, useMe } from "../../../auth/session.ts";
import { PageHeader } from "../../../components/page-header.tsx";
import { ErrorNote } from "../../../components/section.tsx";
import { useT } from "../../../i18n/index.ts";
import {
  api,
  type ClaimTypeDto,
  type ClaimTypeInputDto,
  claimKeys,
  claimSettingsQuery,
  claimTypesQuery,
  errorMessage,
  fieldErrors,
  starterTypesQuery,
} from "../claims/-lib/api.ts";
import { CATEGORY_LABEL } from "../claims/-lib/ui.tsx";

export const Route = createFileRoute("/_app/settings/claim-types")({
  component: ClaimTypesPage,
});

const EMPLOYMENT = [
  { value: "full_time", label: "Full-time" },
  { value: "part_time", label: "Part-time" },
  { value: "contract", label: "Contract" },
  { value: "intern", label: "Intern" },
] as const;

const PERIOD_LABEL: Record<string, string> = { per_claim: "per claim", monthly: "a month", yearly: "a year" };

function receiptText(t: Pick<ClaimTypeDto, "receiptRule" | "receiptAboveCents">) {
  if (t.receiptRule === "always") return "Always";
  if (t.receiptRule === "never") return "Not needed";
  return `Above ${formatMoney(t.receiptAboveCents ?? 0)}`;
}

function capText(t: Pick<ClaimTypeDto, "capCents" | "capPeriod">) {
  return t.capPeriod === "none" || t.capCents === null
    ? "No cap"
    : `${formatMoney(t.capCents)} ${PERIOD_LABEL[t.capPeriod]}`;
}

function eligibleText(t: Pick<ClaimTypeDto, "eligibleEmploymentTypes" | "availableDuringProbation">) {
  const who = t.eligibleEmploymentTypes.length
    ? t.eligibleEmploymentTypes.map((e) => EMPLOYMENT.find((x) => x.value === e)?.label ?? e).join(", ")
    : "Everyone";
  return t.availableDuringProbation ? who : `${who}, after probation`;
}

function ClaimTypesPage() {
  const t = useT("settings-account");
  const me = useMe();
  const editable = can(me, "policies:update");
  const types = useQuery(claimTypesQuery(true));
  const settings = useQuery(claimSettingsQuery);
  const [editing, setEditing] = React.useState<ClaimTypeDto | "new" | null>(null);
  const qc = useQueryClient();
  const archive = useMutation({
    mutationFn: (t: ClaimTypeDto) =>
      api<ClaimTypeDto>("POST", `/claims/types/${t.id}/${t.archived ? "restore" : "archive"}`),
    onSuccess: (claimType) => {
      toast.success(
        claimType.archived
          ? t("{name} archived", { name: claimType.name })
          : t("{name} restored", { name: claimType.name }),
      );
      void qc.invalidateQueries({ queryKey: claimKeys.all });
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const columns: ColumnDef<ClaimTypeDto, unknown>[] = [
    {
      id: "name",
      header: t("Claim type"),
      accessorFn: (t) => t.name,
      cell: ({ row }) => (
        <span className="flex items-baseline gap-2 whitespace-nowrap">
          <span className="font-medium">{row.original.name}</span>
          <span className="num text-2xs text-primary-200">{row.original.code}</span>
          {row.original.archived ? <StatusPill tone="neutral">{t("Archived")}</StatusPill> : null}
        </span>
      ),
    },
    {
      id: "category",
      header: t("Category"),
      accessorFn: (claimType) => t(CATEGORY_LABEL[claimType.category] ?? claimType.category),
    },
    {
      id: "receipt",
      header: t("Receipt"),
      accessorFn: (t) => receiptText(t),
      cell: ({ getValue }) => <span className="num whitespace-nowrap">{getValue() as string}</span>,
    },
    {
      id: "cap",
      header: t("Cap"),
      accessorFn: (t) => capText(t),
      cell: ({ getValue }) => <span className="num whitespace-nowrap">{getValue() as string}</span>,
    },
    {
      id: "who",
      header: t("Who can claim"),
      accessorFn: (t) => eligibleText(t),
      meta: { headerClassName: "hidden lg:table-cell", cellClassName: "hidden lg:table-cell" },
    },
    {
      id: "payout",
      header: t("Paid"),
      accessorFn: (claimType) => (claimType.defaultPayout === "payroll" ? "With payroll" : "By transfer"),
      cell: ({ getValue }) => <span className="whitespace-nowrap">{getValue() as string}</span>,
      meta: { headerClassName: "hidden xl:table-cell", cellClassName: "hidden xl:table-cell" },
    },
    {
      id: "taxable",
      header: t("Taxable"),
      accessorFn: (claimType) => (claimType.taxable ? "Yes" : "No"),
      meta: { headerClassName: "hidden xl:table-cell", cellClassName: "hidden xl:table-cell" },
    },
    ...(editable
      ? [
          {
            id: "actions",
            header: () => <span className="sr-only">{t("Actions")}</span>,
            cell: ({ row }: { row: { original: ClaimTypeDto } }) => (
              <span className="flex justify-end gap-0.5">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      onClick={() => setEditing(row.original)}
                      aria-label={t("Edit {name}", { name: row.original.name })}
                    >
                      <Pencil aria-hidden />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>{t("Edit")}</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      onClick={() => archive.mutate(row.original)}
                      aria-label={t("{value} {name}", {
                        value: row.original.archived ? t("Restore") : t("Archive"),
                        name: row.original.name,
                      })}
                    >
                      {row.original.archived ? <RotateCcw aria-hidden /> : <Archive aria-hidden />}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>{row.original.archived ? t("Restore") : t("Archive")}</TooltipContent>
                </Tooltip>
              </span>
            ),
          } as ColumnDef<ClaimTypeDto, unknown>,
        ]
      : []),
  ];

  const items = types.data?.items ?? [];
  return (
    <>
      <PageHeader
        crumbs={[{ label: t("Settings"), to: "/settings" }]}
        title={t("Claim types")}
        description={t("What employees can claim, receipt rules, caps and how each type is paid.")}
        actions={
          editable && items.length ? (
            <Button variant="primary" size="sm" onClick={() => setEditing("new")}>
              <Plus aria-hidden /> {t("Add claim type")}
            </Button>
          ) : null
        }
      />
      {settings.data && settings.data.scanning === false && me.roles.includes("owner") ? (
        <Alert className="mb-4" data-testid="scanning-off">
          <ShieldOff aria-hidden />
          <AlertDescription>
            {t(
              "Virus scanning of receipts is off on this server. Uploads are still checked by file type and size. Set up ClamAV in the server configuration to scan them.",
            )}
          </AlertDescription>
        </Alert>
      ) : null}
      {types.isError ? <ErrorNote error={types.error} retry={() => void types.refetch()} /> : null}
      {types.isPending ? (
        <Skeleton className="h-40 w-full" />
      ) : items.length === 0 ? (
        <StarterSet editable={editable} onCustom={() => setEditing("new")} />
      ) : (
        <DataTable label={t("Claim types")} columns={columns} data={items} getRowId={(t) => t.id} />
      )}
      {settings.data ? <WindowSetting days={settings.data.submissionWindowDays} editable={editable} /> : null}
      {editing ? <TypeDialog type={editing === "new" ? null : editing} onClose={() => setEditing(null)} /> : null}
    </>
  );
}

function StarterSet({ editable, onCustom }: { editable: boolean; onCustom: () => void }) {
  const t = useT("settings-account");
  const starter = useQuery(starterTypesQuery);
  const [chosen, setChosen] = React.useState<Set<string> | null>(null);
  const qc = useQueryClient();
  const codes = chosen ?? new Set((starter.data?.items ?? []).map((t) => t.code));
  const create = useMutation({
    mutationFn: () => api<{ items: ClaimTypeDto[] }>("POST", "/claims/types/starter", { codes: [...codes] }),
    onSuccess: (r) => {
      toast.success(t("{length} claim types added", { length: r.items.length }));
      void qc.invalidateQueries({ queryKey: claimKeys.all });
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
  return (
    <EmptyState
      title={t("No claim types yet.")}
      description={
        editable
          ? t(
              "Start with the types most Singapore SMEs use, then adjust caps and receipt rules. Nothing is created until you confirm.",
            )
          : t("Ask an owner or HR admin to set up claim types.")
      }
      data-testid="claim-types-empty"
      actions={
        editable ? (
          <div className="flex w-full max-w-xl flex-col gap-3">
            <ul className="divide-y divide-border rounded-md border border-border bg-card text-left">
              {(starter.data?.items ?? []).map((t) => (
                <li key={t.code} className="flex items-center gap-3 px-3 py-2">
                  <Checkbox
                    id={`starter-${t.code}`}
                    checked={codes.has(t.code)}
                    onCheckedChange={(v) => {
                      const next = new Set(codes);
                      if (v) next.add(t.code);
                      else next.delete(t.code);
                      setChosen(next);
                    }}
                  />
                  <Label
                    htmlFor={`starter-${t.code}`}
                    className="flex flex-1 flex-wrap items-baseline justify-between gap-x-3"
                  >
                    <span className="font-medium">{t.name}</span>
                    <span className="num text-2xs text-primary-300">
                      {receiptText({ receiptRule: t.receiptRule, receiptAboveCents: t.receiptAboveCents ?? null })}{" "}
                      receipt · {capText({ capCents: t.capCents ?? null, capPeriod: t.capPeriod })}
                      {t.eligibleEmploymentTypes?.length ? " · full-time only" : ""}
                    </span>
                  </Label>
                </li>
              ))}
            </ul>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="primary"
                onClick={() => create.mutate()}
                disabled={create.isPending || codes.size === 0}
                data-testid="add-starter"
              >
                {t("Add")} {codes.size} claim {codes.size === 1 ? "type" : "types"}
              </Button>
              <Button variant="ghost" onClick={onCustom}>
                {t("Start from scratch")}
              </Button>
            </div>
          </div>
        ) : undefined
      }
    />
  );
}

function WindowSetting({ days, editable }: { days: number; editable: boolean }) {
  const t = useT("settings-account");
  const [value, setValue] = React.useState(String(days));
  const qc = useQueryClient();
  const save = useMutation({
    mutationFn: () => api("PUT", "/claims/settings", { submissionWindowDays: Number(value) }),
    onSuccess: () => {
      toast.success(t("Saved"));
      void qc.invalidateQueries({ queryKey: claimKeys.settings });
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
  return (
    <section className="mt-8 max-w-xl" aria-labelledby="window-title">
      <h2 id="window-title" className={textStyle.section}>
        {t("Submission window")}
      </h2>
      <p className="mt-1 text-ui text-primary-300">{t("Expenses older than this can't be claimed.")}</p>
      <form
        className="mt-3 flex items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <div>
          <Label htmlFor="window-days" className="mb-1 block text-2xs">
            {t("Days after the expense date")}
          </Label>
          <Input
            id="window-days"
            className="num w-28 text-right"
            inputMode="numeric"
            value={value}
            disabled={!editable}
            onChange={(e) => setValue(e.target.value.replace(/\D/g, ""))}
          />
        </div>
        {editable ? (
          <Button type="submit" disabled={save.isPending || Number(value) === days}>
            {t("Save")}
          </Button>
        ) : null}
      </form>
    </section>
  );
}

function TypeDialog({ type, onClose }: { type: ClaimTypeDto | null; onClose: () => void }) {
  const t = useT("settings-account");
  const qc = useQueryClient();
  const [form, setForm] = React.useState<ClaimTypeInputDto>(() =>
    type
      ? {
          code: type.code,
          name: type.name,
          category: type.category,
          receiptRule: type.receiptRule,
          receiptAboveCents: type.receiptAboveCents,
          capCents: type.capCents,
          capPeriod: type.capPeriod,
          eligibleEmploymentTypes: type.eligibleEmploymentTypes,
          availableDuringProbation: type.availableDuringProbation,
          defaultPayout: type.defaultPayout,
          gstApplicable: type.gstApplicable,
          taxable: type.taxable,
          glCode: type.glCode,
        }
      : {
          code: "",
          name: "",
          category: "other",
          receiptRule: "always",
          receiptAboveCents: null,
          capCents: null,
          capPeriod: "none",
          eligibleEmploymentTypes: [],
          availableDuringProbation: true,
          defaultPayout: "payroll",
          gstApplicable: true,
          taxable: false,
          glCode: null,
        },
  );
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const set = <K extends keyof ClaimTypeInputDto>(k: K, v: ClaimTypeInputDto[K]) => setForm((f) => ({ ...f, [k]: v }));
  const save = useMutation({
    mutationFn: () =>
      type
        ? api<ClaimTypeDto>("PATCH", `/claims/types/${type.id}`, form)
        : api<ClaimTypeDto>("POST", "/claims/types", form),
    onSuccess: (claimType) => {
      toast.success(t("{name} saved", { name: claimType.name }));
      void qc.invalidateQueries({ queryKey: claimKeys.all });
      onClose();
    },
    onError: (err) => {
      setErrors(fieldErrors(err));
      toast.error(errorMessage(err));
    },
  });
  const employment = new Set(form.eligibleEmploymentTypes ?? []);
  return (
    <Dialog open onOpenChange={(o) => (o ? null : onClose())}>
      <DialogContent className="max-h-[90dvh] max-w-xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{type ? t("Edit {name}", { name: type.name }) : t("New claim type")}</DialogTitle>
          <DialogDescription>
            {type?.inUse
              ? t("Changes apply to new claims. Claims already submitted keep their amounts.")
              : t("Employees see the name on the claim form.")}
          </DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
        >
          <FormField label={t("Name")} error={errors.name} required>
            <Input value={form.name} onChange={(e) => set("name", e.target.value)} placeholder={t("Transport")} />
          </FormField>
          <FormField label={t("Code")} hint={t("Used in approval rules and exports.")} error={errors.code} required>
            <Input
              className="num uppercase"
              value={form.code}
              onChange={(e) => set("code", e.target.value.toUpperCase())}
              placeholder="TRANSPORT"
            />
          </FormField>
          <FormField
            label={t("Category")}
            hint={t("Medical receipts are only shown to HR, the employee and the approver.")}
          >
            <Select value={form.category} onValueChange={(v) => set("category", v as ClaimTypeInputDto["category"])}>
              <SelectTrigger aria-label={t("Category")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(CATEGORY_LABEL).map(([k, v]) => (
                  <SelectItem key={k} value={k}>
                    {v}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>
          {/* Each error shows once: under the amount when it is shown, else under the rule. */}
          <FormField label={t("Receipt")} error={form.receiptRule === "above" ? undefined : errors.receiptAboveCents}>
            <Select
              value={form.receiptRule}
              onValueChange={(v) => set("receiptRule", v as ClaimTypeInputDto["receiptRule"])}
            >
              <SelectTrigger aria-label={t("Receipt rule")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="always">{t("Always required")}</SelectItem>
                <SelectItem value="above">{t("Required above an amount")}</SelectItem>
                <SelectItem value="never">{t("Not needed")}</SelectItem>
              </SelectContent>
            </Select>
          </FormField>
          {form.receiptRule === "above" ? (
            <FormField label={t("Receipt required above")} error={errors.receiptAboveCents} className="sm:col-span-2">
              <MoneyInput value={form.receiptAboveCents ?? null} onChange={(c) => set("receiptAboveCents", c)} />
            </FormField>
          ) : null}
          <FormField label={t("Cap")} error={form.capPeriod === "none" ? errors.capCents : undefined}>
            <Select
              value={form.capPeriod}
              onValueChange={(v) =>
                setForm((f) => ({
                  ...f,
                  capPeriod: v as ClaimTypeInputDto["capPeriod"],
                  capCents: v === "none" ? null : f.capCents,
                }))
              }
            >
              <SelectTrigger aria-label={t("Cap period")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">{t("No cap")}</SelectItem>
                <SelectItem value="per_claim">{t("Per claim")}</SelectItem>
                <SelectItem value="monthly">{t("Per calendar month")}</SelectItem>
                <SelectItem value="yearly">{t("Per calendar year")}</SelectItem>
              </SelectContent>
            </Select>
          </FormField>
          {form.capPeriod !== "none" ? (
            <FormField label={t("Cap amount")} hint={t("Per employee.")} error={errors.capCents}>
              <MoneyInput
                value={form.capCents ?? null}
                onChange={(c) => set("capCents", c)}
                aria-label={t("Cap amount")}
              />
            </FormField>
          ) : (
            <div />
          )}
          <fieldset className="sm:col-span-2">
            <legend className="mb-2 text-ui font-medium">{t("Who can claim")}</legend>
            <div className="flex flex-wrap gap-x-4 gap-y-2">
              {EMPLOYMENT.map((e) => (
                <span key={e.value} className="flex items-center gap-2">
                  <Checkbox
                    id={`emp-${e.value}`}
                    checked={employment.has(e.value)}
                    onCheckedChange={(v) => {
                      const next = new Set(employment);
                      if (v) next.add(e.value);
                      else next.delete(e.value);
                      set("eligibleEmploymentTypes", [...next] as ClaimTypeInputDto["eligibleEmploymentTypes"]);
                    }}
                  />
                  <Label htmlFor={`emp-${e.value}`}>{t(e.label)}</Label>
                </span>
              ))}
            </div>
            <p className="mt-1 text-2xs text-primary-200">{t("None ticked means everyone.")}</p>
          </fieldset>
          <ToggleRow
            id="probation"
            label={t("Available during probation")}
            checked={form.availableDuringProbation ?? true}
            onChange={(v) => set("availableDuringProbation", v)}
          />
          <ToggleRow
            id="gst"
            label={t("Lines may carry GST")}
            checked={form.gstApplicable ?? true}
            onChange={(v) => set("gstApplicable", v)}
          />
          <ToggleRow
            id="taxable"
            label={t("Taxable benefit (for IR8A)")}
            hint={t("Recorded for the IR8A export; payroll decides the treatment.")}
            checked={form.taxable ?? false}
            onChange={(v) => set("taxable", v)}
          />
          <FormField label={t("Paid")}>
            <Select
              value={form.defaultPayout ?? "payroll"}
              onValueChange={(v) => set("defaultPayout", v as "payroll" | "outside")}
            >
              <SelectTrigger aria-label={t("Payout")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="payroll">{t("With payroll")}</SelectItem>
                <SelectItem value="outside">{t("By transfer, outside payroll")}</SelectItem>
              </SelectContent>
            </Select>
          </FormField>
          <FormField label={t("GL code")} hint={t("Optional, for your accountant.")}>
            <Input
              className="num"
              value={form.glCode ?? ""}
              onChange={(e) => set("glCode", e.target.value || null)}
              placeholder="6100"
            />
          </FormField>
          <DialogFooter className="sm:col-span-2">
            <Button type="button" variant="ghost" onClick={onClose}>
              {t("Cancel")}
            </Button>
            <Button type="submit" variant="primary" disabled={save.isPending}>
              {t("Save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ToggleRow({
  id,
  label,
  hint,
  checked,
  onChange,
}: {
  id: string;
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-3 rounded-md border border-border px-3 py-2">
      <div>
        <Label htmlFor={id}>{label}</Label>
        {hint ? <p className="text-2xs text-primary-200">{hint}</p> : null}
      </div>
      <Switch id={id} checked={checked} onCheckedChange={onChange} />
    </div>
  );
}
