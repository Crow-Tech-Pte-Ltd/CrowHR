import type { DirectoryRowDto } from "@crowhr/core";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Checkbox,
  cn,
  DatePicker,
  FormField,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  StatusPill,
  singaporeTodayIso,
  textStyle,
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

/** Directory rows: a chip only when the work pass needs someone (expired or expiring). */
export function PassPill({ state }: { state: DirectoryRowDto["workPassState"] }) {
  if (state === "expired") return <StatusPill tone="danger">Work pass expired</StatusPill>;
  if (state === "expiring") return <StatusPill tone="warning">Work pass expiring</StatusPill>;
  return null;
}

/** Definition list row for read-only profile sections. */
export function Field({ term, children, mono }: { term: string; children: React.ReactNode; mono?: boolean }) {
  return (
    <div className="grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)] gap-3 border-b border-border py-2 last:border-b-0 sm:grid-cols-[12rem_minmax(0,1fr)]">
      <dt className={cn(textStyle.field, "pt-0.5")}>{term}</dt>
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
        <h2 className={textStyle.section}>{title}</h2>
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

/** A date field showing "31 Oct 2026" (the UI kit's DatePicker); YYYY-MM-DD out, "" when empty. */
export function DateInput({
  label: text,
  value,
  onChange,
  error,
  hint,
  required,
  className,
  min,
  max,
  yearPicker,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  error?: string;
  hint?: React.ReactNode;
  required?: boolean;
  className?: string;
  min?: string;
  max?: string;
  /** Month and year dropdowns, for dates years away (date of birth, an old start date). */
  yearPicker?: boolean;
}) {
  return (
    <FormField label={text} error={error} hint={hint} required={required} className={className}>
      <DatePicker
        value={value || null}
        onChange={(v) => onChange(v ?? "")}
        min={min}
        max={max}
        yearPicker={yearPicker}
      />
    </FormField>
  );
}

export const today = () => singaporeTodayIso();

export function centsToInput(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return "";
  return `${Math.trunc(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;
}

/** MOM: who the Employment Act and its Part 4 (hours, rest days, overtime) cover. */
export const MOM_WHO_IS_COVERED_URL = "https://www.mom.gov.sg/employment-practices/employment-act/who-is-covered";

/** "MOM: who is covered" link, opening in a new tab. */
export function MomCoverageLink({ children = "MOM: who is covered" }: { children?: React.ReactNode }) {
  return (
    <a
      className="text-biru-400 underline underline-offset-2 hover:no-underline"
      href={MOM_WHO_IS_COVERED_URL}
      target="_blank"
      rel="noreferrer"
    >
      {children}
    </a>
  );
}

/**
 * Employment Act Part 4 classification of an employment record: workman, and manager or
 * executive. Managers and executives are never covered by Part 4, so they get no statutory OT.
 */
export function Part4Fields({
  isWorkman,
  isManagerOrExecutive,
  onChange,
}: {
  isWorkman: boolean;
  isManagerOrExecutive: boolean;
  onChange: (v: { isWorkman: boolean; isManagerOrExecutive: boolean }) => void;
}) {
  return (
    <fieldset className="flex flex-col gap-2 sm:col-span-2">
      <legend className={cn(textStyle.group, "mb-1")}>Employment Act Part 4</legend>
      <div className="flex items-start gap-2">
        <Checkbox
          id="part4-workman"
          checked={isWorkman}
          onCheckedChange={(c) => onChange({ isWorkman: !!c, isManagerOrExecutive })}
        />
        <Label htmlFor="part4-workman" className="flex flex-col gap-0.5 font-sans text-ui font-normal">
          <span className="font-medium">Workman</span>
          <span className="text-2xs text-primary-300">
            Mainly manual work, e.g. cleaners, drivers, kitchen and production crew.
          </span>
        </Label>
      </div>
      <div className="flex items-start gap-2">
        <Checkbox
          id="part4-manager"
          checked={isManagerOrExecutive}
          onCheckedChange={(c) => onChange({ isWorkman, isManagerOrExecutive: !!c })}
        />
        <Label htmlFor="part4-manager" className="flex flex-col gap-0.5 font-sans text-ui font-normal">
          <span className="font-medium">Manager or executive</span>
          <span className="text-2xs text-primary-300">
            Executive or supervisory duties, such as hiring, appraisals or running a team. Never covered by Part 4, so
            overtime follows the contract, not the statutory 1.5× rate.
          </span>
        </Label>
      </div>
      <p className="text-2xs text-primary-300">
        The duties decide this, not the job title. <MomCoverageLink />
      </p>
    </fieldset>
  );
}
