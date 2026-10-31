import { attendanceReportSource } from "../attendance/report-source.ts";
import { claimsReportSource } from "../claims/report-source.ts";
import type { AppDeps } from "../deps.ts";
import { peopleReportSource } from "../employees/reports/source.ts";
import { leaveReportSource } from "../leave/reports.ts";
import { payrollReportSource } from "../payroll/reports.ts";
import type { AnyReportDefinition, ReportSource } from "./types.ts";

/**
 * Report sources shipped with core, one line per module (like `V1_MODULES` and
 * `CORE_WORKFLOW_PLUGINS`). Hosts and tests replace the list with `deps.reportSources`; a module
 * left out (not installed) registers no reports, and its report IDs answer 404.
 */
export const CORE_REPORT_SOURCES: readonly ReportSource[] = [
  peopleReportSource,
  leaveReportSource,
  attendanceReportSource,
  claimsReportSource,
  payrollReportSource,
];

export type ReportingAppDeps = AppDeps & { reportSources?: readonly ReportSource[] };

const cache = new WeakMap<object, readonly AnyReportDefinition[]>();

export function reportDefinitions(deps: AppDeps): readonly AnyReportDefinition[] {
  let found = cache.get(deps);
  if (!found) {
    const sources = (deps as ReportingAppDeps).reportSources ?? CORE_REPORT_SOURCES;
    const seen = new Set<string>();
    const defs: AnyReportDefinition[] = [];
    for (const source of sources) {
      for (const def of source.reports) {
        if (def.module !== source.module) throw new Error(`Report ${def.id} is registered by ${source.module}.`);
        if (seen.has(def.id)) throw new Error(`Report ${def.id} is registered twice.`);
        seen.add(def.id);
        defs.push(def);
      }
    }
    found = defs;
    cache.set(deps, found);
  }
  return found;
}

export function findReport(deps: AppDeps, id: string): AnyReportDefinition | undefined {
  return reportDefinitions(deps).find((d) => d.id === id);
}
