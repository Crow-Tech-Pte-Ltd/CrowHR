import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Card,
  cn,
  EmptyState,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  toast,
} from "@crowhr/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Navigate } from "@tanstack/react-router";
import { AlertTriangle, ExternalLink, Wallet } from "lucide-react";
import * as React from "react";
import { can, useMe } from "../../../auth/session.ts";
import { PageHeader } from "../../../components/page-header.tsx";
import { ErrorNote } from "../../../components/section.tsx";
import {
  type AllowanceSettingDto,
  allowanceSettingsQuery,
  errorMessage,
  fieldErrors,
  saveAllowanceSetting,
} from "./-lib/api.ts";

const MOM_GROSS_RATE = "https://www.mom.gov.sg/employment-practices/salary/monthly-and-daily-salary";
const CPF_WAGES = "https://www.cpf.gov.sg/employer/employer-obligations/what-constitutes-wages-for-cpf-contributions";

export const Route = createFileRoute("/_app/payroll/allowances")({
  // `?highlight=SHIFT,TRANSPORT` marks the allowances a payroll issue asked about.
  validateSearch: (s: Record<string, unknown>): { highlight?: string } =>
    typeof s.highlight === "string" && s.highlight ? { highlight: s.highlight } : {},
  component: AllowancesPage,
});

function AllowancesPage() {
  const me = useMe();
  if (!can(me, "payroll:read")) return <Navigate to="/me/payslips" />;
  return <Allowances editable={can(me, "payroll:update")} />;
}

function Allowances({ editable }: { editable: boolean }) {
  const q = useQuery(allowanceSettingsQuery);
  const { highlight } = Route.useSearch();
  const marked = new Set((highlight ?? "").split(",").filter(Boolean));
  const unset = q.data?.items.filter((a) => a.grossRateIncluded === null) ?? [];
  return (
    <>
      <PageHeader
        crumbs={[{ label: "Payroll", to: "/payroll" }]}
        title="Allowance treatment"
        description="How each recurring allowance counts: for CPF, in a month someone joins or leaves, and in the Employment Act's gross rate of pay (one day's pay for a public holiday on an off day, and leave encashment)."
      />
      {unset.length ? (
        <Alert variant="warning" className="mb-5">
          <AlertTriangle aria-hidden />
          <div>
            <AlertTitle>
              {unset.length === 1 ? "1 allowance has" : `${unset.length} allowances have`} no answer for the gross rate
              yet
            </AlertTitle>
            <AlertDescription>
              Until it is set, a public holiday on an off day blocks payroll for staff who get the allowance, and their
              leave encashment can't be requested.
            </AlertDescription>
          </div>
        </Alert>
      ) : null}
      <Guidance />
      {q.isPending ? (
        <div role="status" aria-label="Loading allowances" className="flex flex-col gap-2">
          <Skeleton className="h-14 w-full" />
          <Skeleton className="h-14 w-full" />
        </div>
      ) : q.isError ? (
        <Card>
          <ErrorNote error={q.error} retry={() => void q.refetch()} />
        </Card>
      ) : q.data.items.length === 0 ? (
        <EmptyState
          icon={<Wallet />}
          title="No allowance types yet"
          description="Allowance types and employees' recurring allowances are added through the API for now (allowance types, then allowances on a hire or pay change). Their treatment is set here."
        />
      ) : (
        <Card>
          <div
            aria-hidden
            className="hidden border-b border-border bg-surface-100 px-4 py-2 font-azeret text-[10px] uppercase tracking-wider text-primary-200 md:grid md:grid-cols-[minmax(0,1.2fr)_repeat(3,minmax(0,1fr))_6rem] md:gap-3"
          >
            <span>Allowance</span>
            <span>CPF</span>
            <span>Incomplete month</span>
            <span>Gross rate of pay</span>
            <span />
          </div>
          <ul className="divide-y divide-border">
            {q.data.items.map((a) => (
              <AllowanceRow key={a.allowanceTypeId} a={a} editable={editable} marked={marked.has(a.code)} />
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}

function Guidance() {
  return (
    <details className="group mb-5 rounded-md border border-border bg-card px-4 py-3 text-ui">
      <summary className="focus-ring cursor-pointer rounded-sm font-medium">How to decide</summary>
      <dl className="mt-3 flex flex-col gap-3 text-primary-300">
        <div>
          <dt className="font-medium text-ink">Gross rate of pay</dt>
          <dd>
            Include fixed allowances paid as part of salary (a fixed shift or responsibility allowance). Exclude
            travelling, food and housing allowances, reimbursements, productivity incentives and other variable
            payments. Overtime, bonuses and AWS never count.{" "}
            <SourceLink href={MOM_GROSS_RATE}>MOM: monthly and daily salary</SourceLink>
          </dd>
        </div>
        <div>
          <dt className="font-medium text-ink">CPF</dt>
          <dd>
            Allowances are ordinary wages for CPF unless they are a reimbursement of an actual expense.{" "}
            <SourceLink href={CPF_WAGES}>CPF: what counts as wages</SourceLink>
          </dd>
        </div>
        <div>
          <dt className="font-medium text-ink">Incomplete month</dt>
          <dd>Pro-rated allowances are paid for the days employed, like basic pay; the others are paid in full.</dd>
        </div>
        <p>A change applies the next time a draft run is computed. Encashment requests already made keep their rate.</p>
      </dl>
    </details>
  );
}

function SourceLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="focus-ring inline-flex items-center gap-1 rounded-sm text-biru-400 hover:underline"
    >
      {children} <ExternalLink className="size-3" aria-hidden />
    </a>
  );
}

const GROSS: Record<"null" | "true" | "false", string> = {
  null: "Not set",
  true: "Included",
  false: "Excluded",
};

function AllowanceRow({ a, editable, marked }: { a: AllowanceSettingDto; editable: boolean; marked: boolean }) {
  const qc = useQueryClient();
  const ref = React.useRef<HTMLLIElement>(null);
  const [cpf, setCpf] = React.useState(a.cpfLiable);
  const [prorate, setProrate] = React.useState(a.prorate);
  const [gross, setGross] = React.useState<"null" | "true" | "false">(String(a.grossRateIncluded) as "null");
  React.useEffect(() => {
    if (marked) ref.current?.scrollIntoView({ block: "center" });
  }, [marked]);
  const dirty = cpf !== a.cpfLiable || prorate !== a.prorate || gross !== String(a.grossRateIncluded);
  const save = useMutation({
    mutationFn: () =>
      saveAllowanceSetting(a.allowanceTypeId, {
        cpfLiable: cpf,
        prorate,
        grossRateIncluded: gross === "null" ? null : gross === "true",
      }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: allowanceSettingsQuery.queryKey });
      toast.success(`${a.name} saved. Recompute draft runs to apply it.`);
    },
  });
  const errors = fieldErrors(save.error);
  const name = `${a.name} (${a.code})`;
  return (
    <li
      ref={ref}
      aria-label={name}
      className={cn(
        "grid grid-cols-1 gap-3 px-4 py-3 sm:grid-cols-3 md:grid-cols-[minmax(0,1.2fr)_repeat(3,minmax(0,1fr))_6rem] md:items-center",
        marked && "bg-kuning-50",
      )}
    >
      <div className="min-w-0 sm:col-span-3 md:col-span-1">
        <p className="truncate font-medium">{a.name}</p>
        <p className="num text-[10px] text-primary-200">{a.code}</p>
      </div>
      <Choice
        label="CPF"
        name={name}
        editable={editable}
        value={String(cpf)}
        onChange={(v) => setCpf(v === "true")}
        options={[
          ["true", "CPF-liable (OW)"],
          ["false", "Not CPF-liable"],
        ]}
      />
      <Choice
        label="Incomplete month"
        name={name}
        editable={editable}
        value={String(prorate)}
        onChange={(v) => setProrate(v === "true")}
        options={[
          ["true", "Pro-rated"],
          ["false", "Paid in full"],
        ]}
      />
      <Choice
        label="Gross rate of pay"
        name={name}
        editable={editable}
        value={gross}
        onChange={(v) => setGross(v as typeof gross)}
        warn={gross === "null"}
        options={[
          ...(a.grossRateIncluded === null ? ([["null", GROSS.null]] as [string, string][]) : []),
          ["true", GROSS.true],
          ["false", GROSS.false],
        ]}
      />
      <div className="flex items-center gap-2 sm:col-span-3 md:col-span-1 md:justify-end">
        {editable ? (
          <Button
            size="sm"
            variant={dirty ? "ink" : "secondary"}
            disabled={!dirty || save.isPending}
            onClick={() => save.mutate()}
            aria-label={`Save ${a.name}`}
          >
            Save
          </Button>
        ) : null}
      </div>
      {save.isError ? (
        <p role="alert" className="text-2xs text-danger-300 sm:col-span-3 md:col-span-5">
          {Object.values(errors)[0] ?? errorMessage(save.error)}
        </p>
      ) : null}
    </li>
  );
}

function Choice({
  label,
  name,
  editable,
  value,
  onChange,
  options,
  warn,
}: {
  label: string;
  name: string;
  editable: boolean;
  value: string;
  onChange: (v: string) => void;
  options: [string, string][];
  warn?: boolean;
}) {
  const text = options.find(([v]) => v === value)?.[1] ?? value;
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className="font-azeret text-[10px] uppercase tracking-wider text-primary-200 md:sr-only">{label}</span>
      {editable ? (
        <Select value={value} onValueChange={onChange}>
          <SelectTrigger aria-label={`${name}: ${label}`} className={cn("h-8", warn && "border-warning-300")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {options.map(([v, l]) => (
              <SelectItem key={v} value={v}>
                {l}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : (
        <span className={cn("text-ui", warn && "text-warning-400")}>{text}</span>
      )}
    </div>
  );
}
