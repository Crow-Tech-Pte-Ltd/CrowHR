import type { PayrollIr8aPreviewDto } from "@crowhr/core";
import { Button, Card, formatDate, singaporeTodayIso, toast } from "@crowhr/ui";
import { queryOptions, useQuery } from "@tanstack/react-query";
import { Download, ExternalLink } from "lucide-react";
import * as React from "react";
import { useReauth } from "../../../../auth/reauth.tsx";
import { ErrorNote } from "../../../../components/section.tsx";
import { api, downloadFile, type Excluded, errorMessage } from "./api.ts";

export const ir8aQuery = (year: number) =>
  queryOptions({
    queryKey: ["payroll", "ir8a", year] as const,
    queryFn: () => api<PayrollIr8aPreviewDto>("GET", `/payroll/years/${year}/ir8a`),
  });

/** Year end: IR8A rows for IRAS's import template (Appendix 8A is not produced). */
export function Ir8aPanel({ years }: { years: number[] }) {
  const today = singaporeTodayIso();
  const thisYear = Number(today.slice(0, 4));
  // Jan–Mar is filing season for the previous year.
  const preferred = Number(today.slice(5, 7)) <= 3 ? thisYear - 1 : thisYear;
  const options = years.length ? years : [preferred];
  const [year, setYear] = React.useState(options.includes(preferred) ? preferred : (options[0] as number));
  const q = useQuery(ir8aQuery(year));
  const reauth = useReauth();
  const [excluded, setExcluded] = React.useState<Excluded[] | null>(null);
  const get = (part: number) =>
    reauth(() => downloadFile(`/payroll/years/${year}/ir8a/file?part=${part}`))
      .then((r) => {
        const out = r as Awaited<ReturnType<typeof downloadFile>>;
        if (part === 1) setExcluded(out.excluded.length ? out.excluded : null);
        toast.success(`Downloaded ${out.fileName}`);
      })
      .catch((e) => toast.error(errorMessage(e)));
  const p = q.data;
  const withNotes = p?.records.filter((r) => r.notes.length > 0) ?? [];
  return (
    <section aria-labelledby="ir8a-title" className="mt-8" data-testid="payroll-ir8a">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h2 id="ir8a-title" className="font-azeret text-xs font-semibold uppercase tracking-wider">
          Year end: IR8A
        </h2>
        {options.length > 1 ? (
          <fieldset className="flex gap-1" aria-label="Income year">
            {options.map((y) => (
              <Button
                key={y}
                size="sm"
                variant={y === year ? "primary" : "secondary"}
                aria-pressed={y === year}
                onClick={() => {
                  setYear(y);
                  setExcluded(null);
                }}
              >
                {y}
              </Button>
            ))}
          </fieldset>
        ) : null}
      </div>
      <Card>
        {q.isError ? (
          <ErrorNote error={q.error} retry={() => void q.refetch()} />
        ) : !p ? (
          <p className="px-4 py-3 text-ui text-primary-300">Loading…</p>
        ) : (
          <>
            <div className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <p className="text-ui font-medium">
                  Income year {p.year} (Year of Assessment {p.yearOfAssessment}), due {formatDate(p.dueOn)}
                </p>
                <p className="mt-1 max-w-prose text-2xs text-primary-300">
                  {p.records.length} {p.records.length === 1 ? "employee" : "employees"} from approved payslips, in
                  IRAS's IR8A import template columns. Paste the rows (without the header) at row 6 of the template's
                  IR8A sheet, then import it in myTax Portal under Employment Income Records. Income is in whole dollars
                  with the cents dropped; deductions are rounded up. Crow HR cannot submit to IRAS directly: the AIS API
                  needs IRAS's approval of the software.
                </p>
                <a
                  href={p.templateUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="focus-ring mt-2 inline-flex items-center gap-1 rounded-sm text-2xs font-medium underline"
                >
                  IRAS IR8A import template <ExternalLink aria-hidden className="size-3" />
                </a>
              </div>
              <div className="flex shrink-0 flex-wrap gap-2">
                {p.records.length === 0 ? (
                  <span className="text-2xs text-primary-200">No approved payslips in {p.year}</span>
                ) : (
                  p.parts.map((part) => (
                    <Button key={part.part} size="sm" onClick={() => void get(part.part)}>
                      <Download aria-hidden />
                      {p.parts.length > 1 ? `Part ${part.part} (${part.records})` : "CSV"}
                    </Button>
                  ))
                )}
              </div>
            </div>
            {p.notes.length || withNotes.length || p.excluded.length || excluded ? (
              <div className="border-t border-border px-4 py-3 text-ui">
                <ul className="list-disc space-y-1 pl-5 text-primary-300">
                  {p.notes.map((n) => (
                    <li key={n.code}>{n.message}</li>
                  ))}
                  {withNotes.flatMap((r) =>
                    r.notes.map((n) => (
                      <li key={`${r.employeeId}-${n.code}`}>
                        <span className="font-medium text-foreground">{r.employeeName}:</span> {n.message}
                      </li>
                    )),
                  )}
                </ul>
                {(excluded ?? p.excluded).length ? (
                  <>
                    <p className="mt-2 font-medium text-warning-400">Left out of the file:</p>
                    <ul className="mt-1 list-disc pl-5">
                      {(excluded ?? p.excluded).map((x) => (
                        <li key={x.employeeName}>
                          {x.employeeName}: {x.reason}
                        </li>
                      ))}
                    </ul>
                  </>
                ) : null}
              </div>
            ) : null}
          </>
        )}
      </Card>
    </section>
  );
}
