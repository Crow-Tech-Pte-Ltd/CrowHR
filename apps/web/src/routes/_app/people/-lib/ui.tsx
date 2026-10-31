import type { DirectoryRowDto } from "@crowhr/core";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  cn,
  FormField,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  StatusPill,
} from "@crowhr/ui";
import { AlertTriangle } from "lucide-react";
import type * as React from "react";
import { errorMessage } from "./api.ts";

/** Human labels for enum values. */
export const LABELS: Record<string, string> = {
  citizen: "Singapore citizen",
  pr: "Permanent resident",
  foreigner: "Foreigner",
  full_time: "Full-time",
  part_time: "Part-time",
  contract: "Contract",
  intern: "Intern",
  nric: "NRIC",
  fin: "FIN",
  other: "Other",
  monthly: "Monthly",
  hourly: "Hourly",
  gg: "G/G (graduated, default)",
  fg: "F/G (full employer, graduated employee)",
  ff: "F/F (full rates)",
  female: "Female",
  male: "Male",
  undisclosed: "Prefer not to say",
  resignation: "Resignation",
  dismissal: "Dismissal",
  retrenchment: "Retrenchment",
  contract_end: "Contract end",
  retirement: "Retirement",
  death: "Death",
  mutual_agreement: "Mutual agreement",
  hire: "Hired",
  rehire: "Rehired",
  transfer: "Transfer",
  promotion: "Promotion",
  salary_change: "Pay change",
  probation_confirmed: "Probation confirmed",
  termination: "Termination",
  hr_admin: "HR admin",
  payroll_admin: "Payroll admin",
  manager: "Manager",
  employee: "Employee",
};

export function label(v: string | null | undefined): string {
  if (!v) return "—";
  return LABELS[v] ?? v.charAt(0).toUpperCase() + v.slice(1).replace(/_/g, " ");
}

export function statusTone(code: DirectoryRowDto["status"]["code"]) {
  return code === "active" ? "success" : code === "leaving" ? "warning" : code === "not_started" ? "info" : "neutral";
}

export function EmployeeStatus({ status }: { status: DirectoryRowDto["status"] }) {
  return <StatusPill tone={statusTone(status.code)}>{status.label}</StatusPill>;
}

export function PassPill({ state }: { state: DirectoryRowDto["workPassState"] }) {
  if (!state || state === "valid") return null;
  if (state === "expired") return <StatusPill tone="danger">Work pass expired</StatusPill>;
  if (state === "expiring") return <StatusPill tone="warning">Pass expiring</StatusPill>;
  return <StatusPill tone="neutral">Pass cancelled</StatusPill>;
}

/** Definition list row for read-only profile sections. */
export function Field({ term, children, mono }: { term: string; children: React.ReactNode; mono?: boolean }) {
  return (
    <div className="grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)] gap-3 border-b border-border py-2 last:border-b-0 sm:grid-cols-[12rem_minmax(0,1fr)]">
      <dt className="font-azeret text-2xs uppercase tracking-wider text-primary-200">{term}</dt>
      <dd className={cn("min-w-0 break-words text-ui", mono && "num")}>{children ?? "—"}</dd>
    </div>
  );
}

export function Section({
  title,
  actions,
  children,
  className,
}: {
  title: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("rounded-lg border border-border bg-surface-50", className)}>
      <header className="flex items-center justify-between gap-2 border-b border-border px-4 py-2.5">
        <h2 className="font-azeret text-2xs font-semibold uppercase tracking-wider">{title}</h2>
        {actions}
      </header>
      <div className="px-4 py-2">{children}</div>
    </section>
  );
}

export function ErrorPanel({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  return (
    <Alert variant="danger" className="max-w-2xl">
      <AlertTriangle aria-hidden />
      <div className="flex flex-col gap-2">
        <AlertTitle>Couldn't load this</AlertTitle>
        <AlertDescription>{errorMessage(error)}</AlertDescription>
        {onRetry ? (
          <div>
            <Button size="sm" onClick={onRetry}>
              Try again
            </Button>
          </div>
        ) : null}
      </div>
    </Alert>
  );
}

export function PanelSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div role="status" aria-busy="true" aria-label="Loading" className="flex flex-col gap-3">
      {Array.from({ length: rows }, (_, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: static placeholders.
        <Skeleton key={i} className="h-9 w-full" />
      ))}
    </div>
  );
}

/** Text input bound to a form state key, with the server's field error. */
export function TextInput({
  label: text,
  value,
  onChange,
  error,
  hint,
  required,
  type = "text",
  placeholder,
  autoComplete,
  className,
  inputMode,
  mono,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  error?: string;
  hint?: React.ReactNode;
  required?: boolean;
  type?: string;
  placeholder?: string;
  autoComplete?: string;
  className?: string;
  inputMode?: React.HTMLAttributes<HTMLInputElement>["inputMode"];
  mono?: boolean;
}) {
  return (
    <FormField label={text} error={error} hint={hint} required={required} className={className}>
      <Input
        type={type}
        value={value}
        placeholder={placeholder}
        autoComplete={autoComplete}
        inputMode={inputMode}
        className={mono ? "num" : undefined}
        onChange={(e) => onChange(e.target.value)}
      />
    </FormField>
  );
}

export function SelectInput({
  label: text,
  value,
  onChange,
  options,
  error,
  hint,
  required,
  placeholder = "Choose…",
  className,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  error?: string;
  hint?: React.ReactNode;
  required?: boolean;
  placeholder?: string;
  className?: string;
}) {
  return (
    <FormField label={text} error={error} hint={hint} required={required} className={className}>
      <Select value={value || undefined} onValueChange={onChange}>
        <SelectTrigger aria-label={text}>
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </FormField>
  );
}

/** Native date input: keyboard-friendly, YYYY-MM-DD out. */
export function DateInput({
  label: text,
  value,
  onChange,
  error,
  hint,
  required,
  className,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  error?: string;
  hint?: React.ReactNode;
  required?: boolean;
  className?: string;
}) {
  return (
    <FormField label={text} error={error} hint={hint} required={required} className={className}>
      <Input type="date" className="num" value={value} onChange={(e) => onChange(e.target.value)} />
    </FormField>
  );
}

export const today = () => new Date(Date.now() + 8 * 3_600_000).toISOString().slice(0, 10);

export function centsToInput(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return "";
  return `${Math.trunc(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;
}
