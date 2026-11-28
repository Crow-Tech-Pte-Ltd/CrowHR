import type { EmployeeDetailDto } from "@crowhr/core";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  FormField,
  formatDate,
  formatMoney,
  MoneyInput,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  textStyle,
  toast,
} from "@crowhr/ui";
import { type UseQueryResult, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Pencil, Plus } from "lucide-react";
import * as React from "react";
import { useT } from "../../../../i18n/index.ts";
import { type AllowanceType, allowanceTypesQuery, api, errorMessage, fieldErrors, invalidatePeople } from "./api.ts";
import { DateInput, Section, SelectInput, today } from "./ui.tsx";

export interface AllowanceDraft {
  key: number;
  allowanceTypeId: string;
  amountCents: number | null;
}

const typesLink = (
  <Link className="font-medium text-biru-400 underline" to="/payroll/allowances">
    Payroll → Allowance treatment
  </Link>
);

function AllowanceTypesStatus({ query }: { query: UseQueryResult<{ items: AllowanceType[] }> }) {
  const t = useT("people-payroll");
  if (query.isPending)
    return (
      <p role="status" className="text-ui text-primary-300">
        {t("Loading allowance types…")}
      </p>
    );
  if (!query.isError) return null;
  return (
    <div className="flex flex-wrap items-center gap-2 text-ui">
      <p role="alert" className="text-danger-300">
        {errorMessage(query.error)}
      </p>
      <Button type="button" size="sm" variant="ghost" onClick={() => void query.refetch()}>
        {t("Try again")}
      </Button>
    </div>
  );
}

export function HireAllowanceFields({
  rows,
  onChange,
  errors,
}: {
  rows: AllowanceDraft[];
  onChange: (rows: AllowanceDraft[]) => void;
  errors: Record<string, string>;
}) {
  const t = useT("people-payroll");
  const query = useQuery(allowanceTypesQuery);
  const key = React.useRef(0);
  const types = (query.data?.items ?? []).filter((type) => !type.archived);
  const update = (id: number, fields: Partial<Omit<AllowanceDraft, "key">>) =>
    onChange(rows.map((row) => (row.key === id ? { ...row, ...fields } : row)));
  return (
    <fieldset className="grid gap-3 sm:col-span-2">
      <legend className={textStyle.group}>{t("Recurring allowances")}</legend>
      <AllowanceTypesStatus query={query} />
      {query.isSuccess && !types.length ? (
        <p className="text-ui text-primary-300">Create an allowance type in {typesLink} to assign it here.</p>
      ) : null}
      {rows.map((row, index) => (
        <div key={row.key} className="grid items-start gap-2 sm:grid-cols-[1fr_1fr_auto]">
          <SelectInput
            label={t("Allowance type")}
            required
            value={row.allowanceTypeId}
            onChange={(allowanceTypeId) => update(row.key, { allowanceTypeId })}
            options={types
              .filter((type) => !rows.some((other) => other.key !== row.key && other.allowanceTypeId === type.id))
              .map((type) => ({ value: type.id, label: `${type.name} (${type.code})` }))}
            error={errors[`allowances.${index}.allowanceTypeId`]}
          />
          <FormField label={t("Monthly amount")} required error={errors[`allowances.${index}.amountCents`]}>
            <MoneyInput value={row.amountCents} onChange={(amountCents) => update(row.key, { amountCents })} />
          </FormField>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="justify-self-start sm:mt-5"
            aria-label={`Remove allowance ${index + 1}`}
            onClick={() => onChange(rows.filter((other) => other.key !== row.key))}
          >
            {t("Remove")}
          </Button>
        </div>
      ))}
      {errors.allowances ? (
        <p role="alert" className="text-ui text-danger-300">
          {errors.allowances}
        </p>
      ) : null}
      {types.length > rows.length && rows.length < 20 ? (
        <Button
          type="button"
          size="sm"
          className="justify-self-start"
          onClick={() => onChange([...rows, { key: key.current++, allowanceTypeId: "", amountCents: null }])}
        >
          <Plus aria-hidden /> {t("Add recurring allowance")}
        </Button>
      ) : null}
    </fieldset>
  );
}

type AllowanceRecord = NonNullable<EmployeeDetailDto["compensation"]>["allowances"][number];

export function RecurringAllowances({
  employeeId,
  rows,
  editable,
}: {
  employeeId: string;
  rows: AllowanceRecord[];
  editable: boolean;
}) {
  const t = useT("people-payroll");
  const [open, setOpen] = React.useState(false);
  return (
    <Section
      title={t("Recurring allowances")}
      actions={
        editable ? (
          <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>
            {rows.length ? <Pencil aria-hidden /> : <Plus aria-hidden />}
            {rows.length ? t("Change allowance") : t("Add allowance")}
          </Button>
        ) : null
      }
    >
      {rows.length ? (
        <div className="-mx-4 -my-2">
          <Table aria-label={t("Recurring allowances")}>
            <TableHeader>
              <TableRow>
                <TableHead>{t("Allowance")}</TableHead>
                <TableHead numeric>{t("Monthly amount")}</TableHead>
                <TableHead numeric>{t("From")}</TableHead>
                <TableHead numeric>{t("Ends on")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell>{row.name}</TableCell>
                  <TableCell numeric>{formatMoney(row.amountCents)}</TableCell>
                  <TableCell numeric>{formatDate(row.effectiveFrom)}</TableCell>
                  <TableCell numeric>{row.effectiveTo ? formatDate(row.effectiveTo) : t("Ongoing")}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : (
        <p className="py-3 text-ui text-primary-300">{t("Recurring allowances appear here after they’re assigned.")}</p>
      )}
      {open ? <AllowanceChangeDialog employeeId={employeeId} rows={rows} onClose={() => setOpen(false)} /> : null}
    </Section>
  );
}

function AllowanceChangeDialog({
  employeeId,
  rows,
  onClose,
}: {
  employeeId: string;
  rows: AllowanceRecord[];
  onClose: () => void;
}) {
  const t = useT("people-payroll");
  const query = useQuery(allowanceTypesQuery);
  const qc = useQueryClient();
  const [date, setDate] = React.useState(today);
  const [typeId, setTypeId] = React.useState("");
  const [action, setAction] = React.useState("set");
  const [amount, setAmount] = React.useState<number | null>(null);
  const ends = action === "end";
  const inForce = (id: string) =>
    rows.find(
      (row) => row.allowanceTypeId === id && row.effectiveFrom <= date && (!row.effectiveTo || date < row.effectiveTo),
    );
  const current = inForce(typeId);
  const options = (query.data?.items ?? []).filter((type) => (ends ? inForce(type.id) : !type.archived));
  const canSave = !!(
    date &&
    typeId &&
    options.some((type) => type.id === typeId) &&
    (ends ? current : amount !== null)
  );
  const save = useMutation({
    mutationFn: () =>
      api<{ status: string }>("POST", `/employees/${employeeId}/events`, {
        type: "salary_change",
        effectiveDate: date,
        ...(ends
          ? { endAllowanceTypeIds: [typeId] }
          : {
              allowances: [{ allowanceTypeId: typeId, amountCents: amount }],
              requireSingleAllowanceRatePerMonth: true,
            }),
      }),
    onSuccess: async (result) => {
      await invalidatePeople(qc);
      toast.success(result.status === "scheduled" ? t("Allowance change scheduled") : t("Allowance changed"), {
        description: `Effective from ${formatDate(date)}. Recompute any affected draft payroll runs.`,
      });
      onClose();
    },
  });
  const errors = fieldErrors(save.error);
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("Change recurring allowance")}</DialogTitle>
          <DialogDescription>
            {t("Add, change or end one recurring allowance from the effective date.")}
          </DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (canSave) save.mutate();
          }}
        >
          <DateInput
            label={t("Effective from")}
            required
            value={date}
            onChange={(value) => {
              setDate(value);
              save.reset();
            }}
            error={errors.effectiveDate}
          />
          <SelectInput
            label={t("Change")}
            value={action}
            onChange={(value) => {
              setAction(value);
              save.reset();
            }}
            options={[
              { value: "set", label: t("Set monthly amount") },
              { value: "end", label: t("End allowance") },
            ]}
          />
          <AllowanceTypesStatus query={query} />
          {query.isSuccess && options.length ? (
            <SelectInput
              label={t("Allowance type")}
              required
              value={typeId}
              onChange={(id) => {
                setTypeId(id);
                setAmount(inForce(id)?.amountCents ?? null);
                save.reset();
              }}
              options={options.map((type) => ({ value: type.id, label: `${type.name} (${type.code})` }))}
              error={errors.allowances ?? errors.endAllowanceTypeIds}
              hint={ends && typeId && !current ? t("Choose an allowance in force on that date.") : undefined}
            />
          ) : null}
          {query.isSuccess && !options.length ? (
            <p className="text-ui text-primary-300">
              {ends ? (
                t("No recurring allowances are in force on that date.")
              ) : (
                <>Create an allowance type in {typesLink} to assign it here.</>
              )}
            </p>
          ) : null}
          {!ends && typeId ? (
            <FormField
              label={t("Monthly amount")}
              required
              error={errors["allowances.0.amountCents"]}
              hint={current ? `In force on that date ${formatMoney(current.amountCents)} per month.` : undefined}
            >
              <MoneyInput value={amount} onChange={setAmount} />
            </FormField>
          ) : null}
          {save.isError && !Object.keys(errors).length ? (
            <p role="alert" className="text-ui text-danger-300">
              {errorMessage(save.error)}
            </p>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              {t("Cancel")}
            </Button>
            <Button type="submit" variant="primary" disabled={save.isPending || !canSave}>
              {t("Save allowance")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
