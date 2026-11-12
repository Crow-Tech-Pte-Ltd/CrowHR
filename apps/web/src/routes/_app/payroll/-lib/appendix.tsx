import type {
  PayrollIr8aAppendixEntryDto,
  PayrollIr8aAppendixEntryInput,
  PayrollIr8aAppendixListDto,
} from "@crowhr/core";
import {
  Button,
  Checkbox,
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
  Label,
  MoneyInput,
  RadioGroup,
  RadioGroupItem,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
  toast,
} from "@crowhr/ui";
import { queryOptions, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as React from "react";
import { directoryQuery } from "../../people/-lib/api.ts";
import { api, errorMessage, fieldErrors } from "./api.ts";

/** IR8A Appendix 8A (benefits-in-kind) and 8B (share-plan gains): queries, labels and the entry dialog. */

export type AppendixEntry = PayrollIr8aAppendixEntryDto;
export type AppendixKind = AppendixEntry["kind"];

export const appendixQuery = (year: number) =>
  queryOptions({
    queryKey: ["payroll", "ir8a", year, "appendices"] as const,
    queryFn: () => api<PayrollIr8aAppendixListDto>("GET", `/payroll/years/${year}/ir8a/appendices`),
  });

export const KIND_LABEL: Record<AppendixKind, string> = {
  residence: "Place of residence",
  hotel: "Hotel stay",
  car: "Car",
  other: "Other benefit",
  share_gain: "Share-plan gain",
};

type OtherItem = Extract<AppendixEntry["details"], { kind: "other" }>["item"];
export const OTHER_ITEMS: { value: OtherItem; code: string; label: string }[] = [
  { value: "home_leave", code: "4a", label: "Home leave passages for the employee and family" },
  { value: "loan_interest", code: "4b", label: "Interest paid for the employee, or interest benefit on a loan" },
  { value: "insurance", code: "4c", label: "Insurance premiums (personal policy)" },
  { value: "holiday", code: "4d", label: "Free or subsidised holidays, including air passages" },
  { value: "education", code: "4e", label: "Educational expenses, including a tutor" },
  { value: "club", code: "4f", label: "Club entrance or transfer fees and subscriptions" },
  { value: "asset_gain", code: "4g", label: "Gains from assets sold below market value" },
  { value: "vehicle_given", code: "4h", label: "Full cost of a motor vehicle given" },
  { value: "other", code: "4j", label: "Other non-monetary awards or benefits" },
];

const CAR_TYPES = [
  { value: "new", label: "New car (employer is the first owner)" },
  { value: "second_hand", label: "Second-hand car" },
  { value: "renewed_coe", label: "COE renewed by the employer" },
  { value: "leased", label: "Leased car" },
] as const;
type CarType = (typeof CAR_TYPES)[number]["value"];

/** One-line description of an entry for tables. */
export function entrySummary(e: AppendixEntry): string {
  const d = e.details;
  switch (d.kind) {
    case "residence":
      return d.basis === "none"
        ? "Utilities, driver or servant"
        : `${d.basis === "rented" ? "Rented" : "Owned"} · ${d.address ?? ""}`;
    case "hotel":
      return d.note ?? "Hotel or serviced apartment in a hotel";
    case "car":
      return `${CAR_TYPES.find((c) => c.value === d.carType)?.label ?? d.carType}${d.note ? ` · ${d.note}` : ""}`;
    case "other":
      return `${OTHER_ITEMS.find((o) => o.value === d.item)?.label ?? d.item}${d.note ? ` · ${d.note}` : ""}`;
    case "share_gain":
      return `${d.planType} granted ${formatDate(d.grantedOn)}`;
  }
}

/** Period shown in tables, or null. */
export function entryPeriod(e: AppendixEntry): string | null {
  const d = e.details;
  if (d.kind === "residence" && d.occupiedFrom && d.occupiedTo)
    return `${formatDate(d.occupiedFrom)} – ${formatDate(d.occupiedTo)}`;
  if (d.kind === "car") return `${formatDate(d.usedFrom)} – ${formatDate(d.usedTo)}`;
  if (d.kind === "share_gain") return formatDate(d.eventDate);
  return null;
}

// ---------------------------------------------------------------------------------------------
// Form draft
// ---------------------------------------------------------------------------------------------

interface Draft {
  kind: AppendixKind;
  employeeId: string;
  note: string;
  basis: "rented" | "owned" | "none";
  address: string;
  occupiedFrom: string;
  occupiedTo: string;
  employeesSharing: string;
  rentPaidByEmployerCents: number | null;
  annualValueCents: number | null;
  enterPeriodValue: boolean;
  annualValueForPeriodCents: number | null;
  furnishing: "partial" | "full";
  rentPaidByEmployeeCents: number | null;
  utilitiesCents: number | null;
  driverAnnualCostCents: number | null;
  driverPersonalKm: string;
  driverTotalKm: string;
  servantCents: number | null;
  costCents: number | null;
  paidByEmployeeCents: number | null;
  carType: CarType;
  usedFrom: string;
  usedTo: string;
  carCostCents: number | null;
  parfRebateCents: number | null;
  coeYears: string;
  rentalCents: number | null;
  runningCostsCents: number | null;
  item: OtherItem;
  amountCents: number | null;
  planType: "ESOP" | "ESOW";
  grantedOn: string;
  eventDate: string;
  exercisePrice: string;
  openMarketValue: string;
  shares: string;
  companyIdType: "" | "UEN-Local Co" | "UEN-Others" | "OTHERS";
  companyIdNumber: string;
  companyName: string;
}

function blankDraft(kind: AppendixKind, year: number): Draft {
  return {
    kind,
    employeeId: "",
    note: "",
    basis: "rented",
    address: "",
    occupiedFrom: `${year}-01-01`,
    occupiedTo: `${year}-12-31`,
    employeesSharing: "1",
    rentPaidByEmployerCents: null,
    annualValueCents: null,
    enterPeriodValue: false,
    annualValueForPeriodCents: null,
    furnishing: "full",
    rentPaidByEmployeeCents: null,
    utilitiesCents: null,
    driverAnnualCostCents: null,
    driverPersonalKm: "",
    driverTotalKm: "",
    servantCents: null,
    costCents: null,
    paidByEmployeeCents: null,
    carType: "new",
    usedFrom: `${year}-01-01`,
    usedTo: `${year}-12-31`,
    carCostCents: null,
    parfRebateCents: null,
    coeYears: "",
    rentalCents: null,
    runningCostsCents: null,
    item: "home_leave",
    amountCents: null,
    planType: "ESOP",
    grantedOn: "",
    eventDate: "",
    exercisePrice: "",
    openMarketValue: "",
    shares: "",
    companyIdType: "",
    companyIdNumber: "",
    companyName: "",
  };
}

function draftOf(e: AppendixEntry): Draft {
  const base = { ...blankDraft(e.kind, e.year), employeeId: e.employeeId, note: e.details.note ?? "" };
  const d = e.details;
  switch (d.kind) {
    case "residence":
      return {
        ...base,
        basis: d.basis,
        address: d.address ?? "",
        occupiedFrom: d.occupiedFrom ?? "",
        occupiedTo: d.occupiedTo ?? "",
        employeesSharing: String(d.employeesSharing),
        rentPaidByEmployerCents: d.rentPaidByEmployerCents,
        annualValueCents: d.annualValueCents,
        enterPeriodValue: d.annualValueForPeriodCents !== null,
        annualValueForPeriodCents: d.annualValueForPeriodCents,
        furnishing: d.furnishing ?? "full",
        rentPaidByEmployeeCents: d.rentPaidByEmployeeCents || null,
        utilitiesCents: d.utilitiesCents || null,
        driverAnnualCostCents: d.driverAnnualCostCents || null,
        driverPersonalKm: d.driverPersonalKm === null ? "" : String(d.driverPersonalKm),
        driverTotalKm: d.driverTotalKm === null ? "" : String(d.driverTotalKm),
        servantCents: d.servantCents || null,
      };
    case "hotel":
      return { ...base, costCents: d.costCents, paidByEmployeeCents: d.paidByEmployeeCents || null };
    case "car":
      return {
        ...base,
        carType: d.carType,
        usedFrom: d.usedFrom,
        usedTo: d.usedTo,
        carCostCents: d.costCents,
        parfRebateCents: d.parfRebateCents,
        coeYears: d.coeYears === null ? "" : String(d.coeYears),
        rentalCents: d.rentalCents,
        runningCostsCents: d.runningCostsCents || null,
      };
    case "other":
      return { ...base, item: d.item, amountCents: d.amountCents };
    case "share_gain":
      return {
        ...base,
        planType: d.planType,
        grantedOn: d.grantedOn,
        eventDate: d.eventDate,
        exercisePrice: d.exercisePrice,
        openMarketValue: d.openMarketValue,
        shares: d.shares,
        companyIdType: d.companyIdType ?? "",
        companyIdNumber: d.companyIdNumber ?? "",
        companyName: d.companyName ?? "",
      };
  }
}

const int = (s: string): number | null => (s.trim() === "" ? null : Number(s.trim()));

function bodyOf(d: Draft): PayrollIr8aAppendixEntryInput {
  const note = d.note.trim() || null;
  switch (d.kind) {
    case "residence": {
      const none = d.basis === "none";
      return {
        kind: "residence",
        basis: d.basis,
        address: none ? null : d.address.trim() || null,
        occupiedFrom: none ? null : d.occupiedFrom || null,
        occupiedTo: none ? null : d.occupiedTo || null,
        employeesSharing: none ? 1 : (int(d.employeesSharing) ?? 1),
        rentPaidByEmployerCents: d.basis === "rented" ? d.rentPaidByEmployerCents : null,
        annualValueCents: d.basis === "owned" && !d.enterPeriodValue ? d.annualValueCents : null,
        annualValueForPeriodCents: d.basis === "owned" && d.enterPeriodValue ? d.annualValueForPeriodCents : null,
        furnishing: d.basis === "owned" ? d.furnishing : null,
        rentPaidByEmployeeCents: none ? 0 : (d.rentPaidByEmployeeCents ?? 0),
        utilitiesCents: d.utilitiesCents ?? 0,
        driverAnnualCostCents: d.driverAnnualCostCents ?? 0,
        driverPersonalKm: int(d.driverPersonalKm),
        driverTotalKm: int(d.driverTotalKm),
        servantCents: d.servantCents ?? 0,
        note,
      };
    }
    case "hotel":
      return { kind: "hotel", costCents: d.costCents ?? 0, paidByEmployeeCents: d.paidByEmployeeCents ?? 0, note };
    case "car": {
      const leased = d.carType === "leased";
      return {
        kind: "car",
        carType: d.carType,
        usedFrom: d.usedFrom,
        usedTo: d.usedTo,
        costCents: leased ? null : d.carCostCents,
        parfRebateCents: leased ? null : d.parfRebateCents,
        coeYears: d.carType === "second_hand" || d.carType === "renewed_coe" ? int(d.coeYears) : null,
        rentalCents: leased ? d.rentalCents : null,
        runningCostsCents: d.runningCostsCents ?? 0,
        note,
      };
    }
    case "other":
      return { kind: "other", item: d.item, amountCents: d.amountCents ?? 0, note };
    case "share_gain":
      return {
        kind: "share_gain",
        planType: d.planType,
        grantedOn: d.grantedOn,
        eventDate: d.eventDate,
        exercisePrice: d.exercisePrice.trim(),
        openMarketValue: d.openMarketValue.trim(),
        shares: d.shares.trim(),
        companyIdType: d.companyIdType || null,
        companyIdNumber: d.companyIdNumber.trim() || null,
        companyName: d.companyName.trim() || null,
        note,
      };
  }
}

// ---------------------------------------------------------------------------------------------
// Dialog
// ---------------------------------------------------------------------------------------------

const Sub = ({ children }: { children: React.ReactNode }) => (
  <p className="mt-1 font-azeret text-[10px] font-semibold uppercase tracking-wider text-primary-300 sm:col-span-2">
    {children}
  </p>
);

/**
 * Add or edit one Appendix 8A/8B record. After saving, the dialog stays open on the saved record
 * and shows what Crow HR computed, with the working.
 */
export function AppendixEntryDialog({
  year,
  open,
  onOpenChange,
  entry,
  initialKind = "residence",
}: {
  year: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  entry: AppendixEntry | null;
  initialKind?: AppendixKind;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        {open ? (
          <EntryForm
            key={entry?.id ?? `new-${initialKind}`}
            year={year}
            entry={entry}
            initialKind={initialKind}
            onClose={() => onOpenChange(false)}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function EntryForm({
  year,
  entry: initial,
  initialKind,
  onClose,
}: {
  year: number;
  entry: AppendixEntry | null;
  initialKind: AppendixKind;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [saved, setSaved] = React.useState<AppendixEntry | null>(initial);
  const [d, setD] = React.useState<Draft>(() => (initial ? draftOf(initial) : blankDraft(initialKind, year)));
  const [confirmDelete, setConfirmDelete] = React.useState(false);
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((x) => ({ ...x, [k]: v }));
  const people = useQuery({ ...directoryQuery({ status: "active,leaving,former" }), enabled: !saved });
  const invalidate = () => qc.invalidateQueries({ queryKey: ["payroll", "ir8a", year] });
  const save = useMutation({
    mutationFn: () =>
      saved
        ? api<AppendixEntry>("PUT", `/payroll/ir8a/appendices/${saved.id}`, { entry: bodyOf(d) })
        : api<AppendixEntry>("POST", `/payroll/years/${year}/ir8a/appendices`, {
            employeeId: d.employeeId,
            entry: bodyOf(d),
          }),
    onSuccess: async (e) => {
      setSaved(e);
      await invalidate();
      toast.success(`${KIND_LABEL[e.kind]} saved for ${e.employeeName}`);
    },
  });
  const remove = useMutation({
    mutationFn: () => api<void>("DELETE", `/payroll/ir8a/appendices/${saved?.id}`),
    onSuccess: async () => {
      await invalidate();
      toast.success("Record deleted");
      onClose();
    },
  });
  const errors = fieldErrors(save.error);
  const err = (k: string) => errors[`entry.${k}`];
  const formError = save.error && !Object.keys(errors).length ? errorMessage(save.error) : null;
  const sharePlan = d.kind === "share_gain";
  return (
    <>
      <DialogHeader>
        <DialogTitle>
          {saved
            ? `${KIND_LABEL[d.kind]}: ${saved.employeeName}`
            : sharePlan
              ? "Record a share-plan gain"
              : "Record a benefit-in-kind"}
        </DialogTitle>
        <DialogDescription>
          {sharePlan
            ? `Appendix 8B, income year ${year}. Report a gain in the year it accrues; IRAS does not take losses.`
            : `Appendix 8A, income year ${year}. Leave out benefits IRAS exempts, such as group medical insurance or festive gifts up to S$200.`}
        </DialogDescription>
      </DialogHeader>
      <form
        className="grid grid-cols-1 gap-3 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        {saved ? null : (
          <>
            <FormField label="Employee" error={errors.employeeId}>
              <Select value={d.employeeId} onValueChange={(v) => set("employeeId", v)}>
                <SelectTrigger aria-label="Employee">
                  <SelectValue placeholder={people.isPending ? "Loading…" : "Choose an employee"} />
                </SelectTrigger>
                <SelectContent>
                  {(people.data?.items ?? []).map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.legalName} · {p.employeeNumber}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
            {sharePlan ? null : (
              <FormField label="Benefit">
                <Select value={d.kind} onValueChange={(v) => set("kind", v as AppendixKind)}>
                  <SelectTrigger aria-label="Benefit">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(["residence", "hotel", "car", "other"] as const).map((k) => (
                      <SelectItem key={k} value={k}>
                        {KIND_LABEL[k]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FormField>
            )}
          </>
        )}
        {d.kind === "residence" ? <ResidenceFields d={d} set={set} err={err} /> : null}
        {d.kind === "hotel" ? (
          <>
            <FormField
              label="Actual cost of the stay (3a)"
              hint="Hotel, or a serviced apartment in a hotel building."
              error={err("costCents")}
            >
              <MoneyInput value={d.costCents} onChange={(c) => set("costCents", c)} />
            </FormField>
            <FormField label="Paid by the employee (3b)" error={err("paidByEmployeeCents")}>
              <MoneyInput value={d.paidByEmployeeCents} onChange={(c) => set("paidByEmployeeCents", c)} />
            </FormField>
          </>
        ) : null}
        {d.kind === "car" ? <CarFields d={d} set={set} err={err} /> : null}
        {d.kind === "other" ? (
          <>
            <FormField label="Item" className="sm:col-span-2">
              <Select value={d.item} onValueChange={(v) => set("item", v as OtherItem)}>
                <SelectTrigger aria-label="Item">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {OTHER_ITEMS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.code} {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
            <FormField
              label="Cost to the employer"
              hint={
                d.item === "loan_interest"
                  ? "IRAS values interest benefits at 3-month SORA + 1.5%: work it out from IRAS's rates."
                  : d.item === "home_leave"
                    ? "Full cost for the employee and family (taxable in full since YA 2018)."
                    : "The actual cost of providing the benefit."
              }
              error={err("amountCents")}
            >
              <MoneyInput value={d.amountCents} onChange={(c) => set("amountCents", c)} />
            </FormField>
          </>
        ) : null}
        {sharePlan ? <ShareFields d={d} set={set} err={err} /> : null}
        <FormField
          label="Note"
          hint="For your records, e.g. a car plate or plan name. Not exported."
          className="sm:col-span-2"
          error={err("note")}
        >
          <Textarea rows={2} value={d.note} maxLength={200} onChange={(e) => set("note", e.target.value)} />
        </FormField>
        {formError ? (
          <p role="alert" className="text-ui text-danger-300 sm:col-span-2">
            {formError}
          </p>
        ) : null}
        {saved?.computed ? <Computed entry={saved} /> : null}
        {saved?.error ? (
          <p role="alert" className="text-ui text-danger-300 sm:col-span-2">
            {saved.error}
          </p>
        ) : null}
        <DialogFooter className="sm:col-span-2">
          {saved ? (
            confirmDelete ? (
              <Button
                type="button"
                variant="destructive"
                size="sm"
                disabled={remove.isPending}
                onClick={() => remove.mutate()}
              >
                Confirm delete
              </Button>
            ) : (
              <Button type="button" size="sm" onClick={() => setConfirmDelete(true)}>
                Delete
              </Button>
            )
          ) : null}
          <Button type="button" size="sm" onClick={onClose}>
            {saved ? "Done" : "Cancel"}
          </Button>
          <Button type="submit" variant="primary" size="sm" disabled={save.isPending || (!saved && !d.employeeId)}>
            {save.isPending ? "Saving…" : saved ? "Save changes" : "Save"}
          </Button>
        </DialogFooter>
      </form>
    </>
  );
}

type FieldsProps = {
  d: Draft;
  set: <K extends keyof Draft>(k: K, v: Draft[K]) => void;
  err: (k: string) => string | undefined;
};

function ResidenceFields({ d, set, err }: FieldsProps) {
  const none = d.basis === "none";
  return (
    <>
      <fieldset className="sm:col-span-2">
        <legend className="mb-1.5 text-ui font-medium">Who pays for the premises</legend>
        <RadioGroup value={d.basis} onValueChange={(v) => set("basis", v as Draft["basis"])} className="gap-1.5">
          {(
            [
              ["rented", "The employer rents it (valued at the rent paid)"],
              ["owned", "The employer owns it, no rent (valued at annual value)"],
              ["none", "No place of residence: only utilities, a driver or a servant"],
            ] as const
          ).map(([v, label]) => (
            <Label key={v} className="flex items-center gap-2 font-normal">
              <RadioGroupItem value={v} /> {label}
            </Label>
          ))}
        </RadioGroup>
      </fieldset>
      {none ? null : (
        <>
          <FormField label="Address" className="sm:col-span-2" error={err("address")}>
            <Input value={d.address} maxLength={115} onChange={(e) => set("address", e.target.value)} />
          </FormField>
          <FormField label="Occupied from" error={err("occupiedFrom")}>
            <Input type="date" value={d.occupiedFrom} onChange={(e) => set("occupiedFrom", e.target.value)} />
          </FormField>
          <FormField label="Occupied to" hint="One record per unbroken period." error={err("occupiedTo")}>
            <Input type="date" value={d.occupiedTo} onChange={(e) => set("occupiedTo", e.target.value)} />
          </FormField>
          <FormField
            label="Employees sharing"
            hint="1 if not shared; family members who aren't employees don't count."
            error={err("employeesSharing")}
          >
            <Input
              inputMode="numeric"
              value={d.employeesSharing}
              onChange={(e) => set("employeesSharing", e.target.value)}
            />
          </FormField>
          {d.basis === "rented" ? (
            <FormField
              label="Rent paid by the employer"
              hint="For the period, whole premises, including furniture and fittings. Crow HR divides it between the employees sharing."
              error={err("rentPaidByEmployerCents")}
            >
              <MoneyInput value={d.rentPaidByEmployerCents} onChange={(c) => set("rentPaidByEmployerCents", c)} />
            </FormField>
          ) : (
            <>
              <FormField label="Furnishing" error={err("furnishing")}>
                <Select value={d.furnishing} onValueChange={(v) => set("furnishing", v as Draft["furnishing"])}>
                  <SelectTrigger aria-label="Furnishing">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="partial">Partly furnished: fittings only (40% of AV)</SelectItem>
                    <SelectItem value="full">Fully furnished: furniture too (50% of AV)</SelectItem>
                  </SelectContent>
                </Select>
              </FormField>
              <Label className="flex items-center gap-2 font-normal sm:col-span-2">
                <Checkbox checked={d.enterPeriodValue} onCheckedChange={(c) => set("enterPeriodValue", c === true)} />
                Enter the annual value for the period myself (AV revised during the year, or a leap year)
              </Label>
              {d.enterPeriodValue ? (
                <FormField label="Annual value for the period (2a)" error={err("annualValueForPeriodCents")}>
                  <MoneyInput
                    value={d.annualValueForPeriodCents}
                    onChange={(c) => set("annualValueForPeriodCents", c)}
                  />
                </FormField>
              ) : (
                <FormField
                  label="Annual value of the premises"
                  hint="On the property tax bill or IRAS's e-Valuation List. Crow HR apportions it."
                  error={err("annualValueCents")}
                >
                  <MoneyInput value={d.annualValueCents} onChange={(c) => set("annualValueCents", c)} />
                </FormField>
              )}
            </>
          )}
          <FormField label="Rent paid by the employee (2e)" error={err("rentPaidByEmployeeCents")}>
            <MoneyInput value={d.rentPaidByEmployeeCents} onChange={(c) => set("rentPaidByEmployeeCents", c)} />
          </FormField>
        </>
      )}
      <Sub>Utilities and housekeeping</Sub>
      <FormField
        label="Utilities, phone and gadgets (2g)"
        hint="Actual amount the employer paid."
        error={err("utilitiesCents")}
      >
        <MoneyInput value={d.utilitiesCents} onChange={(c) => set("utilitiesCents", c)} />
      </FormField>
      <FormField
        label="Servant, gardener or upkeep (2i)"
        hint="Annual wages, or what a company was paid."
        error={err("servantCents")}
      >
        <MoneyInput value={d.servantCents} onChange={(c) => set("servantCents", c)} />
      </FormField>
      <FormField
        label="Driver's annual cost"
        hint="Valued at cost × private ÷ total mileage (2h)."
        error={err("driverAnnualCostCents")}
      >
        <MoneyInput value={d.driverAnnualCostCents} onChange={(c) => set("driverAnnualCostCents", c)} />
      </FormField>
      <div className="grid grid-cols-2 gap-3">
        <FormField label="Private km" error={err("driverPersonalKm")}>
          <Input
            inputMode="numeric"
            value={d.driverPersonalKm}
            onChange={(e) => set("driverPersonalKm", e.target.value)}
          />
        </FormField>
        <FormField label="Total km" error={err("driverTotalKm")}>
          <Input inputMode="numeric" value={d.driverTotalKm} onChange={(e) => set("driverTotalKm", e.target.value)} />
        </FormField>
      </div>
    </>
  );
}

function CarFields({ d, set, err }: FieldsProps) {
  const leased = d.carType === "leased";
  const renewed = d.carType === "renewed_coe";
  return (
    <>
      <FormField label="Car" className="sm:col-span-2">
        <Select value={d.carType} onValueChange={(v) => set("carType", v as CarType)}>
          <SelectTrigger aria-label="Car">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {CAR_TYPES.map((c) => (
              <SelectItem key={c.value} value={c.value}>
                {c.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </FormField>
      <FormField label="Provided from" error={err("usedFrom")}>
        <Input type="date" value={d.usedFrom} onChange={(e) => set("usedFrom", e.target.value)} />
      </FormField>
      <FormField label="Provided to" error={err("usedTo")}>
        <Input type="date" value={d.usedTo} onChange={(e) => set("usedTo", e.target.value)} />
      </FormField>
      {leased ? (
        <FormField label="Rental for the period" error={err("rentalCents")}>
          <MoneyInput value={d.rentalCents} onChange={(c) => set("rentalCents", c)} />
        </FormField>
      ) : (
        <>
          <FormField
            label={renewed ? "Amount paid to renew the COE" : "Car cost, including COE"}
            hint={renewed ? undefined : "Acquisition cost paid or payable at purchase."}
            error={err("costCents")}
          >
            <MoneyInput value={d.carCostCents} onChange={(c) => set("carCostCents", c)} />
          </FormField>
          <FormField
            label={renewed ? "PARF rebate forgone by renewing" : "PARF rebate"}
            hint={renewed ? undefined : "On de-registration at 9 to 10 years; 0 if over 10 years old at purchase."}
            error={err("parfRebateCents")}
          >
            <MoneyInput value={d.parfRebateCents} onChange={(c) => set("parfRebateCents", c)} />
          </FormField>
          {d.carType === "second_hand" || renewed ? (
            <FormField
              label={renewed ? "Renewed COE term (years)" : "Years from purchase to COE expiry"}
              hint={renewed ? "5 or 10." : "Rounded up: 6 years 2 months is 7."}
              error={err("coeYears")}
            >
              <Input inputMode="numeric" value={d.coeYears} onChange={(e) => set("coeYears", e.target.value)} />
            </FormField>
          ) : null}
        </>
      )}
      <FormField
        label="Running costs borne by the employer"
        hint="Road tax, petrol, parking, ERP, insurance, repairs, including reimbursements."
        error={err("runningCostsCents")}
      >
        <MoneyInput value={d.runningCostsCents} onChange={(c) => set("runningCostsCents", c)} />
      </FormField>
    </>
  );
}

function ShareFields({ d, set, err }: FieldsProps) {
  return (
    <>
      <FormField label="Plan">
        <Select value={d.planType} onValueChange={(v) => set("planType", v as Draft["planType"])}>
          <SelectTrigger aria-label="Plan">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ESOP">ESOP: share options</SelectItem>
            <SelectItem value="ESOW">ESOW: share awards or purchase plan</SelectItem>
          </SelectContent>
        </Select>
      </FormField>
      <FormField label="Granted on" error={err("grantedOn")}>
        <Input type="date" value={d.grantedOn} onChange={(e) => set("grantedOn", e.target.value)} />
      </FormField>
      <FormField
        label="Gain accrued on"
        hint="Exercise (ESOP), vesting, or grant without vesting; the day a moratorium lifted, if any."
        error={err("eventDate")}
      >
        <Input type="date" value={d.eventDate} onChange={(e) => set("eventDate", e.target.value)} />
      </FormField>
      <FormField label="Number of shares" error={err("shares")}>
        <Input
          inputMode="decimal"
          className="num text-right"
          value={d.shares}
          onChange={(e) => set("shares", e.target.value)}
        />
      </FormField>
      <FormField
        label="Price paid per share (S$)"
        hint="Exercise price; 0 for free shares."
        error={err("exercisePrice")}
      >
        <Input
          inputMode="decimal"
          className="num text-right"
          value={d.exercisePrice}
          onChange={(e) => set("exercisePrice", e.target.value)}
        />
      </FormField>
      <FormField
        label="Open market value per share (S$)"
        hint="On the accrual date: SGX last done price; net asset value if there is no market. Convert other currencies at that day's rate."
        error={err("openMarketValue")}
      >
        <Input
          inputMode="decimal"
          className="num text-right"
          value={d.openMarketValue}
          onChange={(e) => set("openMarketValue", e.target.value)}
        />
      </FormField>
      <Sub>Granting company (only if not the employer)</Sub>
      <FormField label="ID type" error={err("companyIdType")}>
        <Select
          value={d.companyIdType || "none"}
          onValueChange={(v) => set("companyIdType", v === "none" ? "" : (v as Draft["companyIdType"]))}
        >
          <SelectTrigger aria-label="Company ID type">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">The employer granted it</SelectItem>
            <SelectItem value="UEN-Local Co">UEN (local company)</SelectItem>
            <SelectItem value="UEN-Others">UEN (other entity)</SelectItem>
            <SelectItem value="OTHERS">Other (foreign company)</SelectItem>
          </SelectContent>
        </Select>
      </FormField>
      {d.companyIdType ? (
        <>
          <FormField label="Company ID number" error={err("companyIdNumber")}>
            <Input value={d.companyIdNumber} maxLength={25} onChange={(e) => set("companyIdNumber", e.target.value)} />
          </FormField>
          <FormField label="Company name" className="sm:col-span-2" error={err("companyName")}>
            <Input value={d.companyName} maxLength={100} onChange={(e) => set("companyName", e.target.value)} />
          </FormField>
        </>
      ) : null}
    </>
  );
}

const OPTIONAL_LINES = new Set(["2e", "2g", "2h", "2i", "3b"]);

/** What Crow HR computed for a saved record: IRAS's items with computed/entered tags and the working. */
function Computed({ entry }: { entry: AppendixEntry }) {
  const c = entry.computed;
  if (!c) return null;
  return (
    <div className="rounded-md border border-border sm:col-span-2" data-testid="appendix-computed">
      <p className="border-b border-border px-3 py-2 font-azeret text-[10px] font-semibold uppercase tracking-wider text-primary-300">
        {c.appendix === "8B"
          ? `Appendix 8B · ${c.section === "S10_1_G" ? "S10(1)(g), IR8A d7(b)" : "S10(1)(b), IR8A d7(a)"}`
          : `Appendix 8A · item ${c.item}${c.days ? ` · ${c.days} days` : ""}`}
      </p>
      <table className="w-full text-ui">
        <tbody>
          {/* Optional parts left empty (no driver, no rent from the employee…) are noise: hide zeros. */}
          {c.lines
            .filter((l) => l.amountCents !== 0 || !OPTIONAL_LINES.has(l.code))
            .map((l) => (
              <tr key={l.code} className="border-b border-border last:border-0">
                <td className="w-10 px-3 py-1.5 font-azeret text-2xs text-primary-200">{l.code}</td>
                <td className="px-1 py-1.5">
                  {l.label}
                  <span className="ml-1.5 font-azeret text-[10px] uppercase text-primary-200">
                    {l.entered ? "entered" : "computed"}
                  </span>
                </td>
                <td className="num px-3 py-1.5 text-right">
                  {l.amountCents === null ? "–" : formatMoney(l.amountCents)}
                </td>
              </tr>
            ))}
        </tbody>
      </table>
      {c.working.length ? (
        <ul className="space-y-0.5 border-t border-border px-3 py-2 text-2xs text-primary-300">
          {c.working.map((w) => (
            <li key={`${w.code}-${w.text}`}>{w.text}</li>
          ))}
        </ul>
      ) : null}
      {c.issues.length ? (
        <ul className="border-t border-border px-3 py-2 text-2xs text-warning-400">
          {c.issues.map((i) => (
            <li key={i.code}>{i.message}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
