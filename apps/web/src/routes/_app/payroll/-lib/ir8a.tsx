import type { PayrollIr8aPreviewDto } from "@crowhr/core";
import { Button, Card, formatDate, singaporeTodayIso, toast } from "@crowhr/ui";
import { queryOptions, useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ArrowRight, Download, ExternalLink } from "lucide-react";
import * as React from "react";
import { useReauth } from "../../../../auth/reauth.tsx";
import { ErrorNote } from "../../../../components/section.tsx";
import { api, downloadFile, type Excluded, errorMessage } from "./api.ts";
import { groupEmployeeNotes, namesSummary } from "./notes.ts";

export const ir8aQuery = (year: number) =>
  queryOptions({
    queryKey: ["payroll", "ir8a", year] as const,
    queryFn: () => api<PayrollIr8aPreviewDto>("GET", `/payroll/years/${year}/ir8a`),
  });

type Sheet = "ir8a" | "appendix-8a-accommodation" | "appendix-8a-hotel-others" | "appendix-8b";

/** Appendix sheets of the import template, with the preview's row count per part. */
const APPENDIX_SHEETS: {
  sheet: Exclude<Sheet, "ir8a">;
  label: string;
  rows: (p: PayrollIr8aPreviewDto["parts"][number]) => number;
}[] = [
  { sheet: "appendix-8a-accommodation", label: "8A accommodation", rows: (p) => p.appendix8aAccommodation },
  { sheet: "appendix-8a-hotel-others", label: "8A hotel & others", rows: (p) => p.appendix8aHotelOthers },
  { sheet: "appendix-8b", label: "8B", rows: (p) => p.appendix8b },
];

/** Year end: IR8A rows and the Appendix 8A/8B sheets for IRAS's import template. */
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
  const get = (part: number, sheet: Sheet = "ir8a") =>
    reauth(() =>
      downloadFile(`/payroll/years/${year}/ir8a/file?part=${part}${sheet === "ir8a" ? "" : `&sheet=${sheet}`}`),
    )
      .then((r) => {
        const out = r as Awaited<ReturnType<typeof downloadFile>>;
        if (part === 1 && sheet === "ir8a") setExcluded(out.excluded.length ? out.excluded : null);
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
                  {p.records.length} {p.records.length === 1 ? "employee" : "employees"} from approved payslips and the
                  year's benefits-in-kind and share gains, in IRAS's IR8A import template columns. Paste the IR8A rows
                  (without the header) at row 6 of the template's IR8A sheet and each appendix file at row 2 of its
                  sheet, then import the workbook in myTax Portal under Employment Income Records. Income is in whole
                  dollars with the cents dropped; deductions are rounded up. Crow HR cannot submit to IRAS directly: the
                  AIS API needs IRAS's approval of the software.
                </p>
                <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
                  <Link
                    to="/payroll/year-end/$year"
                    params={{ year: String(p.year) }}
                    className="focus-ring inline-flex items-center gap-1 rounded-sm text-2xs font-medium underline"
                  >
                    Benefits and share gains (Appendix 8A, 8B) <ArrowRight aria-hidden className="size-3" />
                  </Link>
                  <a
                    href={p.templateUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="focus-ring inline-flex items-center gap-1 rounded-sm text-2xs font-medium underline"
                  >
                    IRAS IR8A import template <ExternalLink aria-hidden className="size-3" />
                  </a>
                </p>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-2">
                {p.records.length === 0 ? (
                  <span className="text-2xs text-primary-200">
                    No approved payslips or appendix records in {p.year}
                  </span>
                ) : (
                  p.parts.map((part) => (
                    <div key={part.part} className="flex flex-wrap justify-end gap-2">
                      <Button size="sm" onClick={() => void get(part.part)}>
                        <Download aria-hidden />
                        {p.parts.length > 1 ? `Part ${part.part} (${part.records})` : "CSV"}
                      </Button>
                      {APPENDIX_SHEETS.filter((s) => s.rows(part) > 0).map((s) => (
                        <Button key={s.sheet} size="sm" onClick={() => void get(part.part, s.sheet)}>
                          <Download aria-hidden />
                          {p.parts.length > 1 ? `Part ${part.part} ${s.label}` : s.label}
                        </Button>
                      ))}
                    </div>
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
                  {groupEmployeeNotes(withNotes).map((g) => (
                    <li key={g.key}>
                      <span className="font-medium text-foreground">
                        {g.names.length === 1 ? g.names[0] : `${g.names.length} employees`}:
                      </span>{" "}
                      {g.message}
                      {g.names.length > 1 ? (
                        <details className="mt-0.5">
                          <summary className="focus-ring w-fit cursor-pointer rounded-sm text-2xs font-medium text-ink">
                            {namesSummary(g.names)}
                          </summary>
                          <p className="mt-1 text-2xs">{g.names.join(", ")}</p>
                        </details>
                      ) : null}
                    </li>
                  ))}
                </ul>
                {(excluded ?? p.excluded).length ? (
                  <>
                    <p className="mt-2 font-medium text-warning-400">Left out of the file:</p>
                    <ul className="mt-1 list-disc pl-5">
                      {(excluded ?? p.excluded).map((x) => (
                        <li key={`${x.employeeName}-${x.reason}`}>
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
