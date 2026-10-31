import { toCsv } from "../leave/outputs.ts";
import type { RosterView } from "./rosters.ts";

/** Roster week as CSV, one row per shift (spec "Schedule views and export"). */
export const ROSTER_CSV_HEADER = [
  "Employee number",
  "Name",
  "Date",
  "Start",
  "End",
  "Break minutes",
  "Paid minutes",
  "Template",
  "Conflicts",
];

export function rosterCsv(view: RosterView): string {
  const people = new Map(view.employees.map((e) => [e.id, e]));
  const rows = view.shifts
    .filter((s) => s.kind === "shift")
    .map((s) => {
      const e = s.employeeId ? people.get(s.employeeId) : undefined;
      return [
        e?.employeeNumber ?? "",
        e?.name ?? "Open shift",
        s.date,
        s.start ?? "",
        s.end ?? "",
        s.breakMinutes,
        s.paidMinutes,
        s.templateCode ?? "",
        s.conflicts.map((c) => c.label).join("; "),
      ];
    })
    .sort((a, b) => `${a[2]}${a[1]}${a[3]}`.localeCompare(`${b[2]}${b[1]}${b[3]}`));
  return toCsv(ROSTER_CSV_HEADER, rows);
}
